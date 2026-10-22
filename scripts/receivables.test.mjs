import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { startTestApi } from './api-test-server.mjs';
const { Client } = createRequire(new URL('../apps/api/package.json', import.meta.url))('pg');
const run = promisify(execFile);
loadEnvFile(new URL('../.env', import.meta.url));

test(
  'scan lookup, receivable quantities and manual receiving closure on real PostgreSQL',
  { timeout: 180000 },
  async (t) => {
    const source = new URL(process.env.DATABASE_URL);
    assert.equal(source.pathname, '/caicang');
    assert.ok(['localhost', '127.0.0.1'].includes(source.hostname));
    const name = 'caicang_test_' + randomUUID().replaceAll('-', ''),
      url = new URL(source);
    url.pathname = '/' + name;
    const admin = new Client({ connectionString: source.toString() }),
      db = new Client({ connectionString: url.toString() });
    let created = false,
      connected = false,
      counter = 0,
      logs = '';
    try {
      await admin.connect();
      assert.match(name, /^caicang_test_[a-f0-9]{32}$/);
      await admin.query(`CREATE DATABASE "${name}"`);
      created = true;
      await run(
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
      await t.test('production API with real receipts', async (http) => {
        const base = await startTestApi(http, {
          env: {
            DATABASE_URL: url.toString(),
            NODE_ENV: 'test',
            JWT_ACCESS_SECRET: randomBytes(48).toString('hex'),
            TRUSTED_PROXIES: '127.0.0.1/32,::1/128',
          },
          onOutput: (chunk) => {
            logs += chunk;
          },
        });
        let a, b;
        const accounts = {};
        const request = (
          path,
          { actor = 'owner', tenant = a, method = 'GET', body, headers = {} } = {},
        ) =>
          fetch(base + '/api/v1' + path, {
            method,
            headers: {
              'Content-Type': 'application/json',
              'X-Forwarded-For': `198.22.${Math.floor(++counter / 250)}.${(counter % 250) + 1}`,
              ...(actor && accounts[actor]
                ? { Authorization: 'Bearer ' + accounts[actor].accessToken }
                : {}),
              ...(tenant ? { 'X-Tenant-Id': tenant.tenant.id } : {}),
              ...headers,
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          });
        const read = async (response, status, code) => {
          assert.equal(response.status, status);
          const payload = await response.json();
          assert.equal(payload.requestId, response.headers.get('x-request-id'));
          if (code) assert.equal(payload.error.code, code);
          return payload;
        };
        for (const actor of ['owner', 'admin', 'buyer', 'warehouse', 'viewer']) {
          const input = { email: actor + '@receivable.example.test', password: 'Receivable!2026' };
          await read(
            await request('/auth/register', {
              actor: null,
              tenant: null,
              method: 'POST',
              body: input,
            }),
            201,
          );
          accounts[actor] = (
            await read(
              await request('/auth/login', {
                actor: null,
                tenant: null,
                method: 'POST',
                body: input,
              }),
              200,
            )
          ).data;
        }
        a = (
          await read(
            await request('/tenants', { tenant: null, method: 'POST', body: { name: '验收 A' } }),
            201,
          )
        ).data;
        b = (
          await read(
            await request('/tenants', { tenant: null, method: 'POST', body: { name: '验收 B' } }),
            201,
          )
        ).data;
        for (const [actor, role] of [
          ['admin', 'ADMIN'],
          ['buyer', 'BUYER'],
          ['warehouse', 'WAREHOUSE'],
          ['viewer', 'VIEWER'],
        ])
          await read(
            await request('/members', {
              method: 'POST',
              body: { email: accounts[actor].user.email, role },
            }),
            201,
          );
        const product = (
          await read(
            await request('/products', {
              method: 'POST',
              body: { name: '20W 充电器', sku: 'CHARGER-20W', unit: '件' },
            }),
            201,
          )
        ).data;
        const cable = (
          await read(
            await request('/products', {
              method: 'POST',
              body: { name: '1 米数据线', sku: 'CABLE-1M', unit: '条' },
            }),
            201,
          )
        ).data;
        async function createOrder(items, tenant = a) {
          const draft = (
            await read(
              await request('/purchase-orders', {
                tenant,
                method: 'POST',
                body: {
                  warehouseId: tenant.defaultWarehouse.id,
                  platform: 'TAOBAO',
                  purchaseDate: '2026-10-22',
                  recipient: { name: '验收员', phone: '13800000000', address: '虚构仓库地址' },
                  items,
                },
              }),
              201,
            )
          ).data;
          const placed = (
            await read(
              await request('/purchase-orders/' + draft.id + '/place', { tenant, method: 'POST' }),
              200,
            )
          ).data;
          return { ...placed, tenant };
        }
        const order = await createOrder([
          { productId: product.id, quantity: 10, unitPrice: '18.50' },
          { productId: cable.id, quantity: 5, unitPrice: '9.00' },
        ]);
        const lineA = order.items[0].id,
          lineB = order.items[1].id;
        async function bind(o, carrierCode, trackingNo, expectedItems, tenant = a) {
          return (
            await read(
              await request('/purchase-orders/' + o.id + '/packages', {
                tenant,
                method: 'POST',
                body: { carrierCode, trackingNo, expectedItems },
              }),
              201,
            )
          ).data;
        }
        // 10 件拆两箱：A1 预计 6，A2 预计 4；A3 不填预计明细，人工选择。
        const a1 = await bind(order, 'ZTO', '000RECEIVABLE-01', [
          { purchaseOrderItemId: lineA, expectedQuantity: 6 },
        ]);
        const a2 = await bind(order, 'SF', '000RECEIVABLE-02', [
          { purchaseOrderItemId: lineA, expectedQuantity: 4 },
        ]);
        const a3 = await bind(order, 'YTO', '000RECEIVABLE-03', []);
        let receiptCount = 0;
        async function receive(pkg, o, items) {
          const id = randomUUID();
          receiptCount += 1;
          await db.query(
            'INSERT INTO receipts(id,tenant_id,receipt_no,purchase_order_id,package_id,warehouse_id,client_operation_id,request_hash,received_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
            [
              id,
              o.tenant.tenant.id,
              'R-' + id,
              o.id,
              pkg.id,
              o.warehouseId,
              randomUUID(),
              'a'.repeat(64),
              accounts.owner.user.id,
            ],
          );
          for (const item of items)
            await db.query(
              'INSERT INTO receipt_items(tenant_id,receipt_id,purchase_order_id,purchase_order_item_id,product_id,quantity,landed_unit_cost) VALUES($1,$2,$3,$4,$5,$6,$7)',
              [
                o.tenant.tenant.id,
                id,
                o.id,
                item.purchaseOrderItemId,
                item.productId,
                item.quantity,
                '18.5000',
              ],
            );
          return id;
        }
        const receivable = (pkg, options = {}) =>
          request('/packages/' + pkg.id + '/receivable', options);
        const line = (payload, id) =>
          payload.data.lines.find((row) => row.purchaseOrderItemId === id);
        const stockCount = async () => {
          const result = await db.query(
            'SELECT (SELECT count(*)::int FROM stock_balances) AS balances, (SELECT count(*)::int FROM stock_movements) AS movements',
          );
          return result.rows[0];
        };

        await http.test(
          'unknown tracking number returns empty candidates and no stock',
          async () => {
            const body = await read(
              await request('/packages/lookup?trackingNo=' + encodeURIComponent('999UNKNOWN-000')),
              200,
            );
            assert.deepEqual(body.data, []);
            assert.deepEqual(await stockCount(), { balances: 0, movements: 0 });
            assert.equal((await db.query('SELECT count(*)::int AS t FROM receipts')).rows[0].t, 0);
          },
        );
        await http.test('lookup returns every candidate with its own progress', async () => {
          const body = await read(
            await request('/packages/lookup?trackingNo=' + encodeURIComponent('000RECEIVABLE-01')),
            200,
          );
          assert.equal(body.data.length, 1);
          const [candidate] = body.data;
          assert.equal(candidate.packageId, a1.id);
          assert.equal(candidate.purchaseOrderId, order.id);
          assert.equal(candidate.purchaseOrderNo, order.orderNo);
          assert.equal(candidate.carrierCode, 'ZTO');
          assert.equal(candidate.trackingNo, '000RECEIVABLE-01');
          assert.equal(candidate.receivingStatus, 'NOT_RECEIVED');
          assert.equal(candidate.hasReceipts, false);
          assert.equal(candidate.receivedQuantity, 0);
          const firstOrder = await createOrder([
            { productId: product.id, quantity: 3, unitPrice: '1.00' },
          ]);
          const sfMulti = await bind(firstOrder, 'SF', '000RECEIVABLE-MULTI', []);
          const secondOrder = await createOrder([
            { productId: product.id, quantity: 3, unitPrice: '1.00' },
          ]);
          const ytoMulti = await bind(secondOrder, 'YTO', '000RECEIVABLE-MULTI', []);
          const multiple = await read(
            await request(
              '/packages/lookup?trackingNo=' + encodeURIComponent('000RECEIVABLE-MULTI'),
            ),
            200,
          );
          assert.equal(multiple.data.length, 2, 'same number on two carriers must not auto-pick');
          assert.deepEqual(
            multiple.data.map((row) => row.carrierCode),
            ['SF', 'YTO'],
          );
          assert.deepEqual(
            multiple.data.map((row) => row.packageId).sort(),
            [sfMulti.id, ytoMulti.id].sort(),
          );
        });
        await http.test('planned package starts with the full purchase quantity left', async () => {
          const body = await read(await receivable(a1), 200);
          assert.equal(body.data.packageId, a1.id);
          assert.equal(body.data.purchaseOrderId, order.id);
          assert.equal(body.data.purchaseOrderNo, order.orderNo);
          assert.equal(body.data.hasPlan, true);
          assert.equal(body.data.receivingClosed, false);
          assert.equal(body.data.receivedQuantity, 0);
          assert.equal(body.data.lines.length, 1, 'only planned lines are listed');
          const first = body.data.lines[0];
          assert.equal(first.purchaseOrderItemId, lineA);
          assert.equal(first.sku, 'CHARGER-20W');
          assert.equal(first.name, '20W 充电器');
          assert.equal(first.unit, '件');
          assert.equal(first.orderedQuantity, 10);
          assert.equal(first.receivedQuantity, 0);
          assert.equal(first.orderRemainingQuantity, 10);
          assert.equal(first.inPackagePlan, true);
          assert.equal(first.expectedQuantity, 6);
          assert.equal(first.packageReceivedQuantity, 0);
          assert.equal(first.packageRemainingQuantity, 6);
          assert.equal(first.maxReceivableQuantity, 6);
          assert.deepEqual(await stockCount(), { balances: 0, movements: 0 });
        });
        await http.test(
          'receiving another package deducts the shared purchase quantity',
          async () => {
            await receive(a2, order, [
              { purchaseOrderItemId: lineA, productId: product.id, quantity: 4 },
            ]);
            const body = await read(await receivable(a1), 200);
            const first = body.data.lines[0];
            // 验收口径：购买 10 件、已入库 4 件、还可入库 6 件。
            assert.equal(first.orderedQuantity, 10);
            assert.equal(first.receivedQuantity, 4);
            assert.equal(first.orderRemainingQuantity, 6);
            assert.equal(first.packageRemainingQuantity, 6);
            assert.equal(first.maxReceivableQuantity, 6);
            assert.equal(body.data.receivedQuantity, 0, 'this package still has no receipts');
            const sibling = await read(await receivable(a2), 200);
            assert.equal(sibling.data.lines[0].packageReceivedQuantity, 4);
            assert.equal(sibling.data.lines[0].packageRemainingQuantity, 0);
            assert.equal(sibling.data.lines[0].maxReceivableQuantity, 0);
          },
        );
        await http.test('package plan caps what one box may still receive', async () => {
          await receive(a1, order, [
            { purchaseOrderItemId: lineA, productId: product.id, quantity: 6 },
          ]);
          const body = await read(await receivable(a1), 200);
          const first = body.data.lines[0];
          assert.equal(first.receivedQuantity, 10);
          assert.equal(first.orderRemainingQuantity, 0);
          assert.equal(first.packageReceivedQuantity, 6);
          assert.equal(first.packageRemainingQuantity, 0);
          assert.equal(first.maxReceivableQuantity, 0);
          const detail = await read(await request('/packages/' + a1.id), 200);
          assert.equal(detail.data.receivingStatus, 'RECEIVED');
          assert.equal(detail.data.receivedQuantity, 6);
        });
        await http.test('package without a plan falls back to purchase leftovers', async () => {
          const body = await read(await receivable(a3), 200);
          assert.equal(body.data.hasPlan, false);
          assert.equal(body.data.lines.length, 1);
          const first = body.data.lines[0];
          assert.equal(first.purchaseOrderItemId, lineB, 'fully received lines are not offered');
          assert.equal(first.sku, 'CABLE-1M');
          assert.equal(first.orderedQuantity, 5);
          assert.equal(first.receivedQuantity, 0);
          assert.equal(first.orderRemainingQuantity, 5);
          assert.equal(first.inPackagePlan, false);
          assert.equal(first.expectedQuantity, null);
          assert.equal(first.packageReceivedQuantity, 0);
          assert.equal(first.packageRemainingQuantity, null);
          assert.equal(first.maxReceivableQuantity, 5);
          await receive(a3, order, [
            { purchaseOrderItemId: lineB, productId: cable.id, quantity: 2 },
          ]);
          const partial = await read(await receivable(a3), 200);
          const cableLine = line(partial, lineB);
          assert.equal(cableLine.receivedQuantity, 2);
          assert.equal(cableLine.orderRemainingQuantity, 3);
          assert.equal(cableLine.maxReceivableQuantity, 3);
          assert.equal(partial.data.receivingStatus, 'PARTIAL_RECEIVED');
        });
        await http.test('over-received data clamps to zero instead of going negative', async () => {
          const over = await createOrder([
            { productId: product.id, quantity: 10, unitPrice: '1.00' },
          ]);
          const pkg = await bind(over, 'ZTO', '000RECEIVABLE-OVER', [
            { purchaseOrderItemId: over.items[0].id, expectedQuantity: 10 },
          ]);
          await receive(pkg, over, [
            { purchaseOrderItemId: over.items[0].id, productId: product.id, quantity: 12 },
          ]);
          const body = await read(await receivable(pkg), 200);
          const first = body.data.lines[0];
          assert.equal(first.receivedQuantity, 12);
          assert.equal(first.orderRemainingQuantity, 0);
          assert.equal(first.packageRemainingQuantity, 0);
          assert.equal(first.maxReceivableQuantity, 0);
        });
        await http.test('manual closure only applies to packages without a plan', async () => {
          const planned = await request('/packages/' + a1.id + '/complete-receiving', {
            method: 'POST',
          });
          await read(planned, 409, 'STATUS_CONFLICT');
          const closed = await read(
            await request('/packages/' + a3.id + '/complete-receiving', { method: 'POST' }),
            200,
          );
          assert.equal(closed.data.id, a3.id);
          assert.equal(closed.data.receivingStatus, 'RECEIVED');
          assert.equal(closed.data.status, 'RECEIVED');
          assert.ok(closed.data.receivingClosedAt);
          const after = await read(await receivable(a3), 200);
          assert.equal(after.data.receivingClosed, true);
          assert.ok(after.data.lines.every((row) => row.maxReceivableQuantity === 0));
          assert.deepEqual(await stockCount(), { balances: 0, movements: 0 });
        });
        await http.test('repeating the same closure is idempotent', async () => {
          const before = await read(await request('/packages/' + a3.id), 200);
          const again = await read(
            await request('/packages/' + a3.id + '/complete-receiving', { method: 'POST' }),
            200,
          );
          assert.equal(again.data.receivingClosedAt, before.data.receivingClosedAt);
          assert.equal(again.data.updatedAt, before.data.updatedAt);
          const audits = await db.query(
            "SELECT count(*)::int AS t FROM audit_logs WHERE action='PACKAGE_RECEIVING_CLOSED' AND object_id=$1",
            [a3.id],
          );
          assert.equal(audits.rows[0].t, 1);
        });
        await http.test('two concurrent closures produce one audit row', async () => {
          const concurrent = await bind(order, 'JD', '000RECEIVABLE-RACE', []);
          const [one, two] = await Promise.all([
            request('/packages/' + concurrent.id + '/complete-receiving', { method: 'POST' }),
            request('/packages/' + concurrent.id + '/complete-receiving', { method: 'POST' }),
          ]);
          const first = await read(one, 200),
            second = await read(two, 200);
          assert.equal(first.data.receivingClosedAt, second.data.receivingClosedAt);
          const audits = await db.query(
            "SELECT count(*)::int AS t FROM audit_logs WHERE action='PACKAGE_RECEIVING_CLOSED' AND object_id=$1",
            [concurrent.id],
          );
          assert.equal(audits.rows[0].t, 1);
        });
        await http.test('cross tenant packages stay hidden', async () => {
          const foreign = await request('/packages/' + a1.id + '/receivable', {
            actor: 'owner',
            tenant: b,
          });
          await read(foreign, 404, 'NOT_FOUND');
          const foreignClose = await request('/packages/' + a3.id + '/complete-receiving', {
            actor: 'owner',
            tenant: b,
            method: 'POST',
          });
          await read(foreignClose, 404, 'NOT_FOUND');
          await read(await request('/packages/' + randomUUID() + '/receivable'), 404, 'NOT_FOUND');
          await read(await request('/packages/not-a-uuid/receivable'), 400, 'VALIDATION_ERROR');
          await read(
            await request('/packages/not-a-uuid/complete-receiving', { method: 'POST' }),
            400,
            'VALIDATION_ERROR',
          );
        });
        await http.test(
          'receiving permissions are limited to owner, admin and warehouse',
          async () => {
            await read(await receivable(a1, { actor: 'warehouse' }), 200);
            await read(await receivable(a1, { actor: 'admin' }), 200);
            await read(await receivable(a1, { actor: 'buyer' }), 403, 'FORBIDDEN');
            await read(await receivable(a1, { actor: 'viewer' }), 403, 'FORBIDDEN');
            const pending = await bind(order, 'STO', '000RECEIVABLE-PERM', []);
            await read(
              await request('/packages/' + pending.id + '/complete-receiving', {
                actor: 'buyer',
                method: 'POST',
              }),
              403,
              'FORBIDDEN',
            );
            await read(
              await request('/packages/' + pending.id + '/complete-receiving', {
                actor: 'viewer',
                method: 'POST',
              }),
              403,
              'FORBIDDEN',
            );
            await read(
              await request('/packages/' + pending.id + '/complete-receiving', {
                actor: 'warehouse',
                method: 'POST',
              }),
              200,
            );
            await read(
              await request('/packages/' + a1.id + '/receivable', { actor: null, tenant: null }),
              401,
              'UNAUTHENTICATED',
            );
          },
        );
        await http.test('cancelled purchase order blocks closure', async () => {
          const cancelled = await createOrder([
            { productId: product.id, quantity: 2, unitPrice: '1.00' },
          ]);
          const pkg = await bind(cancelled, 'ZTO', '000RECEIVABLE-CANCELLED', []);
          await db.query("UPDATE purchase_orders SET status='CANCELLED' WHERE id=$1", [
            cancelled.id,
          ]);
          await read(
            await request('/packages/' + pkg.id + '/complete-receiving', { method: 'POST' }),
            409,
            'STATUS_CONFLICT',
          );
          const readOnly = await read(await receivable(pkg), 200);
          assert.equal(readOnly.data.receivingClosed, false);
        });
        await http.test('openapi documents both receiving operations', async () => {
          const doc = await (await fetch(base + '/api/docs-json')).json();
          const receivablePath = doc.paths['/api/v1/packages/{id}/receivable'];
          const closePath = doc.paths['/api/v1/packages/{id}/complete-receiving'];
          assert.ok(receivablePath?.get, 'GET receivable must be documented');
          assert.ok(closePath?.post, 'POST complete-receiving must be documented');
          assert.equal(
            receivablePath.get.operationId.endsWith('PackagesController_receivable'),
            true,
          );
          assert.equal(
            closePath.post.operationId.endsWith('PackagesController_completeReceiving'),
            true,
          );
        });
        await http.test('no receiving endpoint writes stock or receipts', async () => {
          assert.deepEqual(await stockCount(), { balances: 0, movements: 0 });
          const receipts = await db.query('SELECT count(*)::int AS t FROM receipts');
          assert.equal(receipts.rows[0].t, receiptCount, 'only the SQL fixtures created receipts');
        });
      });
    } finally {
      if (connected) await db.end();
      if (created) await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.end();
      if (logs) t.diagnostic('API log tail: ' + logs.slice(-1200));
    }
  },
);
