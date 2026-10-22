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
  'acceptance receipts: real stock, row locks, idempotency and rollback on PostgreSQL',
  { timeout: 240000 },
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
      await t.test('production API with real inventory tables', async (http) => {
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
              'X-Forwarded-For': `198.23.${Math.floor(++counter / 250)}.${(counter % 250) + 1}`,
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
          const input = { email: actor + '@receipt.example.test', password: 'Receipt!2026' };
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
            await request('/tenants', { tenant: null, method: 'POST', body: { name: '入库 A' } }),
            201,
          )
        ).data;
        b = (
          await read(
            await request('/tenants', { tenant: null, method: 'POST', body: { name: '入库 B' } }),
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
        const makeProduct = async (name, sku, unit) =>
          (
            await read(
              await request('/products', { method: 'POST', body: { name, sku, unit } }),
              201,
            )
          ).data;
        const charger = await makeProduct('20W 充电器', 'CHARGER-20W', '件');
        const cable = await makeProduct('1 米数据线', 'CABLE-1M', '条');
        const stand = await makeProduct('铝合金支架', 'STAND-AL', '个');
        const hub = await makeProduct('七合一扩展坞', 'HUB-7IN1', '台');
        const mount = await makeProduct('显示器挂架', 'MOUNT-01', '套');
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
        async function bind(order, carrierCode, trackingNo, expectedItems, tenant = a) {
          return (
            await read(
              await request('/purchase-orders/' + order.id + '/packages', {
                tenant,
                method: 'POST',
                body: { carrierCode, trackingNo, expectedItems },
              }),
              201,
            )
          ).data;
        }
        const receipt = (body, options = {}) =>
          request('/receipts', { ...options, method: 'POST', body });
        const stock = async (productId) => {
          const row = await db.query(
            'SELECT quantity_on_hand, total_cost::text AS total_cost FROM stock_balances WHERE tenant_id=$1 AND product_id=$2',
            [a.tenant.id, productId],
          );
          return row.rows[0] ?? { quantity_on_hand: 0, total_cost: '0.0000' };
        };
        const counts = async () => {
          const row = await db.query(
            `SELECT (SELECT count(*)::int FROM receipts WHERE tenant_id=$1) AS receipts,
              (SELECT count(*)::int FROM receipt_items WHERE tenant_id=$1) AS items,
              (SELECT count(*)::int FROM stock_movements WHERE tenant_id=$1) AS movements,
              (SELECT count(*)::int FROM audit_logs WHERE tenant_id=$1 AND action='RECEIPT_CONFIRMED') AS audits`,
            [a.tenant.id],
          );
          return row.rows[0];
        };

        const order = await createOrder([
          { productId: charger.id, quantity: 10, unitPrice: '18.50' },
        ]);
        const lineA = order.items[0].id;
        // 10 件拆两箱：p1 预计 6，p2 预计 4。
        const p1 = await bind(order, 'ZTO', '000RECEIPT-01', [
          { purchaseOrderItemId: lineA, expectedQuantity: 6 },
        ]);
        const p2 = await bind(order, 'SF', '000RECEIPT-02', [
          { purchaseOrderItemId: lineA, expectedQuantity: 4 },
        ]);
        const op1 = randomUUID();
        const firstBody = {
          packageId: p1.id,
          clientOperationId: op1,
          items: [{ purchaseOrderItemId: lineA, receivedQty: 6 }],
          remark: '外箱完好，人工核对无误',
        };
        let firstReceipt;

        await http.test(
          'first confirmation writes receipt, stock and immutable movement',
          async () => {
            const response = await receipt(firstBody);
            assert.equal(response.status, 201);
            const payload = await response.json();
            assert.equal(payload.requestId, response.headers.get('x-request-id'));
            firstReceipt = payload.data;
            assert.match(firstReceipt.receiptNo, /^RCV-\d{8}-[0-9A-F]{10}$/);
            assert.equal(firstReceipt.purchaseOrderId, order.id);
            assert.equal(firstReceipt.purchaseOrderNo, order.orderNo);
            assert.equal(firstReceipt.packageId, p1.id);
            assert.equal(firstReceipt.trackingNo, '000RECEIPT-01');
            assert.equal(firstReceipt.carrierCode, 'ZTO');
            assert.equal(firstReceipt.warehouseId, a.defaultWarehouse.id);
            assert.equal(firstReceipt.warehouseName, a.defaultWarehouse.name);
            assert.equal(firstReceipt.status, 'CONFIRMED');
            assert.equal(firstReceipt.clientOperationId, op1);
            assert.equal(firstReceipt.receivedBy, accounts.owner.user.id);
            assert.equal(firstReceipt.receivedByName, accounts.owner.user.displayName);
            assert.equal(firstReceipt.remark, '外箱完好，人工核对无误');
            assert.equal(firstReceipt.totalQuantity, 6);
            assert.equal(firstReceipt.totalCost, '111.0000');
            assert.equal(firstReceipt.items.length, 1);
            const line = firstReceipt.items[0];
            assert.equal(line.purchaseOrderItemId, lineA);
            assert.equal(line.productId, charger.id);
            assert.equal(line.sku, 'CHARGER-20W');
            assert.equal(line.name, '20W 充电器');
            assert.equal(line.unit, '件');
            assert.equal(line.quantity, 6);
            assert.equal(line.landedUnitCost, '18.5000');
            assert.equal(line.lineCost, '111.0000');

            assert.deepEqual(await stock(charger.id), {
              quantity_on_hand: 6,
              total_cost: '111.0000',
            });
            const movement = await db.query(
              'SELECT source_type, source_item_id, quantity_delta, quantity_before, quantity_after, total_cost_before::text, total_cost_after::text, cost_delta::text FROM stock_movements WHERE tenant_id=$1',
              [a.tenant.id],
            );
            assert.equal(movement.rows.length, 1);
            assert.equal(movement.rows[0].source_type, 'RECEIPT');
            assert.equal(movement.rows[0].source_item_id, line.id);
            assert.equal(movement.rows[0].quantity_delta, 6);
            assert.equal(movement.rows[0].quantity_before, 0);
            assert.equal(movement.rows[0].quantity_after, 6);
            assert.equal(movement.rows[0].total_cost_before, '0.0000');
            assert.equal(movement.rows[0].total_cost_after, '111.0000');
            assert.equal(movement.rows[0].cost_delta, '111.0000');

            const orderRow = await db.query('SELECT status FROM purchase_orders WHERE id=$1', [
              order.id,
            ]);
            assert.equal(orderRow.rows[0].status, 'PARTIAL_RECEIVED');
            const packageRow = await db.query(
              'SELECT status, receiving_closed_at FROM packages WHERE id=$1',
              [p1.id],
            );
            assert.equal(packageRow.rows[0].status, 'RECEIVED');
            assert.ok(packageRow.rows[0].receiving_closed_at);
            assert.deepEqual(await counts(), { receipts: 1, items: 1, movements: 1, audits: 1 });
            const audit = await db.query(
              "SELECT object_type, metadata FROM audit_logs WHERE action='RECEIPT_CONFIRMED'",
            );
            assert.equal(audit.rows[0].object_type, 'receipt');
            assert.equal(audit.rows[0].metadata.items[0].quantity, 6);
            assert.equal(audit.rows[0].metadata.purchaseStatus, 'PARTIAL_RECEIVED');
          },
        );

        await http.test('ten retries add no stock and reuse the original receipt', async () => {
          for (let attempt = 0; attempt < 10; attempt += 1) {
            const replay = await receipt(firstBody);
            assert.equal(replay.status, 200, 'retry ' + attempt + ' must not create');
            const payload = await replay.json();
            assert.equal(payload.data.id, firstReceipt.id);
            assert.equal(payload.data.receivedAt, firstReceipt.receivedAt);
            assert.equal(payload.data.receiptNo, firstReceipt.receiptNo);
          }
          assert.deepEqual(await stock(charger.id), {
            quantity_on_hand: 6,
            total_cost: '111.0000',
          });
          assert.deepEqual(await counts(), { receipts: 1, items: 1, movements: 1, audits: 1 });
        });

        await http.test('five concurrent retries still create one receipt', async () => {
          const responses = await Promise.all(Array.from({ length: 5 }, () => receipt(firstBody)));
          for (const response of responses) {
            assert.equal(response.status, 200);
            assert.equal((await response.json()).data.id, firstReceipt.id);
          }
          assert.equal((await stock(charger.id)).quantity_on_hand, 6);
          assert.deepEqual(await counts(), { receipts: 1, items: 1, movements: 1, audits: 1 });
        });

        await http.test('same operation id with a different payload is a conflict', async () => {
          await read(
            await receipt({
              ...firstBody,
              items: [{ purchaseOrderItemId: lineA, receivedQty: 5 }],
            }),
            409,
            'IDEMPOTENCY_CONFLICT',
          );
          // Remark is part of the acceptance request, so changing only the note also conflicts.
          await read(
            await receipt({ ...firstBody, remark: '改过的备注' }),
            409,
            'IDEMPOTENCY_CONFLICT',
          );
          assert.equal((await stock(charger.id)).quantity_on_hand, 6);
          assert.deepEqual(await counts(), { receipts: 1, items: 1, movements: 1, audits: 1 });
        });

        await http.test('the warehouse role may confirm and is recorded as receiver', async () => {
          const second = await read(
            await receipt(
              {
                packageId: p2.id,
                clientOperationId: randomUUID(),
                items: [{ purchaseOrderItemId: lineA, receivedQty: 4 }],
              },
              { actor: 'warehouse' },
            ),
            201,
          );
          assert.equal(second.data.receivedBy, accounts.warehouse.user.id);
          assert.equal(second.data.receivedByName, accounts.warehouse.user.displayName);
          assert.deepEqual(await stock(charger.id), {
            quantity_on_hand: 10,
            total_cost: '185.0000',
          });
          const orderRow = await db.query('SELECT status FROM purchase_orders WHERE id=$1', [
            order.id,
          ]);
          assert.equal(orderRow.rows[0].status, 'RECEIVED');
          const closed = await db.query(
            'SELECT status, receiving_closed_at FROM packages WHERE id=$1',
            [p2.id],
          );
          assert.equal(closed.rows[0].status, 'RECEIVED');
          assert.ok(closed.rows[0].receiving_closed_at);
        });

        await http.test('quantity above the order or package remainder is rejected', async () => {
          const overOrder = await createOrder([
            { productId: stand.id, quantity: 5, unitPrice: '12.00' },
          ]);
          const lineS = overOrder.items[0].id;
          const planned = await bind(overOrder, 'YTO', '000RECEIPT-OVER', [
            { purchaseOrderItemId: lineS, expectedQuantity: 2 },
          ]);
          const exceeded = await read(
            await receipt({
              packageId: planned.id,
              clientOperationId: randomUUID(),
              items: [{ purchaseOrderItemId: lineS, receivedQty: 3 }],
            }),
            409,
            'RECEIPT_QTY_EXCEEDED',
          );
          assert.equal(exceeded.error.details.purchaseOrderItemId, lineS);
          assert.equal(exceeded.error.details.maxReceivableQuantity, 2);
          assert.equal(exceeded.error.details.scope, 'PACKAGE');
          assert.deepEqual(await stock(stand.id), {
            quantity_on_hand: 0,
            total_cost: '0.0000',
          });
          const pending = await db.query(
            'SELECT count(*)::int AS t FROM receipts WHERE purchase_order_id=$1',
            [overOrder.id],
          );
          assert.equal(pending.rows[0].t, 0);

          const tooManyForOrder = await read(
            await receipt({
              packageId: planned.id,
              clientOperationId: randomUUID(),
              items: [{ purchaseOrderItemId: lineS, receivedQty: 3 }],
            }),
            409,
            'RECEIPT_QTY_EXCEEDED',
          );
          assert.ok(tooManyForOrder.error.details.maxReceivableQuantity <= 2);
        });

        await http.test('a failed multi-line confirmation leaves no partial stock', async () => {
          const multi = await createOrder([
            { productId: charger.id, quantity: 3, unitPrice: '18.50' },
            { productId: cable.id, quantity: 2, unitPrice: '9.00' },
          ]);
          const line1 = multi.items[0].id,
            line2 = multi.items[1].id;
          const partial = await bind(multi, 'JD', '000RECEIPT-ATOMIC', [
            { purchaseOrderItemId: line1, expectedQuantity: 3 },
            { purchaseOrderItemId: line2, expectedQuantity: 2 },
          ]);
          await read(
            await receipt({
              packageId: partial.id,
              clientOperationId: randomUUID(),
              items: [
                { purchaseOrderItemId: line1, receivedQty: 2 },
                { purchaseOrderItemId: line2, receivedQty: 3 },
              ],
            }),
            409,
            'RECEIPT_QTY_EXCEEDED',
          );
          // The valid first line must not be committed on its own.
          assert.equal((await stock(charger.id)).quantity_on_hand, 10);
          assert.deepEqual(await stock(cable.id), {
            quantity_on_hand: 0,
            total_cost: '0.0000',
          });
          const rows = await db.query(
            'SELECT count(*)::int AS t FROM receipts WHERE purchase_order_id=$1',
            [multi.id],
          );
          assert.equal(rows.rows[0].t, 0);
          assert.deepEqual(await counts(), { receipts: 2, items: 2, movements: 2, audits: 2 });

          const valid = await read(
            await receipt({
              packageId: partial.id,
              clientOperationId: randomUUID(),
              items: [
                { purchaseOrderItemId: line2, receivedQty: 2 },
                { purchaseOrderItemId: line1, receivedQty: 3 },
              ],
            }),
            201,
          );
          assert.deepEqual(
            valid.data.items.map((item) => item.purchaseOrderItemId),
            [line1, line2],
            'items follow purchase line order',
          );
          assert.equal(valid.data.totalQuantity, 5);
        });

        await http.test(
          'cancelled purchase orders and closed packages refuse receipts',
          async () => {
            const cancelled = await createOrder([
              { productId: stand.id, quantity: 2, unitPrice: '12.00' },
            ]);
            const lineS = cancelled.items[0].id;
            const pkg = await bind(cancelled, 'ZTO', '000RECEIPT-CANCELLED', []);
            await read(
              await request('/purchase-orders/' + cancelled.id + '/cancel', { method: 'POST' }),
              200,
            );
            await read(
              await receipt({
                packageId: pkg.id,
                clientOperationId: randomUUID(),
                items: [{ purchaseOrderItemId: lineS, receivedQty: 1 }],
              }),
              409,
              'STATUS_CONFLICT',
            );
            assert.deepEqual(await stock(stand.id), {
              quantity_on_hand: 0,
              total_cost: '0.0000',
            });
          },
        );

        await http.test('closed package rejects further acceptance', async () => {
          const closing = await createOrder([
            { productId: mount.id, quantity: 10, unitPrice: '15.00' },
          ]);
          const lineM = closing.items[0].id;
          const closedPackage = await bind(closing, 'ZTO', '000RECEIPT-CLOSED', [
            { purchaseOrderItemId: lineM, expectedQuantity: 2 },
          ]);
          await read(
            await receipt({
              packageId: closedPackage.id,
              clientOperationId: randomUUID(),
              items: [{ purchaseOrderItemId: lineM, receivedQty: 2 }],
            }),
            201,
          );
          const extra = await read(
            await receipt({
              packageId: closedPackage.id,
              clientOperationId: randomUUID(),
              items: [{ purchaseOrderItemId: lineM, receivedQty: 1 }],
            }),
            409,
            'STATUS_CONFLICT',
          );
          assert.equal(extra.error.details.receivingClosed, true);
          assert.deepEqual(await stock(mount.id), {
            quantity_on_hand: 2,
            total_cost: '30.0000',
          });
        });

        await http.test('cross tenant packages stay invisible', async () => {
          await read(
            await receipt(
              {
                packageId: p1.id,
                clientOperationId: randomUUID(),
                items: [{ purchaseOrderItemId: lineA, receivedQty: 1 }],
              },
              { tenant: b },
            ),
            404,
            'NOT_FOUND',
          );
          const foreign = await read(
            await request('/receipts/' + firstReceipt.id, { tenant: b }),
            404,
            'NOT_FOUND',
          );
          assert.equal(foreign.error.code, 'NOT_FOUND');
        });

        await http.test('roles without receiving permission are rejected', async () => {
          const before = (await counts()).receipts;
          const body = {
            packageId: p2.id,
            clientOperationId: randomUUID(),
            items: [{ purchaseOrderItemId: lineA, receivedQty: 1 }],
          };
          for (const actor of ['buyer', 'viewer']) {
            const denied = await receipt(body, { actor });
            assert.equal(denied.status, 403);
            assert.equal((await denied.json()).error.code, 'FORBIDDEN');
          }
          assert.equal((await counts()).receipts, before);
        });

        await http.test('clients cannot submit stock balances or warehouse overrides', async () => {
          const rejected = await read(
            await receipt({
              packageId: p1.id,
              clientOperationId: randomUUID(),
              items: [{ purchaseOrderItemId: lineA, receivedQty: 1 }],
              quantityOnHand: 999,
              totalCost: '0.0000',
              warehouseId: a.defaultWarehouse.id,
            }),
            400,
            'VALIDATION_ERROR',
          );
          const fields = rejected.error.details.fields.map((row) => row.field);
          // Whitelist rejections are reported without echoing the attacker-controlled field name.
          assert.ok(fields.includes('[unknown]'));
          assert.equal(fields.filter((field) => field === '[unknown]').length, 3);
        });

        await http.test(
          'invalid payloads fail validation before touching the database',
          async () => {
            const base = {
              packageId: p1.id,
              clientOperationId: randomUUID(),
            };
            await read(await receipt({ ...base, items: [] }), 400, 'VALIDATION_ERROR');
            await read(
              await receipt({
                ...base,
                items: [
                  { purchaseOrderItemId: lineA, receivedQty: 1 },
                  { purchaseOrderItemId: lineA, receivedQty: 1 },
                ],
              }),
              400,
              'VALIDATION_ERROR',
            );
            await read(
              await receipt({ ...base, items: [{ purchaseOrderItemId: lineA, receivedQty: 0 }] }),
              400,
              'VALIDATION_ERROR',
            );
            await read(
              await receipt({
                packageId: randomUUID(),
                clientOperationId: randomUUID(),
                items: [{ purchaseOrderItemId: lineA, receivedQty: 1 }],
              }),
              404,
              'NOT_FOUND',
            );
            const before = (await counts()).receipts;
            const owner = await createOrder([
              { productId: cable.id, quantity: 2, unitPrice: '9.00' },
            ]);
            const openPackage = await bind(owner, 'YTO', '000RECEIPT-UNKNOWN-LINE', []);
            // A purchase line from any other order must not be accepted by this package.
            await read(
              await receipt({
                packageId: openPackage.id,
                clientOperationId: randomUUID(),
                items: [{ purchaseOrderItemId: randomUUID(), receivedQty: 1 }],
              }),
              422,
              'BUSINESS_VALIDATION_FAILED',
            );
            assert.equal((await counts()).receipts, before);
          },
        );

        await http.test(
          'concurrent confirmations cannot exceed the purchase quantity',
          async () => {
            const race = await createOrder([
              { productId: stand.id, quantity: 5, unitPrice: '12.00' },
            ]);
            const lineS = race.items[0].id;
            const pkg = await bind(race, 'YTO', '000RECEIPT-RACE', []);
            const [one, two] = await Promise.all([
              receipt({
                packageId: pkg.id,
                clientOperationId: randomUUID(),
                items: [{ purchaseOrderItemId: lineS, receivedQty: 3 }],
              }),
              receipt({
                packageId: pkg.id,
                clientOperationId: randomUUID(),
                items: [{ purchaseOrderItemId: lineS, receivedQty: 3 }],
              }),
            ]);
            const statuses = [one.status, two.status].sort();
            assert.deepEqual(statuses, [201, 409]);
            const failed = one.status === 409 ? one : two;
            assert.equal((await failed.json()).error.code, 'RECEIPT_QTY_EXCEEDED');
            const accepted = one.status === 201 ? one : two;
            assert.equal((await accepted.json()).data.totalQuantity, 3);
            const rows = await db.query(
              'SELECT count(*)::int AS t FROM receipts WHERE purchase_order_id=$1',
              [race.id],
            );
            assert.equal(rows.rows[0].t, 1);
            assert.equal((await stock(stand.id)).quantity_on_hand, 3);
          },
        );

        await http.test('moving weighted average cost accumulates exactly', async () => {
          const cheap = await createOrder([{ productId: hub.id, quantity: 4, unitPrice: '10.00' }]);
          const dear = await createOrder([{ productId: hub.id, quantity: 6, unitPrice: '20.00' }]);
          const cheapPackage = await bind(cheap, 'ZTO', '000RECEIPT-WAC-1', []);
          const dearPackage = await bind(dear, 'ZTO', '000RECEIPT-WAC-2', []);
          await read(
            await receipt({
              packageId: cheapPackage.id,
              clientOperationId: randomUUID(),
              items: [{ purchaseOrderItemId: cheap.items[0].id, receivedQty: 4 }],
            }),
            201,
          );
          assert.deepEqual(await stock(hub.id), {
            quantity_on_hand: 4,
            total_cost: '40.0000',
          });
          await read(
            await receipt({
              packageId: dearPackage.id,
              clientOperationId: randomUUID(),
              items: [{ purchaseOrderItemId: dear.items[0].id, receivedQty: 6 }],
            }),
            201,
          );
          assert.deepEqual(await stock(hub.id), {
            quantity_on_hand: 10,
            total_cost: '160.0000',
          });
          const last = await db.query(
            'SELECT quantity_before, quantity_after, total_cost_before::text, total_cost_after::text FROM stock_movements WHERE tenant_id=$1 AND product_id=$2 ORDER BY created_at DESC LIMIT 1',
            [a.tenant.id, hub.id],
          );
          assert.equal(last.rows[0].quantity_before, 4);
          assert.equal(last.rows[0].quantity_after, 10);
          assert.equal(last.rows[0].total_cost_before, '40.0000');
          assert.equal(last.rows[0].total_cost_after, '160.0000');
        });

        await http.test('concurrent orders for one product keep every cost increment', async () => {
          const left = await createOrder([{ productId: hub.id, quantity: 5, unitPrice: '30.00' }]);
          const right = await createOrder([{ productId: hub.id, quantity: 5, unitPrice: '30.00' }]);
          const leftPackage = await bind(left, 'SF', '000RECEIPT-WAC-3', []);
          const rightPackage = await bind(right, 'SF', '000RECEIPT-WAC-4', []);
          const [one, two] = await Promise.all([
            receipt({
              packageId: leftPackage.id,
              clientOperationId: randomUUID(),
              items: [{ purchaseOrderItemId: left.items[0].id, receivedQty: 5 }],
            }),
            receipt({
              packageId: rightPackage.id,
              clientOperationId: randomUUID(),
              items: [{ purchaseOrderItemId: right.items[0].id, receivedQty: 5 }],
            }),
          ]);
          assert.equal(one.status, 201);
          assert.equal(two.status, 201);
          assert.deepEqual(await stock(hub.id), {
            quantity_on_hand: 20,
            total_cost: '460.0000',
          });
        });

        await http.test('receipt list filters by tenant, package, order and number', async () => {
          const total = await db.query(
            'SELECT count(*)::int AS t FROM receipts WHERE tenant_id=$1',
            [a.tenant.id],
          );
          const list = await read(await request('/receipts?page=1&pageSize=100'), 200);
          assert.equal(list.pagination.total, total.rows[0].t);
          assert.equal(list.data.length, total.rows[0].t);
          for (const row of list.data) assert.equal(row.tenantId, a.tenant.id);
          assert.equal(list.data[0].receivedAt >= list.data.at(-1).receivedAt, true);

          const byPackage = await read(
            await request('/receipts?page=1&pageSize=20&packageId=' + p1.id),
            200,
          );
          assert.equal(byPackage.pagination.total, 1);
          assert.equal(byPackage.data[0].id, firstReceipt.id);

          const byOrder = await read(
            await request('/receipts?page=1&pageSize=20&purchaseOrderId=' + order.id),
            200,
          );
          assert.equal(byOrder.pagination.total, 2);

          const bySearch = await read(
            await request('/receipts?page=1&pageSize=20&search=' + firstReceipt.receiptNo),
            200,
          );
          assert.equal(bySearch.pagination.total, 1);
          assert.equal(bySearch.data[0].id, firstReceipt.id);

          const byTracking = await read(
            await request('/receipts?page=1&pageSize=20&search=000RECEIPT-01'),
            200,
          );
          assert.equal(byTracking.pagination.total, 1);

          const foreign = await read(await request('/receipts', { tenant: b }), 200);
          assert.equal(foreign.pagination.total, 0);
          assert.deepEqual(foreign.data, []);
        });

        await http.test(
          'receipt detail returns line snapshots and hides remarks from viewers',
          async () => {
            const owner = await read(await request('/receipts/' + firstReceipt.id), 200);
            assert.equal(owner.data.remark, '外箱完好，人工核对无误');
            assert.equal(owner.data.items[0].sku, 'CHARGER-20W');
            assert.equal(owner.data.items[0].landedUnitCost, '18.5000');
            const viewer = await read(
              await request('/receipts/' + firstReceipt.id, { actor: 'viewer' }),
              200,
            );
            assert.equal(viewer.data.remark, null);
            assert.equal(viewer.data.totalQuantity, 6);
            const missing = await read(
              await request('/receipts/' + randomUUID()),
              404,
              'NOT_FOUND',
            );
            assert.equal(missing.error.code, 'NOT_FOUND');
          },
        );

        await http.test('openapi documents the receipt endpoints only', async () => {
          const doc = await (await fetch(base + '/api/docs-json')).json();
          assert.equal(doc.paths['/api/v1/receipts'].post !== undefined, true);
          assert.equal(doc.paths['/api/v1/receipts'].get !== undefined, true);
          assert.equal(doc.paths['/api/v1/receipts/{id}'].get !== undefined, true);
          const body =
            doc.paths['/api/v1/receipts'].post.requestBody.content['application/json'].schema;
          const reference = body.$ref ?? body.allOf?.at(-1)?.$ref;
          const model = doc.components.schemas[reference.split('/').at(-1)];
          assert.deepEqual(Object.keys(model.properties).sort(), [
            'clientOperationId',
            'items',
            'packageId',
            'remark',
          ]);
          assert.equal(doc.paths['/api/v1/stock-balances'], undefined);
          assert.equal(doc.paths['/api/v1/stock-movements'], undefined);
        });

        await http.test('every movement is internally consistent', async () => {
          const rows = await db.query(
            'SELECT count(*)::int AS t FROM stock_movements WHERE tenant_id=$1 AND quantity_before + quantity_delta <> quantity_after',
            [a.tenant.id],
          );
          assert.equal(rows.rows[0].t, 0);
          const costRows = await db.query(
            'SELECT count(*)::int AS t FROM stock_movements WHERE tenant_id=$1 AND total_cost_before + cost_delta <> total_cost_after',
            [a.tenant.id],
          );
          assert.equal(costRows.rows[0].t, 0);
          const balances = await db.query(
            `SELECT count(*)::int AS t FROM stock_balances b
             WHERE b.tenant_id=$1 AND b.quantity_on_hand <> (
               SELECT COALESCE(SUM(m.quantity_delta),0) FROM stock_movements m
               WHERE m.tenant_id=b.tenant_id AND m.warehouse_id=b.warehouse_id AND m.product_id=b.product_id)`,
            [a.tenant.id],
          );
          assert.equal(balances.rows[0].t, 0);
        });

        assert.equal(/bootstrap_failed|unhandled/i.test(logs), false, 'API log: ' + logs);
      });
    } finally {
      if (connected) await db.end();
      if (created) {
        await admin.query(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()`,
          [name],
        );
        await admin.query(`DROP DATABASE "${name}"`);
      }
      await admin.end();
    }
  },
);
