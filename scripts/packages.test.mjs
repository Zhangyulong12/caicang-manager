import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { startTestApi } from './api-test-server.mjs';
const { Client } = createRequire(new URL('../apps/api/package.json', import.meta.url))('pg');
const run = promisify(execFile);
loadEnvFile(new URL('../.env', import.meta.url));

test(
  'real package binding, planned quantities, roles, states and concurrent processes',
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
      logs = '',
      counter = 0;
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
      await t.test('production controllers on two instances', async (http) => {
        const settings = {
          DATABASE_URL: url.toString(),
          NODE_ENV: 'test',
          JWT_ACCESS_SECRET: randomBytes(48).toString('hex'),
          TRUSTED_PROXIES: '127.0.0.1/32,::1/128',
        };
        const base = await startTestApi(http, {
            env: settings,
            onOutput: (chunk) => {
              logs += chunk;
            },
          }),
          second = await startTestApi(http, {
            env: settings,
            onOutput: (chunk) => {
              logs += chunk;
            },
          });
        let a, b;
        const accounts = {};
        const request = (
          path,
          { actor = 'owner', tenant = a, method = 'GET', body, server = base, headers = {} } = {},
        ) =>
          fetch(server + '/api/v1' + path, {
            method,
            headers: {
              'Content-Type': 'application/json',
              'X-Forwarded-For': `198.20.${Math.floor(++counter / 250)}.${(counter % 250) + 1}`,
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
          const body = await response.json();
          assert.equal(body.requestId, response.headers.get('x-request-id'));
          if (code) assert.equal(body.error.code, code);
          return body;
        };
        for (const actor of ['owner', 'admin', 'buyer', 'warehouse', 'viewer', 'outsider']) {
          const input = { email: actor + '@packages.example.test', password: 'PackagesTests!2026' };
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
            await request('/tenants', { tenant: null, method: 'POST', body: { name: '包裹 A' } }),
            201,
          )
        ).data;
        b = (
          await read(
            await request('/tenants', { tenant: null, method: 'POST', body: { name: '包裹 B' } }),
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
        const products = [];
        for (const sku of ['CHARGER-100', 'CABLE-20'])
          products.push(
            (
              await read(
                await request('/products', {
                  method: 'POST',
                  body: { name: sku, sku, unit: '件' },
                }),
                201,
              )
            ).data,
          );
        const foreignProduct = (
          await read(
            await request('/products', {
              tenant: b,
              method: 'POST',
              body: { name: 'B商品', sku: 'CHARGER-100' },
            }),
            201,
          )
        ).data;
        async function order({ tenant = a, status = 'PLACED', quantity = 100 } = {}) {
          const result = (
            await read(
              await request('/purchase-orders', {
                tenant,
                method: 'POST',
                body: {
                  warehouseId: tenant.defaultWarehouse.id,
                  platform: 'TAOBAO',
                  purchaseDate: '2026-10-22',
                  recipient: { name: '测试员', phone: '13800000000', address: '虚构验收仓库地址' },
                  items: (tenant === a ? products : [foreignProduct]).map((p, i) => ({
                    productId: p.id,
                    quantity: i === 0 ? quantity : 20,
                    unitPrice: '18.50',
                  })),
                },
              }),
              201,
            )
          ).data;
          if (status === 'DRAFT') return result;
          const placed = (
            await read(
              await request('/purchase-orders/' + result.id + '/place', { tenant, method: 'POST' }),
              200,
            )
          ).data;
          if (status !== 'PLACED')
            await db.query('UPDATE purchase_orders SET status=$1 WHERE id=$2', [status, result.id]);
          return { ...placed, status };
        }
        const body = (items = [], extra = {}) => ({
          carrierCode: 'ZTO',
          trackingNo: '000' + randomUUID(),
          expectedItems: items,
          ...extra,
        });
        const line = (o, n, index = 0) => ({
          purchaseOrderItemId: o.items[index].id,
          expectedQuantity: n,
        });
        async function bind(o, input = body(), options = {}) {
          return (
            await read(
              await request('/purchase-orders/' + o.id + '/packages', {
                method: 'POST',
                body: input,
                ...options,
              }),
              201,
            )
          ).data;
        }
        async function update(p, input, status = 200, code, options = {}) {
          return (
            await read(
              await request('/packages/' + p.id, { method: 'PATCH', body: input, ...options }),
              status,
              code,
            )
          ).data;
        }
        async function receipt(p, o, quantity = 0) {
          const id = randomUUID();
          await db.query(
            'INSERT INTO receipts(id,tenant_id,receipt_no,purchase_order_id,package_id,warehouse_id,client_operation_id,request_hash,received_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
            [
              id,
              a.tenant.id,
              'R-' + id,
              o.id,
              p.id,
              o.warehouseId,
              randomUUID(),
              'a'.repeat(64),
              accounts.owner.user.id,
            ],
          );
          if (quantity)
            await db.query(
              'INSERT INTO receipt_items(tenant_id,receipt_id,purchase_order_id,purchase_order_item_id,product_id,quantity,landed_unit_cost) VALUES($1,$2,$3,$4,$5,$6,$7)',
              [a.tenant.id, id, o.id, o.items[0].id, products[0].id, quantity, '18.5000'],
            );
          return id;
        }
        let primary, packages;
        await http.test(
          '100-piece purchase binds 3 independently readable packages, with multiple SKU per package',
          async () => {
            primary = await order({ quantity: 80 });
            assert.equal(
              primary.items.reduce((sum, item) => sum + item.quantity, 0),
              100,
            );
            packages = [];
            for (const [i, quantity] of [20, 20, 40].entries())
              packages.push(
                await bind(
                  primary,
                  body([line(primary, quantity), ...(i < 2 ? [line(primary, 10, 1)] : [])], {
                    trackingNo: '000T14-' + i,
                  }),
                ),
              );
            assert.equal(new Set(packages.map((p) => p.id)).size, 3);
            assert.deepEqual(
              packages.map((p) =>
                p.expectedItems.reduce((sum, item) => sum + item.expectedQuantity, 0),
              ),
              [30, 30, 40],
            );
            for (const [i, p] of packages.entries()) {
              const r = await request('/packages/' + p.id);
              assert.equal(r.headers.get('cache-control'), 'no-store');
              const data = (await read(r, 200)).data;
              assert.equal(data.purchaseOrderId, primary.id);
              assert.equal(data.purchaseOrderNo, primary.orderNo);
              assert.equal(data.trackingNo, '000T14-' + i);
              assert.equal(data.receivingStatus, 'NOT_RECEIVED');
              assert.equal(data.receivedQuantity, 0);
            }
            const rows = (
              await db.query(
                'SELECT purchase_order_item_id,sum(expected_quantity)::int quantity FROM package_expected_items WHERE purchase_order_id=$1 GROUP BY purchase_order_item_id',
                [primary.id],
              )
            ).rows;
            assert.equal(
              rows.find((r) => r.purchase_order_item_id === primary.items[0].id).quantity,
              80,
            );
            assert.equal(
              rows.find((r) => r.purchase_order_item_id === primary.items[1].id).quantity,
              20,
            );
          },
        );
        await http.test(
          'unallocated contents may be omitted or explicitly empty without creating receipts',
          async () => {
            for (const input of [
              { carrierCode: 'SF', trackingNo: '000EMPTY' },
              { carrierCode: 'SF', trackingNo: '000EMPTY2', expectedItems: [] },
            ]) {
              const p = await bind(primary, input);
              assert.deepEqual(p.expectedItems, []);
              assert.equal(p.hasReceipts, false);
            }
          },
        );
        await http.test(
          'duplicate carrier+tracking is rejected including lower-case carrier normalization',
          async () => {
            await read(
              await request('/purchase-orders/' + primary.id + '/packages', {
                method: 'POST',
                body: body([], { carrierCode: ' zto ', trackingNo: '000T14-0' }),
              }),
              409,
              'PACKAGE_TRACKING_ALREADY_EXISTS',
            );
            assert.equal(
              (
                await db.query(
                  'SELECT count(*)::int n FROM packages WHERE tenant_id=$1 AND carrier_code=$2 AND tracking_no=$3',
                  [a.tenant.id, 'ZTO', '000T14-0'],
                )
              ).rows[0].n,
              1,
            );
          },
        );
        await http.test(
          'same tracking under different carriers yields candidates rather than an arbitrary package',
          async () => {
            const p = await bind(primary, body([], { carrierCode: 'SF', trackingNo: '000T14-0' }));
            const data = (await read(await request('/packages/lookup?trackingNo=000T14-0'), 200))
              .data;
            assert.deepEqual(
              data.map((r) => r.carrierCode),
              ['SF', 'ZTO'],
            );
            assert.ok(data.some((r) => r.packageId === p.id));
            assert.ok(data.every((r) => r.purchaseOrderId === primary.id));
            assert.ok(!('recipient' in data[0]));
          },
        );
        await http.test(
          'leading zeroes internal symbols and case are preserved; lookup is exact',
          async () => {
            const value = '000Ab%_ /?#';
            await bind(primary, body([], { trackingNo: value }));
            assert.equal(
              (
                await read(
                  await request('/packages/lookup?trackingNo=' + encodeURIComponent(value)),
                  200,
                )
              ).data[0].trackingNo,
              value,
            );
            for (const value of ['T14-0', '0T14-0', '000ab%_ /?#', 'absent'])
              assert.deepEqual(
                (
                  await read(
                    await request('/packages/lookup?trackingNo=' + encodeURIComponent(value)),
                    200,
                  )
                ).data,
                [],
              );
          },
        );
        await http.test(
          'unknown query empty repeated query invalid UUID and anonymous access use standard errors',
          async () => {
            for (const path of [
              '/packages/lookup',
              '/packages/lookup?trackingNo=',
              '/packages/lookup?trackingNo=x&trackingNo=y',
              '/packages/lookup?trackingNo=x&tenantId=' + b.tenant.id,
              '/packages/not-a-uuid',
            ])
              await read(await request(path), 400, 'VALIDATION_ERROR');
            await read(await request('/packages/' + packages[0].id, { actor: null }), 401);
            await read(
              await request('/packages/' + packages[0].id, { headers: { 'X-Tenant-Id': 'bad' } }),
              400,
              'INVALID_TENANT_HEADER',
            );
          },
        );
        await http.test(
          'DTO rejects numeric tracking, null required fields, invalid nested lines and forged warehouse states',
          async () => {
            const invalid = [
              { trackingNo: 123 },
              { trackingNo: null },
              { trackingNo: ' ' },
              { trackingNo: 'x\ncode' },
              { trackingNo: 'x'.repeat(129) },
              { carrierCode: 'bad carrier' },
              { expectedItems: null },
              { expectedItems: [line(primary, 0)] },
              { expectedItems: [line(primary, 1.2)] },
              { expectedItems: [line(primary, 2147483648)] },
              { expectedItems: [line(primary, 1), line(primary, 1)] },
              { expectedItems: [{ ...line(primary, 1), tenantId: b.tenant.id }] },
              { status: 'RECEIVED' },
              { tenantId: b.tenant.id },
              { receivingClosedAt: new Date().toISOString() },
              { remark: 'x'.repeat(2001) },
            ];
            for (const fields of invalid)
              await read(
                await request('/purchase-orders/' + primary.id + '/packages', {
                  method: 'POST',
                  body: body([], fields),
                }),
                400,
                'VALIDATION_ERROR',
              );
            for (const fields of [
              { trackingNo: null },
              { expectedItems: null },
              { status: 'PARTIAL_RECEIVED' },
              { status: 'RECEIVED' },
              { purchaseOrderId: null },
              { receivedQuantity: 100 },
              { receivingClosedAt: new Date().toISOString() },
            ])
              await update(packages[0], fields, 400, 'VALIDATION_ERROR');
            await update(packages[0], {}, 400, 'BAD_REQUEST');
          },
        );
        await http.test(
          'sum across all packages cannot exceed either ordered SKU quantity',
          async () => {
            for (const item of [line(primary, 1), line(primary, 1, 1)])
              await read(
                await request('/purchase-orders/' + primary.id + '/packages', {
                  method: 'POST',
                  body: body([item]),
                }),
                409,
                'PACKAGE_EXPECTED_QTY_EXCEEDED',
              );
            await update(
              packages[0],
              { expectedItems: [line(primary, 31), line(primary, 10, 1)] },
              409,
              'PACKAGE_EXPECTED_QTY_EXCEEDED',
            );
          },
        );
        await http.test(
          'same PATCH is idempotent and preserves plan row IDs timestamps and audit count',
          async () => {
            const p = packages[0],
              count = (
                await db.query(
                  "SELECT count(*)::int n FROM audit_logs WHERE object_type='package' AND object_id=$1",
                  [p.id],
                )
              ).rows[0].n;
            const result = await update(p, {
              trackingNo: p.trackingNo,
              carrierCode: p.carrierCode,
              expectedItems: [line(primary, 10, 1), line(primary, 20)],
            });
            assert.equal(result.updatedAt, p.updatedAt);
            assert.deepEqual(
              result.expectedItems.map((i) => i.id),
              p.expectedItems.map((i) => i.id),
            );
            assert.equal(
              (
                await db.query(
                  "SELECT count(*)::int n FROM audit_logs WHERE object_type='package' AND object_id=$1",
                  [p.id],
                )
              ).rows[0].n,
              count,
            );
          },
        );
        await http.test(
          'plan edits exclude own reservation, retain kept IDs and empty replacement releases capacity',
          async () => {
            const o = await order(),
              p = await bind(o, body([line(o, 60)])),
              q = await bind(o, body([line(o, 40)]));
            const changed = await update(p, { expectedItems: [line(o, 50), line(o, 5, 1)] });
            assert.equal(
              changed.expectedItems.find((i) => i.purchaseOrderItemId === o.items[0].id).id,
              p.expectedItems[0].id,
            );
            await update(q, { expectedItems: [line(o, 50)] });
            await update(p, { expectedItems: [] });
            assert.deepEqual(
              (await update(q, { expectedItems: [line(o, 100)] })).expectedItems.map(
                (i) => i.expectedQuantity,
              ),
              [100],
            );
          },
        );
        await http.test(
          'unreceived package may move only with an explicit valid replacement plan and both orders stay consistent',
          async () => {
            const from = await order(),
              to = await order(),
              p = await bind(from, body([line(from, 30)]));
            await update(p, { purchaseOrderId: to.id }, 422, 'BUSINESS_VALIDATION_FAILED');
            await update(
              p,
              { purchaseOrderId: to.id, expectedItems: [line(from, 30)] },
              404,
              'NOT_FOUND',
            );
            assert.equal(
              (await read(await request('/packages/' + p.id), 200)).data.purchaseOrderId,
              from.id,
            );
            const result = await update(p, {
              purchaseOrderId: to.id,
              expectedItems: [line(to, 30)],
            });
            assert.equal(result.purchaseOrderId, to.id);
            assert.equal(result.expectedItems[0].purchaseOrderItemId, to.items[0].id);
            await bind(from, body([line(from, 100)]));
            const found = (
              await read(await request('/packages/lookup?trackingNo=' + p.trackingNo), 200)
            ).data;
            assert.equal(found[0].purchaseOrderId, to.id);
          },
        );
        let foreign;
        await http.test(
          'cross-tenant and wrong-order package and planned line IDs always return 404 without leaking',
          async () => {
            const other = await order({ tenant: b });
            foreign = await bind(other, body([], { trackingNo: '000T14-0' }), { tenant: b });
            for (const path of ['/packages/' + foreign.id]) {
              await read(await request(path), 404, 'NOT_FOUND');
              await read(
                await request(path, { method: 'PATCH', body: { remark: 'x' } }),
                404,
                'NOT_FOUND',
              );
            }
            await read(
              await request('/purchase-orders/' + other.id + '/packages', {
                method: 'POST',
                body: body(),
              }),
              404,
              'NOT_FOUND',
            );
            await read(
              await request('/purchase-orders/' + primary.id + '/packages', {
                method: 'POST',
                body: body([line(other, 1)]),
              }),
              404,
              'NOT_FOUND',
            );
            await update(
              packages[0],
              { purchaseOrderId: other.id, expectedItems: [] },
              404,
              'NOT_FOUND',
            );
            const ownOther = await order();
            await read(
              await request('/purchase-orders/' + primary.id + '/packages', {
                method: 'POST',
                body: body([line(ownOther, 1)]),
              }),
              404,
              'NOT_FOUND',
            );
            const candidates = (
              await read(await request('/packages/lookup?trackingNo=000T14-0'), 200)
            ).data;
            assert.ok(candidates.every((p) => p.packageId !== foreign.id));
            assert.equal(
              (
                await read(
                  await request('/packages/lookup?trackingNo=000T14-0', { tenant: b }),
                  200,
                )
              ).data.length,
              1,
            );
            await read(
              await request('/packages/' + packages[0].id, { actor: 'outsider' }),
              403,
              'FORBIDDEN',
            );
          },
        );
        await http.test(
          'roles allow owner admin buyer writes and warehouse scan while viewer is read-only',
          async () => {
            for (const actor of ['owner', 'admin', 'buyer'])
              assert.equal(
                (await bind(primary, body([], { remark: 'PRIVATE-PACKAGE-NOTE' }), { actor }))
                  .status,
                'CREATED',
              );
            for (const actor of ['warehouse', 'viewer']) {
              await read(await request('/packages/' + packages[0].id, { actor }), 200);
              await read(
                await request('/purchase-orders/' + primary.id + '/packages', {
                  actor,
                  method: 'POST',
                  body: body(),
                }),
                403,
                'FORBIDDEN',
              );
              await update(packages[0], { remark: 'not allowed' }, 403, 'FORBIDDEN', { actor });
            }
            await read(
              await request('/packages/lookup?trackingNo=000T14-0', { actor: 'warehouse' }),
              200,
            );
            await read(
              await request('/packages/lookup?trackingNo=000T14-0', { actor: 'viewer' }),
              403,
              'FORBIDDEN',
            );
            const p = await bind(primary, body([], { remark: 'PRIVATE-PACKAGE-NOTE' }));
            assert.equal(
              (await read(await request('/packages/' + p.id, { actor: 'viewer' }), 200)).data
                .remark,
              null,
            );
          },
        );
        await http.test(
          'draft cancelled and fully received orders cannot accept new packages; partial orders can',
          async () => {
            for (const status of ['DRAFT', 'CANCELLED', 'RECEIVED']) {
              const o = await order({ status });
              await read(
                await request('/purchase-orders/' + o.id + '/packages', {
                  method: 'POST',
                  body: body(),
                }),
                409,
                'STATUS_CONFLICT',
              );
            }
            assert.equal(
              (await bind(await order({ status: 'PARTIAL_RECEIVED' }))).status,
              'CREATED',
            );
          },
        );
        await http.test(
          'logistics transitions are explicit and ARRIVED never creates receiving or inventory records',
          async () => {
            let p = await bind(primary);
            p = await update(p, { status: 'IN_TRANSIT' });
            p = await update(p, { status: 'ARRIVED' });
            assert.equal(p.receivingStatus, 'NOT_RECEIVED');
            assert.equal(p.receivedQuantity, 0);
            assert.equal(p.hasReceipts, false);
            await update(p, { status: 'CREATED' }, 409, 'STATUS_CONFLICT');
            p = await update(p, { status: 'EXCEPTION' });
            p = await update(p, { status: 'IN_TRANSIT' });
            assert.equal(p.status, 'IN_TRANSIT');
            assert.equal((await db.query('SELECT count(*)::int n FROM receipts')).rows[0].n, 0);
            assert.equal(
              (await db.query('SELECT count(*)::int n FROM stock_movements')).rows[0].n,
              0,
            );
          },
        );
        await http.test(
          'any receipt header including an empty one freezes ownership tracking contents and logistics but permits notes',
          async () => {
            const o = await order(),
              target = await order(),
              p = await bind(o, body([line(o, 10)]));
            await receipt(p, o);
            for (const input of [
              { purchaseOrderId: target.id, expectedItems: [] },
              { trackingNo: 'changed' },
              { carrierCode: 'SF' },
              { expectedItems: [] },
              { status: 'ARRIVED' },
            ])
              await update(p, input, 409, 'STATUS_CONFLICT');
            const result = await update(p, { remark: 'PRIVATE-PACKAGE-NOTE' });
            assert.equal(result.hasReceipts, true);
            assert.equal(result.receivingStatus, 'NOT_RECEIVED');
            assert.equal(result.purchaseOrderId, o.id);
            assert.equal((await update(p, { expectedItems: [line(o, 10)] })).id, p.id);
          },
        );
        await http.test(
          'actual receipt quantities drive independent partial and completed receiving views',
          async () => {
            const o = await order(),
              p = await bind(o, body([line(o, 10)]));
            await receipt(p, o, 4);
            let result = (await read(await request('/packages/' + p.id), 200)).data;
            assert.equal(result.status, 'CREATED');
            assert.equal(result.receivingStatus, 'PARTIAL_RECEIVED');
            assert.equal(result.receivedQuantity, 4);
            assert.equal(result.expectedItems[0].receivedQuantity, 4);
            await receipt(p, o, 6);
            result = (await read(await request('/packages/' + p.id), 200)).data;
            assert.equal(result.receivingStatus, 'RECEIVED');
            assert.equal(result.receivedQuantity, 10);
            const q = await bind(o);
            await receipt(q, o, 1);
            assert.equal(
              (await read(await request('/packages/' + q.id), 200)).data.receivingStatus,
              'PARTIAL_RECEIVED',
            );
            await db.query('UPDATE packages SET receiving_closed_at=now() WHERE id=$1', [q.id]);
            assert.equal(
              (await read(await request('/packages/' + q.id), 200)).data.receivingStatus,
              'RECEIVED',
            );
          },
        );
        await http.test(
          'legacy received status and receiving-close marker also freeze edits without trusting them as receipt quantities',
          async () => {
            for (const values of [
              { status: 'RECEIVED' },
              { status: 'PARTIAL_RECEIVED' },
              { receiving_closed_at: new Date() },
            ]) {
              const p = await bind(primary);
              if (values.status)
                await db.query('UPDATE packages SET status=$1 WHERE id=$2', [values.status, p.id]);
              else
                await db.query('UPDATE packages SET receiving_closed_at=now() WHERE id=$1', [p.id]);
              await update(p, { trackingNo: 'not-changeable' }, 409, 'STATUS_CONFLICT');
              assert.equal(
                (await read(await request('/packages/' + p.id), 200)).data.receivedQuantity,
                0,
              );
            }
          },
        );
        await http.test(
          'terminal purchase freezes package core fields but preserves readable history and notes',
          async () => {
            const o = await order(),
              p = await bind(o);
            await read(
              await request('/purchase-orders/' + o.id + '/cancel', { method: 'POST' }),
              200,
            );
            await update(p, { status: 'ARRIVED' }, 409, 'STATUS_CONFLICT');
            assert.equal(
              (await update(p, { remark: 'cancelled purchase note' })).purchaseStatus,
              'CANCELLED',
            );
          },
        );
        await http.test(
          'simultaneous package creates on two processes cannot over-allocate 100 pieces',
          async () => {
            const o = await order();
            const responses = await Promise.all([
              request('/purchase-orders/' + o.id + '/packages', {
                method: 'POST',
                body: body([line(o, 60)]),
              }),
              request('/purchase-orders/' + o.id + '/packages', {
                server: second,
                method: 'POST',
                body: body([line(o, 60)]),
              }),
            ]);
            assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
            for (const r of responses)
              await read(
                r,
                r.status,
                r.status === 409 ? 'PACKAGE_EXPECTED_QTY_EXCEEDED' : undefined,
              );
            assert.equal(
              (
                await db.query(
                  'SELECT sum(expected_quantity)::int n FROM package_expected_items WHERE purchase_order_id=$1',
                  [o.id],
                )
              ).rows[0].n,
              60,
            );
          },
        );
        await http.test(
          'simultaneous increases exclude own reservation yet cannot exceed total ordered',
          async () => {
            const o = await order(),
              p = await bind(o, body([line(o, 30)])),
              q = await bind(o, body([line(o, 30)]));
            const responses = await Promise.all([
              request('/packages/' + p.id, {
                method: 'PATCH',
                body: { expectedItems: [line(o, 60)] },
              }),
              request('/packages/' + q.id, {
                server: second,
                method: 'PATCH',
                body: { expectedItems: [line(o, 60)] },
              }),
            ]);
            assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
            for (const r of responses)
              await read(
                r,
                r.status,
                r.status === 409 ? 'PACKAGE_EXPECTED_QTY_EXCEEDED' : undefined,
              );
            assert.equal(
              (
                await db.query(
                  'SELECT sum(expected_quantity)::int n FROM package_expected_items WHERE purchase_order_id=$1',
                  [o.id],
                )
              ).rows[0].n,
              90,
            );
          },
        );
        await http.test(
          'duplicate concurrent tracking persists one package and one planned line',
          async () => {
            const o = await order(),
              input = body([line(o, 1)]);
            const responses = await Promise.all([
              request('/purchase-orders/' + o.id + '/packages', { method: 'POST', body: input }),
              request('/purchase-orders/' + o.id + '/packages', {
                server: second,
                method: 'POST',
                body: input,
              }),
            ]);
            assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
            for (const r of responses)
              await read(
                r,
                r.status,
                r.status === 409 ? 'PACKAGE_TRACKING_ALREADY_EXISTS' : undefined,
              );
            assert.equal(
              (
                await db.query('SELECT count(*)::int n FROM packages WHERE purchase_order_id=$1', [
                  o.id,
                ])
              ).rows[0].n,
              1,
            );
          },
        );
        await http.test(
          'opposite parent moves use stable lock order without deadlock',
          async () => {
            const x = await order(),
              y = await order(),
              p = await bind(x, body([line(x, 10)])),
              q = await bind(y, body([line(y, 10)]));
            const responses = await Promise.all([
              request('/packages/' + p.id, {
                method: 'PATCH',
                body: { purchaseOrderId: y.id, expectedItems: [line(y, 10)] },
              }),
              request('/packages/' + q.id, {
                server: second,
                method: 'PATCH',
                body: { purchaseOrderId: x.id, expectedItems: [line(x, 10)] },
              }),
            ]);
            for (const r of responses) await read(r, 200);
          },
        );
        await http.test(
          'duplicate tracking edit and excess move roll back ownership and plan together',
          async () => {
            const o = await order(),
              target = await order(),
              p = await bind(o, body([line(o, 10)])),
              q = await bind(o, body());
            await bind(target, body([line(target, 100)]));
            await update(
              p,
              { trackingNo: q.trackingNo, expectedItems: [] },
              409,
              'PACKAGE_TRACKING_ALREADY_EXISTS',
            );
            await update(
              p,
              { purchaseOrderId: target.id, expectedItems: [line(target, 1)] },
              409,
              'PACKAGE_EXPECTED_QTY_EXCEEDED',
            );
            const result = (await read(await request('/packages/' + p.id), 200)).data;
            assert.equal(result.purchaseOrderId, o.id);
            assert.equal(result.expectedItems[0].id, p.expectedItems[0].id);
            assert.equal(result.expectedItems[0].expectedQuantity, 10);
          },
        );
        await http.test(
          'audit failure rolls back package row, edits and planned reservation',
          async () => {
            const o = await order(),
              p = await bind(o, body([line(o, 10)])),
              input = body([line(o, 20)]);
            await db.query(
              "CREATE FUNCTION reject_package_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.object_type='package' THEN RAISE EXCEPTION 'private audit failure'; END IF; RETURN NEW; END $$",
            );
            await db.query(
              'CREATE TRIGGER fail_package_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_package_audit()',
            );
            try {
              await read(
                await request('/purchase-orders/' + o.id + '/packages', {
                  method: 'POST',
                  body: input,
                }),
                500,
                'INTERNAL_ERROR',
              );
              await update(p, { expectedItems: [line(o, 50)] }, 500, 'INTERNAL_ERROR');
            } finally {
              await db.query('DROP TRIGGER fail_package_audit ON audit_logs');
              await db.query('DROP FUNCTION reject_package_audit()');
            }
            assert.deepEqual(
              (await read(await request('/packages/lookup?trackingNo=' + input.trackingNo), 200))
                .data,
              [],
            );
            assert.equal(
              (await read(await request('/packages/' + p.id), 200)).data.expectedItems[0]
                .expectedQuantity,
              10,
            );
          },
        );
        await http.test(
          'receipt committed while edit waits prevents the stale unreceived edit',
          async () => {
            const o = await order(),
              p = await bind(o, body([line(o, 10)]));
            await db.query('BEGIN');
            let pending;
            try {
              await db.query('SELECT id FROM tenants WHERE id=$1 FOR UPDATE', [a.tenant.id]);
              pending = request('/packages/' + p.id, {
                server: second,
                method: 'PATCH',
                body: { expectedItems: [line(o, 20)] },
              });
              const deadline = Date.now() + 10000;
              let waiting = false;
              while (Date.now() < deadline) {
                waiting = (
                  await db.query(
                    "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND pid<>pg_backend_pid()) yes",
                  )
                ).rows[0].yes;
                if (waiting) break;
                await delay(30);
              }
              assert.equal(waiting, true);
              await receipt(p, o, 1);
              await db.query('COMMIT');
              await read(await pending, 409, 'STATUS_CONFLICT');
              const result = (await read(await request('/packages/' + p.id), 200)).data;
              assert.equal(result.receivedQuantity, 1);
              assert.equal(result.expectedItems[0].expectedQuantity, 10);
            } catch (error) {
              await db.query('ROLLBACK');
              if (pending) await pending;
              throw error;
            }
          },
        );
        await http.test('permission is rechecked after waiting for tenant lock', async () => {
          await db.query('BEGIN');
          let pending;
          try {
            await db.query('SELECT id FROM tenants WHERE id=$1 FOR UPDATE', [a.tenant.id]);
            pending = request('/purchase-orders/' + primary.id + '/packages', {
              actor: 'buyer',
              method: 'POST',
              body: body(),
            });
            const deadline = Date.now() + 10000;
            let waiting = false;
            while (Date.now() < deadline) {
              waiting = (
                await db.query(
                  "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND pid<>pg_backend_pid()) yes",
                )
              ).rows[0].yes;
              if (waiting) break;
              await delay(30);
            }
            assert.equal(waiting, true);
            await db.query(
              "UPDATE tenant_memberships SET role='VIEWER' WHERE tenant_id=$1 AND user_id=$2",
              [a.tenant.id, accounts.buyer.user.id],
            );
            await db.query('COMMIT');
            await read(await pending, 403, 'FORBIDDEN');
          } catch (error) {
            await db.query('ROLLBACK');
            if (pending) await pending;
            throw error;
          }
        });
        await http.test(
          'OpenAPI declares all four routes, array candidates and documented receipts',
          async () => {
            const spec = await (await fetch(base + '/api/docs-json')).json();
            for (const [path, method] of [
              ['/api/v1/purchase-orders/{id}/packages', 'post'],
              ['/api/v1/packages/{id}', 'get'],
              ['/api/v1/packages/{id}', 'patch'],
              ['/api/v1/packages/lookup', 'get'],
            ])
              assert.ok(spec.paths[path][method]);
            assert.equal(
              spec.paths['/api/v1/packages/lookup'].get.responses['200'].content['application/json']
                .schema.allOf[1].properties.data.type,
              'array',
            );
            // Task 16 adds the closure/receivable reads; task 17 adds the receipt write endpoint.
            assert.ok(spec.paths['/api/v1/packages/{id}/complete-receiving'].post);
            assert.ok(spec.paths['/api/v1/packages/{id}/receivable'].get);
            assert.ok(spec.paths['/api/v1/receipts'].post.responses['201']);
            assert.ok(spec.paths['/api/v1/receipts'].get);
          },
        );
        await http.test(
          'fresh process reads persistent package and actual receipt summaries',
          async () => {
            const restarted = await startTestApi(http, { env: settings });
            assert.equal(
              (await read(await request('/packages/' + packages[0].id, { server: restarted }), 200))
                .data.trackingNo,
              '000T14-0',
            );
          },
        );
        await http.test(
          'logging and package audits never include tokens passwords logistics notes or raw tracking',
          async () => {
            const metadata = JSON.stringify(
              (await db.query("SELECT metadata FROM audit_logs WHERE object_type='package'")).rows,
            );
            for (const secret of [
              'PackagesTests!2026',
              accounts.owner.accessToken,
              accounts.owner.refreshToken,
              'PRIVATE-PACKAGE-NOTE',
              '000T14-0',
              'private audit failure',
            ]) {
              assert.equal(logs.includes(secret), false);
              assert.equal(metadata.includes(secret), false);
            }
            assert.equal(
              (await db.query('SELECT count(*)::int n FROM stock_balances')).rows[0].n,
              0,
            );
            assert.equal(
              (await db.query('SELECT count(*)::int n FROM stock_movements')).rows[0].n,
              0,
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
