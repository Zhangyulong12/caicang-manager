import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { access, mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { loadEnvFile } from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, URLSearchParams } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';
import ts from 'typescript';
import { startTestApi } from './api-test-server.mjs';
const { Client } = createRequire(new URL('../apps/api/package.json', import.meta.url))('pg');
const run = promisify(execFile);
loadEnvFile(new URL('../.env', import.meta.url));
const compiled = new URL('../apps/admin-web/.test-build/accounts/', import.meta.url);
await mkdir(compiled, { recursive: true });
for (const name of [
  'purchase-account-form',
  'purchase-form',
  'catalog-form',
  'client',
  'purchases',
]) {
  const source = await readFile(
    new URL(`../apps/admin-web/src/api/${name}.ts`, import.meta.url),
    'utf8',
  );
  await writeFile(
    new URL(name + '.mjs', compiled),
    ts
      .transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
      })
      .outputText.replace(/(['"])\.\/(client|purchase-form)\1/g, (_a, _q, n) => `'./${n}.mjs'`),
  );
}
const forms = await import(new URL('purchase-account-form.mjs', compiled));
const purchaseForms = await import(new URL('purchase-form.mjs', compiled));
const catalogForms = await import(new URL('catalog-form.mjs', compiled));
const { createPurchases } = await import(new URL('purchases.mjs', compiled));
test('account and purchase front-end validation and tenant request boundaries', async (t) => {
  await t.test('alias, platform, remarks and product attribute validation', () => {
    assert.ok(forms.accountErrors(forms.blankAccount()).alias);
    assert.deepEqual(forms.accountErrors({ ...forms.blankAccount(), alias: '淘宝主账号' }), {});
    assert.ok(
      forms.accountErrors({ ...forms.blankAccount(), platform: 'ALIEXPRESS', alias: 'ok' })
        .platform,
    );
    assert.ok(forms.accountErrors({ ...forms.blankAccount(), alias: 'x'.repeat(101) }).alias);
    assert.ok(forms.accountErrors({ ...forms.blankAccount(), alias: 'ok', remark: '\0' }).remark);
    assert.equal(
      forms.accountPayload({ ...forms.blankAccount(), alias: ' 淘宝主账号 ' }).alias,
      '淘宝主账号',
    );
    assert.ok(
      catalogForms.productErrors({ ...catalogForms.blankProduct(), articleNo: 'x'.repeat(81) })
        .articleNo,
    );
    assert.equal(
      catalogForms.productPayload({
        ...catalogForms.blankProduct(),
        articleNo: ' T20 ',
        color: '白',
        size: 'L',
      }).articleNo,
      'T20',
    );
    assert.ok(
      purchaseForms.purchaseErrors({
        ...purchaseForms.blankPurchase(),
        purchaseAccountId: 'invalid',
      }).purchaseAccountId,
    );
  });
  await t.test('all filters are encoded and foreign scope responses rejected', async () => {
    let scope = {
      userId: 'user',
      sessionKey: 'session',
      tenantId: 'tenant-a',
      permissions: ['purchase:read', 'purchase:write'],
    };
    const calls = [];
    const api = createPurchases(
      {
        request: async (path, init) => {
          calls.push({ path, init });
          return { data: [], pagination: { total: 0 } };
        },
      },
      () => scope,
    );
    await api.list({
      page: 1,
      pageSize: 20,
      purchaseAccountId: 'account',
      dateFrom: '2026-10-01',
      dateTo: '2026-10-31',
      search: 'A&B',
      platform: 'JD',
    });
    const params = new URLSearchParams(calls[0].path.split('?')[1]);
    assert.equal(params.get('search'), 'A&B');
    assert.equal(params.get('purchaseAccountId'), 'account');
    assert.equal(params.get('dateFrom'), '2026-10-01');
    assert.equal(params.get('dateTo'), '2026-10-31');
    assert.equal(calls[0].init.tenantId, 'tenant-a');
    scope.permissions = ['purchase:read'];
    await assert.rejects(
      api.saveAccount({ platform: 'JD', alias: '京东号', remark: null, isActive: true }),
      (e) => e.status === 403,
    );
    const changed = createPurchases(
      {
        request: async () => {
          scope = { ...scope, tenantId: 'tenant-b' };
          return { data: [], pagination: { total: 0 } };
        },
      },
      () => scope,
    );
    await assert.rejects(changed.accountOptions(), (e) => e.code === 'SCOPE_CHANGED');
    const foreign = createPurchases(
      { request: async () => ({ data: [{ tenantId: 'tenant-c' }], pagination: { total: 1 } }) },
      () => scope,
    );
    await assert.rejects(foreign.accountOptions(), (e) => e.code === 'INVALID_RESPONSE');
  });
});

test('the account migration only adds nullable columns and keeps history', async () => {
  const read = (name) =>
    readFile(
      new URL(`../apps/api/prisma/migrations/${name}/migration.sql`, import.meta.url),
      'utf8',
    );
  const [attributes, sql] = await Promise.all([
    read('20261023130000_product_attributes'),
    read('20261023140000_purchase_accounts'),
  ]);
  // 升级脚本不能让老数据消失或变空：只允许 ADD，不允许 DROP / UPDATE / DELETE / TRUNCATE。
  for (const script of [attributes, sql]) {
    for (const forbidden of [
      /\bDROP\s+(TABLE|COLUMN|CONSTRAINT)\b/i,
      /^\s*UPDATE\b/im,
      /^\s*DELETE\s+FROM\b/im,
      /\bTRUNCATE\b/i,
    ]) {
      assert.doesNotMatch(script, forbidden);
    }
  }
  // 商品属性同样可空，老商品与老采购明细维持 NULL。
  for (const column of ['article_no', 'color', 'size']) {
    assert.match(attributes, new RegExp(`ADD COLUMN\\s+"${column}" VARCHAR\\(80\\)`));
    assert.doesNotMatch(attributes, new RegExp(`"${column}"\\s+VARCHAR\\(80\\)\\s+NOT NULL`));
  }
  // 新列必须可空，老采购单升级后仍然合法。
  assert.match(sql, /ADD COLUMN\s+"purchase_account_id" UUID[,;]/i);
  assert.doesNotMatch(sql, /purchase_account_id"\s+UUID\s+NOT NULL/i);
  assert.match(sql, /ADD COLUMN\s+"purchase_account_alias_snapshot" VARCHAR\(100\)/i);
  // 账号被引用时由外键拦删除，不级联。
  assert.match(sql, /purchase_account_id"\).*ON DELETE RESTRICT/s);
  // 只有业务字段：整张表没有密码、令牌或第三方凭据列。
  const table = sql.slice(sql.indexOf('CREATE TABLE "purchase_accounts"'));
  const columns = [...table.slice(0, table.indexOf(');')).matchAll(/^\s+"([a-z_]+)"/gm)].map(
    (match) => match[1],
  );
  assert.deepEqual(columns, [
    'id',
    'tenant_id',
    'platform',
    'alias',
    'remark',
    'is_active',
    'created_at',
    'updated_at',
  ]);
});

test(
  'real purchase accounts, reconciliation, immutable costs and tenant isolation',
  { timeout: 900000 },
  async (t) => {
    const source = new URL(process.env.DATABASE_URL);
    assert.equal(source.pathname, '/caicang');
    assert.ok(['localhost', '127.0.0.1'].includes(source.hostname));
    const name = 'caicang_test_' + randomUUID().replaceAll('-', '');
    const url = new URL(source);
    url.pathname = '/' + name;
    const admin = new Client({ connectionString: source.toString() }),
      db = new Client({ connectionString: url.toString() });
    let created = false,
      connected = false;
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
      await t.test('real HTTP and PostgreSQL constraints', async (http) => {
        const base = await startTestApi(http, {
          env: {
            DATABASE_URL: url.toString(),
            NODE_ENV: 'test',
            JWT_ACCESS_SECRET: randomBytes(48).toString('hex'),
            TRUSTED_PROXIES: '127.0.0.1/32,::1/128',
          },
        });
        let counter = 0;
        const credentials = {
          email: 'owner@purchase-accounts.example.test',
          password: randomBytes(24).toString('base64url') + 'Aa1!',
        };
        const actors = {};
        const request = async (
          path,
          { method = 'GET', body, actor = 'owner', tenant = a?.tenant.id, status = 200, code } = {},
        ) => {
          const response = await fetch(base + '/api/v1' + path, {
            method,
            headers: {
              'Content-Type': 'application/json',
              'X-Forwarded-For': `198.18.${Math.floor(++counter / 250)}.${(counter % 250) + 1}`,
              ...(actors[actor] ? { Authorization: 'Bearer ' + actors[actor].accessToken } : {}),
              ...(tenant ? { 'X-Tenant-Id': tenant } : {}),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          });
          const result = await response.json();
          assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(result)}`);
          if (code) assert.equal(result.error.code, code);
          return result;
        };
        let a, b;
        for (const actor of ['owner', 'buyer', 'warehouse', 'viewer', 'outsider']) {
          const login = { ...credentials, email: actor + '@purchase-accounts.example.test' };
          await request('/auth/register', {
            method: 'POST',
            body: login,
            tenant: null,
            status: 201,
          });
          actors[actor] = (
            await request('/auth/login', { method: 'POST', body: login, tenant: null })
          ).data;
        }
        a = (
          await request('/tenants', {
            method: 'POST',
            body: { name: '采购账号隔离 A' },
            tenant: null,
            status: 201,
          })
        ).data;
        b = (
          await request('/tenants', {
            method: 'POST',
            body: { name: '采购账号隔离 B' },
            actor: 'outsider',
            tenant: null,
            status: 201,
          })
        ).data;
        for (const [actor, role] of [
          ['buyer', 'BUYER'],
          ['warehouse', 'WAREHOUSE'],
          ['viewer', 'VIEWER'],
        ])
          await request('/members', {
            method: 'POST',
            body: { email: actor + '@purchase-accounts.example.test', role },
            status: 201,
          });
        let account, jd, foreign, p1, p2, order;
        await http.test('create two accounts and tenant isolation; five roles', async () => {
          account = (
            await request('/purchase-accounts', {
              method: 'POST',
              body: { platform: 'TAOBAO', alias: '淘宝主账号', remark: '业务备注' },
              status: 201,
            })
          ).data;
          jd = (
            await request('/purchase-accounts', {
              method: 'POST',
              actor: 'buyer',
              body: { platform: 'JD', alias: '京东采购号' },
              status: 201,
            })
          ).data;
          foreign = (
            await request('/purchase-accounts', {
              method: 'POST',
              actor: 'outsider',
              tenant: b.tenant.id,
              body: { platform: 'TAOBAO', alias: '淘宝主账号' },
              status: 201,
            })
          ).data;
          assert.equal((await request('/purchase-accounts')).pagination.total, 2);
          assert.equal(
            (await request('/purchase-accounts', { actor: 'warehouse' })).data.length,
            2,
          );
          assert.equal((await request('/purchase-accounts', { actor: 'viewer' })).data.length, 2);
          await request('/purchase-accounts', { actor: 'outsider', status: 403 });
          await request('/purchase-accounts/' + foreign.id, {
            method: 'PATCH',
            body: { alias: 'leak' },
            status: 404,
          });
          for (const actor of ['warehouse', 'viewer'])
            await request('/purchase-accounts', {
              actor,
              method: 'POST',
              body: { platform: 'OTHER', alias: 'blocked' },
              status: 403,
            });
        });
        await http.test(
          'duplicate concurrent creates, validation, no credentials, unused-only deletion',
          async () => {
            const results = await Promise.all(
              [1, 2].map(() =>
                fetch(base + '/api/v1/purchase-accounts', {
                  method: 'POST',
                  headers: {
                    Authorization: 'Bearer ' + actors.owner.accessToken,
                    'X-Tenant-Id': a.tenant.id,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ platform: 'PDD', alias: '并发账号' }),
                }),
              ),
            );
            assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
            for (const body of [
              { platform: 'TAOBAO', alias: '淘宝主账号' },
              { platform: 'BAD', alias: 'x' },
              { platform: 'JD', alias: ' ' },
              { platform: 'JD', alias: 'x', password: 'must-not-save' },
            ])
              await request('/purchase-accounts', {
                method: 'POST',
                body,
                status: body.alias === '淘宝主账号' ? 409 : 400,
              });
            // 从未被采购单引用的账号可以删除，且留下审计；有历史的账号在后面的已下单用例里验证 409。
            const unused = (
              await request('/purchase-accounts', {
                method: 'POST',
                body: { platform: 'OTHER', alias: '一次性账号' },
                status: 201,
              })
            ).data;
            for (const actor of ['warehouse', 'viewer'])
              await request('/purchase-accounts/' + unused.id, {
                actor,
                method: 'DELETE',
                status: 403,
              });
            assert.deepEqual(
              (await request('/purchase-accounts/' + unused.id, { method: 'DELETE' })).data,
              { id: unused.id, deleted: true },
            );
            assert.equal(
              (
                await db.query('SELECT count(*)::int n FROM purchase_accounts WHERE id=$1', [
                  unused.id,
                ])
              ).rows[0].n,
              0,
            );
            assert.equal(
              (
                await db.query(
                  "SELECT count(*)::int n FROM audit_logs WHERE object_id=$1 AND action='PURCHASE_ACCOUNT_DELETED'",
                  [unused.id],
                )
              ).rows[0].n,
              1,
            );
            await request('/purchase-accounts/' + unused.id, {
              method: 'DELETE',
              status: 404,
              code: 'NOT_FOUND',
            });
            assert.equal(
              (
                await db.query('SELECT count(*)::int n FROM purchase_accounts WHERE id=$1', [
                  account.id,
                ])
              ).rows[0].n,
              1,
            );
            await request('/purchase-accounts/' + account.id, {
              method: 'PATCH',
              body: {},
              status: 400,
            });
            await request('/purchase-accounts?isActive=null', { status: 400 });
            await request('/purchase-accounts/' + account.id, {
              method: 'PATCH',
              body: { platform: null },
              status: 400,
            });
          },
        );
        p1 = (
          await request('/products', {
            method: 'POST',
            body: {
              name: '20W 充电器',
              sku: 'CHARGER-20W',
              articleNo: 'C20',
              color: '白色',
              size: '标准',
              referencePurchasePrice: '99.00',
            },
            status: 201,
          })
        ).data;
        p2 = (
          await request('/products', {
            method: 'POST',
            body: { name: '数据线', sku: 'CABLE-1M', articleNo: 'CB1', color: '黑色', size: '1米' },
            status: 201,
          })
        ).data;
        const input = {
          platform: 'TAOBAO',
          purchaseAccountId: account.id,
          platformOrderNo: '0000123456789',
          supplierName: '测试店铺',
          purchaseDate: '2026-10-23',
          warehouseId: a.defaultWarehouse.id,
          recipient: { name: '测试收货员', phone: '13800000000', address: '隔离测试仓库' },
          freightAmount: '10.00',
          items: [
            { productId: p1.id, quantity: 10, unitPrice: '18.50', discountAmount: '5.00' },
            { productId: p2.id, quantity: 2, unitPrice: '8.25', discountAmount: '1.00' },
          ],
        };
        await http.test(
          'multi SKU actual costs independent from reference price; persisted reload',
          async () => {
            order = (
              await request('/purchase-orders', { method: 'POST', body: input, status: 201 })
            ).data;
            assert.equal(order.goodsAmount, '201.50');
            assert.equal(order.discountAmount, '6.00');
            assert.equal(order.totalCost, '205.50');
            assert.equal(order.purchaseAccountAlias, '淘宝主账号');
            assert.equal(order.items[0].articleNo, 'C20');
            assert.equal(order.items[0].color, '白色');
            assert.equal((await request('/purchase-orders/' + order.id)).data.totalCost, '205.50');
            const rows = (
              await db.query(
                'SELECT quantity,unit_price::text FROM purchase_order_items WHERE purchase_order_id=$1 ORDER BY line_no',
                [order.id],
              )
            ).rows;
            assert.deepEqual(rows, [
              { quantity: 10, unit_price: '18.50' },
              { quantity: 2, unit_price: '8.25' },
            ]);
            const persisted = (
              await db.query('SELECT purchase_account_id FROM purchase_orders WHERE id=$1', [
                order.id,
              ])
            ).rows[0];
            assert.equal(persisted.purchase_account_id, account.id);
          },
        );
        await http.test(
          'reject foreign account, platform mismatch, untrusted totals and invalid dates',
          async () => {
            await request('/purchase-orders', {
              method: 'POST',
              body: { ...input, purchaseAccountId: foreign.id },
              status: 404,
            });
            await request('/purchase-orders', {
              method: 'POST',
              body: { ...input, purchaseAccountId: jd.id },
              status: 422,
              code: 'PURCHASE_ACCOUNT_PLATFORM_MISMATCH',
            });
            await request('/purchase-orders/' + order.id, {
              method: 'PATCH',
              body: { purchaseAccountId: foreign.id },
              status: 404,
            });
            await request('/purchase-orders', {
              method: 'POST',
              body: { ...input, totalCost: '0.01' },
              status: 400,
            });
            await request('/purchase-orders?dateFrom=2026-02-30', { status: 400 });
            await request('/purchase-orders?dateFrom=2026-10-24&dateTo=2026-10-23', {
              status: 400,
            });
            await assert.rejects(
              db.query('UPDATE purchase_orders SET purchase_account_id=$1 WHERE id=$2', [
                foreign.id,
                order.id,
              ]),
              (e) => e.code === '23503',
            );
          },
        );
        await http.test('draft account edits, inactive restrictions and audit logs', async () => {
          await request('/purchase-orders/' + order.id, {
            method: 'PATCH',
            body: { platform: 'JD', purchaseAccountId: jd.id },
          });
          await request('/purchase-orders/' + order.id, {
            method: 'PATCH',
            body: { platform: 'TAOBAO', purchaseAccountId: account.id },
          });
          await request('/purchase-accounts/' + account.id, {
            method: 'PATCH',
            body: { platform: 'JD' },
            status: 409,
            code: 'PURCHASE_ACCOUNT_PLATFORM_LOCKED',
          });
          await request('/purchase-accounts/' + account.id, {
            method: 'PATCH',
            body: { isActive: false },
          });
          await request('/purchase-orders', {
            method: 'POST',
            body: input,
            status: 409,
            code: 'PURCHASE_ACCOUNT_INACTIVE',
          });
          await request('/purchase-orders/' + order.id, {
            method: 'PATCH',
            body: { remark: '可保留原停用关联' },
          });
          await request('/purchase-orders/' + order.id + '/place', {
            method: 'POST',
            body: {},
            status: 409,
            code: 'PURCHASE_ACCOUNT_INACTIVE',
          });
          assert.equal((await request('/purchase-orders/' + order.id)).data.status, 'DRAFT');
          await request('/purchase-accounts/' + account.id, {
            method: 'PATCH',
            body: { isActive: true },
          });
          assert.ok(
            (
              await db.query(
                "SELECT count(*)::int n FROM audit_logs WHERE object_id=$1 AND action='PURCHASE_ACCOUNT_UPDATED'",
                [account.id],
              )
            ).rows[0].n >= 2,
          );
        });
        await http.test(
          'confirmed snapshot survives account/product changes; price and account edits blocked',
          async () => {
            order = (
              await request('/purchase-orders/' + order.id + '/place', { method: 'POST', body: {} })
            ).data;
            await request('/products/' + p1.id, {
              method: 'PATCH',
              body: {
                referencePurchasePrice: '999.00',
                articleNo: 'NEW',
                color: '红色',
                size: 'XL',
                isActive: false,
              },
            });
            await request('/purchase-accounts/' + account.id, {
              method: 'PATCH',
              body: { alias: '淘宝改名后', isActive: false },
            });
            const saved = (await request('/purchase-orders/' + order.id)).data;
            assert.equal(saved.totalCost, '205.50');
            assert.equal(saved.items[0].unitPrice, '18.50');
            assert.equal(saved.items[0].articleNo, 'C20');
            assert.equal(saved.items[0].color, '白色');
            assert.equal(saved.purchaseAccountAlias, '淘宝主账号');
            for (const body of [
              { items: [{ productId: p1.id, quantity: 1, unitPrice: '1.00' }] },
              { purchaseAccountId: jd.id },
            ])
              await request('/purchase-orders/' + order.id, { method: 'PATCH', body, status: 409 });
            // 已被采购单引用：接口 409，直接用 SQL 删也会被外键拦住，历史不会悬空。
            await request('/purchase-accounts/' + account.id, {
              method: 'DELETE',
              status: 409,
              code: 'PURCHASE_ACCOUNT_HAS_ORDERS',
            });
            assert.equal(
              (
                await db.query(
                  'SELECT count(*)::int n FROM purchase_orders WHERE purchase_account_id=$1',
                  [account.id],
                )
              ).rows[0].n,
              1,
            );
            await assert.rejects(
              db.query('DELETE FROM purchase_accounts WHERE id=$1', [account.id]),
              (e) => e.code === '23503',
            );
          },
        );
        await http.test(
          'account/platform/article/SKU/platform order/date filtering and tenant boundaries',
          async () => {
            for (const suffix of [
              'purchaseAccountId=' + account.id,
              'search=C20',
              'search=CHARGER-20W',
              'search=0000123456789',
              'dateFrom=2026-10-23&dateTo=2026-10-23',
              'platform=TAOBAO&purchaseAccountId=' + account.id,
            ]) {
              const result = await request('/purchase-orders?' + suffix);
              assert.equal(result.pagination.total, 1);
              assert.equal(result.data[0].id, order.id);
            }
            for (const suffix of [
              'purchaseAccountId=' + foreign.id,
              'purchaseAccountId=' + jd.id,
              'dateTo=2026-10-22',
              'dateFrom=2026-10-24',
              'search=NEW',
            ])
              assert.equal((await request('/purchase-orders?' + suffix)).pagination.total, 0);
            await request('/purchase-orders/' + order.id, {
              actor: 'outsider',
              tenant: b.tenant.id,
              status: 404,
            });
            assert.equal(
              (await request('/purchase-accounts?search=淘宝改名后&isActive=false')).data[0]
                .hasOrders,
              true,
            );
          },
        );
        await http.test(
          'cancelled draft keeps its account alias and audit cost breakdown',
          async () => {
            const draft = (
              await request('/purchase-orders', {
                method: 'POST',
                body: {
                  ...input,
                  platform: 'JD',
                  purchaseAccountId: jd.id,
                  items: [input.items[1]],
                },
                status: 201,
              })
            ).data;
            const cancelled = (
              await request('/purchase-orders/' + draft.id + '/cancel', {
                method: 'POST',
                body: {},
              })
            ).data;
            assert.equal(cancelled.purchaseAccountAlias, '京东采购号');
            await request('/purchase-accounts/' + jd.id, {
              method: 'PATCH',
              body: { alias: '京东号改名' },
            });
            assert.equal(
              (await request('/purchase-orders/' + draft.id)).data.purchaseAccountAlias,
              '京东采购号',
            );
            const audit = (
              await db.query(
                "SELECT metadata FROM audit_logs WHERE object_id=$1 AND action='PURCHASE_ORDER_CANCELLED'",
                [draft.id],
              )
            ).rows[0].metadata;
            assert.equal(audit.after.freightAmount, '10.00');
            assert.equal(audit.after.goodsAmount, '16.50');
            assert.equal(audit.after.discountAmount, '1.00');
            assert.equal(audit.after.totalCost, '25.50');
          },
        );
        await http.test('pre-migration rows stay readable and untouched', async () => {
          const legacy = (
            await request('/purchase-orders', {
              method: 'POST',
              body: { ...input, platform: 'JD', purchaseAccountId: null, items: [input.items[1]] },
              status: 201,
            })
          ).data;
          assert.equal(legacy.purchaseAccountId, null);
          assert.equal(legacy.purchaseAccountAlias, null);
          // 直接按迁移前的老形状插入一行：账号列与明细快照列全为 NULL，created_at 早于本次升级。
          const raw = await db.query(
            `INSERT INTO purchase_orders
             (tenant_id, warehouse_id, order_no, platform, platform_order_no, supplier_name,
              purchase_date, status, freight_amount, created_by, placed_at, created_at, updated_at)
           VALUES ($1,$2,'PO-LEGACY-0001','TAOBAO','OLD-2025-0001','老店铺','2026-01-05','PLACED',3.50,$3, now(), now() - interval '200 days', now() - interval '200 days')
           RETURNING id`,
            [a.tenant.id, a.defaultWarehouse.id, actors.owner.user.id],
          );
          await db.query(
            `INSERT INTO purchase_order_items (tenant_id, purchase_order_id, product_id, quantity, unit_price, discount_amount, line_no)
           VALUES ($1,$2,$3,4,'12.00','1.00',1)`,
            [a.tenant.id, raw.rows[0].id, p1.id],
          );
          const read = (await request('/purchase-orders/' + raw.rows[0].id)).data;
          assert.equal(read.purchaseAccountId, null);
          assert.equal(read.purchaseAccountAlias, null);
          assert.equal(read.status, 'PLACED');
          assert.equal(read.totalCost, '50.50'); // 4 × 12.00 − 1.00 + 3.50
          // 老明细没有快照，读取时回落到商品主数据，不能被清空。
          assert.equal(read.items[0].sku, 'CHARGER-20W');
          assert.equal(read.items[0].name, '20W 充电器');
          assert.equal(read.items[0].quantity, 4);
          assert.equal(
            (
              await db.query(
                'SELECT purchase_account_id, purchase_account_alias_snapshot FROM purchase_orders WHERE id=$1',
                [raw.rows[0].id],
              )
            ).rows[0].purchase_account_id,
            null,
          );
          assert.equal(
            (await request('/purchase-orders?purchaseAccountId=' + account.id)).pagination.total,
            1,
          );
          assert.equal(
            (await request('/purchase-orders?search=PO-LEGACY-0001')).data[0].id,
            raw.rows[0].id,
          );
          assert.equal(
            (await db.query('SELECT count(*)::int n FROM stock_movements')).rows[0].n,
            0,
          );
          assert.equal((await db.query('SELECT count(*)::int n FROM stock_balances')).rows[0].n, 0);
        });
        await http.test('account changes serialize with order creation and placement', async () => {
          const racing = (
            await request('/purchase-accounts', {
              method: 'POST',
              body: { platform: 'OTHER', alias: '并发变更账号' },
              status: 201,
            })
          ).data;
          const raceRequest = async (path, method, body) => {
            const response = await fetch(base + '/api/v1' + path, {
              method,
              headers: {
                Authorization: 'Bearer ' + actors.owner.accessToken,
                'X-Tenant-Id': a.tenant.id,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(body),
            });
            return { status: response.status, body: await response.json() };
          };
          const draftInput = {
            ...input,
            platform: 'OTHER',
            purchaseAccountId: racing.id,
            items: [input.items[1]],
          };
          const [disabled, created] = await Promise.all([
            raceRequest('/purchase-accounts/' + racing.id, 'PATCH', { isActive: false }),
            raceRequest('/purchase-orders', 'POST', draftInput),
          ]);
          assert.equal(disabled.status, 200);
          assert.ok([201, 409].includes(created.status));
          if (created.status === 409)
            assert.equal(created.body.error.code, 'PURCHASE_ACCOUNT_INACTIVE');
          else
            await request('/purchase-orders/' + created.body.data.id + '/place', {
              method: 'POST',
              body: {},
              status: 409,
              code: 'PURCHASE_ACCOUNT_INACTIVE',
            });
          await request('/purchase-accounts/' + racing.id, {
            method: 'PATCH',
            body: { isActive: true },
          });
          const draft = (
            await request('/purchase-orders', { method: 'POST', body: draftInput, status: 201 })
          ).data;
          const [placed, renamed] = await Promise.all([
            raceRequest('/purchase-orders/' + draft.id + '/place', 'POST', {}),
            raceRequest('/purchase-accounts/' + racing.id, 'PATCH', { alias: '并发变更账号改名' }),
          ]);
          assert.equal(placed.status, 200);
          assert.equal(renamed.status, 200);
          assert.ok(
            ['并发变更账号', '并发变更账号改名'].includes(placed.body.data.purchaseAccountAlias),
          );
          await request('/purchase-accounts/' + racing.id, {
            method: 'PATCH',
            body: { alias: '最终账号别名' },
          });
          assert.equal(
            (await request('/purchase-orders/' + draft.id)).data.purchaseAccountAlias,
            placed.body.data.purchaseAccountAlias,
          );
        });
        if (process.env.PURCHASE_ACCOUNTS_BROWSER_CHECK === '1') {
          const { createServer } = await import(
            new URL('../apps/admin-web/node_modules/vite/dist/node/index.js', import.meta.url)
          );
          const web = await createServer({
            root: fileURLToPath(new URL('../apps/admin-web/', import.meta.url)),
            configFile: fileURLToPath(new URL('../apps/admin-web/vite.config.ts', import.meta.url)),
            logLevel: 'silent',
            server: {
              host: '127.0.0.1',
              port: 0,
              strictPort: true,
              proxy: { '/api': { target: base } },
            },
          });
          const state = new URL('../test-results/purchase-accounts-browser.json', import.meta.url),
            done = new URL('../test-results/purchase-accounts-browser.done', import.meta.url);
          try {
            await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
            await unlink(done).catch((e) => {
              if (e.code !== 'ENOENT') throw e;
            });
            // Fresh workspace ensures the browser itself creates both accounts and the order.
            const browserTenant = (
              await request('/tenants', {
                method: 'POST',
                body: { name: '浏览器采购验收工作空间' },
                status: 201,
              })
            ).data;
            for (const product of [
              {
                name: '浏览器充电器',
                sku: 'BROWSER-20W',
                articleNo: 'B20',
                color: '白色',
                size: '标准',
                referencePurchasePrice: '99.00',
              },
              {
                name: '浏览器数据线',
                sku: 'BROWSER-CABLE',
                articleNo: 'BC1',
                color: '黑色',
                size: '1米',
                referencePurchasePrice: '2.00',
              },
            ])
              await request('/products', {
                method: 'POST',
                tenant: browserTenant.tenant.id,
                body: product,
                status: 201,
              });
            await web.listen();
            await writeFile(
              state,
              JSON.stringify(
                {
                  url: 'http://127.0.0.1:' + web.httpServer.address().port,
                  ...credentials,
                  tenant: browserTenant.tenant.id,
                },
                null,
                2,
              ),
            );
            process.stdout.write(
              'Browser fixture ready: test-results/purchase-accounts-browser.json\n',
            );
            let completed = false;
            for (let n = 0; n < 1200; n++) {
              try {
                await access(done);
                completed = true;
                break;
              } catch {
                await delay(500);
              }
            }
            assert.equal(completed, true, 'Browser validation must explicitly finish');
            const saved = (
              await db.query(
                'SELECT id,purchase_account_id,status FROM purchase_orders WHERE tenant_id=$1',
                [browserTenant.tenant.id],
              )
            ).rows;
            assert.equal(saved.length, 1);
            assert.ok(saved[0].purchase_account_id);
            assert.equal(saved[0].status, 'PLACED');
            assert.equal(
              (
                await db.query('SELECT count(*)::int n FROM purchase_accounts WHERE tenant_id=$1', [
                  browserTenant.tenant.id,
                ])
              ).rows[0].n,
              2,
            );
            const lines = (
              await db.query(
                'SELECT quantity,unit_price::text FROM purchase_order_items WHERE purchase_order_id=$1 ORDER BY line_no',
                [saved[0].id],
              )
            ).rows;
            assert.deepEqual(lines, [
              { quantity: 10, unit_price: '18.50' },
              { quantity: 2, unit_price: '8.25' },
            ]);
            assert.equal(
              (
                await request('/purchase-orders/' + saved[0].id, {
                  tenant: browserTenant.tenant.id,
                })
              ).data.totalCost,
              '205.50',
            );
            process.stdout.write(
              'Browser-created accounts, order, two lines and 205.50 total verified in PostgreSQL.\n',
            );
          } finally {
            await web.close();
            await unlink(state).catch(() => {});
            await unlink(done).catch(() => {});
          }
        }
      });
    } finally {
      if (connected) await db.end();
      if (created) {
        await admin.query(
          'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',
          [name],
        );
        await admin.query(`DROP DATABASE "${name}"`);
      }
      await admin.end();
    }
  },
);
