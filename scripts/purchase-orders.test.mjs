import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readdir, cp, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { startTestApi } from './api-test-server.mjs';
import { purchaseCost } from '../apps/api/dist/modules/purchase-orders/purchase-cost.js';
const { Client } = createRequire(new URL('../apps/api/package.json', import.meta.url))('pg');
const run = promisify(execFile);
loadEnvFile(new URL('../.env', import.meta.url));
test('purchase Decimal calculations and deterministic freight allocation', async (t) => {
  await t.test('ten chargers with freight cost exactly 195.00', () => {
    const cost = purchaseCost(
      [{ quantity: 10, unitPrice: '18.50', discountAmount: '0.00' }],
      '10.00',
    );
    assert.equal(cost.totalCost, '195.00');
    assert.equal(cost.items[0].landedUnitCost, '19.5000');
  });
  await t.test('discounted net weights and four-decimal unit costs', () => {
    const cost = purchaseCost(
      [
        { quantity: 10, unitPrice: '18.50', discountAmount: '5.00' },
        { quantity: 5, unitPrice: '9.00', discountAmount: '5.00' },
      ],
      '10.00',
    );
    assert.equal(cost.totalCost, '230.00');
    assert.deepEqual(cost.items, [
      { lineNet: '180.00', freightAllocated: '8.18', landedUnitCost: '18.8180' },
      { lineNet: '40.00', freightAllocated: '1.82', landedUnitCost: '8.3640' },
    ]);
  });
  await t.test('all-free lines allocate freight by pieces', () => {
    const cost = purchaseCost(
      [
        { quantity: 1, unitPrice: '0', discountAmount: '0' },
        { quantity: 2, unitPrice: '0', discountAmount: '0' },
      ],
      '1.00',
    );
    assert.equal(cost.totalCost, '1.00');
    assert.deepEqual(
      cost.items.map((r) => r.freightAllocated),
      ['0.33', '0.67'],
    );
  });
  await t.test('last row absorbs cents without negative allocation', () => {
    const cost = purchaseCost(
      Array.from({ length: 8 }, () => ({ quantity: 1, unitPrice: '1.00', discountAmount: '0' })),
      '0.04',
    );
    assert.deepEqual(
      cost.items.map((r) => r.freightAllocated),
      ['0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.04'],
    );
    assert.equal(cost.totalCost, '8.04');
  });
  await t.test('large values and quantities do not lose cents to floating point', () => {
    assert.equal(
      purchaseCost([{ quantity: 1, unitPrice: '9999999999999999.99', discountAmount: '0' }], '0')
        .totalCost,
      '9999999999999999.99',
    );
    assert.equal(
      purchaseCost([{ quantity: 2147483647, unitPrice: '0.01', discountAmount: '0' }], '0.01')
        .totalCost,
      '21474836.48',
    );
  });
  await t.test('invalid discount quantities and aggregate overflow rejected', () => {
    for (const [line, freight] of [
      [{ quantity: 0, unitPrice: '1', discountAmount: '0' }, '0'],
      [{ quantity: 1, unitPrice: '1', discountAmount: '1.01' }, '0'],
      [{ quantity: 2, unitPrice: '9999999999999999.99', discountAmount: '0' }, '0'],
      [{ quantity: 1, unitPrice: '1', discountAmount: '0' }, '-1'],
    ])
      assert.throws(
        () => purchaseCost([line], freight),
        (error) => error.code === 'BUSINESS_VALIDATION_FAILED',
      );
  });
});

test(
  'real purchase workflow, upgrade, states, isolation, concurrency and privacy',
  { timeout: 240000 },
  async (t) => {
    const source = new URL(process.env.DATABASE_URL);
    assert.equal(source.pathname, '/caicang');
    assert.ok(['localhost', '127.0.0.1'].includes(source.hostname));
    const databaseName = 'caicang_test_' + randomUUID().replaceAll('-', '');
    const url = new URL(source);
    url.pathname = '/' + databaseName;
    const admin = new Client({ connectionString: source.toString() }),
      db = new Client({ connectionString: url.toString() });
    let created = false,
      connected = false,
      logs = '',
      counter = 0;
    const cli = fileURLToPath(
      new URL('../apps/api/node_modules/prisma/build/index.js', import.meta.url),
    );
    const options = {
      cwd: fileURLToPath(new URL('../apps/api/', import.meta.url)),
      env: { ...process.env, DATABASE_URL: url.toString() },
      windowsHide: true,
      timeout: 60000,
    };
    const latest = '20261021120000_purchase_order_workflow';
    try {
      await admin.connect();
      assert.match(databaseName, /^caicang_test_[a-f0-9]{32}$/);
      await admin.query(`CREATE DATABASE "${databaseName}"`);
      created = true;
      await db.connect();
      connected = true;
      const oldProject = new URL(
        '../apps/api/.test-build/purchase-upgrade-' + randomUUID() + '/',
        import.meta.url,
      );
      await mkdir(new URL('migrations/', oldProject), { recursive: true });
      for (const entry of await readdir(
        new URL('../apps/api/prisma/migrations/', import.meta.url),
        { withFileTypes: true },
      )) {
        if (entry.name === latest) continue;
        await cp(
          new URL('../apps/api/prisma/migrations/' + entry.name, import.meta.url),
          new URL('migrations/' + entry.name, oldProject),
          { recursive: true },
        );
      }
      const config = new URL('prisma.config.mjs', oldProject);
      await writeFile(
        config,
        `export default {schema:${JSON.stringify(fileURLToPath(new URL('../apps/api/prisma/schema.prisma', import.meta.url)))},migrations:{path:${JSON.stringify(fileURLToPath(new URL('migrations/', oldProject)))}},datasource:{url:process.env.DATABASE_URL}};`,
      );
      await run(
        process.execPath,
        [cli, 'migrate', 'deploy', '--config', fileURLToPath(config)],
        options,
      );
      const legacy = {
        tenant: randomUUID(),
        user: randomUUID(),
        warehouse: randomUUID(),
        product: randomUUID(),
        order: randomUUID(),
        item: randomUUID(),
      };
      await db.query('INSERT INTO tenants(id,name) VALUES($1,$2)', [legacy.tenant, 'legacy']);
      await db.query('INSERT INTO users(id,email,password_hash,display_name) VALUES($1,$2,$3,$4)', [
        legacy.user,
        'legacy@purchase.example.test',
        'unused-fixture',
        'legacy',
      ]);
      await db.query(
        "INSERT INTO tenant_memberships(tenant_id,user_id,role) VALUES($1,$2,'OWNER')",
        [legacy.tenant, legacy.user],
      );
      await db.query(
        "INSERT INTO warehouses(id,tenant_id,code,name) VALUES($1,$2,'OLD','legacy')",
        [legacy.warehouse, legacy.tenant],
      );
      await db.query("INSERT INTO products(id,tenant_id,sku,name) VALUES($1,$2,'OLD','legacy')", [
        legacy.product,
        legacy.tenant,
      ]);
      await db.query(
        "INSERT INTO purchase_orders(id,tenant_id,warehouse_id,order_no,platform,created_by) VALUES($1,$2,$3,'OLD-PO','OTHER',$4)",
        [legacy.order, legacy.tenant, legacy.warehouse, legacy.user],
      );
      await db.query(
        'INSERT INTO purchase_order_items(id,tenant_id,purchase_order_id,product_id,quantity,unit_price) VALUES($1,$2,$3,$4,3,2.00)',
        [legacy.item, legacy.tenant, legacy.order, legacy.product],
      );
      const oldOrder = (
        await db.query('SELECT to_jsonb(t) data FROM purchase_orders t WHERE id=$1', [legacy.order])
      ).rows[0].data;
      const oldItem = (
        await db.query('SELECT to_jsonb(t) data FROM purchase_order_items t WHERE id=$1', [
          legacy.item,
        ])
      ).rows[0].data;
      await t.test(
        'tracked migration upgrades existing five-migration data without rewriting history',
        async () => {
          await run(process.execPath, [cli, 'migrate', 'deploy'], options);
          await run(process.execPath, [cli, 'migrate', 'deploy'], options);
          const order = (
            await db.query('SELECT to_jsonb(t) data FROM purchase_orders t WHERE id=$1', [
              legacy.order,
            ])
          ).rows[0].data;
          const item = (
            await db.query('SELECT to_jsonb(t) data FROM purchase_order_items t WHERE id=$1', [
              legacy.item,
            ])
          ).rows[0].data;
          for (const [key, value] of Object.entries(oldOrder)) assert.deepEqual(order[key], value);
          for (const [key, value] of Object.entries(oldItem)) assert.deepEqual(item[key], value);
          assert.equal(order.purchase_date, null);
          assert.equal(item.freight_allocated, null);
          assert.equal(
            (
              await db.query(
                'SELECT count(*)::int n FROM _prisma_migrations WHERE finished_at IS NOT NULL',
              )
            ).rows[0].n,
            6,
          );
        },
      );
      await t.test('production controllers with two API instances', async (http) => {
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
        const accounts = {};
        let a, b, p1, p2, pForeign;
        const read = async (response, status, code) => {
          assert.equal(response.status, status);
          const body = await response.json();
          assert.equal(body.requestId, response.headers.get('x-request-id'));
          if (code) assert.equal(body.error.code, code);
          return body;
        };
        const request = (
          path,
          { actor = 'owner', tenant = a, method = 'GET', body, server = base, headers = {} } = {},
        ) =>
          fetch(server + '/api/v1' + path, {
            method,
            headers: {
              'Content-Type': 'application/json',
              'X-Forwarded-For': `198.19.${Math.floor(++counter / 250)}.${(counter % 250) + 1}`,
              ...(actor && accounts[actor]
                ? { Authorization: 'Bearer ' + accounts[actor].accessToken }
                : {}),
              ...(tenant ? { 'X-Tenant-Id': tenant.tenant.id } : {}),
              ...headers,
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          });
        for (const actor of ['owner', 'buyer', 'admin', 'warehouse', 'viewer', 'outsider']) {
          const email = actor + '@purchase.example.test',
            password = 'PurchaseTests!2026';
          await read(
            await request('/auth/register', {
              actor: null,
              tenant: null,
              method: 'POST',
              body: { email, password },
            }),
            201,
          );
          accounts[actor] = (
            await read(
              await request('/auth/login', {
                actor: null,
                tenant: null,
                method: 'POST',
                body: { email, password },
              }),
              200,
            )
          ).data;
        }
        a = (
          await read(
            await request('/tenants', { tenant: null, method: 'POST', body: { name: 'A采购' } }),
            201,
          )
        ).data;
        b = (
          await read(
            await request('/tenants', { tenant: null, method: 'POST', body: { name: 'B采购' } }),
            201,
          )
        ).data;
        for (const [actor, role] of [
          ['buyer', 'BUYER'],
          ['admin', 'ADMIN'],
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
        const makeProduct = async (sku, extra = {}) =>
          (
            await read(
              await request('/products', { method: 'POST', body: { name: sku, sku }, ...extra }),
              201,
            )
          ).data;
        p1 = await makeProduct('CHARGER-20W');
        p2 = await makeProduct('CABLE-1M');
        pForeign = await makeProduct('B-FOREIGN', { tenant: b });
        const input = (extra = {}) => ({
          platform: 'TAOBAO',
          purchaseDate: '2026-10-21',
          warehouseId: a.defaultWarehouse.id,
          platformOrderNo: 'T20261021',
          supplierName: '测试店铺',
          recipient: {
            name: '收货测试人',
            phone: '13812345678',
            address: '采购测试完整地址-禁止日志记录',
          },
          freightAmount: '10.00',
          remark: '采购私密备注-禁止日志记录',
          items: [{ productId: p1.id, quantity: 10, unitPrice: '18.50', discountAmount: '0.00' }],
          ...extra,
        });
        const create = (body = input(), extra = {}) =>
          request('/purchase-orders', { method: 'POST', body, ...extra });
        const make = async (body = input(), extra = {}) =>
          (await read(await create(body, extra), 201)).data;
        const patch = (id, body, extra = {}) =>
          request('/purchase-orders/' + id, { method: 'PATCH', body, ...extra });
        const action = (id, name, extra = {}) =>
          request(`/purchase-orders/${id}/${name}`, { method: 'POST', body: {}, ...extra });
        const detail = async (id, extra = {}) =>
          (await read(await request('/purchase-orders/' + id, extra), 200)).data;
        const audits = async (id) =>
          (
            await db.query(
              "SELECT action,metadata FROM audit_logs WHERE object_type='purchase_order' AND object_id=$1 ORDER BY created_at,id",
              [id],
            )
          ).rows;
        let order;
        await http.test('draft persists real lines and exact 195.00 total', async () => {
          order = await make(input({ orderNo: 'PO-ACCEPT-195' }));
          assert.equal(order.status, 'DRAFT');
          assert.equal(order.totalCost, '195.00');
          assert.equal(order.items[0].landedUnitCost, null);
          assert.equal(order.items[0].freightAllocated, null);
          assert.equal(order.purchaseDate, '2026-10-21');
          assert.equal((await detail(order.id)).totalCost, '195.00');
          assert.equal(
            (
              await db.query(
                'SELECT count(*)::int n FROM purchase_order_items WHERE purchase_order_id=$1',
                [order.id],
              )
            ).rows[0].n,
            1,
          );
        });
        await http.test(
          'draft edits retain kept line IDs and replace only requested items',
          async () => {
            const kept = order.items[0].id;
            order = (
              await read(
                await patch(order.id, {
                  items: [
                    { productId: p2.id, quantity: 5, unitPrice: '9.00', discountAmount: '5.00' },
                    { productId: p1.id, quantity: 10, unitPrice: '18.50', discountAmount: '5.00' },
                  ],
                  supplierName: '多SKU店铺',
                }),
                200,
              )
            ).data;
            assert.equal(order.totalCost, '230.00');
            assert.equal(order.items[1].id, kept);
            assert.equal(order.items[0].lineNo, 1);
            const same = (
              await read(
                await patch(order.id, {
                  items: order.items.map((row) => ({
                    productId: row.productId,
                    quantity: row.quantity,
                    unitPrice: row.unitPrice,
                    discountAmount: row.discountAmount,
                  })),
                  supplierName: '多SKU店铺',
                }),
                200,
              )
            ).data;
            assert.equal(same.updatedAt, order.updatedAt);
            assert.equal((await audits(order.id)).length, 2);
          },
        );
        await http.test(
          'place freezes quantity prices allocation snapshots and is idempotent',
          async () => {
            order = (await read(await action(order.id, 'place'), 200)).data;
            assert.equal(order.status, 'PLACED');
            assert.ok(order.placedAt);
            assert.deepEqual(
              order.items.map((row) => row.freightAllocated),
              ['1.81', '8.19'],
            );
            const repeated = (await read(await action(order.id, 'place', { server: second }), 200))
              .data;
            assert.deepEqual(repeated, order);
            assert.equal(
              (await audits(order.id)).filter((row) => row.action === 'PURCHASE_ORDER_PLACED')
                .length,
              1,
            );
            for (const body of [
              { remark: '更改' },
              { items: [{ productId: p1.id, quantity: 1, unitPrice: '0' }] },
              { freightAmount: '0.00' },
            ])
              await read(await patch(order.id, body), 409, 'STATUS_CONFLICT');
          },
        );
        await http.test(
          'master product edits cannot alter frozen SKU quantity or original price',
          async () => {
            await read(
              await request('/products/' + p1.id, {
                method: 'PATCH',
                body: { sku: 'CHARGER-NEW', name: '新主数据', referencePurchasePrice: '99.99' },
              }),
              200,
            );
            const found = await detail(order.id);
            assert.equal(found.items[1].sku, 'CHARGER-20W');
            assert.equal(found.items[1].unitPrice, '18.50');
            assert.equal(found.totalCost, '230.00');
          },
        );
        await http.test('acceptance order places with 195.00 and 19.5000 unit cost', async () => {
          const accepted = await make();
          const placed = (await read(await action(accepted.id, 'place'), 200)).data;
          assert.equal(placed.totalCost, '195.00');
          assert.equal(placed.items[0].landedUnitCost, '19.5000');
          assert.equal(
            (
              await db.query(
                'SELECT landed_unit_cost::text cost FROM purchase_order_items WHERE purchase_order_id=$1',
                [accepted.id],
              )
            ).rows[0].cost,
            '19.5000',
          );
        });
        await http.test(
          'cancel draft or unreceived placed preserves rows and is idempotent',
          async () => {
            for (const placed of [false, true]) {
              const po = await make();
              if (placed) await read(await action(po.id, 'place'), 200);
              const cancelled = (await read(await action(po.id, 'cancel'), 200)).data;
              assert.equal(cancelled.status, 'CANCELLED');
              assert.equal(cancelled.items.length, 1);
              assert.equal(
                (await read(await action(po.id, 'cancel'), 200)).data.updatedAt,
                cancelled.updatedAt,
              );
              await read(await action(po.id, 'place'), 409, 'STATUS_CONFLICT');
              await read(await patch(po.id, { remark: 'x' }), 409, 'STATUS_CONFLICT');
              assert.equal(
                (await audits(po.id)).filter((row) => row.action === 'PURCHASE_ORDER_CANCELLED')
                  .length,
                1,
              );
            }
          },
        );
        await http.test(
          'explicit draft line removal preserves the remaining line and its UUID',
          async () => {
            const po = await make(
              input({
                items: [
                  { productId: p1.id, quantity: 1, unitPrice: '1' },
                  { productId: p2.id, quantity: 2, unitPrice: '2' },
                ],
              }),
            );
            const edited = (
              await read(
                await patch(po.id, { items: [{ productId: p2.id, quantity: 3, unitPrice: '2' }] }),
                200,
              )
            ).data;
            assert.equal(edited.items.length, 1);
            assert.equal(edited.items[0].id, po.items[1].id);
            assert.equal(edited.totalCost, '16.00');
            assert.equal(
              (
                await db.query(
                  'SELECT count(*)::int n FROM purchase_order_items WHERE purchase_order_id=$1',
                  [po.id],
                )
              ).rows[0].n,
              1,
            );
          },
        );
        await http.test(
          'literal null text and actual null remain distinct during draft updates',
          async () => {
            const fields = { supplierName: null, platformOrderNo: null, remark: null };
            const po = await make(input(fields));
            const literal = (
              await read(
                await patch(po.id, {
                  supplierName: 'null',
                  platformOrderNo: 'null',
                  remark: 'null',
                }),
                200,
              )
            ).data;
            for (const field of Object.keys(fields)) assert.equal(literal[field], 'null');
            const cleared = (await read(await patch(po.id, fields), 200)).data;
            for (const field of Object.keys(fields)) assert.equal(cleared[field], null);
            assert.equal(
              (await read(await patch(po.id, fields), 200)).data.updatedAt,
              cleared.updatedAt,
            );
            assert.equal((await audits(po.id)).length, 3);
          },
        );
        await http.test('duplicate order number on PATCH rolls back header and lines', async () => {
          const po = await make();
          const original = await detail(po.id);
          await read(
            await patch(po.id, {
              orderNo: 'PO-ACCEPT-195',
              items: [{ productId: p2.id, quantity: 1, unitPrice: '1' }],
            }),
            409,
            'PURCHASE_ORDER_NO_ALREADY_EXISTS',
          );
          assert.deepEqual(await detail(po.id), original);
        });
        await http.test(
          'all-free multiple SKUs persist piece-weighted freight with exact final cents',
          async () => {
            const po = await make(
              input({
                freightAmount: '1.00',
                items: [
                  { productId: p1.id, quantity: 1, unitPrice: '0' },
                  { productId: p2.id, quantity: 2, unitPrice: '0' },
                ],
              }),
            );
            const placed = (await read(await action(po.id, 'place'), 200)).data;
            assert.deepEqual(
              placed.items.map((row) => row.freightAllocated),
              ['0.33', '0.67'],
            );
            assert.equal(placed.totalCost, '1.00');
          },
        );
        await http.test(
          'any receipt record blocks cancellation even if order status remains PLACED',
          async () => {
            const po = await make();
            await read(await action(po.id, 'place'), 200);
            const pkg = randomUUID(),
              receipt = randomUUID();
            await db.query(
              'INSERT INTO packages(id,tenant_id,purchase_order_id) VALUES($1,$2,$3)',
              [pkg, a.tenant.id, po.id],
            );
            await db.query(
              "INSERT INTO receipts(id,tenant_id,warehouse_id,package_id,purchase_order_id,receipt_no,client_operation_id,request_hash,received_by) VALUES($1,$2,$3,$4,$5,'TEST-RECEIPT',$6,$7,$8)",
              [
                receipt,
                a.tenant.id,
                a.defaultWarehouse.id,
                pkg,
                po.id,
                randomUUID(),
                'a'.repeat(64),
                accounts.warehouse.user.id,
              ],
            );
            await read(await action(po.id, 'cancel'), 409, 'STATUS_CONFLICT');
            await db.query(
              'INSERT INTO receipt_items(tenant_id,receipt_id,purchase_order_item_id,purchase_order_id,product_id,quantity,landed_unit_cost) VALUES($1,$2,$3,$4,$5,4,19.5000)',
              [a.tenant.id, receipt, po.items[0].id, po.id, p1.id],
            );
            assert.equal((await detail(po.id)).items[0].receivedQuantity, 4);
            await db.query("UPDATE purchase_orders SET status='PARTIAL_RECEIVED' WHERE id=$1", [
              po.id,
            ]);
            for (const operation of [
              () => action(po.id, 'cancel'),
              () => action(po.id, 'place'),
              () => patch(po.id, { remark: 'x' }),
            ])
              await read(await operation(), 409, 'STATUS_CONFLICT');
            await db.query("UPDATE purchase_orders SET status='RECEIVED' WHERE id=$1", [po.id]);
            await read(await action(po.id, 'cancel'), 409, 'STATUS_CONFLICT');
          },
        );
        await http.test(
          'draft with package links cannot replace referenced lines or place',
          async () => {
            const po = await make();
            await db.query('INSERT INTO packages(tenant_id,purchase_order_id) VALUES($1,$2)', [
              a.tenant.id,
              po.id,
            ]);
            await read(
              await patch(po.id, { items: [{ productId: p2.id, quantity: 1, unitPrice: '1' }] }),
              409,
              'STATUS_CONFLICT',
            );
            await read(await action(po.id, 'place'), 409, 'STATUS_CONFLICT');
          },
        );
        await http.test(
          'validation rejects malformed input unknown fields and client computed values',
          async () => {
            for (const extra of [
              { purchaseDate: '2026-02-30' },
              { purchaseDate: '0000-01-01' },
              { purchaseDate: null },
              { platform: 'AMAZON' },
              { warehouseId: null },
              { recipient: null },
              { recipient: [] },
              { recipient: { name: 'x', phone: '123', address: 'a', tenantId: a.tenant.id } },
              { status: 'PLACED' },
              { createdBy: accounts.owner.user.id },
              { totalCost: '0' },
              { items: [] },
              { items: [{ productId: 123, quantity: 1, unitPrice: '1' }] },
              { items: [{ productId: p1.id, quantity: 0, unitPrice: '1' }] },
              { items: [{ productId: p1.id, quantity: 1.5, unitPrice: '1' }] },
              { items: [{ productId: p1.id, quantity: 2147483648, unitPrice: '1' }] },
              { items: [{ productId: p1.id, quantity: 1, unitPrice: 18.5 }] },
              { items: [{ productId: p1.id, quantity: 1, unitPrice: 'NaN' }] },
              { items: [{ productId: p1.id, quantity: 1, unitPrice: '1.001' }] },
              { freightAmount: '1e2' },
              { freightAmount: null },
              { recipient: { name: 'x', phone: '<script>', address: 'a' } },
            ])
              await read(await create(input(extra)), 400, 'VALIDATION_ERROR');
            await read(
              await create(
                input({
                  items: [
                    { productId: p1.id, quantity: 1, unitPrice: '1' },
                    { productId: p1.id.toUpperCase(), quantity: 1, unitPrice: '1' },
                  ],
                }),
              ),
              400,
              'VALIDATION_ERROR',
            );
            const draft = await make();
            await read(await patch(draft.id, {}), 400, 'BAD_REQUEST');
            await read(await patch(draft.id, { warehouseId: null }), 400, 'VALIDATION_ERROR');
            await read(
              await action(draft.id, 'place', { body: { unitPrice: '0' } }),
              400,
              'BAD_REQUEST',
            );
          },
        );
        await http.test(
          'discount greater than gross and aggregate overflow leave no partial orders',
          async () => {
            const before = (await db.query('SELECT count(*)::int n FROM purchase_orders')).rows[0]
              .n;
            await read(
              await create(
                input({
                  items: [
                    { productId: p1.id, quantity: 1, unitPrice: '1', discountAmount: '1.01' },
                  ],
                }),
              ),
              422,
              'BUSINESS_VALIDATION_FAILED',
            );
            await read(
              await create(
                input({
                  items: [{ productId: p1.id, quantity: 2, unitPrice: '9999999999999999.99' }],
                }),
              ),
              422,
              'BUSINESS_VALIDATION_FAILED',
            );
            assert.equal(
              (await db.query('SELECT count(*)::int n FROM purchase_orders')).rows[0].n,
              before,
            );
          },
        );
        await http.test(
          'tenant resources and foreign IDs never leak through any route',
          async () => {
            const foreignPo = await make(
              input({
                warehouseId: b.defaultWarehouse.id,
                items: [{ productId: pForeign.id, quantity: 1, unitPrice: '1' }],
              }),
              { tenant: b },
            );
            await read(await request('/purchase-orders/' + foreignPo.id), 404, 'NOT_FOUND');
            await read(await patch(foreignPo.id, { remark: 'x' }), 404, 'NOT_FOUND');
            await read(await action(foreignPo.id, 'place'), 404, 'NOT_FOUND');
            await read(await action(foreignPo.id, 'cancel'), 404, 'NOT_FOUND');
            await read(
              await create(input({ warehouseId: b.defaultWarehouse.id })),
              404,
              'NOT_FOUND',
            );
            await read(
              await create(
                input({ items: [{ productId: pForeign.id, quantity: 1, unitPrice: '1' }] }),
              ),
              404,
              'NOT_FOUND',
            );
            await read(await request('/purchase-orders', { actor: 'outsider' }), 403, 'FORBIDDEN');
            await read(await request('/purchase-orders', { actor: null }), 401, 'UNAUTHENTICATED');
            await read(
              await request('/purchase-orders', { tenant: null }),
              400,
              'INVALID_TENANT_HEADER',
            );
            assert.equal(
              (
                await read(
                  await request('/purchase-orders?warehouseId=' + b.defaultWarehouse.id),
                  200,
                )
              ).pagination.total,
              0,
            );
          },
        );
        await http.test(
          'all five roles read but only owner admin buyer write; VIEWER data is masked',
          async () => {
            for (const actor of ['owner', 'admin', 'buyer', 'warehouse', 'viewer']) {
              const found = await detail(order.id, { actor });
              assert.equal(found.id, order.id);
              if (actor === 'viewer') {
                assert.equal(found.recipientMasked, true);
                assert.equal(found.recipient.address, '[已隐藏]');
                assert.equal(found.remark, null);
              } else assert.equal(found.recipient.address, input().recipient.address);
            }
            for (const actor of ['admin', 'buyer']) await make(input(), { actor });
            for (const actor of ['warehouse', 'viewer']) {
              await read(await create(input(), { actor }), 403, 'FORBIDDEN');
              await read(await patch(order.id, { remark: 'x' }, { actor }), 403, 'FORBIDDEN');
              await read(await action(order.id, 'place', { actor }), 403, 'FORBIDDEN');
              await read(await action(order.id, 'cancel', { actor }), 403, 'FORBIDDEN');
            }
            const list = await read(await request('/purchase-orders', { actor: 'viewer' }), 200);
            assert.equal(JSON.stringify(list).includes(input().recipient.phone), false);
            assert.equal(JSON.stringify(list).includes(input().recipient.address), false);
            assert.equal(JSON.stringify(list).includes(input().remark), false);
          },
        );
        await http.test(
          'inactive products or warehouses are rejected at creation and again at place',
          async () => {
            const inactive = await makeProduct('INACTIVE'),
              draft = await make(
                input({ items: [{ productId: inactive.id, quantity: 1, unitPrice: '1' }] }),
              );
            await read(
              await request('/products/' + inactive.id, {
                method: 'PATCH',
                body: { isActive: false },
              }),
              200,
            );
            await read(
              await create(
                input({ items: [{ productId: inactive.id, quantity: 1, unitPrice: '1' }] }),
              ),
              422,
              'BUSINESS_VALIDATION_FAILED',
            );
            await read(await action(draft.id, 'place'), 422, 'BUSINESS_VALIDATION_FAILED');
            const po = await make();
            await db.query('UPDATE warehouses SET is_active=false WHERE id=$1', [
              a.defaultWarehouse.id,
            ]);
            try {
              await read(await create(), 422, 'BUSINESS_VALIDATION_FAILED');
              await read(await action(po.id, 'place'), 422, 'BUSINESS_VALIDATION_FAILED');
            } finally {
              await db.query('UPDATE warehouses SET is_active=true WHERE id=$1', [
                a.defaultWarehouse.id,
              ]);
            }
          },
        );
        await http.test(
          'list search stable pagination and filters use current tenant totals',
          async () => {
            for (let i = 0; i < 12; i++)
              await make(input({ orderNo: 'PAGE-PO-' + i, supplierName: 'Literal_%+ shop' }));
            const first = await read(
                await request('/purchase-orders?search=PAGE-PO-&pageSize=10'),
                200,
              ),
              next = await read(
                await request('/purchase-orders?search=PAGE-PO-&pageSize=10&page=2'),
                200,
              );
            assert.equal(first.pagination.total, 12);
            assert.equal(next.data.length, 2);
            assert.equal(new Set([...first.data, ...next.data].map((r) => r.id)).size, 12);
            assert.equal(
              (
                await read(
                  await request('/purchase-orders?search=' + encodeURIComponent('_%+')),
                  200,
                )
              ).pagination.total,
              12,
            );
            assert.ok(
              (
                await read(await request('/purchase-orders?status=PLACED&platform=TAOBAO'), 200)
              ).data.every((row) => row.status === 'PLACED' && row.platform === 'TAOBAO'),
            );
            for (const query of [
              'page=0',
              'pageSize=101',
              'status=UNKNOWN',
              'tenantId=' + b.tenant.id,
              'search=',
              'warehouseId=invalid',
            ])
              await read(await request('/purchase-orders?' + query), 400, 'VALIDATION_ERROR');
          },
        );
        await http.test(
          'concurrent duplicate order numbers across API processes create once',
          async () => {
            const body = input({ orderNo: 'CONCURRENT-PO' });
            const replies = await Promise.all([create(body), create(body, { server: second })]);
            assert.deepEqual(replies.map((r) => r.status).sort(), [201, 409]);
            for (const r of replies)
              await read(
                r,
                r.status,
                r.status === 409 ? 'PURCHASE_ORDER_NO_ALREADY_EXISTS' : undefined,
              );
            assert.equal(
              (
                await db.query(
                  "SELECT count(*)::int n FROM purchase_orders WHERE tenant_id=$1 AND order_no='CONCURRENT-PO'",
                  [a.tenant.id],
                )
              ).rows[0].n,
              1,
            );
            await make(
              input({
                orderNo: 'CONCURRENT-PO',
                warehouseId: b.defaultWarehouse.id,
                items: [{ productId: pForeign.id, quantity: 1, unitPrice: '1' }],
              }),
              { tenant: b },
            );
          },
        );
        await http.test(
          'concurrent place calls freeze once and keep one audit timestamp',
          async () => {
            const po = await make();
            const results = await Promise.all([
              action(po.id, 'place'),
              action(po.id, 'place', { server: second }),
            ]);
            const bodies = await Promise.all(results.map((r) => read(r, 200)));
            assert.deepEqual(bodies[0].data, bodies[1].data);
            assert.equal(
              (await audits(po.id)).filter((r) => r.action === 'PURCHASE_ORDER_PLACED').length,
              1,
            );
          },
        );
        await http.test('edit and place race never edits an already placed order', async () => {
          const po = await make();
          const [edit, place] = await Promise.all([
            patch(po.id, { freightAmount: '20.00' }),
            action(po.id, 'place', { server: second }),
          ]);
          await read(place, 200);
          assert.ok([200, 409].includes(edit.status));
          await read(edit, edit.status, edit.status === 409 ? 'STATUS_CONFLICT' : undefined);
          const found = await detail(po.id);
          assert.equal(found.status, 'PLACED');
          assert.equal(found.totalCost, edit.status === 200 ? '205.00' : '195.00');
        });
        await http.test(
          'place and cancel race has one final CANCELLED state and no repeated side effects',
          async () => {
            const po = await make();
            const [place, cancel] = await Promise.all([
              action(po.id, 'place'),
              action(po.id, 'cancel', { server: second }),
            ]);
            await read(cancel, 200);
            assert.ok([200, 409].includes(place.status));
            await read(place, place.status, place.status === 409 ? 'STATUS_CONFLICT' : undefined);
            assert.equal((await detail(po.id)).status, 'CANCELLED');
          },
        );
        await http.test(
          'audit failure rolls back create edit place and cancel atomically',
          async () => {
            const draft = await make();
            const initial = await detail(draft.id),
              count = (await db.query('SELECT count(*)::int n FROM purchase_orders')).rows[0].n;
            await db.query(
              "CREATE FUNCTION reject_purchase_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action LIKE 'PURCHASE_ORDER_%' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER reject_purchase_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_purchase_audit()",
            );
            try {
              await read(await create(), 500, 'INTERNAL_ERROR');
              await read(
                await patch(draft.id, {
                  freightAmount: '20.00',
                  items: [{ productId: p2.id, quantity: 5, unitPrice: '4' }],
                }),
                500,
                'INTERNAL_ERROR',
              );
              assert.deepEqual(await detail(draft.id), initial);
              await read(await action(draft.id, 'place'), 500, 'INTERNAL_ERROR');
              assert.deepEqual(await detail(draft.id), initial);
              await read(await action(draft.id, 'cancel'), 500, 'INTERNAL_ERROR');
              assert.deepEqual(await detail(draft.id), initial);
              assert.equal(
                (await db.query('SELECT count(*)::int n FROM purchase_orders')).rows[0].n,
                count,
              );
            } finally {
              await db.query(
                'DROP TRIGGER reject_purchase_audit ON audit_logs; DROP FUNCTION reject_purchase_audit()',
              );
            }
          },
        );
        await http.test(
          'write authorization is rechecked after waiting for tenant lock',
          async () => {
            const po = await make();
            await db.query('BEGIN');
            let settled = false;
            let pending;
            try {
              await db.query('SELECT id FROM tenants WHERE id=$1 FOR UPDATE', [a.tenant.id]);
              pending = patch(
                po.id,
                { remark: 'must refuse' },
                { actor: 'buyer', server: second },
              ).then((r) => {
                settled = true;
                return r;
              });
              await delay(150);
              assert.equal(settled, false);
              await db.query(
                "UPDATE tenant_memberships SET role='VIEWER' WHERE tenant_id=$1 AND user_id=$2",
                [a.tenant.id, accounts.buyer.user.id],
              );
              await db.query('COMMIT');
              await read(await pending, 403, 'FORBIDDEN');
            } catch (error) {
              await db.query('ROLLBACK');
              throw error;
            }
          },
        );
        await http.test(
          'OpenAPI documents all routes and no business/log data is fabricated',
          async () => {
            const spec = await (await fetch(base + '/api/docs-json')).json();
            for (const [path, method] of [
              ['/api/v1/purchase-orders', 'get'],
              ['/api/v1/purchase-orders', 'post'],
              ['/api/v1/purchase-orders/{id}', 'get'],
              ['/api/v1/purchase-orders/{id}', 'patch'],
              ['/api/v1/purchase-orders/{id}/place', 'post'],
              ['/api/v1/purchase-orders/{id}/cancel', 'post'],
            ])
              assert.ok(spec.paths[path][method]);
            const metadata = JSON.stringify(
              (await db.query("SELECT metadata FROM audit_logs WHERE object_type='purchase_order'"))
                .rows,
            );
            for (const secret of [
              input().recipient.name,
              input().recipient.phone,
              input().recipient.address,
              input().remark,
              'PurchaseTests!2026',
              accounts.owner.accessToken,
              accounts.owner.refreshToken,
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
      if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
      await admin.end();
    }
  },
);
