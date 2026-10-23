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
const localDate = () =>
  new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

test(
  'acceptance product variants: 货号 颜色 尺码 SKU stay separate through purchase, receiving, stock and outbound',
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
      await t.test('production API with real catalog and stock tables', async (http) => {
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
              'X-Forwarded-For': `198.29.${Math.floor(++counter / 250)}.${(counter % 250) + 1}`,
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
        for (const actor of ['owner', 'warehouse']) {
          const input = { email: actor + '@variants.example.test', password: 'Variant!2026' };
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
              body: { name: '变体 A' },
            }),
            201,
          )
        ).data;
        b = (
          await read(
            await request('/tenants', {
              tenant: null,
              method: 'POST',
              body: { name: '变体 B' },
            }),
            201,
          )
        ).data;
        await read(
          await request('/members', {
            method: 'POST',
            body: { email: accounts.warehouse.user.email, role: 'WAREHOUSE' },
          }),
          201,
        );

        const addProduct = async (body) =>
          (await read(await request('/products', { method: 'POST', body }), 201)).data;
        const black = await addProduct({
          articleNo: 'T20',
          color: '黑色',
          size: 'L',
          sku: 'T20-BLK-L',
          referencePurchasePrice: '10.00',
        });
        const white = await addProduct({
          articleNo: 'T20',
          color: '白色',
          size: 'XL',
          sku: 'T20-WHT-XL',
          barcode: '6900000000027',
          referencePurchasePrice: '12.00',
        });
        const stockOf = async (productId) => {
          const row = await db.query(
            'SELECT quantity_on_hand, total_cost::text AS total_cost FROM stock_balances WHERE tenant_id=$1 AND product_id=$2',
            [a.tenant.id, productId],
          );
          return row.rows[0] ?? { quantity_on_hand: 0, total_cost: '0.0000' };
        };

        await http.test(
          'the same 货号 keeps a separate SKU per 颜色/尺码 and auto-names both variants',
          async () => {
            assert.equal(black.name, 'T20 黑色 L');
            assert.equal(white.name, 'T20 白色 XL');
            assert.equal(black.articleNo, white.articleNo);
            assert.notEqual(black.sku, white.sku);
            // 单位默认按件，条码不再必填。
            assert.equal(black.unit, '件');
            assert.equal(black.barcode, null);
            assert.equal(black.color, '黑色');
            assert.equal(white.size, 'XL');
            await read(
              await request('/products', {
                method: 'POST',
                body: { articleNo: 'T20', color: '黑色', size: 'L', sku: 'T20-BLK-L' },
              }),
              409,
              'PRODUCT_SKU_ALREADY_EXISTS',
            );
            // SKU 只在同一商家内唯一，另一个商家可以用同样的编码。
            const other = await read(
              await request('/products', {
                tenant: b,
                method: 'POST',
                body: { articleNo: 'T20', color: '黑色', size: 'L', sku: 'T20-BLK-L' },
              }),
              201,
            );
            assert.equal(other.data.tenantId, b.tenant.id);
            assert.equal(other.data.name, 'T20 黑色 L');
          },
        );

        await http.test(
          'SKU and barcode lookup return the right variant while 货号 search returns the family',
          async () => {
            const bySku = await read(
              await request('/products/lookup?code=' + encodeURIComponent('T20-BLK-L')),
              200,
            );
            assert.deepEqual(
              bySku.data.map((row) => row.id),
              [black.id],
            );
            const byBarcode = await read(
              await request('/products/lookup?code=' + encodeURIComponent('6900000000027')),
              200,
            );
            assert.deepEqual(
              byBarcode.data.map((row) => row.id),
              [white.id],
            );
            const family = await read(
              await request('/products?page=1&pageSize=20&search=' + encodeURIComponent('T20')),
              200,
            );
            assert.deepEqual(family.data.map((row) => row.id).sort(), [black.id, white.id].sort());
            const whiteOnly = await read(
              await request('/products?page=1&pageSize=20&search=' + encodeURIComponent('白色')),
              200,
            );
            assert.deepEqual(
              whiteOnly.data.map((row) => row.id),
              [white.id],
            );
          },
        );

        const order = {};
        await http.test(
          'one purchase order buys 5 black and 3 white at their own real prices',
          async () => {
            const draft = (
              await read(
                await request('/purchase-orders', {
                  method: 'POST',
                  body: {
                    warehouseId: a.defaultWarehouse.id,
                    platform: 'TAOBAO',
                    purchaseDate: localDate(),
                    recipient: { name: '验收员', phone: '13800000000', address: '虚构仓库地址' },
                    items: [
                      { productId: black.id, quantity: 5, unitPrice: '9.90' },
                      { productId: white.id, quantity: 3, unitPrice: '20.00' },
                    ],
                  },
                }),
                201,
              )
            ).data;
            order.placed = (
              await read(
                await request('/purchase-orders/' + draft.id + '/place', { method: 'POST' }),
                200,
              )
            ).data;
            const [blackLine, whiteLine] = order.placed.items;
            assert.equal(blackLine.productId, black.id);
            assert.equal(blackLine.sku, 'T20-BLK-L');
            assert.equal(blackLine.articleNo, 'T20');
            assert.equal(blackLine.color, '黑色');
            assert.equal(blackLine.size, 'L');
            assert.equal(blackLine.name, 'T20 黑色 L');
            assert.equal(blackLine.quantity, 5);
            assert.equal(blackLine.unitPrice, '9.90');
            assert.equal(whiteLine.productId, white.id);
            assert.equal(whiteLine.sku, 'T20-WHT-XL');
            assert.equal(whiteLine.color, '白色');
            assert.equal(whiteLine.size, 'XL');
            assert.equal(whiteLine.quantity, 3);
            assert.equal(whiteLine.unitPrice, '20.00');
            const pkg = (
              await read(
                await request('/purchase-orders/' + order.placed.id + '/packages', {
                  method: 'POST',
                  body: {
                    carrierCode: 'SF',
                    trackingNo: 'SF0000000001',
                    expectedItems: [],
                  },
                }),
                201,
              )
            ).data;
            order.receipt = (
              await read(
                await request('/receipts', {
                  method: 'POST',
                  body: {
                    packageId: pkg.id,
                    clientOperationId: randomUUID(),
                    items: [
                      { purchaseOrderItemId: blackLine.id, receivedQty: 5 },
                      { purchaseOrderItemId: whiteLine.id, receivedQty: 3 },
                    ],
                  },
                }),
                201,
              )
            ).data;
            const [blackReceipt, whiteReceipt] = order.receipt.items;
            assert.equal(blackReceipt.sku, 'T20-BLK-L');
            assert.equal(blackReceipt.name, 'T20 黑色 L');
            assert.equal(blackReceipt.quantity, 5);
            assert.equal(blackReceipt.landedUnitCost, '9.9000');
            assert.equal(blackReceipt.lineCost, '49.5000');
            assert.equal(whiteReceipt.sku, 'T20-WHT-XL');
            assert.equal(whiteReceipt.quantity, 3);
            assert.equal(whiteReceipt.landedUnitCost, '20.0000');
            assert.equal(whiteReceipt.lineCost, '60.0000');
            // 参考进货价只是建档参考值：入库后仍然是 10.00 / 12.00。
            const saved = await db.query(
              'SELECT sku, reference_purchase_price::text AS price FROM products WHERE tenant_id=$1 ORDER BY sku',
              [a.tenant.id],
            );
            assert.deepEqual(saved.rows, [
              { sku: 'T20-BLK-L', price: '10.00' },
              { sku: 'T20-WHT-XL', price: '12.00' },
            ]);
          },
        );

        await http.test('stock is kept per variant with its own average cost', async () => {
          assert.deepEqual(await stockOf(black.id), {
            quantity_on_hand: 5,
            total_cost: '49.5000',
          });
          assert.deepEqual(await stockOf(white.id), {
            quantity_on_hand: 3,
            total_cost: '60.0000',
          });
          const balances = await read(
            await request('/inventory/balances?page=1&pageSize=100'),
            200,
          );
          const rows = new Map(balances.data.map((row) => [row.productId, row]));
          assert.equal(rows.get(black.id).quantityOnHand, 5);
          assert.equal(rows.get(black.id).averageCost, '9.9000');
          assert.equal(rows.get(black.id).sku, 'T20-BLK-L');
          assert.equal(rows.get(white.id).quantityOnHand, 3);
          assert.equal(rows.get(white.id).averageCost, '20.0000');
          assert.equal(rows.get(white.id).sku, 'T20-WHT-XL');
        });

        await http.test('outbound ships the 黑色 L and 白色 XL variants separately', async () => {
          const draft = (
            await read(
              await request('/outbound-orders', {
                method: 'POST',
                body: {
                  warehouseId: a.defaultWarehouse.id,
                  items: [
                    { productId: black.id, quantity: 2 },
                    { productId: white.id, quantity: 1 },
                  ],
                  customerName: '张老板',
                  customerPhone: '13800000002',
                  customerAddress: '上海市浦东新区虚构路 99 号',
                  carrierCode: 'SF',
                },
              }),
              201,
            )
          ).data;
          const shipped = (
            await read(
              await request('/outbound-orders/' + draft.id + '/ship', {
                method: 'POST',
                body: {
                  clientOperationId: randomUUID(),
                  carrierCode: 'SF',
                  trackingNo: 'SF0000000002',
                },
              }),
              201,
            )
          ).data;
          const bySku = new Map(shipped.items.map((row) => [row.sku, row]));
          assert.equal(bySku.get('T20-BLK-L').shippedUnitCost, '9.9000');
          assert.equal(bySku.get('T20-BLK-L').lineCost, '19.8000');
          assert.equal(bySku.get('T20-WHT-XL').shippedUnitCost, '20.0000');
          assert.equal(bySku.get('T20-WHT-XL').lineCost, '20.0000');
          assert.deepEqual(await stockOf(black.id), {
            quantity_on_hand: 3,
            total_cost: '29.7000',
          });
          assert.deepEqual(await stockOf(white.id), {
            quantity_on_hand: 2,
            total_cost: '40.0000',
          });
          const movements = await read(
            await request('/inventory/movements?page=1&pageSize=100&type=OUTBOUND'),
            200,
          );
          assert.deepEqual(movements.data.map((row) => [row.sku, row.quantityDelta]).sort(), [
            ['T20-BLK-L', -2],
            ['T20-WHT-XL', -1],
          ]);
        });

        await http.test(
          'editing 参考进货价 or the variant attributes never rewrites historical cost',
          async () => {
            const edited = (
              await read(
                await request('/products/' + black.id, {
                  method: 'PATCH',
                  body: { referencePurchasePrice: '99.00', color: '深黑' },
                }),
                200,
              )
            ).data;
            assert.equal(edited.referencePurchasePrice, '99.00');
            // 自动生成的名称会跟着属性走，但只是商品档案，不动任何单据。
            assert.equal(edited.name, 'T20 深黑 L');
            const receipt = await db.query(
              'SELECT quantity, landed_unit_cost::text AS landed FROM receipt_items WHERE tenant_id=$1 AND product_id=$2',
              [a.tenant.id, black.id],
            );
            // 入库成本来自实际采购价，参考价改到 99.00 也不会回写这里。
            assert.deepEqual(receipt.rows, [{ quantity: 5, landed: '9.9000' }]);
            assert.deepEqual(await stockOf(black.id), {
              quantity_on_hand: 3,
              total_cost: '29.7000',
            });
            const line = await db.query(
              `SELECT unit_price::text AS unit_price, landed_unit_cost::text AS landed,
                sku_snapshot, article_no_snapshot, color_snapshot, size_snapshot,
                name_snapshot, unit_snapshot
               FROM purchase_order_items WHERE tenant_id=$1 AND product_id=$2`,
              [a.tenant.id, black.id],
            );
            assert.deepEqual(line.rows, [
              {
                unit_price: '9.90',
                landed: '9.9000',
                sku_snapshot: 'T20-BLK-L',
                article_no_snapshot: 'T20',
                color_snapshot: '黑色',
                size_snapshot: 'L',
                name_snapshot: 'T20 黑色 L',
                unit_snapshot: '件',
              },
            ]);
            const outbound = await db.query(
              'SELECT quantity, shipped_unit_cost::text AS cost FROM outbound_order_items WHERE tenant_id=$1 AND product_id=$2',
              [a.tenant.id, black.id],
            );
            assert.deepEqual(outbound.rows, [{ quantity: 2, cost: '9.9000' }]);
          },
        );
      });
    } catch (error) {
      if (logs) console.error(logs);
      throw error;
    } finally {
      if (connected) await db.end();
      if (created) await admin.query(`DROP DATABASE "${name}"`);
      await admin.end();
    }
  },
);
