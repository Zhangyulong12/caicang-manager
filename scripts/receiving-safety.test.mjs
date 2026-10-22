/**
 * Task 18 — dedicated safety suite for the receiving/inventory transaction.
 *
 * Runs the real API against a throw-away PostgreSQL database and asserts not only the HTTP
 * contract but also that receipts, stock_balances and stock_movements stay mutually consistent
 * after every scenario:
 *
 *   01 first acceptance                    07 one line of a multi-line receipt fails
 *   02 same operation id, repeated         08 purchase order already cancelled
 *   03 same operation id, other payload    09 package belongs to another tenant
 *   04 two employees scan one package      10 database failure mid-transaction
 *   05 two packages receive one SKU        11 partial first, remainder later
 *   06 two requests exceed ordered qty     12 weighted average over several receipts
 */
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

const money = (value) => Number(value).toFixed(4);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

test(
  'receiving safety: twelve failure and concurrency scenarios on PostgreSQL',
  { timeout: 600000 },
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
      await t.test('receiving safety scenarios', async (http) => {
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
              'X-Forwarded-For': `203.11.${Math.floor(++counter / 250)}.${(counter % 250) + 1}`,
              ...(actor && accounts[actor]
                ? { Authorization: 'Bearer ' + accounts[actor].accessToken }
                : {}),
              ...(tenant ? { 'X-Tenant-Id': tenant.tenant.id } : {}),
              ...headers,
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          });
        const read = async (response, status, code) => {
          const payload = await response.json();
          assert.equal(
            response.status,
            status,
            `expected ${status} but got ${response.status}: ${JSON.stringify(payload)}`,
          );
          const requestId = response.headers.get('x-request-id');
          if (requestId) assert.equal(payload.requestId, requestId);
          if (code) assert.equal(payload.error.code, code);
          return payload;
        };
        const q = async (sql, params = []) => (await db.query(sql, params)).rows;

        for (const actor of ['owner', 'warehouse', 'warehouse2']) {
          const input = { email: actor + '@receiving.example.test', password: 'Receiving!2026' };
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
            await request('/tenants', {
              tenant: null,
              method: 'POST',
              body: { name: '收货安全 A' },
            }),
            201,
          )
        ).data;
        b = (
          await read(
            await request('/tenants', {
              tenant: null,
              method: 'POST',
              body: { name: '收货安全 B' },
            }),
            201,
          )
        ).data;
        for (const actor of ['warehouse', 'warehouse2'])
          await read(
            await request('/members', {
              method: 'POST',
              body: { email: accounts[actor].user.email, role: 'WAREHOUSE' },
            }),
            201,
          );

        const makeProduct = async (label, sku, unit, tenant = a) =>
          (
            await read(
              await request('/products', {
                tenant,
                method: 'POST',
                body: { name: label, sku, unit },
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
        async function bind(order, trackingNo, expectedItems, tenant = a) {
          return (
            await read(
              await request('/purchase-orders/' + order.id + '/packages', {
                tenant,
                method: 'POST',
                body: {
                  carrierCode: 'ZTO',
                  trackingNo,
                  ...(expectedItems ? { expectedItems } : {}),
                },
              }),
              201,
            )
          ).data;
        }
        const receipt = (body, options = {}) =>
          request('/receipts', { ...options, method: 'POST', body });
        const newBody = (packageId, items, remark) => ({
          packageId,
          clientOperationId: randomUUID(),
          items,
          ...(remark === undefined ? {} : { remark }),
        });

        const stockOf = async (productId, tenant = a) => {
          const rows = await q(
            `SELECT quantity_on_hand, total_cost::text AS total_cost FROM stock_balances
             WHERE tenant_id=$1 AND warehouse_id=$2 AND product_id=$3`,
            [tenant.tenant.id, tenant.defaultWarehouse.id, productId],
          );
          return rows[0] ?? { quantity_on_hand: 0, total_cost: '0.0000' };
        };
        const scalar = async (sql, params = []) => {
          const rows = await q(sql, params);
          return rows[0];
        };

        /**
         * The safety net used after every scenario. It proves four independent invariants:
         *  - stock_balances equals the sum of its movements, per warehouse and product;
         *  - every RECEIPT movement is joined one-to-one with a receipt line, same quantity and cost;
         *  - movements of a product form one gap-free chain 0 -> ... -> on hand (no lost update);
         *  - receipts, order status and cumulative quantities agree with each other.
         */
        const assertLedger = async (tenantId, label) => {
          const balances = await q(
            `SELECT b.product_id, b.quantity_on_hand, b.total_cost::text AS total_cost,
                    COALESCE(m.qty, 0)::int AS movement_qty,
                    COALESCE(m.cost, 0)::text AS movement_cost
             FROM stock_balances b
             LEFT JOIN (SELECT warehouse_id, product_id, SUM(quantity_delta) AS qty, SUM(cost_delta) AS cost
                        FROM stock_movements WHERE tenant_id=$1
                        GROUP BY warehouse_id, product_id) m
               ON m.warehouse_id=b.warehouse_id AND m.product_id=b.product_id
             WHERE b.tenant_id=$1`,
            [tenantId],
          );
          for (const row of balances) {
            assert.equal(
              row.quantity_on_hand,
              row.movement_qty,
              `[${label}] balance quantity drifted from movements for ${row.product_id}`,
            );
            assert.equal(
              money(row.total_cost),
              money(row.movement_cost),
              `[${label}] balance cost drifted from movements for ${row.product_id}`,
            );
            assert.ok(row.quantity_on_hand >= 0, `[${label}] negative balance`);
          }

          const orphanMovements = await scalar(
            `SELECT count(*)::int AS c FROM stock_movements m
             LEFT JOIN stock_balances b
               ON b.tenant_id=m.tenant_id AND b.warehouse_id=m.warehouse_id AND b.product_id=m.product_id
             WHERE m.tenant_id=$1 AND b.id IS NULL`,
            [tenantId],
          );
          assert.equal(orphanMovements.c, 0, `[${label}] movement without a balance row`);

          const lines = await q(
            `SELECT ri.id, ri.quantity, ri.landed_unit_cost::text AS unit_cost,
                    ri.purchase_order_id AS item_order, r.purchase_order_id AS receipt_order,
                    poi.product_id AS line_product, ri.product_id,
                    m.id AS movement_id, m.source_type, m.quantity_delta, m.cost_delta::text AS cost_delta
             FROM receipt_items ri
             JOIN receipts r ON r.tenant_id=ri.tenant_id AND r.id=ri.receipt_id
             LEFT JOIN purchase_order_items poi ON poi.id=ri.purchase_order_item_id
             LEFT JOIN stock_movements m ON m.tenant_id=ri.tenant_id AND m.source_item_id=ri.id
             WHERE ri.tenant_id=$1`,
            [tenantId],
          );
          for (const line of lines) {
            assert.equal(
              line.item_order,
              line.receipt_order,
              `[${label}] line outside its receipt`,
            );
            assert.equal(line.line_product, line.product_id, `[${label}] line product mismatch`);
            assert.ok(line.movement_id, `[${label}] receipt line ${line.id} has no movement`);
            assert.equal(line.source_type, 'RECEIPT');
            assert.equal(line.quantity_delta, line.quantity);
            assert.equal(money(line.cost_delta), money(Number(line.unit_cost) * line.quantity));
          }

          const orphanReceiptMovements = await scalar(
            `SELECT count(*)::int AS c FROM stock_movements m
             LEFT JOIN receipt_items ri ON ri.tenant_id=m.tenant_id AND ri.id=m.source_item_id
             WHERE m.tenant_id=$1 AND m.source_type='RECEIPT' AND ri.id IS NULL`,
            [tenantId],
          );
          assert.equal(orphanReceiptMovements.c, 0, `[${label}] receipt movement without a line`);

          const movements = await q(
            `SELECT product_id, quantity_before, quantity_delta, quantity_after,
                    total_cost_before::text AS cost_before, total_cost_after::text AS cost_after
             FROM stock_movements WHERE tenant_id=$1 ORDER BY product_id, quantity_before`,
            [tenantId],
          );
          const chain = new Map();
          for (const movement of movements) {
            if (!chain.has(movement.product_id)) chain.set(movement.product_id, []);
            chain.get(movement.product_id).push(movement);
          }
          for (const [productId, rows] of chain) {
            let expectedQuantity = 0,
              expectedCost = 0;
            for (const row of rows) {
              assert.equal(
                row.quantity_before,
                expectedQuantity,
                `[${label}] gap or duplicate start in the movement chain of ${productId}`,
              );
              assert.equal(
                money(row.cost_before),
                money(expectedCost),
                `[${label}] cost chain broken for ${productId}`,
              );
              assert.equal(row.quantity_after, row.quantity_before + row.quantity_delta);
              expectedQuantity = row.quantity_after;
              expectedCost = Number(row.cost_after);
            }
            const balance = balances.find((row) => row.product_id === productId);
            assert.equal(
              balance.quantity_on_hand,
              expectedQuantity,
              `[${label}] chain end differs from on-hand quantity for ${productId}`,
            );
            assert.equal(money(balance.total_cost), money(expectedCost));
          }

          const overReceived = await q(
            `SELECT ri.purchase_order_item_id, SUM(ri.quantity)::int AS received, poi.quantity AS ordered
             FROM receipt_items ri
             JOIN purchase_order_items poi ON poi.id=ri.purchase_order_item_id
             WHERE ri.tenant_id=$1 GROUP BY ri.purchase_order_item_id, poi.quantity
             HAVING SUM(ri.quantity) > poi.quantity`,
            [tenantId],
          );
          assert.deepEqual(overReceived, [], `[${label}] a line received more than ordered`);

          const orders = await q(
            `SELECT po.id, po.status,
                    (SELECT COALESCE(SUM(poi.quantity),0)::int FROM purchase_order_items poi
                     WHERE poi.purchase_order_id=po.id) AS ordered,
                    COALESCE((SELECT SUM(ri.quantity)::int FROM receipt_items ri
                     WHERE ri.purchase_order_id=po.id),0) AS received
             FROM purchase_orders po WHERE po.tenant_id=$1`,
            [tenantId],
          );
          for (const order of orders) {
            if (order.status === 'RECEIVED')
              assert.equal(
                order.received,
                order.ordered,
                `[${label}] RECEIVED order not fully received`,
              );
            if (order.status === 'PARTIAL_RECEIVED')
              assert.ok(
                order.received > 0 && order.received < order.ordered,
                `[${label}] PARTIAL_RECEIVED order has ${order.received}/${order.ordered}`,
              );
            if (['PLACED', 'DRAFT', 'CANCELLED'].includes(order.status))
              assert.equal(order.received, 0, `[${label}] ${order.status} order has receipts`);
          }
        };

        /** Compares one API receipt against the rows it claims to describe. */
        const assertReceiptMatchesDb = async (receiptId, tenant = a) => {
          const detail = (await read(await request('/receipts/' + receiptId, { tenant }), 200))
            .data;
          const header = await scalar(
            `SELECT COALESCE(SUM(quantity),0)::int AS qty,
                    COALESCE(SUM(quantity * landed_unit_cost),0)::text AS cost,
                    count(*)::int AS lines
             FROM receipt_items WHERE tenant_id=$1 AND receipt_id=$2`,
            [tenant.tenant.id, receiptId],
          );
          assert.equal(detail.totalQuantity, header.qty);
          assert.equal(money(detail.totalCost), money(header.cost));
          assert.equal(detail.items.length, header.lines);
          return detail;
        };

        const installCounterTrigger = async () => {
          await db.query(`CREATE TABLE _test_fail_counter (n serial primary key)`);
          await db.query(`
            CREATE FUNCTION _test_fail_second_movement() RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE seen int;
            BEGIN
              INSERT INTO _test_fail_counter DEFAULT VALUES;
              SELECT count(*) INTO seen FROM _test_fail_counter;
              IF seen = 2 THEN
                RAISE EXCEPTION 'injected failure on the second stock movement';
              END IF;
              RETURN NEW;
            END $$`);
          await db.query(
            `CREATE TRIGGER tr_test_fail_movement BEFORE INSERT ON stock_movements
             FOR EACH ROW EXECUTE FUNCTION _test_fail_second_movement()`,
          );
        };
        const dropCounterTrigger = async () => {
          await db.query('DROP TRIGGER IF EXISTS tr_test_fail_movement ON stock_movements');
          await db.query('DROP FUNCTION IF EXISTS _test_fail_second_movement()');
          await db.query('DROP TABLE IF EXISTS _test_fail_counter');
        };
        const installAuditTrigger = async (tenantId) => {
          assert.match(tenantId, uuid);
          await db.query(`
            CREATE FUNCTION _test_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
              RAISE EXCEPTION 'injected failure while writing the audit log';
            END $$`);
          await db.query(
            `CREATE TRIGGER tr_test_fail_audit BEFORE INSERT ON audit_logs
             FOR EACH ROW EXECUTE FUNCTION _test_fail_audit()`,
          );
        };
        const dropAuditTrigger = async () => {
          await db.query('DROP TRIGGER IF EXISTS tr_test_fail_audit ON audit_logs');
          await db.query('DROP FUNCTION IF EXISTS _test_fail_audit()');
        };

        // ---------------------------------------------------------------- 01
        const charger = await makeProduct('20W 充电器', 'CHG-20W', '件');
        const order1 = await createOrder([
          { productId: charger.id, quantity: 10, unitPrice: '18.50' },
        ]);
        const line1 = order1.items[0].id;
        const pkg1 = await bind(order1, 'SAFE-01', [
          { purchaseOrderItemId: line1, expectedQuantity: 6 },
        ]);
        const op1 = randomUUID();
        const firstBody = {
          packageId: pkg1.id,
          clientOperationId: op1,
          items: [{ purchaseOrderItemId: line1, receivedQty: 6 }],
          remark: '外箱完好，人工核对无误',
        };
        let firstReceipt;

        await http.test(
          '01 first acceptance: receipt, balance and movement are written together',
          async () => {
            const response = await receipt(firstBody);
            assert.equal(response.status, 201);
            firstReceipt = (await response.json()).data;
            assert.match(firstReceipt.receiptNo, /^RCV-\d{8}-[0-9A-F]{10}$/);
            assert.equal(firstReceipt.status, 'CONFIRMED');
            assert.equal(firstReceipt.totalQuantity, 6);
            assert.equal(firstReceipt.totalCost, '111.0000');
            assert.equal(firstReceipt.items[0].landedUnitCost, '18.5000');

            assert.deepEqual(await stockOf(charger.id), {
              quantity_on_hand: 6,
              total_cost: '111.0000',
            });
            const movement = await scalar(
              `SELECT source_type, quantity_delta, quantity_before, quantity_after,
                    total_cost_before::text AS before_cost, total_cost_after::text AS after_cost
             FROM stock_movements WHERE tenant_id=$1`,
              [a.tenant.id],
            );
            assert.deepEqual(movement, {
              source_type: 'RECEIPT',
              quantity_delta: 6,
              quantity_before: 0,
              quantity_after: 6,
              before_cost: '0.0000',
              after_cost: '111.0000',
            });
            assert.equal(
              (await scalar('SELECT status FROM purchase_orders WHERE id=$1', [order1.id])).status,
              'PARTIAL_RECEIVED',
            );
            const closed = await scalar(
              'SELECT status, receiving_closed_at FROM packages WHERE id=$1',
              [pkg1.id],
            );
            assert.equal(closed.status, 'RECEIVED');
            assert.ok(closed.receiving_closed_at);
            const audit = await scalar(
              `SELECT count(*)::int AS c FROM audit_logs
             WHERE tenant_id=$1 AND action='RECEIPT_CONFIRMED' AND object_id=$2`,
              [a.tenant.id, firstReceipt.id],
            );
            assert.equal(audit.c, 1);
            await assertReceiptMatchesDb(firstReceipt.id);
            await assertLedger(a.tenant.id, '01');
          },
        );

        // ---------------------------------------------------------------- 02
        await http.test(
          '02 same operation id is replayed, ten times in a row and five times at once',
          async () => {
            for (let attempt = 0; attempt < 10; attempt += 1) {
              const replay = await receipt(firstBody);
              assert.equal(replay.status, 200, 'sequential retry ' + attempt + ' must not create');
              const payload = await replay.json();
              assert.equal(payload.data.id, firstReceipt.id);
              assert.equal(payload.data.receivedAt, firstReceipt.receivedAt);
            }
            const concurrent = await Promise.all(
              Array.from({ length: 5 }, () => receipt(firstBody)),
            );
            for (const response of concurrent) {
              assert.equal(response.status, 200);
              assert.equal((await response.json()).data.id, firstReceipt.id);
            }
            assert.deepEqual(await stockOf(charger.id), {
              quantity_on_hand: 6,
              total_cost: '111.0000',
            });
            assert.equal(
              (
                await scalar('SELECT count(*)::int AS c FROM receipts WHERE tenant_id=$1', [
                  a.tenant.id,
                ])
              ).c,
              1,
            );
            await assertLedger(a.tenant.id, '02');
          },
        );

        // ---------------------------------------------------------------- 03
        await http.test(
          '03 same operation id with another payload is rejected without side effects',
          async () => {
            const before = await scalar(
              `SELECT (SELECT count(*)::int FROM receipts WHERE tenant_id=$1) AS receipts,
                    (SELECT count(*)::int FROM receipt_items WHERE tenant_id=$1) AS items,
                    (SELECT count(*)::int FROM stock_movements WHERE tenant_id=$1) AS movements`,
              [a.tenant.id],
            );
            for (const body of [
              { ...firstBody, items: [{ purchaseOrderItemId: line1, receivedQty: 5 }] },
              { ...firstBody, remark: '改过的备注' },
              { ...firstBody, packageId: randomUUID() },
            ]) {
              const payload = await read(await receipt(body), 409, 'IDEMPOTENCY_CONFLICT');
              assert.equal(payload.error.details.clientOperationId, op1.toLowerCase());
            }
            const after = await scalar(
              `SELECT (SELECT count(*)::int FROM receipts WHERE tenant_id=$1) AS receipts,
                    (SELECT count(*)::int FROM receipt_items WHERE tenant_id=$1) AS items,
                    (SELECT count(*)::int FROM stock_movements WHERE tenant_id=$1) AS movements`,
              [a.tenant.id],
            );
            assert.deepEqual(after, before);
            assert.equal((await stockOf(charger.id)).quantity_on_hand, 6);

            // The same operation id sent twice at once with diverging quantities: one wins, the
            // other must conflict instead of silently overwriting the accepted receipt.
            const buckle = await makeProduct('打包扣', 'BUCKLE-01', '个');
            const order = await createOrder([
              { productId: buckle.id, quantity: 10, unitPrice: '1.20' },
            ]);
            const line = order.items[0].id;
            const pkg = await bind(order, 'SAFE-03', [
              { purchaseOrderItemId: line, expectedQuantity: 10 },
            ]);
            const operationId = randomUUID();
            const raced = await Promise.all([
              receipt({
                packageId: pkg.id,
                clientOperationId: operationId,
                items: [{ purchaseOrderItemId: line, receivedQty: 4 }],
              }),
              receipt({
                packageId: pkg.id,
                clientOperationId: operationId,
                items: [{ purchaseOrderItemId: line, receivedQty: 5 }],
              }),
            ]);
            assert.deepEqual(
              raced.map((response) => response.status).sort(),
              [201, 409],
              'only one of two racing payloads may be accepted',
            );
            const conflict = raced.find((response) => response.status === 409);
            assert.equal((await conflict.json()).error.code, 'IDEMPOTENCY_CONFLICT');
            const winner = raced.find((response) => response.status === 201);
            const accepted = (await winner.json()).data;
            assert.equal(accepted.clientOperationId, operationId);
            const balance = await stockOf(buckle.id);
            assert.equal(balance.quantity_on_hand, accepted.totalQuantity);
            assert.equal(money(balance.total_cost), money(accepted.totalCost));
            assert.equal(
              (
                await scalar(
                  'SELECT count(*)::int AS c FROM receipts WHERE tenant_id=$1 AND purchase_order_id=$2',
                  [a.tenant.id, order.id],
                )
              ).c,
              1,
            );
            await assertLedger(a.tenant.id, '03');
          },
        );

        // ---------------------------------------------------------------- 04
        await http.test(
          '04 two employees scanning one package: exactly one acceptance wins',
          async () => {
            const cable = await makeProduct('1 米数据线', 'CBL-1M', '条');
            const order = await createOrder([
              { productId: cable.id, quantity: 10, unitPrice: '5.00' },
            ]);
            const line = order.items[0].id;
            const pkg = await bind(order, 'SAFE-04', [
              { purchaseOrderItemId: line, expectedQuantity: 10 },
            ]);
            const [left, right] = await Promise.all([
              receipt(newBody(pkg.id, [{ purchaseOrderItemId: line, receivedQty: 10 }]), {
                actor: 'warehouse',
              }),
              receipt(newBody(pkg.id, [{ purchaseOrderItemId: line, receivedQty: 10 }]), {
                actor: 'warehouse2',
              }),
            ]);
            const statuses = [left.status, right.status].sort();
            assert.deepEqual(statuses, [201, 409], 'one employee records, the other is rejected');
            const rejected = left.status === 409 ? left : right;
            const payload = await rejected.json();
            assert.ok(
              ['STATUS_CONFLICT', 'RECEIPT_QTY_EXCEEDED'].includes(payload.error.code),
              'unexpected rejection code ' + payload.error.code,
            );
            const accepted = left.status === 201 ? left : right;
            const receiptData = (await accepted.json()).data;
            assert.equal(
              [accounts.warehouse.user.id, accounts.warehouse2.user.id].includes(
                receiptData.receivedBy,
              ),
              true,
            );
            assert.deepEqual(await stockOf(cable.id), {
              quantity_on_hand: 10,
              total_cost: '50.0000',
            });
            assert.equal(
              (
                await scalar(
                  'SELECT count(*)::int AS c FROM receipts WHERE tenant_id=$1 AND purchase_order_id=$2',
                  [a.tenant.id, order.id],
                )
              ).c,
              1,
            );
            await assertLedger(a.tenant.id, '04');
          },
        );

        // ---------------------------------------------------------------- 05
        await http.test(
          '05 two packages receiving the same SKU add up without a lost update',
          async () => {
            const stand = await makeProduct('铝合金支架', 'STAND-AL', '个');
            const order = await createOrder([
              { productId: stand.id, quantity: 10, unitPrice: '12.00' },
            ]);
            const line = order.items[0].id;
            const left = await bind(order, 'SAFE-05A', [
              { purchaseOrderItemId: line, expectedQuantity: 5 },
            ]);
            const right = await bind(order, 'SAFE-05B', [
              { purchaseOrderItemId: line, expectedQuantity: 5 },
            ]);
            const responses = await Promise.all([
              receipt(newBody(left.id, [{ purchaseOrderItemId: line, receivedQty: 5 }])),
              receipt(newBody(right.id, [{ purchaseOrderItemId: line, receivedQty: 5 }])),
            ]);
            assert.deepEqual(
              responses.map((response) => response.status),
              [201, 201],
            );
            assert.deepEqual(await stockOf(stand.id), {
              quantity_on_hand: 10,
              total_cost: '120.0000',
            });
            assert.equal(
              (await scalar('SELECT status FROM purchase_orders WHERE id=$1', [order.id])).status,
              'RECEIVED',
            );

            // Two different purchase orders of the same SKU contend for the same balance row.
            const screw = await makeProduct('螺丝盒', 'SCREW-BOX', '盒');
            const first = await createOrder([
              { productId: screw.id, quantity: 6, unitPrice: '2.00' },
            ]);
            const second = await createOrder([
              { productId: screw.id, quantity: 6, unitPrice: '2.00' },
            ]);
            const firstPkg = await bind(first, 'SAFE-05C', [
              { purchaseOrderItemId: first.items[0].id, expectedQuantity: 6 },
            ]);
            const secondPkg = await bind(second, 'SAFE-05D', [
              { purchaseOrderItemId: second.items[0].id, expectedQuantity: 6 },
            ]);
            const crossOrder = await Promise.all([
              receipt(
                newBody(firstPkg.id, [{ purchaseOrderItemId: first.items[0].id, receivedQty: 6 }]),
              ),
              receipt(
                newBody(secondPkg.id, [
                  { purchaseOrderItemId: second.items[0].id, receivedQty: 6 },
                ]),
              ),
            ]);
            assert.deepEqual(
              crossOrder.map((response) => response.status),
              [201, 201],
            );
            assert.deepEqual(await stockOf(screw.id), {
              quantity_on_hand: 12,
              total_cost: '24.0000',
            });
            const chain = await q(
              `SELECT quantity_before, quantity_after FROM stock_movements
             WHERE tenant_id=$1 AND product_id=$2 ORDER BY quantity_before`,
              [a.tenant.id, screw.id],
            );
            assert.deepEqual(chain, [
              { quantity_before: 0, quantity_after: 6 },
              { quantity_before: 6, quantity_after: 12 },
            ]);
            await assertLedger(a.tenant.id, '05');
          },
        );

        // ---------------------------------------------------------------- 06
        await http.test(
          '06 two requests that together exceed the ordered quantity are refused',
          async () => {
            const tape = await makeProduct('封箱胶带', 'TAPE-48', '卷');
            const order = await createOrder([
              { productId: tape.id, quantity: 10, unitPrice: '3.00' },
            ]);
            const line = order.items[0].id;
            const firstPkg = await bind(order, 'SAFE-06A', [
              { purchaseOrderItemId: line, expectedQuantity: 6 },
            ]);
            // The second parcel carries no plan, so only the ordered quantity can stop it.
            const secondPkg = await bind(order, 'SAFE-06B');
            await read(
              await receipt(newBody(firstPkg.id, [{ purchaseOrderItemId: line, receivedQty: 6 }])),
              201,
            );
            const rejected = await read(
              await receipt(newBody(secondPkg.id, [{ purchaseOrderItemId: line, receivedQty: 5 }])),
              409,
              'RECEIPT_QTY_EXCEEDED',
            );
            assert.equal(rejected.error.details.maxReceivableQuantity, 4);
            assert.deepEqual(await stockOf(tape.id), {
              quantity_on_hand: 6,
              total_cost: '18.0000',
            });

            // The same race without ordering: both requests are valid on their own.
            const strap = await makeProduct('打包带', 'STRAP-01', '卷');
            const raced = await createOrder([
              { productId: strap.id, quantity: 10, unitPrice: '7.00' },
            ]);
            const racedLine = raced.items[0].id;
            const leftPkg = await bind(raced, 'SAFE-06C');
            const rightPkg = await bind(raced, 'SAFE-06D');
            const responses = await Promise.all([
              receipt(newBody(leftPkg.id, [{ purchaseOrderItemId: racedLine, receivedQty: 6 }])),
              receipt(newBody(rightPkg.id, [{ purchaseOrderItemId: racedLine, receivedQty: 6 }])),
            ]);
            assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
            assert.deepEqual(await stockOf(strap.id), {
              quantity_on_hand: 6,
              total_cost: '42.0000',
            });
            await assertLedger(a.tenant.id, '06');
          },
        );

        // ---------------------------------------------------------------- 07
        await http.test('07 a failing line rolls back the whole multi-line receipt', async () => {
          const hub = await makeProduct('七合一扩展坞', 'HUB-7IN1', '台');
          const lan = await makeProduct('两米网线', 'CAT6-2M', '条');
          const order = await createOrder([
            { productId: hub.id, quantity: 5, unitPrice: '40.00' },
            { productId: lan.id, quantity: 10, unitPrice: '6.00' },
          ]);
          const hubLine = order.items.find((item) => item.productId === hub.id).id;
          const lanLine = order.items.find((item) => item.productId === lan.id).id;
          const pkg = await bind(order, 'SAFE-07', [
            { purchaseOrderItemId: hubLine, expectedQuantity: 5 },
            { purchaseOrderItemId: lanLine, expectedQuantity: 10 },
          ]);

          // Validation-level failure: the second line asks for more than was ordered.
          const invalid = await read(
            await receipt(
              newBody(pkg.id, [
                { purchaseOrderItemId: lanLine, receivedQty: 4 },
                { purchaseOrderItemId: hubLine, receivedQty: 6 },
              ]),
            ),
            409,
            'RECEIPT_QTY_EXCEEDED',
          );
          assert.equal(invalid.error.details.purchaseOrderItemId, hubLine);
          assert.deepEqual(await stockOf(lan.id), { quantity_on_hand: 0, total_cost: '0.0000' });
          assert.deepEqual(await stockOf(hub.id), { quantity_on_hand: 0, total_cost: '0.0000' });

          // Storage-level failure: the receipt is half-written when the second movement fails.
          const packageBefore = await scalar(
            'SELECT status, receiving_closed_at FROM packages WHERE id=$1',
            [pkg.id],
          );
          const movementsBefore = (
            await scalar('SELECT count(*)::int AS c FROM stock_movements WHERE tenant_id=$1', [
              a.tenant.id,
            ])
          ).c;
          await installCounterTrigger();
          const operationId = randomUUID();
          try {
            const failed = await read(
              await receipt({
                packageId: pkg.id,
                clientOperationId: operationId,
                items: [
                  { purchaseOrderItemId: lanLine, receivedQty: 4 },
                  { purchaseOrderItemId: hubLine, receivedQty: 2 },
                ],
              }),
              500,
              'INTERNAL_ERROR',
            );
            assert.equal(failed.error.code, 'INTERNAL_ERROR');
          } finally {
            await dropCounterTrigger();
          }
          assert.equal(
            (
              await scalar(
                'SELECT count(*)::int AS c FROM receipts WHERE tenant_id=$1 AND purchase_order_id=$2',
                [a.tenant.id, order.id],
              )
            ).c,
            0,
          );
          assert.equal(
            (
              await scalar(
                'SELECT count(*)::int AS c FROM receipt_items WHERE tenant_id=$1 AND purchase_order_id=$2',
                [a.tenant.id, order.id],
              )
            ).c,
            0,
          );
          assert.equal(
            (
              await scalar('SELECT count(*)::int AS c FROM stock_movements WHERE tenant_id=$1', [
                a.tenant.id,
              ])
            ).c,
            movementsBefore,
            'the failed receipt must not leave a stock movement behind',
          );
          assert.deepEqual(await stockOf(lan.id), { quantity_on_hand: 0, total_cost: '0.0000' });
          assert.deepEqual(await stockOf(hub.id), { quantity_on_hand: 0, total_cost: '0.0000' });
          assert.equal(
            (await scalar('SELECT status FROM purchase_orders WHERE id=$1', [order.id])).status,
            'PLACED',
          );
          const packageAfter = await scalar(
            'SELECT status, receiving_closed_at FROM packages WHERE id=$1',
            [pkg.id],
          );
          assert.equal(packageAfter.status, packageBefore.status);
          assert.equal(packageAfter.receiving_closed_at, packageBefore.receiving_closed_at);

          // Nothing was persisted, so the very same operation id may still be confirmed.
          const recovered = await read(
            await receipt({
              packageId: pkg.id,
              clientOperationId: operationId,
              items: [
                { purchaseOrderItemId: lanLine, receivedQty: 4 },
                { purchaseOrderItemId: hubLine, receivedQty: 2 },
              ],
            }),
            201,
          );
          assert.equal(recovered.data.totalQuantity, 6);
          assert.deepEqual(await stockOf(lan.id), {
            quantity_on_hand: 4,
            total_cost: '24.0000',
          });
          assert.deepEqual(await stockOf(hub.id), {
            quantity_on_hand: 2,
            total_cost: '80.0000',
          });
          await assertLedger(a.tenant.id, '07');
        });

        // ---------------------------------------------------------------- 08
        await http.test('08 a cancelled purchase order accepts no goods', async () => {
          const mount = await makeProduct('显示器挂架', 'MNT-01', '套');
          const order = await createOrder([
            { productId: mount.id, quantity: 3, unitPrice: '33.00' },
          ]);
          const line = order.items[0].id;
          const pkg = await bind(order, 'SAFE-08', [
            { purchaseOrderItemId: line, expectedQuantity: 3 },
          ]);
          const cancelled = await read(
            await request('/purchase-orders/' + order.id + '/cancel', { method: 'POST' }),
            200,
          );
          assert.equal(cancelled.data.status, 'CANCELLED');
          const rejected = await read(
            await receipt(newBody(pkg.id, [{ purchaseOrderItemId: line, receivedQty: 3 }])),
            409,
            'STATUS_CONFLICT',
          );
          assert.equal(rejected.error.details.purchaseStatus, 'CANCELLED');
          assert.deepEqual(await stockOf(mount.id), { quantity_on_hand: 0, total_cost: '0.0000' });
          assert.equal(
            (
              await scalar(
                'SELECT count(*)::int AS c FROM receipts WHERE tenant_id=$1 AND purchase_order_id=$2',
                [a.tenant.id, order.id],
              )
            ).c,
            0,
          );
          await assertLedger(a.tenant.id, '08');
        });

        // ---------------------------------------------------------------- 09
        await http.test('09 a package of another tenant is invisible', async () => {
          const marker = await makeProduct('记号笔', 'MARKER-B', '支', b);
          const orderB = await createOrder(
            [{ productId: marker.id, quantity: 2, unitPrice: '1.50' }],
            b,
          );
          const pkgB = await bind(
            orderB,
            'SAFE-09B',
            [{ purchaseOrderItemId: orderB.items[0].id, expectedQuantity: 2 }],
            b,
          );
          const rejected = await read(
            await receipt(
              newBody(pkgB.id, [{ purchaseOrderItemId: orderB.items[0].id, receivedQty: 2 }]),
            ),
            404,
            'NOT_FOUND',
          );
          assert.equal(rejected.error.code, 'NOT_FOUND');
          assert.equal(
            (
              await scalar('SELECT count(*)::int AS c FROM receipts WHERE tenant_id=$1', [
                b.tenant.id,
              ])
            ).c,
            0,
          );
          assert.deepEqual(await stockOf(marker.id, b), {
            quantity_on_hand: 0,
            total_cost: '0.0000',
          });
          // The order is also unreachable from the other tenant.
          await read(await request('/purchase-orders/' + orderB.id), 404, 'NOT_FOUND');
          await assertLedger(a.tenant.id, '09-another-tenant');
          await assertLedger(b.tenant.id, '09-tenant-b');
        });

        // ---------------------------------------------------------------- 10
        await http.test(
          '10 a database failure at the last step rolls everything back',
          async () => {
            const relay = await makeProduct('继电器', 'RELAY-12V', '个');
            const order = await createOrder([
              { productId: relay.id, quantity: 7, unitPrice: '9.50' },
            ]);
            const line = order.items[0].id;
            const pkg = await bind(order, 'SAFE-10', [
              { purchaseOrderItemId: line, expectedQuantity: 7 },
            ]);
            const packageBefore = await scalar(
              'SELECT status, receiving_closed_at FROM packages WHERE id=$1',
              [pkg.id],
            );
            const auditsBefore = (
              await scalar(
                `SELECT count(*)::int AS c FROM audit_logs WHERE tenant_id=$1 AND action='RECEIPT_CONFIRMED'`,
                [a.tenant.id],
              )
            ).c;
            const operationId = randomUUID();
            const body = {
              packageId: pkg.id,
              clientOperationId: operationId,
              items: [{ purchaseOrderItemId: line, receivedQty: 7 }],
            };
            await installAuditTrigger(a.tenant.id);
            try {
              await read(await receipt(body), 500, 'INTERNAL_ERROR');
            } finally {
              await dropAuditTrigger();
            }
            // The audit log is the last write, so a failure there must undo receipt, lines, balance,
            // order status and package status.
            assert.equal(
              (
                await scalar(
                  'SELECT count(*)::int AS c FROM receipts WHERE tenant_id=$1 AND purchase_order_id=$2',
                  [a.tenant.id, order.id],
                )
              ).c,
              0,
            );
            assert.equal(
              (
                await scalar(
                  'SELECT count(*)::int AS c FROM receipt_items WHERE tenant_id=$1 AND purchase_order_id=$2',
                  [a.tenant.id, order.id],
                )
              ).c,
              0,
            );
            assert.equal(
              (
                await scalar(
                  `SELECT count(*)::int AS c FROM stock_movements
                 WHERE tenant_id=$1 AND product_id=$2`,
                  [a.tenant.id, relay.id],
                )
              ).c,
              0,
            );
            assert.deepEqual(await stockOf(relay.id), {
              quantity_on_hand: 0,
              total_cost: '0.0000',
            });
            assert.equal(
              (await scalar('SELECT status FROM purchase_orders WHERE id=$1', [order.id])).status,
              'PLACED',
            );
            const packageAfter = await scalar(
              'SELECT status, receiving_closed_at FROM packages WHERE id=$1',
              [pkg.id],
            );
            assert.equal(packageAfter.status, packageBefore.status);
            assert.equal(packageAfter.receiving_closed_at, packageBefore.receiving_closed_at);
            assert.equal(
              (
                await scalar(
                  `SELECT count(*)::int AS c FROM audit_logs
                 WHERE tenant_id=$1 AND action='RECEIPT_CONFIRMED'`,
                  [a.tenant.id],
                )
              ).c,
              auditsBefore,
              'the rolled back receipt must not leave an audit row',
            );
            await assertLedger(a.tenant.id, '10-rollback');

            const recovered = await read(await receipt(body), 201);
            assert.equal(recovered.data.totalQuantity, 7);
            assert.deepEqual(await stockOf(relay.id), {
              quantity_on_hand: 7,
              total_cost: '66.5000',
            });
            assert.equal(
              (await scalar('SELECT status FROM purchase_orders WHERE id=$1', [order.id])).status,
              'RECEIVED',
            );
            await assertLedger(a.tenant.id, '10-recovered');
          },
        );

        // ---------------------------------------------------------------- 11
        await http.test('11 partial receipt first, remainder later, nothing twice', async () => {
          const sensor = await makeProduct('温湿度传感器', 'SENSOR-TH', '只');
          const order = await createOrder([
            { productId: sensor.id, quantity: 10, unitPrice: '25.00' },
          ]);
          const line = order.items[0].id;
          const firstPkg = await bind(order, 'SAFE-11A', [
            { purchaseOrderItemId: line, expectedQuantity: 6 },
          ]);
          const secondPkg = await bind(order, 'SAFE-11B', [
            { purchaseOrderItemId: line, expectedQuantity: 4 },
          ]);
          const partial = await read(
            await receipt(newBody(firstPkg.id, [{ purchaseOrderItemId: line, receivedQty: 6 }])),
            201,
          );
          assert.equal(
            (await scalar('SELECT status FROM purchase_orders WHERE id=$1', [order.id])).status,
            'PARTIAL_RECEIVED',
          );
          assert.deepEqual(await stockOf(sensor.id), {
            quantity_on_hand: 6,
            total_cost: '150.0000',
          });
          await assertReceiptMatchesDb(partial.data.id);

          // The closed package cannot be confirmed again, even for the remainder.
          await read(
            await receipt(newBody(firstPkg.id, [{ purchaseOrderItemId: line, receivedQty: 2 }])),
            409,
            'STATUS_CONFLICT',
          );

          const rest = await read(
            await receipt(newBody(secondPkg.id, [{ purchaseOrderItemId: line, receivedQty: 4 }])),
            201,
          );
          assert.equal(rest.data.totalQuantity, 4);
          assert.equal(
            (await scalar('SELECT status FROM purchase_orders WHERE id=$1', [order.id])).status,
            'RECEIVED',
          );
          assert.deepEqual(await stockOf(sensor.id), {
            quantity_on_hand: 10,
            total_cost: '250.0000',
          });
          const list = await read(
            await request('/receipts?purchaseOrderId=' + order.id + '&pageSize=100'),
            200,
          );
          assert.equal(list.data.length, 2);
          assert.deepEqual(
            list.data.map((row) => row.totalQuantity).sort((left, right) => left - right),
            [4, 6],
          );
          assert.deepEqual(
            (
              await q(
                `SELECT quantity_before, quantity_after FROM stock_movements
               WHERE tenant_id=$1 AND product_id=$2 ORDER BY quantity_before`,
                [a.tenant.id, sensor.id],
              )
            ).map((row) => [row.quantity_before, row.quantity_after]),
            [
              [0, 6],
              [6, 10],
            ],
          );
          await assertLedger(a.tenant.id, '11');
        });

        // ---------------------------------------------------------------- 12
        await http.test(
          '12 moving weighted average across several receipts and prices',
          async () => {
            const pump = await makeProduct('微型水泵', 'PUMP-5V', '台');
            const steps = [
              { quantity: 10, unitPrice: '10.00', trackingNo: 'SAFE-12A' },
              { quantity: 10, unitPrice: '20.00', trackingNo: 'SAFE-12B' },
              { quantity: 5, unitPrice: '30.00', trackingNo: 'SAFE-12C' },
            ];
            let expectedQuantity = 0,
              expectedCost = 0;
            for (const [index, step] of steps.entries()) {
              const order = await createOrder([
                { productId: pump.id, quantity: step.quantity, unitPrice: step.unitPrice },
              ]);
              const pkg = await bind(order, step.trackingNo, [
                { purchaseOrderItemId: order.items[0].id, expectedQuantity: step.quantity },
              ]);
              const confirmed = await read(
                await receipt(
                  newBody(pkg.id, [
                    { purchaseOrderItemId: order.items[0].id, receivedQty: step.quantity },
                  ]),
                ),
                201,
              );
              assert.equal(
                confirmed.data.items[0].landedUnitCost,
                Number(step.unitPrice).toFixed(4),
              );
              expectedQuantity += step.quantity;
              expectedCost += step.quantity * Number(step.unitPrice);
              const balance = await stockOf(pump.id);
              assert.equal(balance.quantity_on_hand, expectedQuantity);
              assert.equal(money(balance.total_cost), money(expectedCost));
              // The weighted average is the derived number the UI would show.
              assert.equal(
                money(Number(balance.total_cost) / balance.quantity_on_hand),
                money(expectedCost / expectedQuantity),
              );
              assert.equal(
                money(expectedCost / expectedQuantity),
                ['10.0000', '15.0000', '18.0000'][index],
              );
              await assertLedger(a.tenant.id, '12-step-' + (index + 1));
            }
            assert.deepEqual(await stockOf(pump.id), {
              quantity_on_hand: 25,
              total_cost: '450.0000',
            });
          },
        );

        // ---------------------------------------------------------------- global
        await http.test('every receipt, balance and movement agrees at the end', async () => {
          await assertLedger(a.tenant.id, 'final-a');
          await assertLedger(b.tenant.id, 'final-b');

          const list = await read(await request('/receipts?pageSize=100'), 200);
          assert.ok(list.data.length >= 12);
          for (const row of list.data) await assertReceiptMatchesDb(row.id);

          const totals = await scalar(
            `SELECT (SELECT count(*)::int FROM receipts WHERE tenant_id=$1) AS receipts,
                    (SELECT count(*)::int FROM receipt_items WHERE tenant_id=$1) AS items,
                    (SELECT count(*)::int FROM stock_movements WHERE tenant_id=$1) AS movements,
                    (SELECT count(*)::int FROM audit_logs WHERE tenant_id=$1 AND action='RECEIPT_CONFIRMED') AS audits`,
            [a.tenant.id],
          );
          assert.equal(totals.receipts, totals.audits, 'one audit row per receipt');
          assert.ok(totals.movements >= totals.items);
          http.diagnostic(
            `tenant A ledger: ${totals.receipts} receipts, ${totals.items} lines, ` +
              `${totals.movements} movements, ${totals.audits} audits`,
          );
          assert.equal(/unhandled|bootstrap_failed/i.test(logs), false, 'API log: ' + logs);
        });
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
