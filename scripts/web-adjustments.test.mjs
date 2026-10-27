import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { access, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { loadEnvFile } from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';
import ts from 'typescript';
import { startTestApi } from './api-test-server.mjs';
const { Client } = createRequire(new URL('../apps/api/package.json', import.meta.url))('pg');
const run = promisify(execFile),
  output = new URL('../apps/admin-web/.test-build/adjustments/', import.meta.url);
await mkdir(output, { recursive: true });
for (const name of ['client', 'inventory', 'inventory-format', 'adjustment-form', 'adjustments']) {
  const source = await readFile(
    new URL(`../apps/admin-web/src/api/${name}.ts`, import.meta.url),
    'utf8',
  );
  await writeFile(
    new URL(name + '.mjs', output),
    ts
      .transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
      })
      .outputText.replace(
        /(['"])\.\/(client|inventory|adjustment-form)\1/g,
        (_a, _q, n) => `'./${n}.mjs'`,
      ),
  );
}
const policySource = await readFile(
  new URL('../apps/admin-web/src/router/policy.ts', import.meta.url),
  'utf8',
);
await writeFile(
  new URL('policy.mjs', output),
  ts.transpileModule(policySource, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText,
);
const { createApiClient, ApiFailure } = await import(new URL('client.mjs', output));
const { createAdjustments } = await import(new URL('adjustments.mjs', output));
const { createInventory } = await import(new URL('inventory.mjs', output));
const { movementSourcePath } = await import(new URL('inventory-format.mjs', output));
const {
  blankAdjustment,
  adjustmentErrors,
  adjustmentInput,
  pendingForm,
  createAdjustmentAttempt,
  adjustmentAttemptKey,
  adjustmentDefinitelyRejected,
} = await import(new URL('adjustment-form.mjs', output));
const { allowed, safeRedirect, inventoryPath } = await import(new URL('policy.mjs', output));
const memory = () => {
  const values = new Map();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
};
loadEnvFile(new URL('../.env', import.meta.url));
test('adjustment form, routing and safe pending operation', async (t) => {
  const valid = () => ({
    ...blankAdjustment(),
    warehouseId: randomUUID(),
    productId: randomUUID(),
    quantityDelta: '-2',
  });
  await t.test('nonzero integer bounds, reason direction and remarks', () => {
    const form = valid();
    assert.deepEqual(adjustmentErrors(form), {});
    for (const quantityDelta of [
      '0',
      '-0',
      '1.5',
      '1e2',
      '2147483648',
      '-2147483648',
      '1 2',
      'NaN',
    ])
      assert.ok(adjustmentErrors({ ...form, quantityDelta }).quantityDelta, quantityDelta);
    assert.ok(adjustmentErrors({ ...form, quantityDelta: '+2' }).quantityDelta);
    assert.deepEqual(
      adjustmentErrors({ ...form, quantityDelta: '+2', reason: 'STOCKTAKE_GAIN' }),
      {},
    );
    assert.ok(adjustmentErrors({ ...form, reason: 'OTHER', remark: ' ' }).remark);
    assert.ok(adjustmentErrors({ ...form, remark: 'x'.repeat(501) }).remark);
    assert.ok(adjustmentErrors({ ...form, remark: '\0' }).remark);
    assert.ok(adjustmentErrors({ ...form, warehouseId: 'foreign' }).warehouseId);
    assert.ok(adjustmentErrors({ ...form, reason: 'UNKNOWN' }).reason);
    const body = adjustmentInput({
      ...form,
      reason: 'OTHER',
      remark: ' 测试依据 ',
      quantityOnHand: 999,
      unitCost: '0',
    });
    assert.equal(body.remark, '测试依据');
    assert.equal(body.quantityDelta, -2);
    assert.equal('unitCost' in body, false);
    assert.equal('quantityOnHand' in body, false);
  });
  await t.test('reload reuses exact operation; edited pending operation cannot be sent', () => {
    assert.throws(
      () => adjustmentAttemptKey('user', undefined),
      (e) => e.code === 'FORBIDDEN',
    );
    assert.throws(
      () => adjustmentAttemptKey(undefined, 'tenant'),
      (e) => e.code === 'FORBIDDEN',
    );
    assert.notEqual(
      adjustmentAttemptKey('user', 'tenant-a'),
      adjustmentAttemptKey('user', 'tenant-b'),
    );
    const storage = memory(),
      form = valid(),
      a = createAdjustmentAttempt(storage, 'user-a/tenant-a');
    const first = a.begin(form),
      restored = createAdjustmentAttempt(storage, 'user-a/tenant-a');
    assert.deepEqual(restored.begin(form), first);
    assert.deepEqual(pendingForm(restored.read()), form);
    assert.throws(
      () => restored.begin({ ...form, quantityDelta: '-3' }),
      (e) => e.code === 'PENDING_ADJUSTMENT',
    );
    assert.equal(createAdjustmentAttempt(storage, 'user-a/tenant-b').read(), null);
    assert.equal(createAdjustmentAttempt(storage, 'user-b/tenant-a').read(), null);
    restored.clear();
    assert.equal(restored.read(), null);
    assert.notEqual(restored.begin(form).clientOperationId, first.clientOperationId);
    storage.setItem('broken', '{');
    assert.throws(
      () => createAdjustmentAttempt(storage, 'broken').read(),
      (e) => e.code === 'PENDING_ADJUSTMENT_UNREADABLE',
    );
    const unavailable = createAdjustmentAttempt(
      {
        getItem: () => null,
        setItem: () => {
          throw new Error('quota');
        },
        removeItem: () => {},
      },
      'x',
    );
    assert.throws(
      () => unavailable.begin(form),
      (e) => e.code === 'PENDING_STORAGE_UNAVAILABLE',
    );
    assert.equal(adjustmentDefinitelyRejected(new ApiFailure(409, 'OUT_OF_STOCK', '不足')), true);
    for (const error of [
      new ApiFailure(0, 'NETWORK_ERROR', 'lost'),
      new ApiFailure(500, 'INTERNAL_ERROR', 'error'),
      new ApiFailure(409, 'IDEMPOTENCY_CONFLICT', 'conflict'),
      new Error('unknown'),
    ])
      assert.equal(adjustmentDefinitelyRejected(error), false);
  });
  await t.test(
    'create route requires inventory permission; read routes and movement source links work',
    () => {
      const id = randomUUID();
      for (const path of ['/inventory/adjustments', '/inventory/adjustments/' + id]) {
        assert.equal(inventoryPath(path), true);
        assert.equal(allowed(path, ['products:read']), true);
        assert.equal(allowed(path, []), false);
        assert.equal(safeRedirect(path), path);
      }
      assert.equal(allowed('/inventory/adjustments/new', ['products:read']), false);
      assert.equal(
        allowed('/inventory/adjustments/new', ['products:read', 'inventory:write']),
        true,
      );
      assert.equal(
        movementSourcePath({ type: 'ADJUSTMENT', sourceDocumentId: id }),
        '/inventory/adjustments/' + id,
      );
      assert.equal(
        movementSourcePath({ type: 'RECEIPT', sourceDocumentId: id }),
        '/receipts/' + id,
      );
      assert.equal(movementSourcePath({ type: 'ADJUSTMENT', sourceDocumentId: null }), null);
    },
  );
});

test(
  'Web adjustment client with real API, PostgreSQL and optional browser acceptance',
  { timeout: 900000 },
  async (t) => {
    const source = new URL(process.env.DATABASE_URL);
    assert.equal(source.pathname, '/caicang');
    assert.ok(['localhost', '127.0.0.1'].includes(source.hostname));
    const name = 'caicang_test_' + randomUUID().replaceAll('-', '');
    assert.match(name, /^caicang_test_[a-f0-9]{32}$/);
    const url = new URL(source);
    url.pathname = '/' + name;
    const admin = new Client({ connectionString: source.toString() }),
      db = new Client({ connectionString: url.toString() });
    let created = false,
      connected = false;
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
      await t.test('real clients and inventory transactions', async (http) => {
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
          email: 'owner@task30.example.test',
          password: randomBytes(24).toString('base64url') + 'Aa1!',
        };
        const network = (input, init = {}) =>
          fetch(input, {
            ...init,
            headers: {
              ...init.headers,
              'X-Forwarded-For': `198.26.${Math.floor(++counter / 250)}.${(counter % 250) + 1}`,
            },
          });
        const clients = {},
          sessions = {};
        for (const actor of ['owner', 'admin', 'buyer', 'warehouse', 'viewer']) {
          clients[actor] = createApiClient({
            baseUrl: base + '/api/v1',
            storage: memory(),
            fetcher: network,
            lock: async (work) => work(),
          });
          await clients[actor].register({ ...credentials, email: actor + '@task30.example.test' });
          await clients[actor].login({ ...credentials, email: actor + '@task30.example.test' });
          sessions[actor] = clients[actor].sync();
        }
        const a = (
          await clients.owner.request('/tenants', { method: 'POST', body: { name: 'Web 调整 A' } })
        ).data;
        const b = (
          await clients.owner.request('/tenants', { method: 'POST', body: { name: 'Web 调整 B' } })
        ).data;
        for (const [actor, role] of [
          ['admin', 'ADMIN'],
          ['buyer', 'BUYER'],
          ['warehouse', 'WAREHOUSE'],
          ['viewer', 'VIEWER'],
        ])
          await clients.owner.request('/members', {
            method: 'POST',
            tenantId: a.tenant.id,
            body: { email: actor + '@task30.example.test', role },
          });
        const scopes = {};
        for (const actor of Object.keys(clients)) {
          const current = (
            await clients[actor].request('/tenants/current', { tenantId: a.tenant.id })
          ).data;
          scopes[actor] = {
            userId: current.membership.userId,
            sessionKey: sessions[actor].sessionKey,
            tenantId: a.tenant.id,
            permissions: current.permissions,
          };
        }
        let activeScope = scopes.owner;
        const api = createAdjustments(clients.owner, () => activeScope),
          inventory = createInventory(clients.owner, () => activeScope);
        const request = (path, body, tenantId = a.tenant.id) =>
          clients.owner.request(path, { method: 'POST', body, tenantId });
        const product = (
          await request('/products', {
            sku: 'TASK30-CHARGER',
            name: '20W 充电器',
            referencePurchasePrice: '99.00',
          })
        ).data;
        async function receive(tenant, productId) {
          const order = (
            await request(
              '/purchase-orders',
              {
                warehouseId: tenant.defaultWarehouse.id,
                platform: 'TAOBAO',
                purchaseDate: '2026-10-24',
                recipient: { name: '测试收货员', phone: '13800000000', address: '隔离测试仓库' },
                items: [{ productId, quantity: 10, unitPrice: '18.50' }],
              },
              tenant.tenant.id,
            )
          ).data;
          await request('/purchase-orders/' + order.id + '/place', {}, tenant.tenant.id);
          const pkg = (
            await request(
              '/purchase-orders/' + order.id + '/packages',
              { carrierCode: 'SF', trackingNo: '0000' + randomUUID() },
              tenant.tenant.id,
            )
          ).data;
          await request(
            '/receipts',
            {
              packageId: pkg.id,
              clientOperationId: randomUUID(),
              items: [{ purchaseOrderItemId: order.items[0].id, receivedQty: 10 }],
            },
            tenant.tenant.id,
          );
        }
        await receive(a, product.id);
        const form = {
          ...blankAdjustment(),
          warehouseId: a.defaultWarehouse.id,
          productId: product.id,
          quantityDelta: '-2',
          remark: '盘点差异核对',
        };
        const storage = memory(),
          attempt = createAdjustmentAttempt(storage, 'owner/' + a.tenant.id);
        let loss, gain;
        await http.test(
          'real Web loss 10 → 8, gain 8 → 11; refreshed balance and ledger reconcile',
          async () => {
            assert.equal(
              (await inventory.balances({ page: 1, pageSize: 20, productId: product.id })).data[0]
                .quantityOnHand,
              10,
            );
            loss = await api.create(attempt.begin(form));
            attempt.clear();
            assert.deepEqual(
              [loss.quantityBefore, loss.quantityDelta, loss.quantityAfter],
              [10, -2, 8],
            );
            gain = await api.create({
              ...adjustmentInput({
                ...form,
                quantityDelta: '+3',
                reason: 'STOCKTAKE_GAIN',
                remark: '发现漏计三件',
              }),
              clientOperationId: randomUUID(),
            });
            assert.deepEqual(
              [gain.quantityBefore, gain.quantityDelta, gain.quantityAfter],
              [8, 3, 11],
            );
            const fresh = createInventory(clients.owner, () => activeScope);
            assert.equal(
              (await fresh.balances({ page: 1, pageSize: 20, productId: product.id })).data[0]
                .quantityOnHand,
              11,
            );
            const movements = await fresh.movements({
              page: 1,
              pageSize: 20,
              productId: product.id,
              type: 'ADJUSTMENT',
            });
            assert.equal(movements.pagination.total, 2);
            for (const record of [loss, gain]) {
              const row = movements.data.find((row) => row.sourceDocumentId === record.id);
              assert.ok(row);
              assert.deepEqual(
                [row.quantityBefore, row.quantityDelta, row.quantityAfter],
                [record.quantityBefore, record.quantityDelta, record.quantityAfter],
              );
              assert.equal(row.sourceNo, record.adjustmentNo);
              assert.equal(movementSourcePath(row), '/inventory/adjustments/' + record.id);
              assert.equal(
                (await api.detail(row.sourceDocumentId)).createdByName,
                record.createdByName,
              );
            }
            assert.deepEqual(
              (
                await db.query(
                  'SELECT quantity_on_hand,total_cost::text FROM stock_balances WHERE tenant_id=$1 AND product_id=$2',
                  [a.tenant.id, product.id],
                )
              ).rows[0],
              { quantity_on_hand: 11, total_cost: '203.5000' },
            );
          },
        );
        await http.test(
          'list filters, pagination and direct cross-tenant detail do not leak data',
          async () => {
            const list = await api.list({
              page: 1,
              pageSize: 1,
              warehouseId: a.defaultWarehouse.id,
              search: 'TASK30',
            });
            assert.equal(list.pagination.total, 2);
            assert.equal(list.data.length, 1);
            assert.equal(
              (await api.list({ page: 1, pageSize: 20, reason: 'STOCKTAKE_LOSS' })).data[0].id,
              loss.id,
            );
            const today = new Date().toISOString().slice(0, 10);
            assert.equal(
              (await api.list({ page: 1, pageSize: 20, from: today, to: today })).pagination.total,
              2,
            );
            await assert.rejects(api.list({ page: 1, pageSize: 0 }), (e) => e.status === 400);
            const foreignScope = { ...scopes.owner, tenantId: b.tenant.id },
              other = createAdjustments(clients.owner, () => foreignScope);
            assert.equal((await other.list({ page: 1, pageSize: 20 })).pagination.total, 0);
            await assert.rejects(other.detail(loss.id), (e) => e.status === 404);
            await assert.rejects(
              api.create({
                ...adjustmentInput(form),
                warehouseId: b.defaultWarehouse.id,
                clientOperationId: randomUUID(),
              }),
              (e) => e.status === 404,
            );
            await assert.rejects(
              clients.viewer.request('/inventory/adjustments/' + loss.id, {
                tenantId: b.tenant.id,
              }),
              (e) => e.status === 403,
            );
          },
        );
        await http.test(
          'read-only roles can read; both client and API reject unauthorized writes',
          async () => {
            for (const actor of ['buyer', 'viewer']) {
              const readOnly = createAdjustments(clients[actor], () => scopes[actor]);
              assert.equal((await readOnly.detail(loss.id)).id, loss.id);
              await assert.rejects(
                readOnly.create({ ...adjustmentInput(form), clientOperationId: randomUUID() }),
                (e) => e.status === 403,
              );
              await assert.rejects(
                clients[actor].request('/inventory/adjustments', {
                  method: 'POST',
                  tenantId: a.tenant.id,
                  body: { ...adjustmentInput(form), clientOperationId: randomUUID() },
                }),
                (e) => e.status === 403,
              );
            }
            for (const actor of ['owner', 'admin', 'warehouse'])
              assert.ok(scopes[actor].permissions.includes('inventory:write'));
            const local = createAdjustments(
              {
                request: async () => {
                  activeScope = { ...activeScope, tenantId: b.tenant.id };
                  return { data: loss };
                },
              },
              () => activeScope,
            );
            await assert.rejects(local.detail(loss.id), (e) => e.code === 'SCOPE_CHANGED');
            activeScope = scopes.owner;
          },
        );
        await http.test(
          'lost response and reload preserve original operation, concurrent retries deduct only once',
          async () => {
            const pendingStorage = memory(),
              holder = createAdjustmentAttempt(pendingStorage, 'loss-retry'),
              payload = holder.begin({ ...form, quantityDelta: '-1' });
            const lossy = createAdjustments(
              {
                request: async (path, init) => {
                  await clients.owner.request(path, init);
                  throw new ApiFailure(0, 'NETWORK_ERROR', 'response lost after commit');
                },
              },
              () => activeScope,
            );
            await assert.rejects(lossy.create(payload), (e) => e.code === 'NETWORK_ERROR');
            assert.equal(holder.read().clientOperationId, payload.clientOperationId);
            const afterReload = createAdjustmentAttempt(pendingStorage, 'loss-retry'),
              same = afterReload.begin({ ...form, quantityDelta: '-1' });
            const [first, second] = await Promise.all([api.create(same), api.create(same)]);
            assert.equal(first.id, second.id);
            assert.equal(first.quantityAfter, 10);
            assert.equal(
              (
                await db.query(
                  'SELECT count(*)::int n FROM stock_adjustments WHERE tenant_id=$1 AND client_operation_id=$2',
                  [a.tenant.id, payload.clientOperationId],
                )
              ).rows[0].n,
              1,
            );
            assert.equal(
              (
                await db.query(
                  "SELECT count(*)::int n FROM stock_movements WHERE tenant_id=$1 AND source_type='ADJUSTMENT' AND source_item_id=$2",
                  [a.tenant.id, first.id],
                )
              ).rows[0].n,
              1,
            );
            afterReload.clear();
          },
        );
        await http.test(
          'server rejects insufficient stock and injected balances without any mutation',
          async () => {
            const count = async () =>
              (
                await db.query(
                  'SELECT (SELECT count(*)::int FROM stock_adjustments) adjustments,(SELECT count(*)::int FROM stock_movements) movements,(SELECT quantity_on_hand FROM stock_balances WHERE tenant_id=$1 AND product_id=$2) quantity',
                  [a.tenant.id, product.id],
                )
              ).rows[0];
            const before = await count();
            await assert.rejects(
              api.create({
                ...adjustmentInput({ ...form, quantityDelta: '-99' }),
                clientOperationId: randomUUID(),
              }),
              (e) => e.status === 409 && e.code === 'OUT_OF_STOCK' && e.details.available === 10,
            );
            await assert.rejects(
              request('/inventory/adjustments', {
                ...adjustmentInput(form),
                clientOperationId: randomUUID(),
                quantityOnHand: 100,
              }),
              (e) => e.status === 400,
            );
            await assert.rejects(
              request('/inventory/adjustments', {
                ...adjustmentInput(form),
                clientOperationId: randomUUID(),
                quantityDelta: 2,
              }),
              (e) => e.status === 422,
            );
            assert.deepEqual(await count(), before);
            let sent;
            const whitelist = createAdjustments(
              {
                request: async (_path, init) => {
                  sent = init.body;
                  return { data: loss };
                },
              },
              () => activeScope,
            );
            await whitelist.create({
              ...adjustmentInput(form),
              clientOperationId: randomUUID(),
              quantityOnHand: 999,
              totalCost: '0',
              unitCost: '0',
            });
            assert.equal('quantityOnHand' in sent, false);
            assert.equal('totalCost' in sent, false);
            assert.equal('unitCost' in sent, false);
          },
        );
        if (process.env.TASK30_BROWSER_CHECK === '1') {
          const { createServer } = await import(
            new URL('../apps/admin-web/node_modules/vite/dist/node/index.js', import.meta.url)
          );
          const tenant = (await request('/tenants', { name: '任务30浏览器验收' })).data;
          const p = (
            await request(
              '/products',
              {
                sku: 'TASK30-BROWSER',
                name: '20W 充电器',
                articleNo: 'C20',
                color: '白色',
                size: '标准',
                referencePurchasePrice: '99.00',
              },
              tenant.tenant.id,
            )
          ).data;
          await receive(tenant, p.id);
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
          const state = new URL('../test-results/task30-browser.json', import.meta.url),
            done = new URL('../test-results/task30-browser.done', import.meta.url);
          try {
            await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
            await unlink(done).catch((e) => {
              if (e.code !== 'ENOENT') throw e;
            });
            await web.listen();
            await writeFile(
              state,
              JSON.stringify({
                url: 'http://127.0.0.1:' + web.httpServer.address().port,
                ...credentials,
                tenantId: tenant.tenant.id,
                productId: p.id,
              }),
            );
            process.stdout.write(
              'Task 30 browser fixture ready: test-results/task30-browser.json\n',
            );
            let finished = false;
            for (let n = 0; n < 1200; n++) {
              try {
                await access(done);
                finished = true;
                break;
              } catch {
                await delay(500);
              }
            }
            assert.equal(finished, true, 'Browser acceptance must explicitly complete');
            const balance = (
              await db.query(
                'SELECT quantity_on_hand,total_cost::text FROM stock_balances WHERE tenant_id=$1 AND product_id=$2',
                [tenant.tenant.id, p.id],
              )
            ).rows[0];
            assert.deepEqual(balance, { quantity_on_hand: 11, total_cost: '203.5000' });
            const adjustments = (
              await db.query(
                'SELECT quantity_delta FROM stock_adjustments WHERE tenant_id=$1 ORDER BY created_at',
                [tenant.tenant.id],
              )
            ).rows;
            assert.deepEqual(adjustments, [{ quantity_delta: -2 }, { quantity_delta: 3 }]);
            const ledger = (
              await db.query(
                "SELECT quantity_before,quantity_delta,quantity_after FROM stock_movements WHERE tenant_id=$1 AND source_type='ADJUSTMENT' ORDER BY created_at",
                [tenant.tenant.id],
              )
            ).rows;
            assert.deepEqual(ledger, [
              { quantity_before: 10, quantity_delta: -2, quantity_after: 8 },
              { quantity_before: 8, quantity_delta: 3, quantity_after: 11 },
            ]);
            process.stdout.write(
              'Browser -2/+3 verified in PostgreSQL: 10 → 8 → 11, two adjustments, matching movements, cost 203.5000.\n',
            );
          } finally {
            await web.close();
            await unlink(state).catch(() => {});
            await unlink(done).catch(() => {});
          }
        }
      });
      await t.test('production Web build includes all three adjustment pages', async () => {
        const root = new URL('../apps/admin-web/dist/assets/', import.meta.url);
        let bundle = '';
        for (const name of await readdir(root))
          if (name.endsWith('.js')) bundle += await readFile(new URL(name, root), 'utf8');
        for (const label of [
          '库存调整详情',
          '新建库存调整',
          '调整前数量',
          '调整后数量',
          '重试确认原调整',
        ])
          assert.ok(bundle.includes(label), label);
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
