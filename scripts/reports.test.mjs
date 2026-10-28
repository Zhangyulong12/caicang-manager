import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { reportFixture } from './report-fixture.mjs';
test(
  'reports: accounting, filters, isolation, CSV and read-only queries',
  { timeout: 240000 },
  async (t) => {
    await reportFixture(
      t,
      async ({
        http,
        db,
        request,
        read,
        post,
        tenant,
        other,
        account,
        product,
        purchase,
        receive,
      }) => {
        const table = async (dataset, query = '', opts = {}) =>
          read(await request('/reports/table?dataset=' + dataset + query, opts));
        const summary = async (query = '') => read(await request('/reports/overview' + query));
        const a = await account('TAOBAO', '淘宝主账号'),
          b = await account('JD', '京东采购号');
        const foreign = await account('JD', 'Other tenant account', other);
        const p = await product('R33-CHARGER', 'CHARGER'),
          c = await product('R33-CABLE', 'CABLE');
        const po = await purchase(
          a,
          [
            [p, 10, '18.50', '5.00'],
            [c, 4, '5.00'],
          ],
          { freight: '10.00' },
        );
        const jd = await purchase(b, [[p, 2, '20.00']], { date: '2026-10-02' });
        await purchase(a, [[p, 99, '999.00']], { place: false });
        const cancelled = await purchase(a, [[p, 1, '999.00']]);
        await read(await post('/purchase-orders/' + cancelled.id + '/cancel'));
        await http.test(
          'two accounts, platforms, multi-SKU totals, original discount/freight once',
          async () => {
            const rows = (await table('accounts')).rows;
            assert.equal(rows.find((r) => r.key === a.id).amount, '210.00');
            assert.equal(rows.find((r) => r.key === b.id).amount, '40.00');
            assert.equal((await table('platforms', '&platform=JD')).rows[0].amount, '40.00');
            const s = await summary();
            assert.equal(s.purchaseAmount, '250.00');
            assert.equal(s.purchaseQuantity, '16');
            assert.equal(s.purchaseOrderCount, '2');
            const selected = await summary('?purchaseAccountId=' + a.id);
            assert.equal(selected.purchaseAmount, '210.00');
            const lines = (
              await table('purchase-lines', '&sku=R33-CHARGER&purchaseAccountId=' + a.id)
            ).rows;
            assert.equal(lines[0].freight, '9.00');
            assert.equal(lines[0].amount, '189.00');
            assert.equal((await table('products', '&articleNo=CHARGER')).rows[0].quantity, '12');
            assert.equal((await summary('?sku=R33-CABLE')).purchaseAmount, '21.00');
          },
        );
        const received = await receive(po, [5, 2]);
        await receive(jd, [2]);
        await http.test(
          'partial receipts, pending quantity/value/package count, complete receipts',
          async () => {
            const s = await summary();
            assert.equal(s.pendingQuantity, '7');
            assert.equal(s.pendingAmount, '105.0000');
            assert.equal(s.pendingPackageCount, '1');
            assert.equal(s.receivedQuantity, '9');
            assert.equal(s.receivedCost, '145.0000');
            assert.equal(s.inventoryCost, '145.0000');
            const inv = (await table('inventory')).rows.find((r) => r.sku === 'R33-CHARGER');
            assert.equal(inv.averageCost, '19.2143');
            const order = await read(await request('/purchase-orders/' + po.id));
            assert.equal(order.totalCost, '210.00');
          },
        );
        const out = await read(
          await post('/outbound-orders', {
            warehouseId: tenant.defaultWarehouse.id,
            customerName: 'Task33',
            customerPhone: '13800000000',
            customerAddress: 'Not delivered',
            items: [{ productId: p.id, quantity: 2 }],
          }),
          201,
        );
        await read(
          await post('/outbound-orders/' + out.id + '/ship', { clientOperationId: randomUUID() }),
          201,
        );
        const ret = await read(
          await post('/purchase-returns', {
            purchaseOrderId: po.id,
            reason: 'Task33 partial return',
            returnDate: '2026-10-03',
            refundAmount: '17.00',
            items: [{ purchaseOrderItemId: po.items[0].id, quantity: 1 }],
          }),
          201,
        );
        await read(
          await post('/purchase-returns/' + ret.id + '/confirm', {
            clientOperationId: randomUUID(),
          }),
          201,
        );
        await http.test(
          'refund independent of original purchases and actual moving-average stock cost',
          async () => {
            const s = await summary();
            assert.equal(s.purchaseAmount, '250.00');
            assert.equal(s.returnRefundAmount, '17.00');
            assert.equal(s.returnQuantity, '1');
            assert.equal(s.returnStockCost, '19.2143');
            assert.equal(s.outboundCost, '38.4286');
            assert.equal(s.inventoryCost, '87.3571');
            assert.equal(s.pendingAmount, '105.0000');
            const ledger = await db.query(
              "SELECT (-SUM(cost_delta))::text AS cost FROM stock_movements WHERE tenant_id=$1 AND source_type='OUTBOUND'",
              [tenant.tenant.id],
            );
            assert.equal(s.outboundCost, ledger.rows[0].cost);
            assert.equal((await table('returns')).rows[0].refund, '17.00');
            assert.equal((await table('outbound')).rows[0].outboundId, out.id);
          },
        );
        await http.test(
          'date boundaries, independently dated refunds, paging and empty tenant',
          async () => {
            assert.equal(
              (await summary('?from=2026-10-01&to=2026-10-01')).purchaseAmount,
              '210.00',
            );
            const s = await summary('?from=2026-10-03&to=2026-10-03');
            assert.equal(s.purchaseAmount, '0.00');
            assert.equal(s.returnRefundAmount, '17.00');
            const empty = await read(await request('/reports/overview', { workspace: other }));
            assert.equal((await summary('?sku=DOES-NOT-EXIST')).purchaseAmount, '0.00');
            assert.equal(empty.purchaseAmount, '0.00');
            assert.equal(empty.pendingAmount, '0.0000');
            assert.equal((await table('accounts', '', { workspace: other })).rows.length, 0);
            const first = await table('purchase-lines', '&page=1&pageSize=1'),
              second = await table('purchase-lines', '&page=2&pageSize=1');
            assert.equal(first.pagination.total, 3);
            assert.notEqual(first.rows[0].key, second.rows[0].key);
            assert.equal((await table('purchase-lines', '&page=999')).rows.length, 0);
            await db.query('UPDATE receipts SET received_at=$1 WHERE id=$2', [
              '2026-10-01T15:59:59.999Z',
              received.receipt.id,
            ]);
            assert.equal(
              (await table('receipts', '&from=2026-10-01&to=2026-10-01')).rows.length,
              2,
            );
            await db.query('UPDATE receipts SET received_at=$1 WHERE id=$2', [
              '2026-10-01T16:00:00.000Z',
              received.receipt.id,
            ]);
            assert.equal(
              (await table('receipts', '&from=2026-10-01&to=2026-10-01')).rows.length,
              0,
            );
            assert.equal(
              (await table('receipts', '&from=2026-10-02&to=2026-10-02')).rows.length,
              2,
            );
          },
        );
        await http.test(
          'all datasets execute, roles and validation, cross-tenant identifiers',
          async () => {
            for (const name of [
              'accounts',
              'platforms',
              'daily',
              'products',
              'pending',
              'purchase-lines',
              'inventory',
              'receipts',
              'outbound',
              'returns',
              'adjustments',
            ])
              await table(name);
            for (const actor of ['admin', 'buyer', 'viewer'])
              await table('accounts', '', { actor });
            await read(await request('/reports/overview', { actor: 'warehouse' }), 403);
            for (const actor of ['buyer', 'viewer', 'warehouse'])
              await read(await request('/reports/export?dataset=accounts', { actor }), 403);
            await read(await request('/reports/overview', { actor: null }), 401);
            await read(await request('/reports/overview?purchaseAccountId=' + foreign.id), 404);
            await read(
              await request('/reports/overview?warehouseId=' + other.defaultWarehouse.id),
              404,
            );
            // Viewer only belongs to A, so B fails membership resolution.
            await read(
              await request('/reports/overview', { actor: 'viewer', workspace: other }),
              403,
            );
            for (const query of [
              'dataset=bad',
              'dataset=accounts&pageSize=101',
              'dataset=accounts&page=0',
              'dataset=accounts&from=2026-02-30',
              'dataset=accounts&from=2026-10-03&to=2026-10-01',
              'dataset=inventory&purchaseAccountId=' + a.id,
              'dataset=returns&sku=R33-CABLE',
              'dataset=accounts&unexpected=1',
            ])
              await read(await request('/reports/table?' + query), 400);
          },
        );
        await http.test(
          'full receipt and historical product reference price cannot change purchase costs',
          async () => {
            // Reuse original package for the remaining units; no duplicate expected allocations.
            await read(
              await post('/receipts', {
                packageId: received.pkg.id,
                clientOperationId: randomUUID(),
                items: [
                  { purchaseOrderItemId: po.items[0].id, receivedQty: 5 },
                  { purchaseOrderItemId: po.items[1].id, receivedQty: 2 },
                ],
              }),
              201,
            );
            await read(
              await request('/products/' + p.id, {
                method: 'PATCH',
                body: { referencePurchasePrice: '999.99' },
              }),
            );
            const s = await summary();
            assert.equal(s.pendingAmount, '0.0000');
            assert.equal(s.pendingQuantity, '0');
            assert.equal(s.inventoryCost, '192.3571');
            assert.equal(s.purchaseAmount, '250.00');
            const lines = (
              await table('purchase-lines', '&purchaseAccountId=' + a.id + '&sku=R33-CHARGER')
            ).rows;
            assert.equal(lines[0].unitPrice, '18.50');
            assert.equal(lines[0].receivedQuantity, '10');
          },
        );
        await http.test(
          'CSV: BOM bytes, all pages, commas/quotes/newline and formula protection',
          async () => {
            await read(
              await request('/purchase-accounts/' + a.id, {
                method: 'PATCH',
                body: { alias: '=SUM(1,2) "quote"' },
              }),
            );
            const result = await read(await request('/reports/export?dataset=accounts'));
            assert.equal(result.rowCount, 2);
            assert.equal(result.csv.codePointAt(0), 0xfeff);
            assert.ok(result.csv.includes('"\'=SUM(1,2) ""quote"""'));
            const raw = await request('/reports/export.csv?dataset=purchase-lines');
            assert.equal(raw.status, 200);
            assert.match(raw.headers.get('content-type'), /text\/csv/);
            const bytes = Buffer.from(await raw.arrayBuffer());
            assert.equal(bytes.subarray(0, 3).toString('hex'), 'efbbbf');
            const owner = await read(
              await request('/reports/export?dataset=accounts', { actor: 'admin' }),
            );
            assert.equal(owner.rowCount, 2);
          },
        );
        await http.test(
          'legacy incomplete allocation is explicit; header totals remain reliable',
          async () => {
            await db.query(
              'UPDATE purchase_order_items SET freight_allocated=NULL,landed_unit_cost=NULL WHERE id=$1',
              [po.items[0].id],
            );
            assert.equal(
              (await table('accounts')).rows.find((r) => r.key === a.id).amount,
              '210.00',
            );
            const s = await summary('?sku=R33-CHARGER&purchaseAccountId=' + a.id);
            assert.equal(s.purchaseAmount, null);
            assert.equal(s.missingAllocationCount, '1');
            assert.equal(
              (await table('purchase-lines', '&purchaseAccountId=' + a.id + '&sku=R33-CHARGER'))
                .rows[0].amount,
              null,
            );
          },
        );
        await http.test(
          'reports leave all balances, movements and original order prices untouched',
          async () => {
            const snapshot = async () =>
              JSON.stringify(
                (
                  await db.query(
                    'SELECT (SELECT jsonb_agg(b ORDER BY id) FROM stock_balances b) AS balances,(SELECT jsonb_agg(m ORDER BY id) FROM stock_movements m) AS movements,(SELECT jsonb_agg(i ORDER BY id) FROM purchase_order_items i) AS items',
                  )
                ).rows,
              );
            const before = await snapshot();
            await summary();
            await table('inventory');
            await table('products');
            await read(await request('/reports/export?dataset=receipts'));
            assert.equal(await snapshot(), before);
          },
        );
        await http.test(
          'multi-SKU refund header counted once and unassigned purchase account',
          async () => {
            const draft = await read(
              await post('/purchase-returns', {
                purchaseOrderId: po.id,
                reason: 'Multi-SKU report fixture',
                returnDate: '2026-10-03',
                refundAmount: '7.25',
                items: [
                  { purchaseOrderItemId: po.items[0].id, quantity: 1 },
                  { purchaseOrderItemId: po.items[1].id, quantity: 1 },
                ],
              }),
              201,
            );
            await read(
              await post('/purchase-returns/' + draft.id + '/confirm', {
                clientOperationId: randomUUID(),
              }),
              201,
            );
            assert.equal((await summary()).returnRefundAmount, '24.25');
            assert.equal(
              (await table('accounts')).rows.find((row) => row.key === a.id).refund,
              '24.25',
            );
            await purchase(null, [[c, 1, '2.50']]);
            assert.equal(
              (await table('accounts', '&purchaseAccountId=UNASSIGNED')).rows[0].amount,
              '2.50',
            );
          },
        );
        await http.test(
          'historical empty article snapshot stays empty and adjustment links actual ledger',
          async () => {
            const fresh = await product('EMPTY-ARTICLE');
            await purchase(a, [[fresh, 1, '1.00']]);
            await read(
              await request('/products/' + fresh.id, {
                method: 'PATCH',
                body: { articleNo: 'LATER-ARTICLE' },
              }),
            );
            assert.equal(
              (await table('purchase-lines', '&sku=EMPTY-ARTICLE')).rows[0].articleNo,
              null,
            );
            assert.equal(
              (await table('purchase-lines', '&articleNo=LATER-ARTICLE')).rows.length,
              0,
            );
            const adjusted = await read(
              await post('/inventory/adjustments', {
                warehouseId: tenant.defaultWarehouse.id,
                productId: c.id,
                quantityDelta: 1,
                reason: 'STOCKTAKE_GAIN',
                clientOperationId: randomUUID(),
              }),
              201,
            );
            const row = (await table('adjustments')).rows[0];
            assert.equal(row.adjustmentId, adjusted.id);
            assert.equal(row.quantity, '1');
            const cost = (
              await db.query(
                "SELECT cost_delta::text AS cost FROM stock_movements WHERE tenant_id=$1 AND source_type='ADJUSTMENT' AND source_item_id=$2",
                [tenant.tenant.id, adjusted.id],
              )
            ).rows[0].cost;
            assert.equal(row.cost, cost);
          },
        );
        await http.test('OpenAPI contract includes report filters, response and CSV', async () => {
          const response = await request('/../docs-json');
          assert.equal(response.status, 200);
          const spec = await response.json();
          assert.ok(
            spec.paths['/api/v1/reports/overview'].get.parameters.some(
              (p) => p.name === 'purchaseAccountId',
            ),
          );
          assert.ok(
            spec.paths['/api/v1/reports/export.csv'].get.responses['200'].content['text/csv'],
          );
          assert.ok(spec.components.schemas.ReportOverviewDto.properties.pendingPackageCount);
        });
        await http.test(
          'export bound rejects more than 10000 rows without truncation',
          async () => {
            await db.query(
              `WITH p AS (INSERT INTO products(tenant_id,sku,name,unit) SELECT $1,'CAP-'||n,'Export bound fixture','件' FROM generate_series(1,10001) n RETURNING id,tenant_id) INSERT INTO stock_balances(tenant_id,warehouse_id,product_id,quantity_on_hand,total_cost) SELECT tenant_id,$2,id,0,0 FROM p`,
              [tenant.tenant.id, tenant.defaultWarehouse.id],
            );
            await read(await request('/reports/export?dataset=inventory'), 422);
          },
        );
      },
    );
  },
);
