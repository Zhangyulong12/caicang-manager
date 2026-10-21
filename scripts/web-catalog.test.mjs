import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';
import ts from 'typescript';
import { startTestApi } from './api-test-server.mjs';
const output = new URL('../apps/admin-web/.test-build/catalog/', import.meta.url);
await mkdir(output, { recursive: true });
for (const file of ['client', 'catalog-form', 'catalog']) {
  const source = await readFile(
    new URL(`../apps/admin-web/src/api/${file}.ts`, import.meta.url),
    'utf8',
  );
  const compiled = ts
    .transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
    })
    .outputText.replace(
      /(['"])\.\/(client|catalog-form)\1/g,
      (_all, _quote, name) => `'./${name}.mjs'`,
    );
  await writeFile(new URL(file + '.mjs', output), compiled);
}
const { createApiClient, ApiFailure } = await import(new URL('client.mjs', output));
const { createCatalog } = await import(new URL('catalog.mjs', output));
const { blankProduct, productForm, productErrors, warehouseErrors } = await import(
  new URL('catalog-form.mjs', output)
);
const { Client } = createRequire(new URL('../apps/api/package.json', import.meta.url))('pg');
const runFile = promisify(execFile);
loadEnvFile(new URL('../.env', import.meta.url));
const memory = () => {
  const values = new Map();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
};

test(
  'production catalog forms and service with real PostgreSQL, API roles and scoped warehouse preference',
  { timeout: 180000 },
  async (t) => {
    const source = new URL(process.env.DATABASE_URL);
    assert.ok(['localhost', '127.0.0.1'].includes(source.hostname));
    assert.equal(source.pathname, '/caicang');
    const name = 'caicang_test_' + randomUUID().replaceAll('-', '');
    const url = new URL(source);
    url.pathname = '/' + name;
    const admin = new Client({ connectionString: source.toString() });
    const db = new Client({ connectionString: url.toString() });
    let created = false,
      connected = false,
      counter = 0;
    try {
      await admin.connect();
      assert.match(name, /^caicang_test_[a-f0-9]{32}$/);
      await admin.query(`CREATE DATABASE "${name}"`);
      created = true;
      await runFile(
        process.execPath,
        [
          fileURLToPath(new URL('../apps/api/node_modules/prisma/build/index.js', import.meta.url)),
          'migrate',
          'deploy',
        ],
        {
          cwd: fileURLToPath(new URL('../apps/api/', import.meta.url)),
          env: { ...process.env, DATABASE_URL: url.toString() },
          windowsHide: true,
          timeout: 60000,
        },
      );
      await db.connect();
      connected = true;
      await t.test('real API and production frontend catalog', async (http) => {
        const base = await startTestApi(http, {
          env: {
            DATABASE_URL: url.toString(),
            NODE_ENV: 'test',
            JWT_ACCESS_SECRET: randomBytes(48).toString('hex'),
            TRUSTED_PROXIES: '127.0.0.1/32,::1/128',
          },
        });
        const accounts = {};
        const clients = {};
        for (const actor of ['owner', 'buyer', 'viewer']) {
          const client = createApiClient({
            baseUrl: base + '/api/v1',
            storage: memory(),
            lock: (work) => work(),
            fetcher: (input, init) =>
              fetch(input, {
                ...init,
                headers: { ...init.headers, 'X-Forwarded-For': `198.18.1.${++counter}` },
              }),
          });
          await client.register({
            email: actor + '@catalog.example.test',
            password: 'CatalogTests!2026',
          });
          accounts[actor] = await client.login({
            email: actor + '@catalog.example.test',
            password: 'CatalogTests!2026',
          });
          clients[actor] = client;
        }
        const client = clients.owner;
        const tenant = (
          await client.request('/tenants', { method: 'POST', body: { name: 'A Catalog' } })
        ).data;
        const other = (
          await client.request('/tenants', { method: 'POST', body: { name: 'B Catalog' } })
        ).data;
        for (const [actor, role] of [
          ['buyer', 'BUYER'],
          ['viewer', 'VIEWER'],
        ])
          await client.request('/members', {
            tenantId: tenant.tenant.id,
            method: 'POST',
            body: { email: accounts[actor].email, role },
          });
        const context = async (actor, tenantId) => {
          const current = (await clients[actor].request('/tenants/current', { tenantId })).data;
          return {
            userId: accounts[actor].id,
            sessionKey: clients[actor].sync().sessionKey,
            tenantId,
            permissions: current.permissions,
          };
        };
        const scopeA = await context('owner', tenant.tenant.id);
        const scopeB = await context('owner', other.tenant.id);
        let scope = scopeA;
        const storage = memory();
        const api = createCatalog(client, () => scope, storage);
        const rejected = (status, code) => (error) =>
          error instanceof ApiFailure && error.status === status && (!code || error.code === code);
        let product, warehouse;
        await http.test(
          'empty forms show required name SKU unit and warehouse field errors',
          () => {
            assert.deepEqual(Object.keys(productErrors({ ...blankProduct(), unit: '' })).sort(), [
              'name',
              'sku',
              'unit',
            ]);
            assert.deepEqual(
              Object.keys(warehouseErrors({ name: ' ', code: '', remark: '' })).sort(),
              ['code', 'name'],
            );
          },
        );
        await http.test(
          'SKU barcode text and decimal validation preserves codes and refuses invalid inputs',
          () => {
            for (const fields of [
              { sku: 's'.repeat(81) },
              { sku: 'x\ncode' },
              { barcode: 'b'.repeat(129) },
              { barcode: 'x\0code' },
              { referencePurchasePrice: '-1' },
              { referencePurchasePrice: '1.234' },
              { referencePurchasePrice: '1e2' },
              { referencePurchasePrice: '10000000000000000' },
              { referencePurchasePrice: ' 1.00' },
              { remark: 'r'.repeat(2001) },
            ])
              assert.ok(
                Object.keys(productErrors({ ...blankProduct(), name: 'x', sku: 'x', ...fields }))
                  .length,
              );
            assert.deepEqual(
              productErrors({
                ...blankProduct(),
                name: '充电器',
                sku: '000AbC',
                barcode: '000123',
                referencePurchasePrice: '18.50',
              }),
              {},
            );
          },
        );
        await http.test('invalid forms are rejected before a write request', async () => {
          const before = counter;
          await assert.rejects(api.saveProduct(blankProduct()), rejected(400, 'VALIDATION_ERROR'));
          await assert.rejects(
            api.saveWarehouse({ name: '', code: '', remark: '' }),
            rejected(400),
          );
          assert.equal(counter, before);
        });
        await http.test(
          'create product sends actual fields to PostgreSQL without a fixed frontend record',
          async () => {
            product = await api.saveProduct({
              ...blankProduct(),
              name: '20W 充电器',
              sku: 'CHARGER-20W',
              barcode: '000123456',
              referencePurchasePrice: '18.50',
              remark: '真实测试档案',
            });
            assert.equal(product.referencePurchasePrice, '18.50');
            assert.equal(product.barcode, '000123456');
            assert.equal(
              (
                await db.query('SELECT name FROM products WHERE tenant_id=$1 AND id=$2', [
                  scopeA.tenantId,
                  product.id,
                ])
              ).rows[0].name,
              '20W 充电器',
            );
          },
        );
        await http.test(
          'duplicate SKU and barcode errors retain their standard field-specific codes',
          async () => {
            await assert.rejects(
              api.saveProduct({ ...blankProduct(), name: 'x', sku: product.sku }),
              rejected(409, 'PRODUCT_SKU_ALREADY_EXISTS'),
            );
            await assert.rejects(
              api.saveProduct({
                ...blankProduct(),
                name: 'x',
                sku: 'OTHER',
                barcode: product.barcode,
              }),
              rejected(409, 'PRODUCT_BARCODE_ALREADY_EXISTS'),
            );
          },
        );
        await http.test(
          'search filters and pagination query real totals and preserve literal search characters',
          async () => {
            for (let i = 0; i < 12; i++)
              await api.saveProduct({ ...blankProduct(), name: `分页商品 ${i}`, sku: `PAGE-${i}` });
            const first = await api.products({ page: 1, pageSize: 10 });
            const second = await api.products({ page: 2, pageSize: 10 });
            assert.equal(first.pagination.total, 13);
            assert.equal(first.data.length, 10);
            assert.equal(second.data.length, 3);
            assert.equal(new Set([...first.data, ...second.data].map((row) => row.id)).size, 13);
            assert.equal(
              (await api.products({ page: 1, pageSize: 20, search: 'CHARGER-20W' })).data[0].id,
              product.id,
            );
            await api.saveProduct({ ...blankProduct(), name: 'USB_% + special', sku: 'LITERAL' });
            assert.equal(
              (await api.products({ page: 1, pageSize: 20, search: '_% +' })).data.length,
              1,
            );
          },
        );
        await http.test(
          'detail edit nullable fields and precise prices persist across a fresh service instance',
          async () => {
            const form = productForm(await api.product(product.id));
            form.name = '充电器更新';
            form.referencePurchasePrice = '26.50';
            form.barcode = '';
            product = await api.saveProduct(form, product.id);
            assert.equal(product.barcode, null);
            const reloaded = await createCatalog(client, () => scopeA, storage).product(product.id);
            assert.equal(reloaded.name, form.name);
            assert.equal(reloaded.referencePurchasePrice, '26.50');
          },
        );
        await http.test(
          'disable is a real PATCH and remains visible in details and the disabled filter',
          async () => {
            await api.setActive(product.id, false);
            assert.equal((await api.product(product.id)).isActive, false);
            assert.equal(
              (await api.products({ page: 1, pageSize: 20, isActive: false })).data[0].id,
              product.id,
            );
            assert.equal(
              (await api.products({ page: 1, pageSize: 20, isActive: true })).data.some(
                (row) => row.id === product.id,
              ),
              false,
            );
          },
        );
        await http.test(
          'buyer may maintain products but cannot create warehouses in frontend or server',
          async () => {
            const buyerScope = await context('buyer', scopeA.tenantId);
            const buyer = createCatalog(clients.buyer, () => buyerScope, storage);
            await buyer.saveProduct({ ...blankProduct(), name: '采购员商品', sku: 'BUYER-ITEM' });
            await assert.rejects(
              buyer.saveWarehouse({ name: 'x', code: 'BUYER', remark: '' }),
              rejected(403),
            );
            await assert.rejects(
              clients.buyer.request('/warehouses', {
                tenantId: scopeA.tenantId,
                method: 'POST',
                body: { name: 'x', code: 'BUYER' },
              }),
              rejected(403),
            );
          },
        );
        await http.test(
          'viewer can read but cannot bypass buttons to write products or warehouses',
          async () => {
            const viewerScope = await context('viewer', scopeA.tenantId);
            const viewer = createCatalog(clients.viewer, () => viewerScope, storage);
            assert.ok((await viewer.products({ page: 1, pageSize: 20 })).data.length);
            for (const operation of [
              () => viewer.saveProduct({ ...blankProduct(), name: 'x', sku: 'VIEWER' }),
              () => viewer.setActive(product.id, true),
              () => viewer.saveWarehouse({ name: 'x', code: 'VIEWER', remark: '' }),
            ])
              await assert.rejects(operation(), rejected(403));
            await assert.rejects(
              clients.viewer.request('/products/' + product.id, {
                tenantId: scopeA.tenantId,
                method: 'PATCH',
                body: { name: 'unauthorized' },
              }),
              rejected(403),
            );
          },
        );
        await http.test(
          'create warehouse and duplicate code use real database constraints',
          async () => {
            warehouse = await api.saveWarehouse({
              name: '二号仓',
              code: 'WH-02',
              remark: '小件货物',
            });
            assert.equal(warehouse.remark, '小件货物');
            await assert.rejects(
              api.saveWarehouse({ name: '重复', code: 'WH-02', remark: '' }),
              rejected(409, 'WAREHOUSE_CODE_ALREADY_EXISTS'),
            );
          },
        );
        await http.test(
          'default preference resolves the real initial warehouse and survives service recreation',
          async () => {
            assert.equal((await api.defaultWarehouse()).id, tenant.defaultWarehouse.id);
            await api.defaultWarehouse(warehouse.id);
            assert.equal(
              (await createCatalog(client, () => scopeA, storage).defaultWarehouse()).id,
              warehouse.id,
            );
          },
        );
        await http.test(
          'preference is independent for different merchants and different users',
          async () => {
            scope = scopeB;
            assert.equal((await api.defaultWarehouse()).id, other.defaultWarehouse.id);
            scope = scopeA;
            assert.equal((await api.defaultWarehouse()).id, warehouse.id);
            const viewerScope = await context('viewer', scopeA.tenantId);
            const viewer = createCatalog(clients.viewer, () => viewerScope, storage);
            assert.equal((await viewer.defaultWarehouse()).id, tenant.defaultWarehouse.id);
            assert.equal((await api.defaultWarehouse()).id, warehouse.id);
          },
        );
        await http.test(
          'cross-merchant preference IDs are rejected without overwriting the valid preference',
          async () => {
            await assert.rejects(api.defaultWarehouse(other.defaultWarehouse.id), rejected(404));
            assert.equal((await api.defaultWarehouse()).id, warehouse.id);
          },
        );
        await http.test(
          'inactive preference falls back to an active initial warehouse',
          async () => {
            await db.query('UPDATE warehouses SET is_active=false WHERE id=$1', [warehouse.id]);
            assert.equal((await api.defaultWarehouse()).id, tenant.defaultWarehouse.id);
            await assert.rejects(api.defaultWarehouse(warehouse.id), rejected(404));
            await db.query('UPDATE warehouses SET is_active=true WHERE id=$1', [warehouse.id]);
          },
        );
        await http.test(
          'selection checks all pages including a warehouse outside the first hundred',
          async () => {
            // Pagination fixtures exist only in this owned temporary DB, never in frontend source/dev data.
            await db.query(
              "INSERT INTO warehouses(tenant_id,code,name) SELECT $1,'PAGE-W-'||i,'分仓 '||i FROM generate_series(1,101) i",
              [scopeA.tenantId],
            );
            assert.equal((await api.warehouses(2, 100)).pagination.total, 103);
            assert.equal((await api.defaultWarehouse(warehouse.id)).id, warehouse.id);
          },
        );
        await http.test(
          'no active warehouses clears the preference instead of choosing an inactive record',
          async () => {
            scope = scopeB;
            await db.query('UPDATE warehouses SET is_active=false WHERE tenant_id=$1', [
              scopeB.tenantId,
            ]);
            assert.equal(await api.defaultWarehouse(), null);
            await db.query('UPDATE warehouses SET is_active=true WHERE tenant_id=$1', [
              scopeB.tenantId,
            ]);
            scope = scopeA;
          },
        );
        await http.test(
          'cross-tenant product IDs do not leak through the frontend service',
          async () => {
            scope = scopeB;
            await assert.rejects(api.product(product.id), rejected(404));
            scope = scopeA;
          },
        );
        await http.test('late product responses are rejected after a merchant switch', async () => {
          let release;
          const gate = new Promise((resolve) => {
            release = resolve;
          });
          let arrived;
          const ready = new Promise((resolve) => {
            arrived = resolve;
          });
          const slow = createCatalog(
            {
              request: async (...args) => {
                const result = await client.request(...args);
                arrived();
                await gate;
                return result;
              },
            },
            () => scope,
            storage,
          );
          const outcome = assert.rejects(
            slow.products({ page: 1, pageSize: 20 }),
            rejected(409, 'SCOPE_CHANGED'),
          );
          await ready;
          scope = scopeB;
          release();
          await outcome;
          scope = scopeA;
        });
        await http.test('failed reads can be retried without fabricated data', async () => {
          let fail = true;
          const unreliable = createCatalog(
            {
              request: (...args) => {
                if (fail) {
                  fail = false;
                  throw new ApiFailure(0, 'NETWORK_ERROR', 'offline');
                }
                return client.request(...args);
              },
            },
            () => scope,
            storage,
          );
          await assert.rejects(unreliable.products({ page: 1, pageSize: 20 }), rejected(0));
          assert.ok(
            (await unreliable.products({ page: 1, pageSize: 20 })).data.some(
              (row) => row.id === product.id,
            ),
          );
        });
        await http.test(
          'concurrent duplicate submissions persist exactly one product',
          async () => {
            const form = { ...blankProduct(), name: '并发商品', sku: 'CONCURRENT-SKU' };
            const results = await Promise.allSettled([
              api.saveProduct(form),
              api.saveProduct(form),
            ]);
            assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
            const failed = results.find((result) => result.status === 'rejected');
            assert.ok(rejected(409, 'PRODUCT_SKU_ALREADY_EXISTS')(failed.reason));
            assert.equal(
              (
                await db.query(
                  'SELECT count(*)::int AS total FROM products WHERE tenant_id=$1 AND sku=$2',
                  [scopeA.tenantId, form.sku],
                )
              ).rows[0].total,
              1,
            );
          },
        );
        await http.test(
          'a server-side member revocation still blocks a stale frontend permission snapshot',
          async () => {
            const viewerScope = await context('viewer', scopeA.tenantId);
            await db.query(
              'UPDATE tenant_memberships SET is_active=false WHERE tenant_id=$1 AND user_id=$2',
              [scopeA.tenantId, accounts.viewer.id],
            );
            await assert.rejects(
              createCatalog(clients.viewer, () => viewerScope, storage).warehouses(),
              rejected(403),
            );
          },
        );
      });
    } finally {
      if (connected) await db.end();
      if (created) await admin.query(`DROP DATABASE "${name}"`);
      await admin.end();
    }
  },
);
