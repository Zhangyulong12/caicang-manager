import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { loadEnvFile } from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { startTestApi } from './api-test-server.mjs';

const requireApi = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { Client } = requireApi('pg');
const runFile = promisify(execFile);
loadEnvFile(new URL('../.env', import.meta.url));

test(
  'real product API, tenant isolation, unique codes, precise prices and historical purchase preservation',
  { timeout: 180000 },
  async (t) => {
    const source = new URL(process.env.DATABASE_URL);
    assert.ok(['localhost', '127.0.0.1'].includes(source.hostname));
    assert.equal(source.pathname, '/caicang');
    const databaseName = `caicang_test_${randomUUID().replaceAll('-', '')}`;
    const url = new URL(source);
    url.pathname = `/${databaseName}`;
    const admin = new Client({ connectionString: source.toString() });
    const db = new Client({ connectionString: url.toString() });
    const secret = randomBytes(48).toString('hex');
    const password = 'ProductsTests!2026';
    const settings = {
      DATABASE_URL: url.toString(),
      NODE_ENV: 'test',
      JWT_ACCESS_SECRET: secret,
      TRUSTED_PROXIES: '127.0.0.1/32,::1/128',
    };
    const accounts = {};
    let created = false,
      connected = false,
      logs = '',
      counter = 0,
      a,
      b,
      product,
      foreign,
      buyerMembership,
      persisted;
    const read = async (response, status, code) => {
      assert.equal(response.status, status);
      const body = await response.json();
      assert.equal(body.requestId, response.headers.get('x-request-id'));
      if (code) {
        assert.equal(body.error.code, code);
        assert.deepEqual(body.error.details, {});
      }
      return body;
    };
    try {
      await admin.connect();
      assert.match(databaseName, /^caicang_test_[a-f0-9]{32}$/);
      await admin.query(`CREATE DATABASE "${databaseName}"`);
      created = true;
      await runFile(
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
      await t.test('production controllers with real database', async (http) => {
        const base = await startTestApi(http, {
          env: settings,
          onOutput: (chunk) => {
            logs += chunk;
          },
        });
        const second = await startTestApi(http, {
          env: settings,
          onOutput: (chunk) => {
            logs += chunk;
          },
        });
        const request = (
          path,
          { actor = 'ownerA', tenant = a, method = 'GET', body, server = base, headers = {} } = {},
        ) =>
          fetch(`${server}/api/v1${path}`, {
            method,
            headers: {
              'Content-Type': 'application/json',
              'X-Forwarded-For': `198.19.${Math.floor(++counter / 250)}.${(counter % 250) + 1}`,
              ...(actor && accounts[actor]
                ? { Authorization: `Bearer ${accounts[actor].accessToken}` }
                : {}),
              ...(tenant ? { 'X-Tenant-Id': tenant.tenant.id } : {}),
              ...headers,
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          });
        const create = (body, extra = {}) =>
          request('/products', { method: 'POST', body, ...extra });
        const patch = (id, body, extra = {}) =>
          request(`/products/${id}`, { method: 'PATCH', body, ...extra });
        const lookup = (code, extra = {}) =>
          request('/products/lookup?code=' + encodeURIComponent(code), extra);
        const make = async (sku, extra = {}) =>
          (await read(await create({ name: sku, sku, ...extra }), 201)).data;
        const auditCount = async () =>
          (
            await db.query(
              "SELECT count(*)::int AS n FROM audit_logs WHERE action LIKE 'PRODUCT_%'",
            )
          ).rows[0].n;
        for (const actor of [
          'ownerA',
          'ownerB',
          'admin',
          'buyer',
          'warehouse',
          'viewer',
          'outsider',
        ]) {
          const email = actor.toLowerCase() + '@products.example.com';
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
            await request('/tenants', {
              tenant: null,
              method: 'POST',
              body: { name: '商品商家 A' },
            }),
            201,
          )
        ).data;
        b = (
          await read(
            await request('/tenants', {
              actor: 'ownerB',
              tenant: null,
              method: 'POST',
              body: { name: '商品商家 B' },
            }),
            201,
          )
        ).data;
        for (const [actor, role] of [
          ['admin', 'ADMIN'],
          ['buyer', 'BUYER'],
          ['warehouse', 'WAREHOUSE'],
          ['viewer', 'VIEWER'],
        ]) {
          const member = (
            await read(
              await request('/members', {
                method: 'POST',
                body: { email: accounts[actor].user.email, role },
              }),
              201,
            )
          ).data;
          if (actor === 'buyer') buyerMembership = member;
        }

        await http.test(
          'anonymous, missing-tenant and nonmember requests fail before accessing products',
          async () => {
            for (const [path, method, body] of [
              ['/products', 'GET'],
              ['/products', 'POST', { name: 'x', sku: 'x' }],
              [`/products/${randomUUID()}`, 'GET'],
              [`/products/${randomUUID()}`, 'PATCH', { name: 'x' }],
              ['/products/lookup?code=x', 'GET'],
            ])
              await read(
                await request(path, { actor: null, method, body }),
                401,
                'UNAUTHENTICATED',
              );
            await read(await request('/products', { tenant: null }), 400, 'INVALID_TENANT_HEADER');
            await read(
              await request('/products', { actor: 'outsider', headers: { 'X-Role': 'OWNER' } }),
              403,
              'FORBIDDEN',
            );
          },
        );
        await http.test(
          'create 20W charger persists all eight fields and returns decimal strings',
          async () => {
            const requestId = randomUUID();
            product = (
              await read(
                await create(
                  {
                    name: ' 20W 充电器 ',
                    sku: ' CHARGER-20W ',
                    specification: ' USB-C PD，白色 ',
                    unit: ' 个 ',
                    barcode: ' 0001234567890 ',
                    referencePurchasePrice: '18.50',
                    isActive: true,
                    remark: ' 支持 PD 快充 ',
                  },
                  { headers: { 'X-Request-Id': requestId } },
                ),
                201,
              )
            ).data;
            assert.deepEqual(Object.keys(product).sort(), [
              'articleNo',
              'barcode',
              'color',
              'createdAt',
              'id',
              'isActive',
              'name',
              'referencePurchasePrice',
              'remark',
              'size',
              'sku',
              'specification',
              'tenantId',
              'unit',
              'updatedAt',
            ]);
            // 新属性可空：没填就是 null，不写空字符串。
            assert.equal(product.articleNo, null);
            assert.equal(product.color, null);
            assert.equal(product.size, null);
            assert.equal(product.name, '20W 充电器');
            assert.equal(product.sku, 'CHARGER-20W');
            assert.equal(product.referencePurchasePrice, '18.50');
            assert.equal(product.barcode, '0001234567890');
            assert.equal(product.specification, 'USB-C PD，白色');
            assert.equal(product.remark, '支持 PD 快充');
            assert.equal(product.tenantId, a.tenant.id);
            const saved = (
              await db.query(
                'SELECT reference_purchase_price::text,barcode,remark FROM products WHERE id=$1',
                [product.id],
              )
            ).rows[0];
            assert.equal(saved.reference_purchase_price, '18.50');
            assert.equal(saved.barcode, '0001234567890');
            const audit = (
              await db.query(
                "SELECT * FROM audit_logs WHERE action='PRODUCT_CREATED' AND object_id=$1",
                [product.id],
              )
            ).rows[0];
            assert.equal(audit.metadata.requestId, requestId);
            assert.equal(audit.actor_id, accounts.ownerA.user.id);
          },
        );
        await http.test(
          'name is optional and follows 货号 颜色 尺码 until a custom name is set',
          async () => {
            const auto = (
              await read(
                await create({ articleNo: 'T20', color: '黑色', size: 'L', sku: 'T20-BLK-L' }),
                201,
              )
            ).data;
            assert.equal(auto.name, 'T20 黑色 L');
            // 没有任何属性时用 SKU 兜底，名称永远不为空。
            const bare = (await read(await create({ sku: 'BARE-SKU' }), 201)).data;
            assert.equal(bare.name, 'BARE-SKU');
            const recolored = (await read(await patch(auto.id, { color: '白色' }), 200)).data;
            assert.equal(recolored.name, 'T20 白色 L');
            // 用户自己写的名称不跟着属性变。
            const custom = (await read(await patch(auto.id, { name: '黑标经典款' }), 200)).data;
            assert.equal(
              (await read(await patch(custom.id, { size: 'XL' }), 200)).data.name,
              '黑标经典款',
            );
            // 传空字符串表示改回自动生成。
            assert.equal(
              (await read(await patch(custom.id, { name: '' }), 200)).data.name,
              'T20 白色 XL',
            );
            // 属性全清空后回落到 SKU。
            assert.equal(
              (
                await read(
                  await patch(custom.id, { articleNo: null, color: null, size: null }),
                  200,
                )
              ).data.name,
              'T20-BLK-L',
            );
            assert.equal(
              (await read(await request('/products/' + custom.id), 200)).data.name,
              'T20-BLK-L',
            );
          },
        );
        await http.test(
          'duplicate SKU is a standard 409 without creating product or audit',
          async () => {
            const before = await auditCount();
            const body = await read(
              await create({ name: '另一个充电器', sku: '  CHARGER-20W ' }),
              409,
              'PRODUCT_SKU_ALREADY_EXISTS',
            );
            assert.equal(JSON.stringify(body).includes('products_tenant'), false);
            assert.equal(await auditCount(), before);
            assert.equal(
              (
                await db.query(
                  'SELECT count(*)::int AS n FROM products WHERE tenant_id=$1 AND sku=$2',
                  [a.tenant.id, 'CHARGER-20W'],
                )
              ).rows[0].n,
              1,
            );
          },
        );
        await http.test(
          'nonempty barcode uniqueness is enforced separately in the database',
          async () => {
            await read(
              await create({ name: '相同条码', sku: 'OTHER-CHARGER', barcode: product.barcode }),
              409,
              'PRODUCT_BARCODE_ALREADY_EXISTS',
            );
            await assert.rejects(
              () =>
                db.query('INSERT INTO products(tenant_id,sku,name,barcode) VALUES($1,$2,$3,$4)', [
                  a.tenant.id,
                  'SQL-DUP',
                  'SQL duplicate',
                  product.barcode,
                ]),
              (e) => e.code === '23505',
            );
          },
        );
        await http.test('another merchant can use exactly the same SKU and barcode', async () => {
          foreign = (
            await read(
              await create(
                {
                  name: 'B 私有商品',
                  sku: product.sku,
                  barcode: product.barcode,
                  referencePurchasePrice: '99.99',
                },
                { actor: 'ownerB', tenant: b },
              ),
              201,
            )
          ).data;
          assert.equal(foreign.sku, product.sku);
          assert.notEqual(foreign.id, product.id);
          const aResult = await read(await lookup(product.sku), 200);
          assert.deepEqual(
            aResult.data.map((p) => p.id),
            [product.id],
          );
          const bResult = await read(
            await lookup(product.sku, { actor: 'ownerB', tenant: b }),
            200,
          );
          assert.deepEqual(
            bResult.data.map((p) => p.id),
            [foreign.id],
          );
        });
        await http.test(
          'details and updates never leak or modify another merchant product',
          async () => {
            const denied = await read(await request(`/products/${foreign.id}`), 404, 'NOT_FOUND');
            const missing = await read(
              await request(`/products/${randomUUID()}`),
              404,
              'NOT_FOUND',
            );
            assert.deepEqual(denied.error, missing.error);
            await read(
              await patch(foreign.id, { name: 'intruder', referencePurchasePrice: '0' }),
              404,
              'NOT_FOUND',
            );
            await read(
              await request(`/products/${product.id}`, { actor: 'ownerB', tenant: b }),
              404,
              'NOT_FOUND',
            );
            assert.equal(JSON.stringify(denied).includes('B 私有商品'), false);
            assert.equal(
              (
                await db.query(
                  'SELECT name,reference_purchase_price::text FROM products WHERE id=$1',
                  [foreign.id],
                )
              ).rows[0].reference_purchase_price,
              '99.99',
            );
          },
        );
        await http.test(
          'lookup matches SKU or barcode exactly, preserves leading zero and does not fall into :id',
          async () => {
            for (const code of ['CHARGER-20W', '0001234567890', '  CHARGER-20W  '])
              assert.deepEqual(
                (await read(await lookup(code), 200)).data.map((p) => p.id),
                [product.id],
              );
            for (const code of ['1234567890', 'charger-20w', 'UNKNOWN-CODE', "' OR 1=1 --"]) {
              const body = await read(await lookup(code), 200);
              assert.deepEqual(body.data, []);
              assert.equal(body.pagination, undefined);
            }
          },
        );
        await http.test(
          'all five roles can list, inspect and look up their own merchant products',
          async () => {
            for (const actor of ['ownerA', 'admin', 'buyer', 'warehouse', 'viewer']) {
              assert.equal(
                (await read(await request(`/products/${product.id}`, { actor }), 200)).data.id,
                product.id,
              );
              assert.ok(
                (await read(await request('/products', { actor }), 200)).data.some(
                  (p) => p.id === product.id,
                ),
              );
              assert.deepEqual(
                (await read(await lookup(product.sku, { actor }), 200)).data.map((p) => p.id),
                [product.id],
              );
            }
          },
        );
        await http.test(
          'OWNER ADMIN BUYER may write; WAREHOUSE VIEWER cannot create or patch',
          async () => {
            for (const actor of ['ownerA', 'admin', 'buyer']) {
              const made = (
                await read(await create({ name: '角色创建', sku: 'ROLE-' + actor }, { actor }), 201)
              ).data;
              await read(await patch(made.id, { remark: 'updated' }, { actor }), 200);
            }
            const before = await auditCount();
            for (const actor of ['warehouse', 'viewer']) {
              await read(
                await create(
                  { name: 'denied', sku: 'DENIED-' + actor },
                  { actor, headers: { 'X-Role': 'OWNER' } },
                ),
                403,
                'FORBIDDEN',
              );
              await read(
                await patch(product.id, { referencePurchasePrice: '0' }, { actor }),
                403,
                'FORBIDDEN',
              );
            }
            assert.equal(await auditCount(), before);
          },
        );
        await http.test(
          'nullable barcode accepts multiple omitted null and blank values with defaults',
          async () => {
            for (const [sku, barcode] of [
              ['NO-CODE-1', undefined],
              ['NO-CODE-2', null],
              ['NO-CODE-3', '   '],
            ]) {
              const made = await make(sku, { barcode });
              assert.equal(made.barcode, null);
              assert.equal(made.unit, '件');
              assert.equal(made.referencePurchasePrice, null);
              assert.equal(made.specification, null);
              assert.equal(made.remark, null);
              assert.equal(made.isActive, true);
            }
          },
        );
        await http.test(
          'reference prices preserve zero, large exact values and two decimal output',
          async () => {
            for (const [sku, price, expected] of [
              ['FREE', '0', '0.00'],
              ['FRACTION', '0.1', '0.10'],
              ['LARGE', '9999999999999999.99', '9999999999999999.99'],
            ]) {
              const made = await make(sku, { referencePurchasePrice: price });
              assert.equal(made.referencePurchasePrice, expected);
              assert.equal(
                (
                  await db.query(
                    'SELECT reference_purchase_price::text AS price FROM products WHERE id=$1',
                    [made.id],
                  )
                ).rows[0].price,
                expected,
              );
            }
          },
        );
        for (const [label, value] of Object.entries({
          number: 18.5,
          negative: '-1.00',
          precision: '18.501',
          overflow: '10000000000000000.00',
          exponent: '1e2',
          nan: 'NaN',
          infinity: 'Infinity',
          blank: '',
          spaces: ' 1.00 ',
          plus: '+1',
          leadingZero: '01.00',
          object: { value: '1' },
          array: ['1'],
        }))
          await http.test(`create and patch reject invalid reference price ${label}`, async () => {
            for (const response of [
              await create({ name: 'bad', sku: 'BAD-' + label, referencePurchasePrice: value }),
              await patch(product.id, { referencePurchasePrice: value }),
            ]) {
              assert.equal(response.status, 400);
              assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
            }
          });
        await http.test(
          'search covers 货号 颜色 尺码 name SKU barcode and specification without crossing merchants',
          async () => {
            const variant = await make('SEARCH-VARIANT', {
              articleNo: 'ART-9',
              color: '藏青',
              size: 'XXL',
            });
            for (const [search, id] of [
              ['充电器', product.id],
              ['charger-20w', product.id],
              ['0001234567890', product.id],
              ['usb-c', product.id],
              ['art-9', variant.id],
              ['藏青', variant.id],
              ['xxl', variant.id],
            ]) {
              const body = await read(
                await request('/products?search=' + encodeURIComponent(search)),
                200,
              );
              assert.ok(
                body.data.some((p) => p.id === id),
                'search ' + search,
              );
              assert.ok(body.data.every((p) => p.tenantId === a.tenant.id));
              assert.equal(
                body.data.some((p) => p.id === foreign.id),
                false,
              );
            }
          },
        );
        await http.test('LIKE metacharacters in search and lookup are literal values', async () => {
          for (const [sku, name] of [
            ['LIT-PCT', '100% 电源'],
            ['LIT-UND', 'A_B 电源'],
            ['LIT-BACK', 'A\\B 电源'],
          ])
            await make(sku, { name });
          for (const search of ['%', '_', '\\']) {
            const body = await read(
              await request('/products?search=' + encodeURIComponent(search)),
              200,
            );
            assert.equal(body.pagination.total, 1);
            assert.ok(body.data[0].name.includes(search));
          }
          await make('EXACT%CODE');
          assert.equal((await read(await lookup('EXACT%CODE'), 200)).data.length, 1);
          assert.deepEqual((await read(await lookup('EXACT_CODE'), 200)).data, []);
        });
        await http.test('active unit and barcode filters combine correctly', async () => {
          const active = await make('FILTER-A', { unit: '筛选单位', barcode: 'FILTER-001' });
          await make('FILTER-B', { unit: '筛选单位', isActive: false });
          const filtered = await read(
            await request(
              '/products?unit=' + encodeURIComponent('筛选单位') + '&isActive=true&hasBarcode=true',
            ),
            200,
          );
          assert.deepEqual(
            filtered.data.map((p) => p.id),
            [active.id],
          );
          const disabled = await read(
            await request(
              '/products?unit=' +
                encodeURIComponent('筛选单位') +
                '&isActive=false&hasBarcode=false',
            ),
            200,
          );
          assert.equal(disabled.data.length, 1);
          assert.equal(disabled.data[0].sku, 'FILTER-B');
          const all = await read(
            await request('/products?unit=' + encodeURIComponent('筛选单位')),
            200,
          );
          assert.equal(all.pagination.total, 2);
        });
        await http.test(
          'stable pagination retains tied timestamps and correct filtered totals',
          async () => {
            const ids = [];
            for (const sku of ['PAGE-1', 'PAGE-2', 'PAGE-3'])
              ids.push((await make(sku, { unit: '分页单位' })).id);
            await db.query(
              "UPDATE products SET created_at='2026-01-01T00:00:00Z' WHERE id=ANY($1::uuid[])",
              [ids],
            );
            const query = 'unit=' + encodeURIComponent('分页单位') + '&pageSize=2';
            const first = await read(await request('/products?' + query + '&page=1'), 200);
            const secondPage = await read(await request('/products?' + query + '&page=2'), 200);
            assert.deepEqual(first.pagination, { page: 1, pageSize: 2, total: 3 });
            assert.deepEqual(
              [...first.data, ...secondPage.data].map((p) => p.id),
              ids.sort().reverse(),
            );
            assert.deepEqual(
              (await read(await request('/products?' + query + '&page=3'), 200)).data,
              [],
            );
          },
        );
        await http.test(
          'PATCH updates only supplied fields and supports nullable clearing without timestamp churn',
          async () => {
            const made = await make('NULLABLE', {
              barcode: 'CLEAR-ME',
              specification: '规格',
              referencePurchasePrice: '12',
              remark: '备注',
            });
            const changed = (
              await read(await patch(made.id, { specification: null, remark: '' }), 200)
            ).data;
            assert.equal(changed.specification, null);
            assert.equal(changed.remark, null);
            assert.equal(changed.referencePurchasePrice, '12.00');
            assert.equal(changed.barcode, 'CLEAR-ME');
            const cleared = (
              await read(await patch(made.id, { barcode: ' ', referencePurchasePrice: null }), 200)
            ).data;
            assert.equal(cleared.barcode, null);
            assert.equal(cleared.referencePurchasePrice, null);
            await make('REUSE-CLEARED-CODE', { barcode: 'CLEAR-ME' });
            const before = await auditCount();
            const noOp = (
              await read(await patch(made.id, { barcode: null, referencePurchasePrice: null }), 200)
            ).data;
            assert.equal(noOp.updatedAt, cleared.updatedAt);
            assert.equal(await auditCount(), before);
          },
        );
        await http.test(
          'update unique conflicts roll back all changed fields and audit',
          async () => {
            const made = await make('UPDATE-CONFLICT', { name: 'unchanged', barcode: 'UPDATE-BC' });
            const before = await auditCount();
            await read(
              await patch(made.id, { sku: product.sku, name: 'must rollback' }),
              409,
              'PRODUCT_SKU_ALREADY_EXISTS',
            );
            await read(
              await patch(made.id, { barcode: product.barcode, name: 'must rollback' }),
              409,
              'PRODUCT_BARCODE_ALREADY_EXISTS',
            );
            assert.equal(
              (await read(await request(`/products/${made.id}`), 200)).data.name,
              'unchanged',
            );
            assert.equal(await auditCount(), before);
          },
        );
        await http.test(
          'lookup returns both cross-field candidates and deduplicates same-product matches',
          async () => {
            const one = await make('AMBIGUOUS');
            const two = await make('AMBIGUOUS-OTHER', { barcode: 'AMBIGUOUS' });
            assert.deepEqual(
              (await read(await lookup('AMBIGUOUS'), 200)).data.map((p) => p.id).sort(),
              [one.id, two.id].sort(),
            );
            const same = await make('SAME-CODE', { barcode: 'SAME-CODE' });
            assert.deepEqual(
              (await read(await lookup('SAME-CODE'), 200)).data.map((p) => p.id),
              [same.id],
            );
          },
        );
        await http.test(
          'product edits and disabling preserve real historical purchase prices costs and relationships',
          async () => {
            const order = (
              await db.query(
                "INSERT INTO purchase_orders(tenant_id,warehouse_id,order_no,platform,status,created_by) VALUES($1,$2,'HISTORY-001','JD','PLACED',$3) RETURNING *",
                [a.tenant.id, a.defaultWarehouse.id, accounts.ownerA.user.id],
              )
            ).rows[0];
            const item = (
              await db.query(
                'INSERT INTO purchase_order_items(tenant_id,purchase_order_id,product_id,quantity,unit_price,discount_amount,landed_unit_cost) VALUES($1,$2,$3,2,18.50,1.00,18.0000) RETURNING *',
                [a.tenant.id, order.id, product.id],
              )
            ).rows[0];
            const edited = (
              await read(
                await patch(product.id, {
                  name: '20W 充电器新版',
                  sku: 'CHARGER-20W-V2',
                  referencePurchasePrice: '25.99',
                  isActive: false,
                }),
                200,
              )
            ).data;
            assert.equal(edited.isActive, false);
            assert.equal(edited.referencePurchasePrice, '25.99');
            assert.deepEqual(
              (await db.query('SELECT * FROM purchase_order_items WHERE id=$1', [item.id])).rows[0],
              item,
            );
            assert.deepEqual(
              (await db.query('SELECT * FROM purchase_orders WHERE id=$1', [order.id])).rows[0],
              order,
            );
            assert.equal(
              (await read(await request(`/products/${product.id}`), 200)).data.isActive,
              false,
            );
            assert.deepEqual((await read(await lookup(edited.sku), 200)).data, []);
            assert.deepEqual((await read(await lookup(product.barcode), 200)).data, []);
            await read(
              await create({ name: '停用编码仍占用', sku: edited.sku }),
              409,
              'PRODUCT_SKU_ALREADY_EXISTS',
            );
            await read(
              await create({
                name: '停用条码仍占用',
                sku: 'DISABLED-BC',
                barcode: product.barcode,
              }),
              409,
              'PRODUCT_BARCODE_ALREADY_EXISTS',
            );
            const reactivated = (await read(await patch(product.id, { isActive: true }), 200)).data;
            assert.deepEqual(
              (await read(await lookup(reactivated.sku), 200)).data.map((p) => p.id),
              [product.id],
            );
            assert.deepEqual(
              (await db.query('SELECT * FROM purchase_order_items WHERE id=$1', [item.id])).rows[0],
              item,
            );
            product = reactivated;
            assert.equal(
              (await request(`/products/${product.id}`, { method: 'DELETE' })).status,
              404,
            );
          },
        );
        await http.test(
          'same-merchant concurrent creation and patch collisions are database-safe across API processes',
          async () => {
            const before = await auditCount();
            const responses = await Promise.all([
              create({ name: 'race1', sku: 'RACE-SKU' }),
              create({ name: 'race2', sku: 'RACE-SKU' }, { server: second }),
            ]);
            assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
            for (const response of responses)
              await read(
                response,
                response.status,
                response.status === 409 ? 'PRODUCT_SKU_ALREADY_EXISTS' : undefined,
              );
            assert.equal(await auditCount(), before + 1);
            const barcodes = await Promise.all([
              create({ name: 'bc1', sku: 'RACE-BC-1', barcode: 'RACE-BC' }),
              create({ name: 'bc2', sku: 'RACE-BC-2', barcode: 'RACE-BC' }, { server: second }),
            ]);
            assert.deepEqual(barcodes.map((r) => r.status).sort(), [201, 409]);
            for (const response of barcodes)
              await read(
                response,
                response.status,
                response.status === 409 ? 'PRODUCT_BARCODE_ALREADY_EXISTS' : undefined,
              );
            const x = await make('PATCH-RACE-1'),
              y = await make('PATCH-RACE-2');
            const patches = await Promise.all([
              patch(x.id, { sku: 'PATCH-RACE-TARGET' }),
              patch(y.id, { sku: 'PATCH-RACE-TARGET' }, { server: second }),
            ]);
            assert.deepEqual(patches.map((r) => r.status).sort(), [200, 409]);
            for (const response of patches)
              await read(
                response,
                response.status,
                response.status === 409 ? 'PRODUCT_SKU_ALREADY_EXISTS' : undefined,
              );
          },
        );
        await http.test('parallel identical patch changes state and audit once', async () => {
          const made = await make('IDEMPOTENT');
          const before = await auditCount();
          let results = [];
          for (const response of await Promise.all([
            patch(made.id, { referencePurchasePrice: '1.0' }),
            patch(made.id, { referencePurchasePrice: '1.00' }, { server: second }),
          ]))
            results.push((await read(response, 200)).data);
          assert.equal(await auditCount(), before + 1);
          assert.equal(results[0].updatedAt, results[1].updatedAt);
        });
        await http.test(
          'audit failures roll back product creation and changes without leaking exceptions',
          async () => {
            const before = await auditCount();
            const existing = (await read(await request(`/products/${product.id}`), 200)).data;
            await db.query(
              "CREATE FUNCTION test_reject_product_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'PRODUCT_TOKEN_PASSWORD_SECRET'; END $$",
            );
            await db.query(
              "CREATE TRIGGER test_product_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW WHEN (NEW.action LIKE 'PRODUCT_%') EXECUTE FUNCTION test_reject_product_audit()",
            );
            try {
              await read(
                await create({ name: 'rollback', sku: 'ROLLBACK-CREATE' }),
                500,
                'INTERNAL_ERROR',
              );
              await read(
                await patch(product.id, {
                  referencePurchasePrice: '999.99',
                  remark: 'must rollback',
                }),
                500,
                'INTERNAL_ERROR',
              );
              assert.equal(await auditCount(), before);
              assert.deepEqual(
                (await read(await request(`/products/${product.id}`), 200)).data,
                existing,
              );
              assert.equal(
                (
                  await db.query(
                    "SELECT count(*)::int AS n FROM products WHERE sku='ROLLBACK-CREATE'",
                  )
                ).rows[0].n,
                0,
              );
            } finally {
              await db.query('DROP TRIGGER test_product_audit_failure ON audit_logs');
              await db.query('DROP FUNCTION test_reject_product_audit()');
            }
            await make('ROLLBACK-CREATE');
          },
        );
        for (const state of ['VIEWER', 'WAREHOUSE'])
          await http.test(
            `transaction rechecks product writer demotion to ${state} after Guard passed`,
            async () => {
              const locker = new Client({ connectionString: url.toString() });
              await locker.connect();
              let pending;
              try {
                await locker.query('BEGIN');
                await locker.query('SELECT id FROM tenants WHERE id=$1 FOR UPDATE', [a.tenant.id]);
                pending = patch(product.id, { name: 'unauthorized' }, { actor: 'buyer' });
                const deadline = Date.now() + 3000;
                let waiting = false;
                while (Date.now() < deadline) {
                  const row = (
                    await db.query(
                      "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1 AND wait_event_type='Lock' AND query LIKE '%FROM tenants WHERE id%'",
                      [databaseName],
                    )
                  ).rows[0];
                  if (row.n) {
                    waiting = true;
                    break;
                  }
                  await delay(20);
                }
                assert.equal(waiting, true);
                await locker.query('UPDATE tenant_memberships SET role=$1 WHERE id=$2', [
                  state,
                  buyerMembership.id,
                ]);
                await locker.query('COMMIT');
                await read(await pending, 403, 'FORBIDDEN');
                pending = undefined;
                assert.equal(
                  (await read(await request(`/products/${product.id}`), 200)).data.name,
                  product.name,
                );
              } finally {
                await locker.query('ROLLBACK');
                await locker.end();
                if (pending) await pending;
              }
              await read(
                await request(`/members/${buyerMembership.id}`, {
                  method: 'PATCH',
                  body: { role: 'BUYER' },
                }),
                200,
              );
            },
          );
        await http.test(
          'inactive membership cannot read any product even with still-valid Access Token',
          async () => {
            await read(
              await request(`/members/${buyerMembership.id}`, {
                method: 'PATCH',
                body: { isActive: false },
              }),
              200,
            );
            for (const path of [
              '/products',
              `/products/${product.id}`,
              '/products/lookup?code=' + product.sku,
            ])
              await read(await request(path, { actor: 'buyer' }), 403, 'FORBIDDEN');
            await read(
              await request(`/members/${buyerMembership.id}`, {
                method: 'PATCH',
                body: { isActive: true },
              }),
              200,
            );
          },
        );
        await http.test(
          'new numeric and remark constraints are enforced by PostgreSQL',
          async () => {
            for (const value of ['-0.01', 'NaN'])
              await assert.rejects(
                () =>
                  db.query('UPDATE products SET reference_purchase_price=$1 WHERE id=$2', [
                    value,
                    product.id,
                  ]),
                (e) => e.code === '23514',
              );
            await assert.rejects(
              () =>
                db.query('UPDATE products SET remark=$1 WHERE id=$2', [
                  'x'.repeat(2001),
                  product.id,
                ]),
              (e) => e.code === '23514',
            );
          },
        );
        await http.test(
          'audit records safe state and changed field names but never copies remarks',
          async () => {
            const requestId = randomUUID();
            await read(
              await patch(
                product.id,
                { referencePurchasePrice: '26.50', remark: 'PRIVATE-NOTE-MUST-NOT-APPEAR' },
                { headers: { 'X-Request-Id': requestId } },
              ),
              200,
            );
            const audit = (
              await db.query("SELECT * FROM audit_logs WHERE metadata->>'requestId'=$1", [
                requestId,
              ])
            ).rows[0];
            assert.equal(audit.tenant_id, a.tenant.id);
            assert.equal(audit.actor_id, accounts.ownerA.user.id);
            assert.equal(audit.object_id, product.id);
            assert.deepEqual(audit.metadata.changedFields, ['referencePurchasePrice', 'remark']);
            assert.equal(audit.metadata.before.referencePurchasePrice, '25.99');
            assert.equal(audit.metadata.after.referencePurchasePrice, '26.50');
            assert.equal(JSON.stringify(audit).includes('PRIVATE-NOTE'), false);
          },
        );
        await http.test(
          'product input rejects malformed fields, money/tenant injection, null required values and empty patch',
          async () => {
            for (const body of [
              {},
              { name: 'x', sku: ' ' },
              { name: null, sku: 'BAD' },
              { name: 'x', sku: 'BAD', unit: null },
              { name: 'x', sku: 'BAD', isActive: null },
              { name: 'x', sku: 'BAD', tenantId: b.tenant.id },
              { name: 'x', sku: 'BAD', unitPrice: '0' },
              { name: 'x', sku: 'BAD', barcode: 123 },
              { name: 'x', sku: 'BAD', barcode: 'bad\ncode' },
              { name: 'x', sku: 'BAD', remark: 'bad\0note' },
              { name: 'x', sku: 'x'.repeat(81) },
              { name: 'x'.repeat(201), sku: 'BAD' },
              { name: 'x', sku: 'BAD', specification: 'x'.repeat(201) },
              { name: 'x', sku: 'BAD', remark: 'x'.repeat(2001) },
            ]) {
              const response = await create(body);
              assert.equal(response.status, 400);
              assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
            }
            for (const body of [
              { sku: null },
              { name: null },
              { unit: '' },
              { isActive: 'false' },
              { tenantId: b.tenant.id },
              { id: foreign.id },
              { unitPrice: '12.00' },
              { barcode: { value: 'CODE' } },
            ]) {
              const response = await patch(product.id, body);
              assert.equal(response.status, 400);
              assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
            }
            await read(await patch(product.id, {}), 400, 'BAD_REQUEST');
          },
        );
        await http.test(
          'invalid query values arrays and UUIDs return safe standard errors',
          async () => {
            for (const query of [
              'page=0',
              'pageSize=101',
              'isActive=1',
              'isActive=TRUE',
              'hasBarcode=yes',
              'isActive=true&isActive=false',
              'search=',
              'unit=',
              'tenantId=' + b.tenant.id,
            ]) {
              const response = await request('/products?' + query);
              assert.equal(response.status, 400);
              assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
            }
            for (const query of [
              '',
              'code=',
              'code=x&code=y',
              'code=x&tenantId=' + b.tenant.id,
              'code=' + encodeURIComponent('x'.repeat(129)),
            ]) {
              const response = await request('/products/lookup?' + query);
              assert.equal(response.status, 400);
              assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
            }
            await read(await request('/products?page=2147483647&pageSize=100'), 400, 'BAD_REQUEST');
            const invalid = await request('/products/invalid-uuid');
            assert.equal(invalid.status, 400);
            assert.equal((await invalid.json()).error.code, 'VALIDATION_ERROR');
          },
        );
        await http.test(
          'Swagger publishes five operations, merchant security and string monetary schema',
          async () => {
            const doc = await (await fetch(`${base}/api/docs-json`)).json();
            for (const [path, method] of [
              ['/products', 'get'],
              ['/products', 'post'],
              ['/products/{id}', 'get'],
              ['/products/{id}', 'patch'],
              ['/products/lookup', 'get'],
            ])
              assert.deepEqual(doc.paths['/api/v1' + path][method].security, [
                { bearer: [], tenant: [] },
              ]);
            // 名称可以缺省（服务端按 货号/颜色/尺码 生成），所以它不在必填列表里。
            const createSchema = doc.components.schemas.CreateProductDto;
            assert.equal(createSchema.required.includes('name'), false);
            assert.equal(createSchema.properties.name.maxLength, 200);
            assert.equal(
              doc.components.schemas.CreateProductDto.properties.sku.example,
              'CHARGER-20W',
            );
            assert.equal(
              doc.components.schemas.ProductDto.properties.referencePurchasePrice.type,
              'string',
            );
            const code = doc.paths['/api/v1/products/lookup'].get.parameters.find(
              (parameter) => parameter.name === 'code',
            );
            assert.equal(code.required, true);
            assert.equal(code.schema.maxLength, 128);
            for (const path of ['/api/v1/products', '/api/v1/products/lookup']) {
              const schema =
                doc.paths[path].get.responses['200'].content['application/json'].schema;
              let hasArray = false;
              for (const part of schema.allOf ?? [schema]) {
                const resolved = part.$ref
                  ? doc.components.schemas[part.$ref.split('/').at(-1)]
                  : part;
                if (resolved.properties?.data?.type) {
                  assert.equal(
                    resolved.properties.data.type,
                    'array',
                    'all schema constraints on data must accept an array',
                  );
                  hasArray = true;
                }
              }
              assert.equal(hasArray, true);
            }
          },
        );
        await http.test(
          'captured application logs omit credentials, remarks and raw database exceptions',
          () => {
            assert.ok(logs.includes('http_request'));
            for (const actor of Object.values(accounts))
              for (const value of [actor.accessToken, actor.refreshToken])
                assert.equal(logs.includes(value), false);
            for (const value of [
              password,
              secret,
              'PRIVATE-NOTE',
              'PRODUCT_TOKEN_PASSWORD_SECRET',
              '@products.example.com',
            ])
              assert.equal(logs.includes(value), false);
          },
        );
        persisted = (await read(await request(`/products/${product.id}`), 200)).data;
      });
      await t.test(
        'product master data and exact reference price persist across API restart',
        async (restarted) => {
          const base = await startTestApi(restarted, { env: settings });
          const body = await read(
            await fetch(`${base}/api/v1/products/${persisted.id}`, {
              headers: {
                Authorization: `Bearer ${accounts.ownerA.accessToken}`,
                'X-Tenant-Id': a.tenant.id,
              },
            }),
            200,
          );
          assert.deepEqual(body.data, persisted);
        },
      );
    } finally {
      if (connected) await db.end();
      if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
      await admin.end();
    }
  },
);
