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
  'stock adjustments: stocktake 10→8, idempotency, cost rules, oversell guard and tenant isolation',
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

      await t.test('production API with real adjustment tables', async (http) => {
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
              'X-Forwarded-For': `198.25.${Math.floor(++counter / 250)}.${(counter % 250) + 1}`,
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
          const input = {
            email: actor + '@adjustments.example.test',
            password: 'Adjustments!2026',
          };
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
            await request('/tenants', { tenant: null, method: 'POST', body: { name: '调整 A' } }),
            201,
          )
        ).data;
        b = (
          await read(
            await request('/tenants', { tenant: null, method: 'POST', body: { name: '调整 B' } }),
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

        const makeProduct = async (sku, extra = {}, tenant = a) =>
          (
            await read(
              await request('/products', {
                tenant,
                method: 'POST',
                body: { name: sku + ' 商品', sku, unit: '件', ...extra },
              }),
              201,
            )
          ).data;

        /** Real receiving transaction so the cost pool under test is genuine. */
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
                  recipient: { name: '调整测试', phone: '13800000000', address: '虚构仓库地址' },
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

        /** 直接读余额表：验收要求"余额为 8"，不能只看接口回显。 */
        const balanceOf = async (productId, tenant = a) => {
          const row = await db.query(
            `SELECT quantity_on_hand, total_cost::text AS total_cost FROM stock_balances
             WHERE tenant_id=$1 AND warehouse_id=$2 AND product_id=$3`,
            [tenant.tenant.id, tenant.defaultWarehouse.id, productId],
          );
          return row.rows[0] ?? { quantity_on_hand: 0, total_cost: '0.0000' };
        };
        const adjustmentFacts = async (productId, tenant = a) => {
          const row = await db.query(
            `SELECT
               (SELECT count(*)::int FROM stock_adjustments WHERE tenant_id=$1 AND product_id=$2) AS adjustments,
               (SELECT count(*)::int FROM stock_movements
                  WHERE tenant_id=$1 AND product_id=$2 AND source_type='ADJUSTMENT') AS movements`,
            [tenant.tenant.id, productId],
          );
          return row.rows[0];
        };
        const adjust = (body, options = {}) =>
          request('/inventory/adjustments', { ...options, method: 'POST', body });

        const charger = await makeProduct('ADJ-CHARGER', { referencePurchasePrice: '99.00' });
        const cable = await makeProduct('ADJ-CABLE');
        const mug = await makeProduct('ADJ-MUG');
        const stand = await makeProduct('ADJ-STAND', { referencePurchasePrice: '25.00' });
        const ghost = await makeProduct('ADJ-GHOST');

        // 验收主场景的入参与返回留在这里，后面的幂等用例必须原样重放。
        let lossBody, lossAdjustment;

        // ---- 01 acceptance: 10 → 8 -------------------------------------------------
        await http.test(
          'a stocktake loss of 2 turns 10 on hand into 8, with a -2 movement',
          async () => {
            await receiveStock(charger.id, 10, '18.50');
            assert.deepEqual(await balanceOf(charger.id), {
              quantity_on_hand: 10,
              total_cost: '185.0000',
            });

            lossBody = {
              warehouseId: a.defaultWarehouse.id,
              productId: charger.id,
              quantityDelta: -2,
              reason: 'STOCKTAKE_LOSS',
              remark: '月末盘点少 2 件',
              clientOperationId: randomUUID(),
            };
            const adjustment = (await read(await adjust(lossBody), 201)).data;
            lossAdjustment = adjustment;
            assert.match(adjustment.adjustmentNo, /^ADJ-\d{8}-[0-9A-F]{12}$/);
            assert.equal(adjustment.quantityDelta, -2);
            assert.equal(adjustment.quantityBefore, 10);
            assert.equal(adjustment.quantityAfter, 8);
            assert.equal(adjustment.reason, 'STOCKTAKE_LOSS');
            assert.equal(adjustment.reasonLabel, '盘点盘亏');
            assert.equal(adjustment.remark, '月末盘点少 2 件');
            assert.equal(adjustment.warehouseId, a.defaultWarehouse.id);
            assert.equal(adjustment.sku, 'ADJ-CHARGER');
            assert.equal(adjustment.unit, '件');
            assert.equal(adjustment.unitCost, '18.5000');
            assert.equal(adjustment.costDelta, '-37.0000');
            assert.equal(adjustment.totalCostBefore, '185.0000');
            assert.equal(adjustment.totalCostAfter, '148.0000');
            assert.equal(adjustment.costSource, 'AVERAGE');
            assert.equal(adjustment.createdBy, accounts.owner.user.id);
            assert.equal(adjustment.createdByName, accounts.owner.user.displayName);
            assert.equal(adjustment.clientOperationId, lossBody.clientOperationId);

            // 余额与流水必须同时正确：余额 8，流水 -2，成本池按均价减少 37。
            assert.deepEqual(await balanceOf(charger.id), {
              quantity_on_hand: 8,
              total_cost: '148.0000',
            });
            const movement = await db.query(
              `SELECT quantity_delta, quantity_before, quantity_after, cost_delta::text AS cost_delta,
                    total_cost_before::text AS total_cost_before, total_cost_after::text AS total_cost_after
             FROM stock_movements WHERE tenant_id=$1 AND source_type='ADJUSTMENT' AND source_item_id=$2`,
              [a.tenant.id, adjustment.id],
            );
            assert.equal(movement.rows.length, 1);
            assert.deepEqual(movement.rows[0], {
              quantity_delta: -2,
              quantity_before: 10,
              quantity_after: 8,
              cost_delta: '-37.0000',
              total_cost_before: '185.0000',
              total_cost_after: '148.0000',
            });

            // 审计留痕：结构化事实齐全，备注不落库（可能含敏感信息）。
            const audit = await db.query(
              `SELECT action, object_type, metadata FROM audit_logs WHERE tenant_id=$1 AND object_id=$2`,
              [a.tenant.id, adjustment.id],
            );
            assert.equal(audit.rows.length, 1);
            assert.equal(audit.rows[0].action, 'STOCK_ADJUSTED');
            assert.equal(audit.rows[0].object_type, 'stock_adjustment');
            assert.equal(audit.rows[0].metadata.quantityBefore, 10);
            assert.equal(audit.rows[0].metadata.quantityAfter, 8);
            assert.equal(audit.rows[0].metadata.reason, 'STOCKTAKE_LOSS');
            assert.equal(audit.rows[0].metadata.costSource, 'AVERAGE');
            assert.equal(audit.rows[0].metadata.adjustmentNo, adjustment.adjustmentNo);
            assert.equal(Object.hasOwn(audit.rows[0].metadata, 'remark'), false);

            // 库存流水列表把调整单号与原因带上，后续页面不用再查一次。
            const listed = (
              await read(
                await request('/inventory/movements?productId=' + charger.id + '&type=ADJUSTMENT'),
                200,
              )
            ).data;
            assert.equal(listed.length, 1);
            assert.equal(listed[0].sourceNo, adjustment.adjustmentNo);
            assert.equal(listed[0].sourceDocumentId, adjustment.id);
            assert.equal(listed[0].note, '月末盘点少 2 件');
            assert.equal(listed[0].quantityDelta, -2);
          },
        );

        // ---- 02 idempotency --------------------------------------------------------
        await http.test(
          'the same clientOperationId never adjusts twice, and a changed payload is a conflict',
          async () => {
            const replay = await adjust(lossBody);
            assert.equal(replay.status, 200, '重放返回 200 而不是再次创建');
            const replayed = (await replay.json()).data;
            assert.equal(replayed.id, lossAdjustment.id, '重放必须返回同一张调整单');
            assert.deepEqual(await balanceOf(charger.id), {
              quantity_on_hand: 8,
              total_cost: '148.0000',
            });
            assert.equal((await adjustmentFacts(charger.id)).movements, 1);
            assert.equal((await adjustmentFacts(charger.id)).adjustments, 1);

            // 同一操作号换数量：两笔不同的调整，必须 409。
            await read(
              await adjust({ ...lossBody, quantityDelta: -3 }),
              409,
              'IDEMPOTENCY_CONFLICT',
            );
            // 同一操作号换备注同样算内容不一致。
            await read(
              await adjust({ ...lossBody, remark: '换个说法' }),
              409,
              'IDEMPOTENCY_CONFLICT',
            );
            assert.deepEqual(await balanceOf(charger.id), {
              quantity_on_hand: 8,
              total_cost: '148.0000',
            });

            // 并发重复提交：一个 201、一个 200，库存只减一次。
            await receiveStock(cable.id, 5, '4.00');
            const body = {
              warehouseId: a.defaultWarehouse.id,
              productId: cable.id,
              quantityDelta: -1,
              reason: 'DAMAGED',
              clientOperationId: randomUUID(),
            };
            const [first, second] = await Promise.all([adjust(body), adjust(body)]);
            const statuses = [first.status, second.status].sort();
            assert.deepEqual(statuses, [200, 201]);
            const firstPayload = await first.json(),
              secondPayload = await second.json();
            assert.equal(firstPayload.data.id, secondPayload.data.id);
            assert.deepEqual(await balanceOf(cable.id), {
              quantity_on_hand: 4,
              total_cost: '16.0000',
            });
            assert.equal((await adjustmentFacts(cable.id)).movements, 1);
          },
        );

        // ---- 03 validation & direction ---------------------------------------------
        await http.test(
          'zero, unknown reasons, direction mismatches and client-supplied balances are rejected',
          async () => {
            const valid = {
              warehouseId: a.defaultWarehouse.id,
              productId: charger.id,
              quantityDelta: 1,
              reason: 'STOCKTAKE_GAIN',
              clientOperationId: randomUUID(),
            };
            for (const body of [
              { ...valid, quantityDelta: 0 },
              { ...valid, reason: 'BROKEN' },
              { ...valid, clientOperationId: 'not-a-uuid' },
              { ...valid, warehouseId: 'not-a-uuid' },
              { ...valid, productId: undefined },
              // 客户端不许直接给余额/成本/单号，全局白名单会把它们判为非法字段。
              { ...valid, quantityOnHand: 8 },
              { ...valid, totalCost: '0.0000' },
              { ...valid, unitCost: '1.0000' },
              { ...valid, adjustmentNo: 'ADJ-20260101-AAAAAAAAAAAA' },
              { ...valid, reason: 'OTHER' },
              { ...valid, reason: 'OTHER', remark: '   ' },
              { ...valid, reason: 'OTHER', remark: 'x'.repeat(501) },
              { ...valid, remark: 'a\u0000b' },
            ])
              await read(await adjust(body), 400, 'VALIDATION_ERROR');
            assert.deepEqual(await balanceOf(charger.id), {
              quantity_on_hand: 8,
              total_cost: '148.0000',
            });

            // 方向规则：盘盈只能加，盘亏/损坏/丢失只能减，其他原因两个方向都行。
            await read(
              await adjust({ ...valid, reason: 'STOCKTAKE_GAIN', quantityDelta: -1 }),
              422,
              'ADJUSTMENT_REASON_MISMATCH',
            );
            for (const reason of ['STOCKTAKE_LOSS', 'DAMAGED', 'LOST'])
              await read(
                await adjust({ ...valid, reason, quantityDelta: 1 }),
                422,
                'ADJUSTMENT_REASON_MISMATCH',
              );
            assert.equal((await adjustmentFacts(charger.id)).adjustments, 1);
          },
        );

        // ---- 04 oversell -----------------------------------------------------------
        await http.test(
          'an adjustment below zero fails and leaves every table untouched',
          async () => {
            const body = {
              warehouseId: a.defaultWarehouse.id,
              productId: cable.id,
              quantityDelta: -6,
              reason: 'STOCKTAKE_LOSS',
              clientOperationId: randomUUID(),
            };
            const payload = await read(await adjust(body), 409, 'OUT_OF_STOCK');
            assert.equal(payload.error.details.available, 4);
            assert.equal(payload.error.details.requested, 6);
            assert.equal(payload.error.details.sku, 'ADJ-CABLE');
            assert.deepEqual(await balanceOf(cable.id), {
              quantity_on_hand: 4,
              total_cost: '16.0000',
            });
            assert.equal((await adjustmentFacts(cable.id)).adjustments, 1);
            assert.equal((await adjustmentFacts(cable.id)).movements, 1);
            // 失败的操作号没有留下行，修正数量后可以复用同一个操作号。
            await read(await adjust({ ...body, quantityDelta: -4, reason: 'LOST' }), 201);
            assert.deepEqual(await balanceOf(cable.id), {
              quantity_on_hand: 0,
              total_cost: '0.0000',
            });
          },
        );

        // ---- 05 cost rules ---------------------------------------------------------
        await http.test(
          'cost follows moving average, reference price or zero, never a guess',
          async () => {
            // 有库存时的盘盈：沿用当前均价，不受后来修改的参考进货价影响。
            const gain = (
              await read(
                await adjust({
                  warehouseId: a.defaultWarehouse.id,
                  productId: charger.id,
                  quantityDelta: 2,
                  reason: 'STOCKTAKE_GAIN',
                  clientOperationId: randomUUID(),
                }),
                201,
              )
            ).data;
            assert.equal(gain.costSource, 'AVERAGE');
            assert.equal(gain.unitCost, '18.5000');
            assert.equal(gain.costDelta, '37.0000');
            assert.equal(gain.totalCostAfter, '185.0000');
            assert.deepEqual(await balanceOf(charger.id), {
              quantity_on_hand: 10,
              total_cost: '185.0000',
            });

            // 零库存盘盈：用商品参考进货价，并标明来源。
            const reference = (
              await read(
                await adjust({
                  warehouseId: a.defaultWarehouse.id,
                  productId: stand.id,
                  quantityDelta: 4,
                  reason: 'STOCKTAKE_GAIN',
                  clientOperationId: randomUUID(),
                }),
                201,
              )
            ).data;
            assert.equal(reference.costSource, 'REFERENCE');
            assert.equal(reference.unitCost, '25.0000');
            assert.equal(reference.costDelta, '100.0000');
            assert.deepEqual(await balanceOf(stand.id), {
              quantity_on_hand: 4,
              total_cost: '100.0000',
            });

            // 零库存盘盈且没有参考价：数量记对，成本记 0，不凭空估值。
            const unknown = (
              await read(
                await adjust({
                  warehouseId: a.defaultWarehouse.id,
                  productId: ghost.id,
                  quantityDelta: 3,
                  reason: 'STOCKTAKE_GAIN',
                  clientOperationId: randomUUID(),
                }),
                201,
              )
            ).data;
            assert.equal(unknown.costSource, 'ZERO');
            assert.equal(unknown.unitCost, '0.0000');
            assert.equal(unknown.costDelta, '0.0000');
            assert.deepEqual(await balanceOf(ghost.id), {
              quantity_on_hand: 3,
              total_cost: '0.0000',
            });

            // 刚好减到 0：成本池必须清零，不留尾差。
            await receiveStock(mug.id, 3, '10.00');
            const cleared = (
              await read(
                await adjust({
                  warehouseId: a.defaultWarehouse.id,
                  productId: mug.id,
                  quantityDelta: -3,
                  reason: 'LOST',
                  clientOperationId: randomUUID(),
                }),
                201,
              )
            ).data;
            assert.equal(cleared.totalCostBefore, '30.0000');
            assert.equal(cleared.costDelta, '-30.0000');
            assert.equal(cleared.totalCostAfter, '0.0000');
            assert.equal(cleared.costSource, 'AVERAGE');
            assert.deepEqual(await balanceOf(mug.id), {
              quantity_on_hand: 0,
              total_cost: '0.0000',
            });
          },
        );

        // ---- 06 permissions & isolation --------------------------------------------
        await http.test(
          'owners, admins and warehouse staff may adjust; buyers, viewers and other tenants may not',
          async () => {
            const bodyFor = (productId) => ({
              warehouseId: a.defaultWarehouse.id,
              productId,
              quantityDelta: 1,
              reason: 'STOCKTAKE_GAIN',
              clientOperationId: randomUUID(),
            });
            for (const actor of ['owner', 'admin', 'warehouse'])
              await read(await adjust(bodyFor(ghost.id), { actor }), 201);
            for (const actor of ['buyer', 'viewer'])
              await read(await adjust(bodyFor(ghost.id), { actor }), 403, 'FORBIDDEN');

            // 列表对所有能读商品的角色开放，写操作才是受限的。
            await read(await request('/inventory/adjustments', { actor: 'viewer' }), 200);
            await read(await adjust(bodyFor(ghost.id), { actor: null }), 401, 'UNAUTHENTICATED');

            // 跨商家：B 的仓库/商品对 A 不可见，一律 404 而不是 403（不暴露存在性）。
            const foreignProduct = await makeProduct('ADJ-FOREIGN', {}, b);
            await read(await adjust(bodyFor(foreignProduct.id)), 404, 'NOT_FOUND');
            await read(
              await adjust({
                ...bodyFor(ghost.id),
                warehouseId: b.defaultWarehouse.id,
              }),
              404,
              'NOT_FOUND',
            );

            // B 的调整单不能通过 A 的详情接口读出来。
            const foreignAdjustment = (
              await read(
                await adjust(
                  {
                    warehouseId: b.defaultWarehouse.id,
                    productId: foreignProduct.id,
                    quantityDelta: 1,
                    reason: 'OTHER',
                    remark: 'B 商家内部调整',
                    clientOperationId: randomUUID(),
                  },
                  { tenant: b },
                ),
                201,
              )
            ).data;
            await read(
              await request('/inventory/adjustments/' + foreignAdjustment.id),
              404,
              'NOT_FOUND',
            );
            assert.equal((await adjustmentFacts(foreignProduct.id, a)).adjustments, 0);
          },
        );

        // ---- 07 list & detail ------------------------------------------------------
        await http.test(
          'list filters by warehouse, reason, keyword and date; detail matches',
          async () => {
            const all = await read(await request('/inventory/adjustments?pageSize=100'), 200);
            assert.ok(all.pagination.total >= 7);
            assert.equal(all.data.length, all.pagination.total);
            // 最近的在前。
            for (let index = 1; index < all.data.length; index += 1)
              assert.ok(all.data[index - 1].createdAt >= all.data[index].createdAt);
            const sample = all.data.find((row) => row.productId === charger.id);
            assert.ok(sample);

            const detail = (await read(await request('/inventory/adjustments/' + sample.id), 200))
              .data;
            assert.deepEqual(detail, sample);

            const byReason = (
              await read(await request('/inventory/adjustments?reason=STOCKTAKE_LOSS'), 200)
            ).data;
            assert.ok(byReason.length >= 1);
            assert.ok(byReason.every((row) => row.reason === 'STOCKTAKE_LOSS'));

            const byProduct = (
              await read(
                await request('/inventory/adjustments?productId=' + charger.id + '&pageSize=100'),
                200,
              )
            ).data;
            assert.equal(byProduct.length, 2);
            assert.ok(byProduct.every((row) => row.productId === charger.id));

            const byWarehouse = (
              await read(
                await request(
                  '/inventory/adjustments?warehouseId=' + a.defaultWarehouse.id + '&pageSize=100',
                ),
                200,
              )
            ).data;
            assert.ok(byWarehouse.length >= byProduct.length);

            const byNo = (
              await read(
                await request(
                  '/inventory/adjustments?search=' + encodeURIComponent(sample.adjustmentNo),
                ),
                200,
              )
            ).data;
            assert.deepEqual(
              byNo.map((row) => row.id),
              [sample.id],
            );
            const bySku = (
              await read(await request('/inventory/adjustments?search=ADJ-CHARGER'), 200)
            ).data;
            assert.equal(bySku.length, 2);
            const byName = (
              await read(
                await request('/inventory/adjustments?search=' + encodeURIComponent('商品')),
                200,
              )
            ).data;
            assert.ok(byName.length >= 2);

            const windowed = (
              await read(
                await request('/inventory/adjustments?from=2026-01-01&to=2099-12-31&pageSize=100'),
                200,
              )
            ).data;
            assert.equal(windowed.length, all.pagination.total);
            assert.equal(
              (
                await read(
                  await request('/inventory/adjustments?from=2026-12-31&to=2026-01-01'),
                  422,
                  'BUSINESS_VALIDATION_FAILED',
                )
              ).error.details.field,
              'date',
            );
            assert.equal(
              (
                await read(
                  await request('/inventory/adjustments?from=not-a-date'),
                  400,
                  'VALIDATION_ERROR',
                )
              ).error.code,
              'VALIDATION_ERROR',
            );

            const paged = await read(
              await request('/inventory/adjustments?page=2&pageSize=2'),
              200,
            );
            assert.equal(paged.data.length, 2);
            assert.equal(paged.pagination.total, all.pagination.total);
            assert.notDeepEqual(
              paged.data.map((row) => row.id),
              all.data.slice(0, 2).map((row) => row.id),
            );

            await read(await request('/inventory/adjustments/' + randomUUID()), 404, 'NOT_FOUND');
          },
        );

        // ---- 08 database guardrails & docs -----------------------------------------
        await http.test(
          'the database rejects unknown reasons and no route can overwrite a balance',
          async () => {
            const bProduct = await makeProduct('ADJ-B-GUARD', {}, b);
            // 绕过接口直接写库：原因枚举由 CHECK 兜住（NOT VALID 只约束新行）。
            await assert.rejects(
              () =>
                db.query(
                  `INSERT INTO stock_adjustments
                   (tenant_id, warehouse_id, product_id, quantity_delta, reason, unit_cost_snapshot, client_operation_id, created_by)
                 VALUES ($1,$2,$3,1,'BROKEN',0,$4,$5)`,
                  [
                    b.tenant.id,
                    b.defaultWarehouse.id,
                    bProduct.id,
                    randomUUID(),
                    accounts.owner.user.id,
                  ],
                ),
              /stock_adjustments_reason_known/,
            );
            // 数量为 0 的历史约束仍然生效。
            await assert.rejects(
              () =>
                db.query(
                  `INSERT INTO stock_adjustments
                   (tenant_id, warehouse_id, product_id, quantity_delta, reason, unit_cost_snapshot, client_operation_id, created_by)
                 VALUES ($1,$2,$3,0,'OTHER',0,$4,$5)`,
                  [
                    b.tenant.id,
                    b.defaultWarehouse.id,
                    bProduct.id,
                    randomUUID(),
                    accounts.owner.user.id,
                  ],
                ),
              /ck_stock_adjustments_1/,
            );

            const doc = await (await fetch(base + '/api/docs-json')).json();
            for (const path of [
              '/api/v1/inventory/adjustments',
              '/api/v1/inventory/adjustments/{id}',
            ])
              assert.ok(doc.paths[path], '缺少 ' + path);
            assert.deepEqual(Object.keys(doc.paths['/api/v1/inventory/adjustments']).sort(), [
              'get',
              'post',
            ]);
            assert.deepEqual(Object.keys(doc.paths['/api/v1/inventory/adjustments/{id}']).sort(), [
              'get',
            ]);
            // 余额/流水仍然只读：没有可直接覆盖余额或成本的入口。
            assert.equal(doc.paths['/api/v1/stock-balances'], undefined);
            assert.equal(doc.paths['/api/v1/stock-movements'], undefined);
            assert.deepEqual(Object.keys(doc.paths['/api/v1/inventory/balances']), ['get']);

            const body =
              doc.paths['/api/v1/inventory/adjustments'].post.requestBody.content[
                'application/json'
              ].schema;
            const reference = body.$ref ?? body.allOf?.at(-1)?.$ref;
            assert.deepEqual(
              Object.keys(doc.components.schemas[reference.split('/').at(-1)].properties).sort(),
              [
                'clientOperationId',
                'productId',
                'quantityDelta',
                'reason',
                'remark',
                'warehouseId',
              ],
            );
          },
        );

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
