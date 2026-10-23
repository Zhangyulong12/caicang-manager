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
  'outbound orders: drafts, shipping transactions, oversell protection and idempotency on PostgreSQL',
  { timeout: 300000 },
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
      trackingCounter = 0,
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

      await t.test('production API with real outbound tables', async (http) => {
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
              'X-Forwarded-For': `198.24.${Math.floor(++counter / 250)}.${(counter % 250) + 1}`,
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

        // ---- accounts and tenants -------------------------------------------------
        for (const actor of ['owner', 'admin', 'buyer', 'warehouse', 'viewer']) {
          const input = { email: actor + '@outbound.example.test', password: 'Outbound!2026' };
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
            await request('/tenants', { tenant: null, method: 'POST', body: { name: '出库 A' } }),
            201,
          )
        ).data;
        b = (
          await read(
            await request('/tenants', { tenant: null, method: 'POST', body: { name: '出库 B' } }),
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

        /** Real stock through the real receiving transaction, so cost pools are genuine. */
        async function receiveStock(productId, quantity, unitPrice, tenant = a) {
          const draft = (
            await read(
              await request('/purchase-orders', {
                tenant,
                method: 'POST',
                body: {
                  warehouseId: tenant.defaultWarehouse.id,
                  platform: 'TAOBAO',
                  purchaseDate: '2026-10-23',
                  recipient: { name: '出库测试', phone: '13800000000', address: '虚构仓库地址' },
                  items: [{ productId, quantity, unitPrice }],
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
          const pkg = (
            await read(
              await request('/purchase-orders/' + placed.id + '/packages', {
                tenant,
                method: 'POST',
                body: {
                  carrierCode: 'SF',
                  trackingNo: 'SF' + String(++trackingCounter).padStart(10, '0'),
                  expectedItems: [],
                },
              }),
              201,
            )
          ).data;
          return (
            await read(
              await request('/receipts', {
                tenant,
                method: 'POST',
                body: {
                  packageId: pkg.id,
                  clientOperationId: randomUUID(),
                  items: [{ purchaseOrderItemId: placed.items[0].id, receivedQty: quantity }],
                },
              }),
              201,
            )
          ).data;
        }

        const stockOf = async (productId, tenant = a) => {
          const row = await db.query(
            'SELECT quantity_on_hand, total_cost::text AS total_cost FROM stock_balances WHERE tenant_id=$1 AND product_id=$2',
            [tenant.tenant.id, productId],
          );
          return row.rows[0] ?? { quantity_on_hand: 0, total_cost: '0.0000' };
        };
        const counts = async () => {
          const row = await db.query(
            `SELECT (SELECT count(*)::int FROM outbound_orders WHERE tenant_id=$1) AS orders,
              (SELECT count(*)::int FROM outbound_order_items WHERE tenant_id=$1) AS items,
              (SELECT count(*)::int FROM stock_movements WHERE tenant_id=$1 AND source_type='OUTBOUND') AS movements,
              (SELECT count(*)::int FROM audit_logs WHERE tenant_id=$1 AND action='OUTBOUND_SHIPPED') AS shipped,
              (SELECT count(*)::int FROM audit_logs WHERE tenant_id=$1 AND action='OUTBOUND_CANCELLED') AS cancelled`,
            [a.tenant.id],
          );
          return row.rows[0];
        };

        const createDraft = (body, options = {}) =>
          request('/outbound-orders', { ...options, method: 'POST', body });
        const ship = (id, body, options = {}) =>
          request('/outbound-orders/' + id + '/ship', { ...options, method: 'POST', body });
        const patch = (id, body, options = {}) =>
          request('/outbound-orders/' + id, { ...options, method: 'PATCH', body });
        const cancel = (id, options = {}) =>
          request('/outbound-orders/' + id + '/cancel', { ...options, method: 'POST' });

        const charger = await makeProduct('20W 充电器', 'CHARGER-20W', '件');
        const cable = await makeProduct('1 米数据线', 'CABLE-1M', '条');
        const stand = await makeProduct('铝合金支架', 'STAND-AL', '个');

        // ---- 01 draft ------------------------------------------------------------
        await http.test('a draft records what to ship without touching stock', async () => {
          await receiveStock(charger.id, 10, '18.50');
          assert.deepEqual(await stockOf(charger.id), {
            quantity_on_hand: 10,
            total_cost: '185.0000',
          });

          const draft = (
            await read(
              await createDraft({
                warehouseId: a.defaultWarehouse.id,
                items: [{ productId: charger.id, quantity: 3 }],
                customerName: '张三',
                customerPhone: '13800000001',
                customerAddress: '上海市浦东新区虚构路 88 号',
                carrierCode: 'SF',
                remark: '到货请电联',
              }),
              201,
            )
          ).data;
          assert.match(draft.outboundNo, /^OUT-\d{8}-[0-9A-F]{10}$/);
          assert.equal(draft.status, 'DRAFT');
          assert.equal(draft.totalQuantity, 3);
          assert.equal(draft.totalCost, '0.0000');
          assert.equal(draft.shippedAt, null);
          assert.equal(draft.shippedBy, null);
          assert.equal(draft.confirmOperationId, null);
          assert.equal(draft.warehouseId, a.defaultWarehouse.id);
          assert.equal(draft.createdByName, accounts.owner.user.displayName);
          assert.equal(draft.items.length, 1);
          assert.equal(draft.items[0].sku, 'CHARGER-20W');
          assert.equal(draft.items[0].shippedUnitCost, null);
          assert.equal(draft.items[0].lineCost, null);
          assert.equal(draft.items[0].availableQuantity, 10);

          // A draft is a plan: creating it must not move a single unit.
          assert.deepEqual(await stockOf(charger.id), {
            quantity_on_hand: 10,
            total_cost: '185.0000',
          });
          assert.equal((await counts()).movements, 0);
          const audit = await db.query(
            `SELECT metadata FROM audit_logs WHERE tenant_id=$1 AND object_id=$2 AND action='OUTBOUND_DRAFT_CREATED'`,
            [a.tenant.id, draft.id],
          );
          assert.equal(audit.rows.length, 1);
          assert.equal(audit.rows[0].metadata.items[0].quantity, 3);

          for (const body of [
            { warehouseId: a.defaultWarehouse.id, items: [] },
            { warehouseId: a.defaultWarehouse.id, items: [{ productId: charger.id, quantity: 0 }] },
            {
              warehouseId: a.defaultWarehouse.id,
              items: [
                { productId: charger.id, quantity: 1 },
                { productId: charger.id, quantity: 2 },
              ],
            },
            // Cost and balances are server-derived; clients may not supply them.
            {
              warehouseId: a.defaultWarehouse.id,
              items: [{ productId: charger.id, quantity: 1 }],
              totalCost: '1.0000',
            },
            {
              warehouseId: a.defaultWarehouse.id,
              items: [{ productId: charger.id, quantity: 1 }],
              customerPhone: 'not-a-phone',
            },
          ])
            await read(await createDraft(body), 400, 'VALIDATION_ERROR');
          await read(
            await createDraft({
              warehouseId: a.defaultWarehouse.id,
              items: [{ productId: randomUUID(), quantity: 1 }],
            }),
            422,
            'BUSINESS_VALIDATION_FAILED',
          );
          await read(
            await createDraft({
              warehouseId: randomUUID(),
              items: [{ productId: charger.id, quantity: 1 }],
            }),
            404,
            'NOT_FOUND',
          );
        });

        // ---- 02 patch -----------------------------------------------------------
        await http.test(
          'PATCH replaces draft lines and recipient, never a shipped order',
          async () => {
            const draft = (
              await read(
                await createDraft({
                  warehouseId: a.defaultWarehouse.id,
                  items: [{ productId: charger.id, quantity: 2 }],
                  customerName: '李四',
                }),
                201,
              )
            ).data;
            const updated = (
              await read(
                await patch(draft.id, {
                  items: [{ productId: cable.id, quantity: 4 }],
                  customerName: '王五',
                  customerPhone: '021-88886666',
                  customerAddress: '北京市朝阳区虚构大厦 3 层',
                }),
                200,
              )
            ).data;
            assert.equal(updated.items.length, 1);
            assert.equal(updated.items[0].sku, 'CABLE-1M');
            assert.equal(updated.items[0].quantity, 4);
            assert.equal(updated.customerName, '王五');
            assert.equal(updated.outboundNo, draft.outboundNo, '单号在草稿阶段不变');
            const rows = await db.query(
              'SELECT product_id FROM outbound_order_items WHERE tenant_id=$1 AND outbound_order_id=$2',
              [a.tenant.id, draft.id],
            );
            assert.equal(rows.rows.length, 1, '旧明细被替换而不是叠加');
            assert.equal(rows.rows[0].product_id, cable.id);

            await read(await patch(draft.id, {}), 422, 'BUSINESS_VALIDATION_FAILED');
            await read(await patch(randomUUID(), { customerName: '无名' }), 404, 'NOT_FOUND');
            // Cancelling leaves the ledger alone, and the draft can no longer be edited.
            await read(await cancel(draft.id), 200);
            await read(await patch(draft.id, { customerName: '改名' }), 409, 'STATUS_CONFLICT');
          },
        );

        // ---- 03 acceptance path -------------------------------------------------
        const acceptance = {};
        await http.test(
          'acceptance: 10 on hand, ship 3, stock is 7 and one ledger line appears',
          async () => {
            const draft = (
              await read(
                await createDraft({
                  warehouseId: a.defaultWarehouse.id,
                  items: [{ productId: charger.id, quantity: 3 }],
                  customerName: '张三',
                  customerPhone: '13800000001',
                  customerAddress: '上海市浦东新区虚构路 88 号',
                  carrierCode: 'SF',
                  remark: '到货请电联',
                }),
                201,
              )
            ).data;
            acceptance.operationId = randomUUID();
            acceptance.body = {
              clientOperationId: acceptance.operationId,
              carrierCode: 'SF',
              trackingNo: '000000000123',
              remark: '已交给快递',
            };
            const shipped = await read(await ship(draft.id, acceptance.body), 201);
            acceptance.order = shipped.data;
            acceptance.id = draft.id;
            assert.equal(shipped.data.status, 'SHIPPED');
            assert.equal(shipped.data.confirmOperationId, acceptance.operationId);
            assert.equal(shipped.data.totalQuantity, 3);
            assert.equal(shipped.data.totalCost, '55.5000', '3 × 18.5000');
            assert.equal(shipped.data.items[0].shippedUnitCost, '18.5000');
            assert.equal(shipped.data.items[0].lineCost, '55.5000');
            assert.equal(shipped.data.items[0].availableQuantity, 7);
            assert.ok(shipped.data.shippedAt);
            assert.equal(shipped.data.trackingNo, '000000000123');

            assert.deepEqual(await stockOf(charger.id), {
              quantity_on_hand: 7,
              total_cost: '129.5000',
            });
            const movement = await db.query(
              `SELECT m.quantity_delta, m.quantity_before, m.quantity_after,
                m.cost_delta::text AS cost_delta, m.total_cost_before::text AS before_cost,
                m.total_cost_after::text AS after_cost, m.source_type, m.source_item_id
               FROM stock_movements m WHERE m.tenant_id=$1 AND m.product_id=$2`,
              [a.tenant.id, charger.id],
            );
            assert.equal(movement.rows.length, 2, '入库 + 出库各一条');
            const out = movement.rows.find((row) => row.source_type === 'OUTBOUND');
            assert.equal(out.quantity_delta, -3);
            assert.equal(out.quantity_before, 10);
            assert.equal(out.quantity_after, 7);
            assert.equal(out.cost_delta, '-55.5000');
            assert.equal(out.before_cost, '185.0000');
            assert.equal(out.after_cost, '129.5000');
            assert.equal(out.source_item_id, shipped.data.items[0].id);

            const audit = await db.query(
              `SELECT actor_id, metadata FROM audit_logs WHERE tenant_id=$1 AND object_id=$2 AND action='OUTBOUND_SHIPPED'`,
              [a.tenant.id, draft.id],
            );
            assert.equal(audit.rows.length, 1);
            assert.equal(audit.rows[0].actor_id, accounts.owner.user.id);
            assert.equal(audit.rows[0].metadata.totalCost, '55.5000');
            assert.equal(audit.rows[0].metadata.items[0].unitCost, '18.5000');
          },
        );

        // ---- 04 oversell ---------------------------------------------------------
        await http.test(
          'acceptance: shipping 8 with only 7 on hand is rejected and stock stays 7',
          async () => {
            const before = await counts();
            const draft = (
              await read(
                await createDraft({
                  warehouseId: a.defaultWarehouse.id,
                  items: [{ productId: charger.id, quantity: 8 }],
                  customerName: '赵六',
                  customerPhone: '13900000002',
                  customerAddress: '广州市天河区虚构街 1 号',
                }),
                201,
              )
            ).data;
            assert.equal(draft.items[0].availableQuantity, 7, '草稿就告诉页面只剩 7 件');
            const failure = await read(
              await ship(draft.id, { clientOperationId: randomUUID() }),
              409,
              'OUT_OF_STOCK',
            );
            assert.equal(failure.error.details.warehouseId, a.defaultWarehouse.id);
            assert.deepEqual(failure.error.details.shortages, [
              {
                productId: charger.id,
                sku: 'CHARGER-20W',
                requestedQuantity: 8,
                availableQuantity: 7,
              },
            ]);
            assert.deepEqual(await stockOf(charger.id), {
              quantity_on_hand: 7,
              total_cost: '129.5000',
            });
            const after = await counts();
            assert.equal(after.movements, before.movements);
            assert.equal(after.shipped, before.shipped);
            const still = (await read(await request('/outbound-orders/' + draft.id), 200)).data;
            assert.equal(still.status, 'DRAFT', '失败的发货不能把单据留在半途');
            acceptance.shortId = draft.id;
          },
        );

        // ---- 05 idempotency ------------------------------------------------------
        await http.test('the same operation id never deducts twice', async () => {
          const replay = await read(await ship(acceptance.id, acceptance.body), 200);
          assert.equal(replay.data.status, 'SHIPPED');
          assert.equal(replay.data.totalCost, '55.5000');
          assert.deepEqual(await stockOf(charger.id), {
            quantity_on_hand: 7,
            total_cost: '129.5000',
          });
          const movements = await db.query(
            `SELECT count(*)::int AS t FROM stock_movements WHERE tenant_id=$1 AND product_id=$2 AND source_type='OUTBOUND'`,
            [a.tenant.id, charger.id],
          );
          assert.equal(movements.rows[0].t, 1, '一条出库流水，重复确认没有再加一条');
          const audits = await db.query(
            `SELECT count(*)::int AS t FROM audit_logs WHERE tenant_id=$1 AND object_id=$2 AND action='OUTBOUND_SHIPPED'`,
            [a.tenant.id, acceptance.id],
          );
          assert.equal(audits.rows[0].t, 1);

          await read(
            await ship(acceptance.id, { ...acceptance.body, trackingNo: '000000000999' }),
            409,
            'IDEMPOTENCY_CONFLICT',
          );
          const second = await read(
            await ship(acceptance.id, { clientOperationId: randomUUID() }),
            409,
            'STATUS_CONFLICT',
          );
          assert.equal(second.error.details.status, 'SHIPPED');
          await read(
            await request('/outbound-orders/' + acceptance.id, {
              method: 'PATCH',
              body: { customerName: '改个名' },
            }),
            409,
            'STATUS_CONFLICT',
          );
          await read(await cancel(acceptance.id), 409, 'STATUS_CONFLICT');
          // 操作号不能挪用到另一张单上，否则会拿着 A 单的结果冒充 B 单。
          await read(
            await ship(acceptance.shortId, { ...acceptance.body }),
            409,
            'IDEMPOTENCY_CONFLICT',
          );
          assert.deepEqual(await stockOf(charger.id), {
            quantity_on_hand: 7,
            total_cost: '129.5000',
          });
        });

        // ---- 06 concurrency ------------------------------------------------------
        await http.test('two concurrent shipments cannot both take the last units', async () => {
          await receiveStock(cable.id, 10, '9.00');
          const makeOrder = async () =>
            (
              await read(
                await createDraft({
                  warehouseId: a.defaultWarehouse.id,
                  items: [{ productId: cable.id, quantity: 6 }],
                  customerName: '并发客户',
                  customerPhone: '13700000003',
                  customerAddress: '深圳市南山区虚构大道 9 号',
                }),
                201,
              )
            ).data;
          const left = await makeOrder(),
            right = await makeOrder();
          const [one, two] = await Promise.all([
            ship(left.id, { clientOperationId: randomUUID() }),
            ship(right.id, { clientOperationId: randomUUID() }),
          ]);
          assert.deepEqual([one.status, two.status].sort(), [201, 409]);
          const failed = one.status === 409 ? one : two;
          const payload = await failed.json();
          assert.equal(payload.error.code, 'OUT_OF_STOCK');
          assert.equal(payload.error.details.shortages[0].availableQuantity, 4);
          const stock = await stockOf(cable.id);
          assert.equal(stock.quantity_on_hand, 4, '不会出现负库存');
          const rows = await db.query(
            `SELECT count(*)::int AS t FROM stock_movements WHERE tenant_id=$1 AND product_id=$2 AND source_type='OUTBOUND'`,
            [a.tenant.id, cable.id],
          );
          assert.equal(rows.rows[0].t, 1);
          const negative = await db.query(
            'SELECT count(*)::int AS t FROM stock_balances WHERE tenant_id=$1 AND quantity_on_hand < 0',
            [a.tenant.id],
          );
          assert.equal(negative.rows[0].t, 0);
        });

        await http.test('two concurrent retries of one shipment deduct once', async () => {
          await receiveStock(stand.id, 10, '12.00');
          const draft = (
            await read(
              await createDraft({
                warehouseId: a.defaultWarehouse.id,
                items: [{ productId: stand.id, quantity: 4 }],
                customerName: '重试客户',
                customerPhone: '13600000004',
                customerAddress: '杭州市西湖区虚构路 6 号',
              }),
              201,
            )
          ).data;
          const body = { clientOperationId: randomUUID() };
          const [one, two] = await Promise.all([ship(draft.id, body), ship(draft.id, body)]);
          assert.deepEqual([one.status, two.status].sort(), [200, 201]);
          assert.equal((await stockOf(stand.id)).quantity_on_hand, 6);
          const rows = await db.query(
            `SELECT count(*)::int AS t, min(quantity_before) AS before_qty, max(quantity_after) AS after_qty
             FROM stock_movements WHERE tenant_id=$1 AND product_id=$2 AND source_type='OUTBOUND'`,
            [a.tenant.id, stand.id],
          );
          assert.equal(rows.rows[0].t, 1);
          assert.equal(rows.rows[0].before_qty, 10);
          assert.equal(rows.rows[0].after_qty, 6);
        });

        // ---- 07 moving average snapshot -----------------------------------------
        await http.test(
          'shipping takes a moving average cost snapshot and clears the pool',
          async () => {
            // 4 @ 10.00 + 6 @ 20.00 = 10 units, 160.0000 pool → average 16.0000.
            const hub = await makeProduct('七合一扩展坞', 'HUB-7IN1', '台');
            await receiveStock(hub.id, 4, '10.00');
            await receiveStock(hub.id, 6, '20.00');
            assert.deepEqual(await stockOf(hub.id), {
              quantity_on_hand: 10,
              total_cost: '160.0000',
            });
            const draft = (
              await read(
                await createDraft({
                  warehouseId: a.defaultWarehouse.id,
                  items: [{ productId: hub.id, quantity: 3 }],
                  customerName: '均价客户',
                  customerPhone: '13500000008',
                  customerAddress: '苏州市工业园区虚构路 8 号',
                }),
                201,
              )
            ).data;
            const partial = await read(
              await ship(draft.id, { clientOperationId: randomUUID() }),
              201,
            );
            assert.equal(partial.data.items[0].shippedUnitCost, '16.0000', '移动加权平均快照');
            assert.equal(partial.data.items[0].lineCost, '48.0000');
            assert.equal(partial.data.totalCost, '48.0000');
            assert.deepEqual(await stockOf(hub.id), {
              quantity_on_hand: 7,
              total_cost: '112.0000',
            });
            const snapshot = await db.query(
              'SELECT shipped_unit_cost::text AS cost FROM outbound_order_items WHERE tenant_id=$1 AND outbound_order_id=$2',
              [a.tenant.id, draft.id],
            );
            assert.equal(snapshot.rows[0].cost, '16.0000', '快照落在明细行上，不随库存价再变');

            // Shipping the rest must zero the cost pool, not leave a rounding residue.
            const rest = (
              await read(
                await createDraft({
                  warehouseId: a.defaultWarehouse.id,
                  items: [{ productId: hub.id, quantity: 7 }],
                  customerName: '清库客户',
                  customerPhone: '13500000009',
                  customerAddress: '苏州市工业园区虚构路 9 号',
                }),
                201,
              )
            ).data;
            const all = await read(await ship(rest.id, { clientOperationId: randomUUID() }), 201);
            assert.equal(all.data.totalCost, '112.0000');
            assert.deepEqual(await stockOf(hub.id), {
              quantity_on_hand: 0,
              total_cost: '0.0000',
            });
          },
        );

        // ---- 08 cancel -----------------------------------------------------------
        await http.test(
          'cancelling a draft never touches stock and cannot be repeated as a success',
          async () => {
            const before = await counts();
            const draft = (
              await read(
                await createDraft({
                  warehouseId: a.defaultWarehouse.id,
                  items: [{ productId: charger.id, quantity: 5 }],
                  customerName: '取消客户',
                  customerPhone: '13500000005',
                  customerAddress: '成都市高新区虚构街 2 号',
                }),
                201,
              )
            ).data;
            const cancelled = await read(await cancel(draft.id), 200);
            assert.equal(cancelled.data.cancelled, true);
            assert.equal(cancelled.data.order.status, 'CANCELLED');
            assert.deepEqual(await stockOf(charger.id), {
              quantity_on_hand: 7,
              total_cost: '129.5000',
            });
            assert.equal((await counts()).movements, before.movements);
            const again = await read(await cancel(draft.id), 200);
            assert.equal(again.data.cancelled, false);
            assert.equal(again.data.order.status, 'CANCELLED');
            const audits = await db.query(
              `SELECT count(*)::int AS t FROM audit_logs WHERE tenant_id=$1 AND object_id=$2 AND action='OUTBOUND_CANCELLED'`,
              [a.tenant.id, draft.id],
            );
            assert.equal(audits.rows[0].t, 1, '重复取消不再写第二条审计');
            await read(
              await ship(draft.id, { clientOperationId: randomUUID() }),
              409,
              'STATUS_CONFLICT',
            );
            assert.equal((await stockOf(charger.id)).quantity_on_hand, 7);
          },
        );

        // ---- 09 roles ------------------------------------------------------------
        await http.test('only warehouse-capable roles may create, ship or cancel', async () => {
          const body = {
            warehouseId: a.defaultWarehouse.id,
            items: [{ productId: charger.id, quantity: 1 }],
            customerName: '权限客户',
            customerPhone: '13400000006',
            customerAddress: '南京市鼓楼区虚构路 5 号',
          };
          for (const actor of ['buyer', 'viewer'])
            await read(await createDraft(body, { actor }), 403, 'FORBIDDEN');
          const draft = (await read(await createDraft(body, { actor: 'warehouse' }), 201)).data;
          for (const actor of ['buyer', 'viewer'])
            await read(
              await ship(draft.id, { clientOperationId: randomUUID() }, { actor }),
              403,
              'FORBIDDEN',
            );
          // The read side stays open to every role, including VIEWER.
          const viewerList = await read(
            await request('/outbound-orders', { actor: 'viewer' }),
            200,
          );
          assert.ok(viewerList.pagination.total >= 1);
          const viewerDetail = await read(
            await request('/outbound-orders/' + acceptance.id, { actor: 'viewer' }),
            200,
          );
          assert.equal(viewerDetail.data.remark, null, 'VIEWER 看不到备注');
          for (const actor of ['buyer', 'viewer'])
            await read(await cancel(draft.id, { actor }), 403, 'FORBIDDEN');
          const shipped = await read(
            await ship(draft.id, { clientOperationId: randomUUID() }, { actor: 'admin' }),
            201,
          );
          assert.equal(shipped.data.shippedByName, accounts.admin.user.displayName);
          await read(await request('/outbound-orders', { actor: null }), 401, 'UNAUTHENTICATED');
          await read(
            await request('/outbound-orders/' + draft.id, { tenant: b }),
            404,
            'NOT_FOUND',
          );
          await read(
            await ship(draft.id, { clientOperationId: randomUUID() }, { tenant: b }),
            404,
            'NOT_FOUND',
          );
        });

        // ---- 10 rollback ---------------------------------------------------------
        await http.test(
          'a failure while writing the audit rolls the whole shipment back',
          async () => {
            const before = await counts();
            const stockBefore = await stockOf(stand.id);
            const draft = (
              await read(
                await createDraft({
                  warehouseId: a.defaultWarehouse.id,
                  items: [{ productId: stand.id, quantity: 2 }],
                  customerName: '回滚客户',
                  customerPhone: '13300000007',
                  customerAddress: '武汉市江汉区虚构路 7 号',
                }),
                201,
              )
            ).data;
            const body = { clientOperationId: randomUUID() };
            await db.query(`
            CREATE FUNCTION _test_reject_outbound_audit() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
              IF NEW.action = 'OUTBOUND_SHIPPED' THEN
                RAISE EXCEPTION 'injected failure while writing the audit log';
              END IF;
              RETURN NEW;
            END $$`);
            await db.query(
              `CREATE TRIGGER tr_test_reject_outbound_audit BEFORE INSERT ON audit_logs
             FOR EACH ROW EXECUTE FUNCTION _test_reject_outbound_audit()`,
            );
            try {
              const failed = await ship(draft.id, body);
              assert.equal(failed.status, 500);
            } finally {
              await db.query('DROP TRIGGER tr_test_reject_outbound_audit ON audit_logs');
              await db.query('DROP FUNCTION _test_reject_outbound_audit()');
            }
            assert.deepEqual(await stockOf(stand.id), stockBefore, '库存扣减已回滚');
            const after = await counts();
            assert.equal(after.movements, before.movements, '流水已回滚');
            assert.equal(after.shipped, before.shipped, '审计已回滚');
            const still = (await read(await request('/outbound-orders/' + draft.id), 200)).data;
            assert.equal(still.status, 'DRAFT');
            assert.equal(still.shippedAt, null);
            assert.equal(still.items[0].shippedUnitCost, null);
            // Nothing half-written is left behind: the same operation id works on retry.
            const retried = await read(await ship(draft.id, body), 201);
            assert.equal(retried.data.status, 'SHIPPED');
            assert.equal(retried.data.totalCost, '24.0000', '2 × 12.0000');
            assert.equal((await stockOf(stand.id)).quantity_on_hand, 4);
          },
        );

        // ---- 11 ledger and inventory views --------------------------------------
        await http.test('the outbound ledger is visible through the inventory API', async () => {
          const movements = await read(
            await request('/inventory/movements?page=1&pageSize=100&type=OUTBOUND'),
            200,
          );
          assert.ok(movements.pagination.total >= 3);
          const chargerRow = movements.data.find(
            (row) => row.productId === charger.id && row.quantityDelta === -3,
          );
          assert.ok(chargerRow, '能找到刚才那笔 -3');
          assert.equal(chargerRow.sourceNo, acceptance.order.outboundNo);
          assert.equal(chargerRow.sourceDocumentId, acceptance.id, '来源单据头可跳出库单');
          assert.equal(chargerRow.unitCost, '18.5000');
          assert.equal(chargerRow.quantityAfter, 7);
          assert.equal(chargerRow.direction, 'OUT');

          const balances = await read(
            await request('/inventory/balances?page=1&pageSize=100&sku=CHARGER-20W'),
            200,
          );
          // 权限用例里 ADMIN 又发了 1 件，所以这里是 7 - 1 = 6。
          assert.equal(balances.data[0].quantityOnHand, 6);
          assert.equal(balances.data[0].averageCost, '18.5000');
          assert.equal(balances.data[0].totalCost, '111.0000');

          const broken = await db.query(
            `SELECT count(*)::int AS t FROM stock_balances b
             WHERE b.tenant_id=$1 AND b.quantity_on_hand <> (
               SELECT COALESCE(SUM(m.quantity_delta),0) FROM stock_movements m
               WHERE m.tenant_id=b.tenant_id AND m.warehouse_id=b.warehouse_id AND m.product_id=b.product_id)`,
            [a.tenant.id],
          );
          assert.equal(broken.rows[0].t, 0, '余额等于流水合计');
          const costBroken = await db.query(
            `SELECT count(*)::int AS t FROM stock_balances b
             WHERE b.tenant_id=$1 AND b.total_cost <> (
               SELECT COALESCE(SUM(m.cost_delta),0) FROM stock_movements m
               WHERE m.tenant_id=b.tenant_id AND m.warehouse_id=b.warehouse_id AND m.product_id=b.product_id)`,
            [a.tenant.id],
          );
          assert.equal(costBroken.rows[0].t, 0, '成本池等于成本变动合计');
          const chain = await db.query(
            `SELECT count(*)::int AS t FROM stock_movements WHERE tenant_id=$1 AND quantity_before + quantity_delta <> quantity_after`,
            [a.tenant.id],
          );
          assert.equal(chain.rows[0].t, 0);
        });

        // ---- 12 list -------------------------------------------------------------
        await http.test('list filters by status, warehouse, product, date and text', async () => {
          const all = await read(await request('/outbound-orders?page=1&pageSize=100'), 200);
          const total = await db.query(
            'SELECT count(*)::int AS t FROM outbound_orders WHERE tenant_id=$1',
            [a.tenant.id],
          );
          assert.equal(all.pagination.total, total.rows[0].t);
          for (const row of all.data) assert.equal(row.tenantId, a.tenant.id);
          assert.equal(all.data[0].createdAt >= all.data.at(-1).createdAt, true);

          const shipped = await read(
            await request('/outbound-orders?page=1&pageSize=100&status=SHIPPED'),
            200,
          );
          assert.ok(shipped.data.every((row) => row.status === 'SHIPPED'));
          const cancelled = await read(
            await request('/outbound-orders?page=1&pageSize=100&status=CANCELLED'),
            200,
          );
          assert.ok(cancelled.data.every((row) => row.status === 'CANCELLED'));
          assert.ok(cancelled.pagination.total >= 1);

          const byProduct = await read(
            await request('/outbound-orders?page=1&pageSize=100&productId=' + cable.id),
            200,
          );
          assert.ok(
            byProduct.data.every((row) => row.items.some((item) => item.productId === cable.id)),
          );

          const byWarehouse = await read(
            await request(
              '/outbound-orders?page=1&pageSize=100&warehouseId=' + a.defaultWarehouse.id,
            ),
            200,
          );
          assert.equal(byWarehouse.pagination.total, all.pagination.total);

          const byNumber = await read(
            await request(
              '/outbound-orders?page=1&pageSize=10&search=' + acceptance.order.outboundNo,
            ),
            200,
          );
          assert.equal(byNumber.pagination.total, 1);
          assert.equal(byNumber.data[0].id, acceptance.id);

          const byTracking = await read(
            await request('/outbound-orders?page=1&pageSize=10&search=000000000123'),
            200,
          );
          assert.equal(byTracking.pagination.total, 1);

          const today = new Date().toISOString().slice(0, 10);
          const dated = await read(
            await request(`/outbound-orders?page=1&pageSize=100&from=${today}&to=${today}`),
            200,
          );
          assert.equal(dated.pagination.total, all.pagination.total);
          const future = await read(
            await request('/outbound-orders?page=1&pageSize=100&from=2099-01-01'),
            200,
          );
          assert.equal(future.pagination.total, 0);
          await read(
            await request('/outbound-orders?page=1&pageSize=10&from=2026-10-23&to=2026-10-01'),
            422,
            'BUSINESS_VALIDATION_FAILED',
          );
          await read(
            await request('/outbound-orders?page=1&pageSize=10&status=NOPE'),
            400,
            'VALIDATION_ERROR',
          );

          const foreign = await read(await request('/outbound-orders', { tenant: b }), 200);
          assert.equal(foreign.pagination.total, 0);
          assert.deepEqual(foreign.data, []);
        });

        // ---- 13 openapi ----------------------------------------------------------
        await http.test('openapi documents the outbound endpoints only', async () => {
          const doc = await (await fetch(base + '/api/docs-json')).json();
          for (const path of [
            '/api/v1/outbound-orders',
            '/api/v1/outbound-orders/{id}',
            '/api/v1/outbound-orders/{id}/ship',
            '/api/v1/outbound-orders/{id}/cancel',
          ])
            assert.ok(doc.paths[path], '缺少 ' + path);
          assert.deepEqual(Object.keys(doc.paths['/api/v1/outbound-orders']).sort(), [
            'get',
            'post',
          ]);
          assert.deepEqual(Object.keys(doc.paths['/api/v1/outbound-orders/{id}']).sort(), [
            'get',
            'patch',
          ]);
          assert.deepEqual(Object.keys(doc.paths['/api/v1/outbound-orders/{id}/ship']), ['post']);
          assert.deepEqual(Object.keys(doc.paths['/api/v1/outbound-orders/{id}/cancel']), ['post']);

          const createBody =
            doc.paths['/api/v1/outbound-orders'].post.requestBody.content['application/json']
              .schema;
          const reference = createBody.$ref ?? createBody.allOf?.at(-1)?.$ref;
          const model = doc.components.schemas[reference.split('/').at(-1)];
          assert.deepEqual(Object.keys(model.properties).sort(), [
            'carrierCode',
            'customerAddress',
            'customerName',
            'customerPhone',
            'items',
            'remark',
            'trackingNo',
            'warehouseId',
          ]);
          const shipBody =
            doc.paths['/api/v1/outbound-orders/{id}/ship'].post.requestBody.content[
              'application/json'
            ].schema;
          const shipRef = shipBody.$ref ?? shipBody.allOf?.at(-1)?.$ref;
          assert.deepEqual(
            Object.keys(doc.components.schemas[shipRef.split('/').at(-1)].properties).sort(),
            ['carrierCode', 'clientOperationId', 'remark', 'trackingNo'],
          );
          // No direct stock editing surface may exist.
          assert.equal(doc.paths['/api/v1/stock-balances'], undefined);
          assert.equal(doc.paths['/api/v1/stock-movements'], undefined);
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
