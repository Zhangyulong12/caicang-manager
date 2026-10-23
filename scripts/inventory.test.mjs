/**
 * Task 22 — inventory read model against the real database.
 *
 * Covers the acceptance path end to end: receive 20 units through the real acceptance
 * transaction, see 20 in GET /inventory/balances, then simulate a shipped outbound (the
 * outbound API does not exist yet, so the fixture performs the same movement + balance
 * update in one SQL transaction) and see 12 left. Also asserts the movement ledger chains
 * 0 → 20 → 12 with no gap, that pending inbound is counted from open purchase lines,
 * that another tenant sees nothing, and that /inventory exposes no write verbs at all.
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

test(
  'inventory: balances, pending inbound, weighted cost and the movement ledger',
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

      await t.test('real API reads real stock', async (http) => {
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
          if (code) assert.equal(payload.error.code, code);
          return payload;
        };
        const page = async (path) => (await read(await request(path), 200)).data;
        const pagination = async (path) => (await read(await request(path), 200)).pagination;
        const register = async (actor, email) => {
          const input = { email, password: 'Inventory!2026' };
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
        };

        await register('owner', 'owner@inventory.example.test');
        await register('viewer', 'viewer@inventory.example.test');
        a = (
          await read(
            await request('/tenants', {
              actor: 'owner',
              tenant: null,
              method: 'POST',
              body: { name: '库存 A' },
            }),
            201,
          )
        ).data;
        await read(
          await request('/members', {
            actor: 'owner',
            method: 'POST',
            body: { email: accounts.viewer.user.email, role: 'VIEWER' },
          }),
          201,
        );
        const second = (
          await read(
            await request('/warehouses', {
              actor: 'owner',
              method: 'POST',
              body: { name: '深圳二仓', code: 'SZ-02' },
            }),
            201,
          )
        ).data;

        const charger = (
          await read(
            await request('/products', {
              actor: 'owner',
              method: 'POST',
              body: {
                name: '20W 充电器',
                sku: 'CHARGER-20W',
                unit: '件',
                barcode: '06912345678901',
              },
            }),
            201,
          )
        ).data;
        const cable = (
          await read(
            await request('/products', {
              actor: 'owner',
              method: 'POST',
              body: { name: '1 米数据线', sku: 'CABLE-1M', unit: '条' },
            }),
            201,
          )
        ).data;

        async function order(warehouseId, items) {
          const draft = (
            await read(
              await request('/purchase-orders', {
                actor: 'owner',
                method: 'POST',
                body: {
                  warehouseId,
                  platform: 'TAOBAO',
                  purchaseDate: '2026-10-23',
                  recipient: { name: '验收员', phone: '13800000000', address: '虚构仓库地址' },
                  items,
                },
              }),
              201,
            )
          ).data;
          return (
            await read(
              await request('/purchase-orders/' + draft.id + '/place', {
                actor: 'owner',
                method: 'POST',
              }),
              200,
            )
          ).data;
        }
        const bind = async (placed, trackingNo, expectedItems) =>
          (
            await read(
              await request('/purchase-orders/' + placed.id + '/packages', {
                actor: 'owner',
                method: 'POST',
                body: { carrierCode: 'ZTO', trackingNo, expectedItems },
              }),
              201,
            )
          ).data;

        const firstOrder = await order(a.defaultWarehouse.id, [
          { productId: charger.id, quantity: 20, unitPrice: '18.50' },
        ]);
        const line = firstOrder.items[0].id;
        const pkg = await bind(firstOrder, '000INV-0001', [
          { purchaseOrderItemId: line, expectedQuantity: 20 },
        ]);
        const receipt = (
          await read(
            await request('/receipts', {
              actor: 'owner',
              method: 'POST',
              body: {
                packageId: pkg.id,
                clientOperationId: randomUUID(),
                items: [{ purchaseOrderItemId: line, receivedQty: 20 }],
                remark: '整箱到货，外箱完好',
              },
            }),
            201,
          )
        ).data;

        await http.test('receiving 20 makes the balance show 20 with a weighted cost', async () => {
          const rows = await page('/inventory/balances');
          assert.equal(rows.length, 1);
          const row = rows[0];
          assert.equal(row.sku, 'CHARGER-20W');
          assert.equal(row.name, '20W 充电器');
          assert.equal(row.barcode, '06912345678901', '条码保留前导零');
          assert.equal(row.warehouseId, a.defaultWarehouse.id);
          assert.equal(row.warehouseName, a.defaultWarehouse.name);
          assert.equal(row.quantityOnHand, 20, '入库 20 件后显示 20 件');
          assert.equal(row.pendingInboundQuantity, 0, '整单收完不再有待入库');
          assert.equal(row.totalCost, (20 * 18.5).toFixed(4), '账面总成本 = 20 × 18.50');
          assert.equal(row.averageCost, '18.5000', '移动加权平均成本 = 总成本 / 数量');
          assert.equal(
            row.lastReceivedAt,
            receipt.receivedAt,
            '最近入库时间 = 这笔入库单的收货时间',
          );
          assert.ok(row.updatedAt);
        });

        await http.test('the summary adds up what the balance rows show', async () => {
          const summary = (await read(await request('/inventory/summary'), 200)).data;
          assert.equal(summary.totalProducts, 1);
          assert.equal(summary.totalWarehouses, 1);
          assert.equal(summary.quantityOnHand, 20);
          assert.equal(summary.totalCost, '370.0000');
          assert.equal(summary.averageCost, '18.5000');
          assert.equal(summary.pendingInboundQuantity, 0);
          assert.equal(summary.lastReceivedAt, receipt.receivedAt);
          assert.equal(summary.warehouses.length, 1);
          assert.equal(summary.warehouses[0].skuCount, 1);
          assert.equal(summary.warehouses[0].quantityOnHand, 20);
          assert.equal(summary.warehouses[0].totalCost, '370.0000');
          assert.ok(
            Math.abs(new Date(summary.generatedAt).getTime() - Date.now()) < 60_000,
            'generatedAt 是服务端当前时间',
          );
        });

        await http.test(
          'the receipt movement carries before/after, document and operator',
          async () => {
            const rows = await page('/inventory/movements');
            assert.equal(rows.length, 1);
            const movement = rows[0];
            assert.equal(movement.type, 'RECEIPT');
            assert.equal(movement.direction, 'IN');
            assert.equal(movement.quantityDelta, 20);
            assert.equal(movement.quantityBefore, 0);
            assert.equal(movement.quantityAfter, 20);
            assert.equal(movement.unitCost, '18.5000');
            assert.equal(movement.totalCostAfter, '370.0000');
            assert.equal(movement.sourceNo, receipt.receiptNo, '来源单据是入库单号');
            assert.equal(movement.sourceId, receipt.items[0].id);
            assert.equal(movement.sourceDocumentId, receipt.id, '来源单据头可跳入库单详情');
            assert.equal(movement.note, '整箱到货，外箱完好');
            assert.equal(movement.operatorName, accounts.owner.user.displayName);
            assert.ok(movement.occurredAt);
          },
        );

        await http.test(
          'an open purchase order shows up as pending inbound on its warehouse',
          async () => {
            await order(second.id, [
              { productId: charger.id, quantity: 6, unitPrice: '19.00' },
              { productId: cable.id, quantity: 4, unitPrice: '3.20' },
            ]);
            const rows = await page('/inventory/balances?warehouseId=' + second.id);
            assert.equal(rows.length, 2, '没入库的商品也要出现在待入库清单里');
            const chargerRow = rows.find((row) => row.sku === 'CHARGER-20W');
            assert.equal(chargerRow.quantityOnHand, 0);
            assert.equal(chargerRow.pendingInboundQuantity, 6);
            assert.equal(chargerRow.averageCost, '0.0000', '没有库存时平均成本为 0');
            assert.equal(chargerRow.totalCost, '0.0000');
            const cableRow = rows.find((row) => row.sku === 'CABLE-1M');
            assert.equal(cableRow.pendingInboundQuantity, 4);
            // 另一仓库的 20 件不受影响
            const total = await pagination('/inventory/balances');
            assert.equal(total.total, 3, '默认仓 1 行 + 二仓 2 行');
          },
        );

        await http.test('pending inbound lists the unpaid purchase lines per SKU', async () => {
          const rows = await page('/inventory/pending');
          assert.equal(rows.length, 2);
          const chargerLine = rows.find((row) => row.sku === 'CHARGER-20W');
          assert.equal(chargerLine.orderedQuantity, 6);
          assert.equal(chargerLine.receivedQuantity, 0);
          assert.equal(chargerLine.pendingQuantity, 6);
          assert.equal(chargerLine.unitPrice, '19.00');
          assert.equal(chargerLine.pendingAmount, '114.0000', '待入库金额 = 6 × 19.00');
          assert.equal(chargerLine.status, 'PLACED');
          assert.equal(chargerLine.platform, 'TAOBAO');
          assert.equal(chargerLine.purchaseDate, '2026-10-23');
          assert.equal(chargerLine.warehouseId, second.id);
          assert.ok(chargerLine.orderNo.startsWith('PO-'));
          // 收完的那张采购单不再出现在待入库里
          assert.equal(
            rows.some((row) => row.purchaseOrderId === firstOrder.id),
            false,
          );

          const cableOnly = await page('/inventory/pending?sku=CABLE-1M');
          assert.equal(cableOnly.length, 1);
          assert.equal(cableOnly[0].pendingAmount, '12.8000', '4 × 3.20');
          assert.equal((await page('/inventory/pending?warehouseId=' + second.id)).length, 2);
          assert.equal(
            (await page('/inventory/pending?warehouseId=' + a.defaultWarehouse.id)).length,
            0,
          );
          assert.equal((await page('/inventory/pending?search=' + chargerLine.orderNo)).length, 2);
          assert.equal((await page('/inventory/pending?search=数据线')).length, 1);
          assert.equal((await page('/inventory/pending?barcode=06912345678901')).length, 1);
          assert.equal(
            (await page('/inventory/pending?from=2026-10-24')).length,
            0,
            '采购日期早于下界',
          );
          assert.equal((await page('/inventory/pending?to=2026-10-23')).length, 2);
          const reversed = await request('/inventory/pending?from=2026-10-24&to=2026-10-22');
          assert.equal(
            (await read(reversed, 422, 'BUSINESS_VALIDATION_FAILED')).error.details.field,
            'from',
          );
        });

        await http.test(
          'SKU, barcode, product, warehouse, text and page filters all work',
          async () => {
            const bySku = await page('/inventory/balances?sku=CHARGER-20W');
            assert.equal(bySku.length, 2, '同一 SKU 在两个仓库各一行');
            assert.deepEqual(
              bySku.map((row) => row.warehouseId).sort(),
              [a.defaultWarehouse.id, second.id].sort(),
            );
            const byBarcode = await page('/inventory/balances?barcode=06912345678901');
            assert.equal(byBarcode.length, 2, '按条码查，前导零不能丢');
            assert.equal(
              (await page('/inventory/balances?barcode=6912345678901')).length,
              0,
              '条码是精确匹配',
            );
            const byProduct = await page('/inventory/balances?productId=' + cable.id);
            assert.equal(byProduct.length, 1);
            assert.equal(byProduct[0].sku, 'CABLE-1M');
            const bySearch = await page('/inventory/balances?search=充电');
            assert.equal(bySearch.length, 2);
            const byNameSubstring = await page('/inventory/balances?search=charger');
            assert.equal(byNameSubstring.length, 2, '子串搜索不区分大小写');
            const filtered = await page(
              '/inventory/balances?warehouseId=' + second.id + '&sku=CABLE-1M',
            );
            assert.equal(filtered.length, 1);
            assert.equal((await page('/inventory/balances?sku=NOPE')).length, 0);

            const firstPage = await page('/inventory/balances?page=1&pageSize=2');
            assert.equal(firstPage.length, 2);
            const meta = await pagination('/inventory/balances?page=1&pageSize=2');
            assert.equal(meta.total, 3);
            assert.equal(meta.pageSize, 2);
            const secondPage = await page('/inventory/balances?page=2&pageSize=2');
            assert.equal(secondPage.length, 1);

            const movementsBySku = await page('/inventory/movements?sku=CHARGER-20W');
            assert.equal(movementsBySku.length, 1);
            assert.equal((await page('/inventory/movements?barcode=06912345678901')).length, 1);
            assert.equal(
              (await page('/inventory/movements?search=数据线')).length,
              0,
              '没入库就没有流水',
            );
            assert.equal((await page('/inventory/movements?type=OUTBOUND')).length, 0);
            assert.equal((await page('/inventory/movements?type=RECEIPT')).length, 1);
          },
        );

        await http.test('another tenant sees no balances and no movements', async () => {
          await register('other', 'other@inventory.example.test');
          b = (
            await read(
              await request('/tenants', {
                actor: 'other',
                tenant: null,
                method: 'POST',
                body: { name: '库存 B' },
              }),
              201,
            )
          ).data;
          assert.deepEqual(
            (await read(await request('/inventory/balances', { actor: 'other', tenant: b }), 200))
              .data,
            [],
          );
          const otherBalances = await read(
            await request('/inventory/balances?search=CHARGER', { actor: 'other', tenant: b }),
            200,
          );
          assert.deepEqual(otherBalances.data, [], '不能按 SKU 猜到别人的库存');
          const otherById = await read(
            await request('/inventory/balances?productId=' + charger.id, {
              actor: 'other',
              tenant: b,
            }),
            200,
          );
          assert.deepEqual(otherById.data, [], '不能按商品 ID 越权');
          const otherMovements = await read(
            await request('/inventory/movements', { actor: 'other', tenant: b }),
            200,
          );
          assert.deepEqual(otherMovements.data, [], '流水同样按商家隔离');
          // 租户 A 的数据仍在
          assert.equal((await page('/inventory/balances')).length, 3);
        });

        await http.test(
          'a shipped outbound reduces the balance and appends a chained movement',
          async () => {
            // 通过真实出库接口发货，验证查询侧读到的是发货事务写下的账（任务 24）。
            const draft = (
              await read(
                await request('/outbound-orders', {
                  method: 'POST',
                  body: {
                    warehouseId: a.defaultWarehouse.id,
                    items: [{ productId: charger.id, quantity: 8 }],
                    customerName: '出库测试客户',
                    customerPhone: '13800000000',
                    customerAddress: '虚构发货地址',
                  },
                }),
                201,
              )
            ).data;
            const shipped = (
              await read(
                await request(`/outbound-orders/${draft.id}/ship`, {
                  method: 'POST',
                  body: { clientOperationId: randomUUID() },
                }),
                201,
              )
            ).data;
            const outboundNo = shipped.outboundNo;
            const outboundOrderId = shipped.id;

            const rows = await page(
              '/inventory/balances?sku=CHARGER-20W&warehouseId=' + a.defaultWarehouse.id,
            );
            assert.equal(rows.length, 1);
            assert.equal(rows[0].quantityOnHand, 12, '出库 8 件后剩 12 件');
            assert.equal(rows[0].totalCost, '222.0000', '成本池同步减少');
            assert.equal(rows[0].averageCost, '18.5000', '移动加权平均单价不变');

            const movements = await page('/inventory/movements?sku=CHARGER-20W');
            assert.equal(movements.length, 2);
            const [outbound, inbound] = movements;
            assert.equal(outbound.type, 'OUTBOUND');
            assert.equal(outbound.direction, 'OUT');
            assert.equal(outbound.quantityDelta, -8);
            assert.equal(outbound.quantityBefore, 20);
            assert.equal(outbound.quantityAfter, 12);
            assert.equal(outbound.sourceNo, outboundNo, '来源单据是出库单号');
            assert.equal(outbound.sourceDocumentId, outboundOrderId);
            assert.equal(outbound.unitCost, '18.5000');
            assert.equal(inbound.quantityAfter, outbound.quantityBefore, '流水首尾相接，没有缺口');

            // 账本对账：流水链 0 → 20 → 12，最终余额与总和一致
            const chain = [...movements].reverse();
            assert.equal(chain[0].quantityBefore, 0);
            for (let index = 1; index < chain.length; index += 1)
              assert.equal(chain[index].quantityBefore, chain[index - 1].quantityAfter);
            const balanceRows = await page(
              '/inventory/balances?warehouseId=' + a.defaultWarehouse.id,
            );
            assert.equal(chain.at(-1).quantityAfter, balanceRows[0].quantityOnHand);
            assert.equal(
              chain.reduce((sum, row) => sum + row.quantityDelta, 0),
              balanceRows[0].quantityOnHand,
              '流水数量合计等于当前库存',
            );

            const summary = await read(await request('/inventory/summary'), 200);
            assert.equal(summary.data.quantityOnHand, 12, '总览跟着出库一起减少');
            assert.equal(summary.data.totalCost, '222.0000');
            assert.equal(summary.data.averageCost, '18.5000');
            assert.equal(summary.data.pendingInboundQuantity, 10, '二仓 6 + 4 仍待入库');
            assert.equal(summary.data.totalProducts, 2);
            assert.equal(summary.data.totalWarehouses, 2);
            const secondWarehouse = summary.data.warehouses.find(
              (row) => row.warehouseId === second.id,
            );
            assert.equal(secondWarehouse.quantityOnHand, 0);
            assert.equal(secondWarehouse.pendingInboundQuantity, 10);
            assert.equal(secondWarehouse.lastReceivedAt, null, '从未收货的仓库没有入库时间');
          },
        );

        await http.test('receipt list filters by received time', async () => {
          const today = new Date().toISOString().slice(0, 10);
          const future = new Date(Date.now() + 25 * 3600_000).toISOString().slice(0, 10);
          const all = await page('/receipts');
          assert.equal(all.length, 1);
          assert.equal(all[0].receiptNo, receipt.receiptNo);
          assert.equal((await page('/receipts?from=' + today)).length, 1, '只写日期按当天起点算');
          assert.equal((await page('/receipts?to=' + today)).length, 1, '上界按当天末尾算');
          assert.equal((await page('/receipts?from=' + future)).length, 0);
          const reversed = await request('/receipts?from=' + future + '&to=' + today);
          assert.equal(
            (await read(reversed, 422, 'BUSINESS_VALIDATION_FAILED')).error.details.field,
            'from',
          );
        });

        await http.test('time and type filters, reversed ranges and paging', async () => {
          const recent = new Date(Date.now() - 3600_000).toISOString();
          const future = new Date(Date.now() + 3600_000).toISOString();
          assert.equal((await page('/inventory/movements?from=' + recent)).length, 2);
          assert.equal((await page('/inventory/movements?from=' + future)).length, 0);
          assert.equal((await page('/inventory/movements?to=' + future)).length, 2);
          assert.equal((await page('/inventory/movements?type=OUTBOUND')).length, 1);
          assert.equal((await page('/inventory/movements?type=RECEIPT')).length, 1);
          const today = new Date().toISOString().slice(0, 10);
          assert.equal(
            (await page('/inventory/movements?to=' + today)).length,
            2,
            '只写日期按当天末尾算',
          );

          const reversed = await request('/inventory/movements?from=' + future + '&to=' + recent);
          const reversedBody = await read(reversed, 422, 'BUSINESS_VALIDATION_FAILED');
          assert.equal(reversedBody.error.details.field, 'from');

          const paged = await page('/inventory/movements?page=1&pageSize=1');
          assert.equal(paged.length, 1);
          assert.equal(paged[0].type, 'OUTBOUND', '默认按时间倒序');
          const meta = await pagination('/inventory/movements?page=1&pageSize=1');
          assert.equal(meta.total, 2);
          const secondPage = await page('/inventory/movements?page=2&pageSize=1');
          assert.equal(secondPage[0].type, 'RECEIPT');
        });

        await http.test(
          'a read-only role can read, and inventory has no write endpoint',
          async () => {
            const viewerBalances = await read(
              await request('/inventory/balances', { actor: 'viewer' }),
              200,
            );
            assert.equal(viewerBalances.data.length, 3);
            const viewerMovements = await read(
              await request('/inventory/movements', { actor: 'viewer' }),
              200,
            );
            assert.equal(viewerMovements.data.length, 2);

            const before = await db.query(
              'SELECT quantity_on_hand FROM stock_balances WHERE tenant_id=$1 AND product_id=$2',
              [a.tenant.id, charger.id],
            );
            for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
              const response = await request('/inventory/balances', { method });
              assert.equal(response.status, 404, method + ' /inventory/balances 必须不存在');
              const movementWrite = await request('/inventory/movements', { method });
              assert.equal(movementWrite.status, 404, method + ' /inventory/movements 必须不存在');
            }
            const after = await db.query(
              'SELECT quantity_on_hand FROM stock_balances WHERE tenant_id=$1 AND product_id=$2',
              [a.tenant.id, charger.id],
            );
            assert.equal(
              after.rows[0].quantity_on_hand,
              before.rows[0].quantity_on_hand,
              '余额没有被改动',
            );

            const spec = await (await fetch(base + '/api/docs-json')).json();
            for (const path of ['/api/v1/inventory/balances', '/api/v1/inventory/movements']) {
              assert.ok(spec.paths[path], 'OpenAPI 必须包含 ' + path);
              assert.deepEqual(
                Object.keys(spec.paths[path]),
                ['get'],
                path + ' 只允许 GET，不能出现直接改库存的 CRUD',
              );
            }
          },
        );

        assert.equal(/unhandled|bootstrap_failed/i.test(logs), false, 'API log: ' + logs);
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
      await admin.end().catch(() => undefined);
    }
  },
);
