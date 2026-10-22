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
const output = new URL('../apps/admin-web/.test-build/packages/', import.meta.url);
await mkdir(output, { recursive: true });
for (const file of ['client', 'packages', 'package-status']) {
  const source = await readFile(
    new URL(`../apps/admin-web/src/api/${file}.ts`, import.meta.url),
    'utf8',
  );
  const compiled = ts
    .transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
    })
    .outputText.replace(/(['"])\.\/client\1/g, "'./client.mjs'");
  await writeFile(new URL(file + '.mjs', output), compiled);
}
const { createApiClient, ApiFailure } = await import(new URL('client.mjs', output));
const { createPackages } = await import(new URL('packages.mjs', output));
const {
  expectedTotal,
  receivingPercent,
  itemSummary,
  formatTime,
  packageStatusTone,
  receivingStatusTone,
  packageStatusNames,
  receivingStatusNames,
} = await import(new URL('package-status.mjs', output));
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
  'production package list and detail client against PostgreSQL and Nest API',
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
        for (const actor of ['owner', 'buyer', 'warehouse', 'viewer']) {
          const client = createApiClient({
            baseUrl: base + '/api/v1',
            storage: memory(),
            lock: (work) => work(),
            fetcher: (input, init) =>
              fetch(input, {
                ...init,
                headers: { ...init.headers, 'X-Forwarded-For': `198.18.4.${++counter}` },
              }),
          });
          const credentials = {
            email: actor + '@packages-ui.example.test',
            password: 'PackageUiTests!2026',
          };
          await client.register(credentials);
          accounts[actor] = await client.login(credentials);
          clients[actor] = client;
        }
        const client = clients.owner;
        const tenant = (
          await client.request('/tenants', { method: 'POST', body: { name: '包裹 A' } })
        ).data;
        const other = (
          await client.request('/tenants', { method: 'POST', body: { name: '包裹 B' } })
        ).data;
        for (const [actor, role] of [
          ['buyer', 'BUYER'],
          ['warehouse', 'WAREHOUSE'],
          ['viewer', 'VIEWER'],
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
        const api = createPackages(client, () => scope);
        const rejected = (status, code) => (e) =>
          e instanceof ApiFailure && e.status === status && (!code || e.code === code);
        const products = [];
        for (const [sku, price] of [
          ['PKG-SKU-A', '18.50'],
          ['PKG-SKU-B', '9.00'],
        ])
          products.push(
            (
              await client.request('/products', {
                tenantId: scopeA.tenantId,
                method: 'POST',
                body: { name: sku + ' 商品', sku, unit: '个', referencePurchasePrice: price },
              })
            ).data,
          );
        const order = (
          await client.request('/purchase-orders', {
            tenantId: scopeA.tenantId,
            method: 'POST',
            body: {
              warehouseId: tenant.defaultWarehouse.id,
              platform: 'TAOBAO',
              platformOrderNo: 'TAOBAO-PKG-0001',
              supplierName: '包裹测试店铺',
              purchaseDate: '2026-10-22',
              recipient: { name: '测试收货人', phone: '13800000000', address: '测试地址' },
              freightAmount: '10.00',
              items: [
                {
                  productId: products[0].id,
                  quantity: 10,
                  unitPrice: '18.50',
                  discountAmount: '0',
                },
                { productId: products[1].id, quantity: 5, unitPrice: '9.00', discountAmount: '0' },
              ],
            },
          })
        ).data;
        await client.request(`/purchase-orders/${order.id}/place`, {
          tenantId: scopeA.tenantId,
          method: 'POST',
          body: {},
        });
        const lineA = order.items[0].id,
          lineB = order.items[1].id;
        async function addPackage(carrierCode, trackingNo, expectedItems, remark) {
          return (
            await client.request(`/purchase-orders/${order.id}/packages`, {
              tenantId: scopeA.tenantId,
              method: 'POST',
              body: { carrierCode, trackingNo, expectedItems, ...(remark ? { remark } : {}) },
            })
          ).data;
        }
        const first = await addPackage(
            'ZTO',
            '000PACKAGE-01',
            [
              { purchaseOrderItemId: lineA, expectedQuantity: 6 },
              { purchaseOrderItemId: lineB, expectedQuantity: 5 },
            ],
            '第一箱，虚构备注',
          ),
          second = await addPackage('SF', '000PACKAGE-02', [
            { purchaseOrderItemId: lineA, expectedQuantity: 4 },
          ]);
        await http.test('list returns real database rows with purchase and plan data', async () => {
          const result = await api.list({ page: 1, pageSize: 20 });
          assert.equal(result.pagination.total, 2);
          assert.equal(result.pagination.page, 1);
          assert.equal(result.data.length, 2);
          const row = result.data.find((item) => item.id === first.id);
          assert.ok(row, 'first package must be listed');
          assert.equal(row.trackingNo, '000PACKAGE-01');
          assert.equal(row.carrierCode, 'ZTO');
          assert.equal(row.purchaseOrderId, order.id);
          assert.equal(row.purchaseOrderNo, order.orderNo);
          assert.equal(row.purchaseStatus, 'PLACED');
          assert.equal(row.warehouseId, tenant.defaultWarehouse.id);
          assert.equal(row.status, 'CREATED');
          assert.equal(row.receivingStatus, 'NOT_RECEIVED');
          assert.equal(row.receivedQuantity, 0);
          assert.equal(row.hasReceipts, false);
          assert.deepEqual(
            row.expectedItems.map((item) => [
              item.sku,
              item.orderedQuantity,
              item.expectedQuantity,
            ]),
            [
              ['PKG-SKU-A', 10, 6],
              ['PKG-SKU-B', 5, 5],
            ],
          );
          assert.equal(row.expectedItems[0].name, 'PKG-SKU-A 商品');
          assert.equal(row.expectedItems[0].unit, '个');
          const stored = await db.query(
            'SELECT count(*)::int AS total FROM packages WHERE tenant_id=$1',
            [scopeA.tenantId],
          );
          assert.equal(stored.rows[0].total, 2);
          assert.equal(new Set(result.data.map((item) => item.id)).size, 2);
          assert.equal(result.data[0].id, second.id, 'newest package sorts first');
          assert.equal(second.receivingStatus, 'NOT_RECEIVED');
        });
        await http.test(
          'search matches tracking, carrier, order number and SKU literally',
          async () => {
            const byTracking = await api.list({ page: 1, pageSize: 20, search: '000PACKAGE-01' });
            assert.equal(byTracking.pagination.total, 1);
            assert.equal(byTracking.data[0].id, first.id);
            assert.equal(
              (await api.list({ page: 1, pageSize: 20, search: 'pkg-sku-b' })).pagination.total,
              1,
            );
            assert.equal(
              (await api.list({ page: 1, pageSize: 20, search: order.orderNo })).pagination.total,
              2,
            );
            assert.equal(
              (await api.list({ page: 1, pageSize: 20, search: '包裹测试店铺' })).pagination.total,
              0,
              'supplier is not a package search target',
            );
            assert.equal(
              (await api.list({ page: 1, pageSize: 20, search: '%' })).pagination.total,
              0,
              'LIKE wildcards stay literal',
            );
            assert.equal(
              (await api.list({ page: 1, pageSize: 20, search: 'not-present' })).data.length,
              0,
            );
          },
        );
        await http.test('filters cover order, carrier, logistics status and receipts', async () => {
          const byOrder = await api.list({ page: 1, pageSize: 20, purchaseOrderId: order.id });
          assert.equal(byOrder.pagination.total, 2);
          const byCarrier = await api.list({ page: 1, pageSize: 20, carrierCode: 'zto' });
          assert.equal(byCarrier.pagination.total, 1);
          assert.equal(byCarrier.data[0].id, first.id);
          assert.equal(
            (await api.list({ page: 1, pageSize: 20, status: 'CREATED' })).pagination.total,
            2,
          );
          assert.equal(
            (await api.list({ page: 1, pageSize: 20, status: 'ARRIVED' })).pagination.total,
            0,
          );
          assert.equal(
            (await api.list({ page: 1, pageSize: 20, hasReceipts: false })).pagination.total,
            2,
          );
          assert.equal(
            (await api.list({ page: 1, pageSize: 20, hasReceipts: true })).pagination.total,
            0,
          );
          assert.equal(
            (
              await api.list({
                page: 1,
                pageSize: 20,
                purchaseOrderId: order.id,
                status: 'ARRIVED',
              })
            ).pagination.total,
            0,
          );
        });
        await http.test('pagination keeps server totals across pages', async () => {
          const pageOne = await api.list({ page: 1, pageSize: 1 });
          const pageTwo = await api.list({ page: 2, pageSize: 1 });
          assert.equal(pageOne.pagination.total, 2);
          assert.equal(pageOne.data.length, 1);
          assert.equal(pageTwo.data.length, 1);
          assert.notEqual(pageOne.data[0].id, pageTwo.data[0].id);
          assert.equal((await api.list({ page: 3, pageSize: 1 })).data.length, 0);
        });
        await http.test(
          'detail returns the same real object and hides nothing from owner',
          async () => {
            const detail = await api.detail(first.id);
            assert.equal(detail.id, first.id);
            assert.equal(detail.trackingNo, '000PACKAGE-01');
            assert.equal(detail.remark, '第一箱，虚构备注');
            assert.equal(detail.expectedItems.length, 2);
            assert.equal(expectedTotal(detail.expectedItems), 11);
            assert.equal(receivingPercent(detail), 0);
            assert.equal(itemSummary(detail.expectedItems), 'PKG-SKU-A×6、PKG-SKU-B×5');
          },
        );
        await http.test('viewer reads packages but cannot use the scan lookup', async () => {
          const viewer = await context('viewer', scopeA.tenantId);
          const readOnly = createPackages(clients.viewer, () => viewer);
          assert.equal((await readOnly.list({ page: 1, pageSize: 20 })).pagination.total, 2);
          const detail = await readOnly.detail(first.id);
          assert.equal(detail.id, first.id);
          assert.equal(detail.remark, null, 'VIEWER must not see free-text remark');
          await assert.rejects(readOnly.lookup('000PACKAGE-01'), rejected(403));
          await assert.rejects(
            clients.viewer.request('/packages/lookup?trackingNo=000PACKAGE-01', {
              tenantId: scopeA.tenantId,
            }),
            rejected(403),
          );
          await assert.rejects(
            clients.viewer.request('/packages', { tenantId: scopeB.tenantId }),
            rejected(403),
          );
        });
        await http.test('warehouse and buyer may look up an exact tracking number', async () => {
          for (const actor of ['warehouse', 'buyer']) {
            const current = await context(actor, scopeA.tenantId);
            const candidates = await createPackages(clients[actor], () => current).lookup(
              '000PACKAGE-01',
            );
            assert.equal(candidates.length, 1);
            assert.equal(candidates[0].packageId, first.id);
            assert.equal(candidates[0].purchaseOrderNo, order.orderNo);
            assert.equal(candidates[0].packageStatus, 'CREATED');
            assert.deepEqual(
              await createPackages(clients[actor], () => current).lookup('UNKNOWN-000'),
              [],
            );
          }
          await assert.rejects(api.lookup('   '), rejected(400));
        });
        await http.test('foreign tenants never see or read another merchant package', async () => {
          scope = scopeB;
          assert.equal((await api.list({ page: 1, pageSize: 20 })).pagination.total, 0);
          assert.equal(
            (await api.list({ page: 1, pageSize: 20, purchaseOrderId: order.id })).pagination.total,
            0,
          );
          await assert.rejects(api.detail(first.id), rejected(404));
          scope = scopeA;
        });
        await http.test('late response after workspace change is rejected', async () => {
          for (const changes of [
            { tenantId: scopeB.tenantId },
            { userId: randomUUID() },
            { sessionKey: randomUUID() },
          ]) {
            const late = (run) => {
              scope = scopeA;
              const delayed = createPackages(
                {
                  request: async (...args) => {
                    const result = await client.request(...args);
                    scope = { ...scopeA, ...changes };
                    return result;
                  },
                },
                () => scope,
              );
              return assert.rejects(run(delayed), rejected(409, 'SCOPE_CHANGED'));
            };
            await late((delayed) => delayed.detail(first.id));
            await late((delayed) => delayed.list({ page: 1, pageSize: 20 }));
          }
          scope = scopeA;
        });
        await http.test('failed list surfaces an error and can be retried', async () => {
          let fail = true,
            calls = 0;
          const unreliable = createPackages(
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
            () => scopeA,
          );
          await assert.rejects(
            unreliable.list({ page: 1, pageSize: 20 }),
            rejected(0, 'NETWORK_ERROR'),
          );
          assert.equal((await unreliable.list({ page: 1, pageSize: 20 })).pagination.total, 2);
          assert.equal(calls, 2);
          await assert.rejects(
            createPackages({ request: async () => ({}) }, () => null).list({
              page: 1,
              pageSize: 20,
            }),
            rejected(403),
          );
        });
        await http.test('invalid query values are rejected by the API', async () => {
          for (const query of [
            'pageSize=101',
            'page=0',
            'status=UNKNOWN',
            'hasReceipts=yes',
            'purchaseOrderId=not-a-uuid',
            'carrierCode=a%20b',
          ])
            await assert.rejects(
              client.request('/packages?' + query, { tenantId: scopeA.tenantId }),
              rejected(400, 'VALIDATION_ERROR'),
              query,
            );
        });
        await http.test('a real receipt moves the package into partial receiving', async () => {
          const receiptId = randomUUID();
          await db.query(
            'INSERT INTO receipts(id,tenant_id,receipt_no,purchase_order_id,package_id,warehouse_id,client_operation_id,request_hash,received_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
            [
              receiptId,
              scopeA.tenantId,
              'R-' + receiptId,
              order.id,
              first.id,
              order.warehouseId,
              randomUUID(),
              'b'.repeat(64),
              accounts.owner.id,
            ],
          );
          await db.query(
            'INSERT INTO receipt_items(id,tenant_id,receipt_id,purchase_order_id,purchase_order_item_id,product_id,quantity,landed_unit_cost) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
            [
              randomUUID(),
              scopeA.tenantId,
              receiptId,
              order.id,
              lineA,
              products[0].id,
              3,
              '19.5000',
            ],
          );
          const withReceipts = await api.list({ page: 1, pageSize: 20, hasReceipts: true });
          assert.equal(withReceipts.pagination.total, 1);
          assert.equal(withReceipts.data[0].id, first.id);
          assert.equal(
            (await api.list({ page: 1, pageSize: 20, hasReceipts: false })).pagination.total,
            1,
          );
          const detail = await api.detail(first.id);
          assert.equal(detail.hasReceipts, true);
          assert.equal(detail.receivedQuantity, 3);
          assert.equal(detail.receivingStatus, 'PARTIAL_RECEIVED');
          assert.equal(receivingPercent(detail), 27);
          assert.equal(
            detail.expectedItems.find((item) => item.purchaseOrderItemId === lineA)
              .receivedQuantity,
            3,
          );
          assert.equal(
            detail.expectedItems.find((item) => item.purchaseOrderItemId === lineB)
              .receivedQuantity,
            0,
          );
        });
        await http.test('openapi documents the new read-only list operation', async () => {
          const doc = await (await fetch(base + '/api/docs-json')).json();
          const operation = doc.paths['/api/v1/packages'].get;
          assert.ok(operation, 'GET /packages must be documented');
          assert.equal(operation.operationId.endsWith('PackagesController_list'), true);
          assert.ok(operation.responses['200'].content['application/json'].schema);
          assert.equal(
            doc.paths['/api/v1/packages'].post,
            undefined,
            'no package creation endpoint',
          );
          assert.ok(doc.paths['/api/v1/packages/{id}'].get, 'package detail stays documented');
          assert.ok(doc.paths['/api/v1/packages/lookup'].get, 'scan lookup stays documented');
        });
        await http.test('display helpers stay consistent with the contract', () => {
          assert.equal(expectedTotal([]), 0);
          assert.equal(expectedTotal([{ expectedQuantity: 6 }, { expectedQuantity: 5 }]), 11);
          assert.equal(
            receivingPercent({ expectedItems: [{ expectedQuantity: 10 }], receivedQuantity: 3 }),
            30,
          );
          assert.equal(receivingPercent({ expectedItems: [], receivedQuantity: 3 }), 0);
          assert.equal(
            receivingPercent({ expectedItems: [{ expectedQuantity: 2 }], receivedQuantity: 5 }),
            100,
          );
          assert.equal(itemSummary([]), '未指定预计商品');
          assert.equal(
            itemSummary([
              { sku: 'A', expectedQuantity: 1 },
              { sku: 'B', expectedQuantity: 2 },
              { sku: 'C', expectedQuantity: 3 },
            ]),
            'A×1、B×2 等 3 项',
          );
          assert.equal(formatTime(null), '—');
          assert.equal(formatTime('not-a-date'), '—');
          assert.ok(formatTime('2026-10-22T00:00:00.000Z').length > 0);
          assert.equal(packageStatusTone('EXCEPTION'), 'danger');
          assert.equal(packageStatusTone('RECEIVED'), 'success');
          assert.equal(receivingStatusTone('PARTIAL_RECEIVED'), 'warning');
          assert.equal(packageStatusNames.IN_TRANSIT, '运输中');
          assert.equal(receivingStatusNames.NOT_RECEIVED, '未收货');
        });
      });
    } finally {
      if (connected) await db.end();
      if (created) await admin.query(`DROP DATABASE "${name}"`);
      await admin.end();
    }
  },
);
