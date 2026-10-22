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
const output = new URL('../apps/admin-web/.test-build/purchases/', import.meta.url);
await mkdir(output, { recursive: true });
for (const file of ['client', 'purchase-form', 'purchases']) {
  const source = await readFile(
    new URL(`../apps/admin-web/src/api/${file}.ts`, import.meta.url),
    'utf8',
  );
  const compiled = ts
    .transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
    })
    .outputText.replace(
      /(['"])\.\/(client|purchase-form)\1/g,
      (_all, _quote, name) => `'./${name}.mjs'`,
    );
  await writeFile(new URL(file + '.mjs', output), compiled);
}
const { createApiClient, ApiFailure } = await import(new URL('client.mjs', output));
const { createPurchases } = await import(new URL('purchases.mjs', output));
const {
  blankPurchase,
  newPurchaseLine,
  purchaseForm,
  purchaseErrors,
  purchasePayload,
  preview,
  mayCancel,
} = await import(new URL('purchase-form.mjs', output));
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
  'production purchase forms and service against PostgreSQL and Nest API',
  { timeout: 180000 },
  async (t) => {
    const source = new URL(process.env.DATABASE_URL);
    assert.ok(['localhost', '127.0.0.1'].includes(source.hostname));
    assert.equal(source.pathname, '/caicang');
    const name = 'caicang_test_' + randomUUID().replaceAll('-', '');
    const url = new URL(source);
    url.pathname = '/' + name;
    const admin = new Client({ connectionString: source.toString() }),
      db = new Client({ connectionString: url.toString() });
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
      await t.test('real API with production frontend logic', async (http) => {
        const base = await startTestApi(http, {
          env: {
            DATABASE_URL: url.toString(),
            NODE_ENV: 'test',
            JWT_ACCESS_SECRET: randomBytes(48).toString('hex'),
            TRUSTED_PROXIES: '127.0.0.1/32,::1/128',
          },
        });
        const clients = {},
          accounts = {};
        for (const actor of ['owner', 'buyer', 'viewer', 'warehouse']) {
          const client = createApiClient({
            baseUrl: base + '/api/v1',
            storage: memory(),
            lock: (work) => work(),
            fetcher: (input, init) =>
              fetch(input, {
                ...init,
                headers: { ...init.headers, 'X-Forwarded-For': `198.18.3.${++counter}` },
              }),
          });
          const credentials = {
            email: actor + '@purchases.example.test',
            password: 'PurchaseTests!2026',
          };
          await client.register(credentials);
          accounts[actor] = await client.login(credentials);
          clients[actor] = client;
        }
        const client = clients.owner;
        const tenant = (
          await client.request('/tenants', { method: 'POST', body: { name: '采购 A' } })
        ).data;
        const other = (
          await client.request('/tenants', { method: 'POST', body: { name: '采购 B' } })
        ).data;
        for (const [actor, role] of [
          ['buyer', 'BUYER'],
          ['viewer', 'VIEWER'],
          ['warehouse', 'WAREHOUSE'],
        ])
          await client.request('/members', {
            tenantId: tenant.tenant.id,
            method: 'POST',
            body: { email: accounts[actor].email, role },
          });
        async function context(actor, tenantId) {
          const current = (await clients[actor].request('/tenants/current', { tenantId })).data;
          return {
            userId: accounts[actor].id,
            sessionKey: clients[actor].sync().sessionKey,
            tenantId,
            permissions: current.permissions,
          };
        }
        const scopeA = await context('owner', tenant.tenant.id),
          scopeB = await context('owner', other.tenant.id);
        let scope = scopeA;
        const api = createPurchases(client, () => scope);
        const rejected = (status, code) => (e) =>
          e instanceof ApiFailure && e.status === status && (!code || e.code === code);
        const products = [];
        for (const [sku, price] of [
          ['CHARGER-20W', '18.50'],
          ['CABLE-USB', '9.00'],
        ])
          products.push(
            (
              await client.request('/products', {
                tenantId: scopeA.tenantId,
                method: 'POST',
                body: { name: sku, sku, unit: '个', referencePurchasePrice: price },
              })
            ).data,
          );
        const warehouse = (await api.warehouses())[0];
        function form() {
          return {
            ...blankPurchase(),
            warehouseId: warehouse.id,
            recipientName: '本地测试员',
            recipientPhone: '13800000000',
            recipientAddress: '测试仓库，虚构地址',
            platformOrderNo: 'TAOBAO-TEST-0001',
            supplierName: '测试店铺',
            freightAmount: '10.00',
            items: products.map((p) => newPurchaseLine(p)),
          };
        }
        let original;
        await http.test('two SKU exact estimate, discount and freight match 235.00', () => {
          const f = form();
          f.items[0].quantity = '10';
          f.items[1].quantity = '5';
          f.items[1].discountAmount = '5.00';
          assert.deepEqual(purchaseErrors(f), {});
          assert.equal(preview(f).totalCost, '235.00');
          assert.equal(preview(f).goodsAmount, '230.00');
          assert.equal(preview(f).discountAmount, '5.00');
          original = f;
        });
        await http.test('large amounts remain precise beyond Number safe integers', () => {
          const f = form();
          f.items = [{ ...f.items[0], unitPrice: '90071992547409.93', quantity: '1' }];
          f.freightAmount = '0.01';
          assert.equal(preview(f).totalCost, '90071992547409.94');
          f.items[0].unitPrice = '9999999999999999.99';
          assert.equal(preview(f).valid, false);
          assert.ok(purchaseErrors(f).total);
        });
        await http.test(
          'invalid fields, malformed dates, duplicate SKU and invalid amounts are rejected',
          () => {
            assert.ok(purchaseErrors(blankPurchase()).items);
            for (const value of ['-1', '1e2', '1.001', 'NaN', ' 1.00', '10000000000000000']) {
              const f = form();
              f.items[0].unitPrice = value;
              assert.ok(purchaseErrors(f)['items.0.unitPrice']);
              assert.equal(preview(f).valid, false);
            }
            for (const quantity of ['0', '-1', '1.5', '2147483648', 'x']) {
              const f = form();
              f.items[0].quantity = quantity;
              assert.ok(purchaseErrors(f)['items.0.quantity']);
            }
            const f = form();
            f.items[0].discountAmount = '999';
            f.items[1].productId = f.items[0].productId;
            f.purchaseDate = '2026-02-30';
            assert.ok(purchaseErrors(f)['items.0.discountAmount']);
            assert.ok(purchaseErrors(f)['items.1.productId']);
            assert.ok(purchaseErrors(f).purchaseDate);
            f.items = Array.from({ length: 101 }, () => f.items[0]);
            assert.ok(purchaseErrors(f).items);
          },
        );
        await http.test(
          'stable generated order number and explicit payload discard display and injected fields',
          () => {
            const number = original.orderNo;
            const payload = purchasePayload({
              ...original,
              tenantId: scopeB.tenantId,
              status: 'PLACED',
            });
            assert.equal(payload.orderNo, number);
            assert.equal(purchasePayload(original).orderNo, number);
            assert.ok(!('tenantId' in payload));
            assert.ok(!('status' in payload));
            assert.deepEqual(Object.keys(payload.items[0]).sort(), [
              'discountAmount',
              'productId',
              'quantity',
              'unitPrice',
            ]);
          },
        );
        let order;
        await http.test(
          'production save creates one order with two real database lines and server total',
          async () => {
            order = await api.save(original);
            assert.equal(order.status, 'DRAFT');
            assert.equal(order.totalCost, '235.00');
            assert.equal(order.items.length, 2);
            const result = await db.query(
              'SELECT (sum(i.quantity*i.unit_price-i.discount_amount)+o.freight_amount)::text AS total_cost, count(i.id)::int AS lines FROM purchase_orders o JOIN purchase_order_items i ON i.purchase_order_id=o.id AND i.tenant_id=o.tenant_id WHERE o.id=$1 GROUP BY o.id',
              [order.id],
            );
            assert.equal(result.rows[0].total_cost, '235.00');
            assert.equal(result.rows[0].lines, 2);
          },
        );
        await http.test(
          'duplicate retry returns conflict without creating or overwriting another order',
          async () => {
            await assert.rejects(
              api.save(original),
              rejected(409, 'PURCHASE_ORDER_NO_ALREADY_EXISTS'),
            );
            assert.equal(
              (await api.list({ page: 1, pageSize: 20, search: original.orderNo })).pagination
                .total,
              1,
            );
          },
        );
        await http.test(
          'editing draft keeps original price after product reference price changes',
          async () => {
            await client.request('/products/' + products[0].id, {
              tenantId: scopeA.tenantId,
              method: 'PATCH',
              body: { referencePurchasePrice: '999.00' },
            });
            const f = purchaseForm(await api.detail(order.id));
            assert.equal(f.items[0].unitPrice, '18.50');
            f.remark = '已核对';
            const ids = order.items.map((i) => i.id);
            order = await api.save(f, order.id);
            assert.equal(order.totalCost, '235.00');
            assert.deepEqual(
              order.items.map((i) => i.id),
              ids,
            );
          },
        );
        await http.test(
          'list filters search pagination and empty result use server data',
          async () => {
            const second = form();
            second.platform = 'JD';
            await api.save(second);
            const filtered = await api.list({
              page: 1,
              pageSize: 1,
              status: 'DRAFT',
              platform: 'TAOBAO',
              search: original.platformOrderNo,
            });
            assert.equal(filtered.pagination.total, 1);
            assert.equal(filtered.data[0].id, order.id);
            assert.equal((await api.list({ page: 2, pageSize: 1 })).data.length, 1);
            assert.equal(
              (await api.list({ page: 1, pageSize: 20, search: 'not-present' })).data.length,
              0,
            );
          },
        );
        await http.test(
          'place returns authoritative allocations and server rejects frozen editing',
          async () => {
            order = await api.action(order.id, 'place');
            assert.equal(order.status, 'PLACED');
            assert.equal(order.totalCost, '235.00');
            assert.equal(order.items[0].freightAllocated, '8.22');
            assert.equal(order.items[1].freightAllocated, '1.78');
            await assert.rejects(api.save(purchaseForm(order), order.id), rejected(409));
            assert.equal((await api.action(order.id, 'place')).id, order.id);
          },
        );
        await http.test(
          'legal cancellation preserves both lines and invalid state transition is refused',
          async () => {
            assert.equal(mayCancel(order), true);
            order = await api.action(order.id, 'cancel');
            assert.equal(order.status, 'CANCELLED');
            assert.equal(mayCancel(order), false);
            assert.equal(order.items.length, 2);
            await assert.rejects(api.action(order.id, 'place'), rejected(409));
            assert.equal(
              mayCancel({ ...order, status: 'PLACED', items: [{ receivedQuantity: 1 }] }),
              false,
            );
          },
        );
        await http.test(
          'buyer may write while viewer and warehouse cannot bypass service or API permissions',
          async () => {
            const buyer = await context('buyer', scopeA.tenantId);
            assert.equal(
              (await createPurchases(clients.buyer, () => buyer).save(form())).status,
              'DRAFT',
            );
            for (const actor of ['viewer', 'warehouse']) {
              const current = await context(actor, scopeA.tenantId);
              const readonly = createPurchases(clients[actor], () => current);
              assert.equal((await readonly.detail(order.id)).id, order.id);
              await assert.rejects(readonly.save(form()), rejected(403));
              await assert.rejects(readonly.action(order.id, 'cancel'), rejected(403));
              await assert.rejects(
                clients[actor].request('/purchase-orders', {
                  tenantId: scopeA.tenantId,
                  method: 'POST',
                  body: purchasePayload(form()),
                }),
                rejected(403),
              );
            }
            const view = await context('viewer', scopeA.tenantId);
            assert.equal(
              (await createPurchases(clients.viewer, () => view).detail(order.id)).recipientMasked,
              true,
            );
          },
        );
        await http.test('foreign tenant resource IDs never leak or mutate data', async () => {
          scope = scopeB;
          assert.equal((await api.list({ page: 1, pageSize: 20 })).data.length, 0);
          await assert.rejects(api.detail(order.id), rejected(404));
          await assert.rejects(api.save(form()), rejected(404));
          await assert.rejects(api.action(order.id, 'cancel'), rejected(404));
          scope = scopeA;
        });
        await http.test(
          'late successful response is rejected after tenant, user or session changes',
          async () => {
            for (const changes of [
              { tenantId: scopeB.tenantId },
              { userId: randomUUID() },
              { sessionKey: randomUUID() },
            ]) {
              scope = scopeA;
              const delayed = createPurchases(
                {
                  request: async (...args) => {
                    const result = await client.request(...args);
                    scope = { ...scopeA, ...changes };
                    return result;
                  },
                },
                () => scope,
              );
              await assert.rejects(delayed.detail(order.id), rejected(409, 'SCOPE_CHANGED'));
            }
            scope = scopeA;
          },
        );
        await http.test('failed read can retry and invalid form never sends HTTP', async () => {
          let fail = true,
            calls = 0;
          const unreliable = createPurchases(
            {
              request: (...args) => {
                calls++;
                if (fail) {
                  fail = false;
                  throw new ApiFailure(0, 'NETWORK_ERROR', 'offline');
                }
                return client.request(...args);
              },
            },
            () => scope,
          );
          await assert.rejects(unreliable.list({ page: 1, pageSize: 20 }), rejected(0));
          assert.ok((await unreliable.list({ page: 1, pageSize: 20 })).data.length);
          assert.equal(calls, 2);
          await assert.rejects(unreliable.save(blankPurchase()), rejected(400));
          assert.equal(calls, 2);
        });
        await http.test(
          'concurrent same-number saves persist one order and two lines',
          async () => {
            const f = form();
            const results = await Promise.allSettled([api.save(f), api.save(f)]);
            assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
            assert.ok(rejected(409)(results.find((r) => r.status === 'rejected').reason));
            assert.equal(
              (
                await db.query(
                  'SELECT count(*)::int total FROM purchase_orders WHERE tenant_id=$1 AND order_no=$2',
                  [scopeA.tenantId, f.orderNo],
                )
              ).rows[0].total,
              1,
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
