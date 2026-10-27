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
  output = new URL('../apps/admin-web/.test-build/returns/', import.meta.url);
await mkdir(output, { recursive: true });
for (const name of ['client', 'inventory', 'inventory-format', 'return-form', 'purchase-returns']) {
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
        /(['"])\.\/(client|inventory|return-form)\1/g,
        (_a, _q, n) => `'./${n}.mjs'`,
      ),
  );
}
await writeFile(
  new URL('policy.mjs', output),
  ts.transpileModule(
    await readFile(new URL('../apps/admin-web/src/router/policy.ts', import.meta.url), 'utf8'),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } },
  ).outputText,
);
const { createApiClient, ApiFailure } = await import(new URL('client.mjs', output));
const { createPurchaseReturns } = await import(new URL('purchase-returns.mjs', output));
const { createInventory } = await import(new URL('inventory.mjs', output));
const { blankReturn, returnErrors, returnInput, returnEstimate, returnConfirmation } = await import(
  new URL('return-form.mjs', output)
);
const { movementSourcePath } = await import(new URL('inventory-format.mjs', output));
const { allowed, safeRedirect, purchaseReturnPath } = await import(new URL('policy.mjs', output));
const memory = () => {
  const values = new Map();
  return {
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, v),
    removeItem: (k) => values.delete(k),
  };
};
loadEnvFile(new URL('../.env', import.meta.url));

test('return form money, input validation and document-scoped confirmation', async (t) => {
  const id = randomUUID(),
    lineId = randomUUID();
  const form = {
    ...blankReturn(),
    purchaseOrderId: id,
    reason: '退给供应商',
    quantities: { [lineId]: '2' },
    refundAmount: '35.00',
  };
  const source = {
    purchaseOrderId: id,
    items: [
      {
        purchaseOrderItemId: lineId,
        availableQuantity: 10,
        orderedQuantity: 10,
        purchaseNetAmount: '180.00',
      },
    ],
  };
  await t.test(
    'estimate uses integer cents, not reference cost or refund; rounds each original line',
    () => {
      assert.deepEqual(returnErrors(form, source), {});
      assert.equal(returnEstimate(form, source), '36.00');
      assert.equal(returnEstimate({ ...form, refundAmount: '0.01' }, source), '36.00');
      assert.equal(
        returnEstimate(
          { ...form, quantities: { [lineId]: '1' } },
          {
            ...source,
            items: [{ ...source.items[0], orderedQuantity: 3, purchaseNetAmount: '0.01' }],
          },
        ),
        '0.00',
      );
      assert.equal(
        returnEstimate(
          { ...form, quantities: { [lineId]: '2' } },
          {
            ...source,
            items: [{ ...source.items[0], orderedQuantity: 3, purchaseNetAmount: '0.01' }],
          },
        ),
        '0.01',
      );
      assert.equal(
        returnEstimate(form, {
          ...source,
          items: [
            { ...source.items[0], orderedQuantity: 2, purchaseNetAmount: '9999999999999999.99' },
          ],
        }),
        '9999999999999999.99',
      );
      assert.equal(returnEstimate(form, null), '0.00');
      const payload = returnInput(
        { ...form, stockCost: '0', estimatedRefundAmount: '999' },
        source,
      );
      assert.equal('estimatedRefundAmount' in payload, false);
      assert.equal('stockCost' in payload, false);
      assert.deepEqual(payload.items, [{ purchaseOrderItemId: lineId, quantity: 2 }]);
    },
  );
  await t.test(
    'invalid, fractional, stale or foreign quantities/dates/money are rejected locally',
    () => {
      for (const qty of ['-1', '1.5', '1e2', '2147483648', '11', 'NaN'])
        assert.ok(
          Object.keys(returnErrors({ ...form, quantities: { [lineId]: qty } }, source)).length,
          qty,
        );
      for (const date of ['2026-02-30', '0000-01-01', '', '2026-1-1'])
        assert.ok(returnErrors({ ...form, returnDate: date }, source).returnDate);
      for (const amount of ['-1', '1.001', 'NaN', '1e2', '10000000000000000.00'])
        assert.ok(returnErrors({ ...form, refundAmount: amount }, source).refundAmount);
      assert.ok(returnErrors({ ...form, reason: ' ' }, source).reason);
      assert.ok(returnErrors(form, null).purchaseOrderId);
      const unknown = randomUUID();
      assert.ok(returnErrors({ ...form, quantities: { [unknown]: '1' } }, source)[unknown]);
      assert.ok(returnErrors({ ...form, quantities: {} }, source).items);
    },
  );
  await t.test(
    'reload reuses UUID, cannot share keys across users/tenants/documents; unavailable storage blocks HTTP',
    () => {
      const storage = memory(),
        first = returnConfirmation(storage, 'user', 'tenant', id)();
      assert.equal(returnConfirmation(storage, 'user', 'tenant', id)(), first);
      assert.notEqual(returnConfirmation(storage, 'user', 'other', id)(), first);
      assert.notEqual(returnConfirmation(storage, 'other', 'tenant', id)(), first);
      assert.notEqual(returnConfirmation(storage, 'user', 'tenant', randomUUID())(), first);
      assert.throws(
        () => returnConfirmation(storage, 'user', undefined, id),
        (e) => e.code === 'FORBIDDEN',
      );
      assert.throws(
        () =>
          returnConfirmation(
            {
              getItem: () => null,
              setItem: () => {
                throw new Error('quota');
              },
            },
            'user',
            'tenant',
            id,
          )(),
        (e) => e.code === 'CONFIRM_STORAGE_UNAVAILABLE',
      );
    },
  );
  await t.test('read/create routing and inventory source link match actual permissions', () => {
    for (const path of ['/purchase-returns', '/purchase-returns/' + id]) {
      assert.equal(purchaseReturnPath(path), true);
      assert.equal(allowed(path, ['purchase:read']), true);
      assert.equal(allowed(path, []), false);
      assert.equal(safeRedirect(path), path);
    }
    assert.equal(allowed('/purchase-returns/new', ['purchase:read']), false);
    assert.equal(allowed('/purchase-returns/new', ['purchase:write']), true);
    assert.equal(safeRedirect('/purchase-returns/evil'), '/');
    assert.equal(
      movementSourcePath({ type: 'PURCHASE_RETURN', sourceDocumentId: id }),
      '/purchase-returns/' + id,
    );
  });
});

test(
  'Web returns with real API, original purchase, receipt, balances, ledger and refunds',
  { timeout: 900000 },
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
      await t.test('actual Web services and isolated PostgreSQL', async (http) => {
        const base = await startTestApi(http, {
          env: {
            DATABASE_URL: url.toString(),
            NODE_ENV: 'test',
            JWT_ACCESS_SECRET: randomBytes(48).toString('hex'),
            TRUSTED_PROXIES: '127.0.0.1/32,::1/128',
          },
        });
        let counter = 0;
        const clients = {},
          scopes = {};
        const credentials = {
          email: 'owner@task32.example.test',
          password: randomBytes(24).toString('hex') + 'Aa1!',
        };
        const network = (input, init = {}) =>
          fetch(input, {
            ...init,
            headers: {
              ...init.headers,
              'X-Forwarded-For': `198.28.${Math.floor(++counter / 250)}.${(counter % 250) + 1}`,
            },
          });
        for (const actor of ['owner', 'buyer', 'warehouse', 'viewer']) {
          const c = (clients[actor] = createApiClient({
            baseUrl: base + '/api/v1',
            storage: memory(),
            fetcher: network,
            lock: async (work) => work(),
          }));
          const input = { ...credentials, email: actor + '@task32.example.test' };
          await c.register(input);
          await c.login(input);
        }
        const a = (
          await clients.owner.request('/tenants', { method: 'POST', body: { name: 'Web 退货 A' } })
        ).data;
        const b = (
          await clients.owner.request('/tenants', { method: 'POST', body: { name: 'Web 退货 B' } })
        ).data;
        for (const [actor, role] of [
          ['buyer', 'BUYER'],
          ['warehouse', 'WAREHOUSE'],
          ['viewer', 'VIEWER'],
        ])
          await clients.owner.request('/members', {
            tenantId: a.tenant.id,
            method: 'POST',
            body: { email: actor + '@task32.example.test', role },
          });
        for (const actor of Object.keys(clients)) {
          const current = (
            await clients[actor].request('/tenants/current', { tenantId: a.tenant.id })
          ).data;
          scopes[actor] = {
            userId: current.membership.userId,
            tenantId: a.tenant.id,
            sessionKey: clients[actor].sync().sessionKey,
            permissions: current.permissions,
          };
        }
        let activeScope = scopes.owner;
        const api = createPurchaseReturns(clients.owner, () => activeScope),
          inventory = createInventory(clients.owner, () => activeScope);
        const request = (path, body, tenantId = a.tenant.id) =>
          clients.owner.request(path, { tenantId, method: 'POST', body });
        async function stock(sku, tenant = a) {
          const p = (
            await request(
              '/products',
              { sku, name: '20W 充电器 ' + sku, unit: '件', referencePurchasePrice: '99.00' },
              tenant.tenant.id,
            )
          ).data;
          const draft = (
            await request(
              '/purchase-orders',
              {
                platform: 'TAOBAO',
                warehouseId: tenant.defaultWarehouse.id,
                purchaseDate: '2026-10-25',
                recipient: { name: '隔离测试', phone: '13800000000', address: '虚构地址' },
                freightAmount: '10.00',
                items: [
                  { productId: p.id, quantity: 10, unitPrice: '18.50', discountAmount: '5.00' },
                ],
              },
              tenant.tenant.id,
            )
          ).data;
          const po = (
            await request('/purchase-orders/' + draft.id + '/place', {}, tenant.tenant.id)
          ).data;
          const pkg = (
            await request(
              '/purchase-orders/' + po.id + '/packages',
              { carrierCode: 'SF', trackingNo: '000' + randomUUID(), expectedItems: [] },
              tenant.tenant.id,
            )
          ).data;
          await request(
            '/receipts',
            {
              packageId: pkg.id,
              clientOperationId: randomUUID(),
              items: [{ purchaseOrderItemId: po.items[0].id, receivedQty: 10 }],
            },
            tenant.tenant.id,
          );
          return { p, po };
        }
        const acceptance = await stock('TASK32-CHARGER');
        const available = await api.returnable(acceptance.po.id);
        const form = {
          ...blankReturn(),
          purchaseOrderId: acceptance.po.id,
          reason: '部分商品退给供应商',
          refundAmount: '35.00',
          quantities: { [acceptance.po.items[0].id]: '2' },
          remark: '隔离验收',
        };
        let r, confirmed;
        const op = returnConfirmation(memory(), scopes.owner.userId, a.tenant.id, randomUUID())();
        await http.test(
          'real original selection, source quantities, preview, persisted draft and reload',
          async () => {
            assert.ok((await api.purchases('', 1)).data.some((i) => i.id === acceptance.po.id));
            assert.equal(
              (await api.purchases(acceptance.po.orderNo, 1)).data[0].id,
              acceptance.po.id,
            );
            assert.equal(available.items[0].receivedQuantity, 10);
            assert.equal(available.items[0].returnedQuantity, 0);
            assert.equal(available.items[0].availableQuantity, 10);
            assert.equal(returnEstimate(form, available), '36.00');
            r = await api.create(returnInput(form, available));
            assert.equal(r.estimatedRefundAmount, '36.00');
            assert.equal(r.refundAmount, '35.00');
            assert.equal(r.status, 'DRAFT');
            assert.deepEqual(await api.detail(r.id), r);
            assert.equal(
              (await inventory.balances({ page: 1, pageSize: 20, productId: acceptance.p.id }))
                .data[0].quantityOnHand,
              10,
            );
          },
        );
        await http.test(
          'confirmation, replay, real balance/ledger/refund and original purchase reconcile',
          async () => {
            confirmed = await api.confirm(r.id, op);
            assert.equal(confirmed.status, 'CONFIRMED');
            assert.equal(confirmed.confirmedByName, 'owner');
            assert.equal(confirmed.estimatedRefundAmount, '36.00');
            assert.equal(confirmed.refundAmount, '35.00');
            assert.equal(confirmed.stockCost, '38.0000');
            assert.deepEqual(await api.confirm(r.id, op), confirmed);
            const balance = (
              await inventory.balances({ page: 1, pageSize: 20, productId: acceptance.p.id })
            ).data[0];
            assert.equal(balance.quantityOnHand, 8);
            assert.equal(balance.totalCost, '152.0000');
            const movements = (
              await inventory.movements({
                page: 1,
                pageSize: 20,
                productId: acceptance.p.id,
                type: 'PURCHASE_RETURN',
              })
            ).data;
            assert.equal(movements.length, 1);
            assert.equal(movements[0].sourceDocumentId, r.id);
            assert.equal(movements[0].quantityBefore, 10);
            assert.equal(movements[0].quantityAfter, 8);
            const original = (
              await clients.owner.request('/purchase-orders/' + acceptance.po.id, {
                tenantId: a.tenant.id,
              })
            ).data;
            assert.equal(original.items[0].unitPrice, '18.50');
            assert.equal(original.items[0].receivedQuantity, 10);
            assert.equal(original.totalCost, '190.00');
            const stored = (
              await db.query(
                'SELECT refund_amount::text,status,confirmed_at FROM purchase_returns WHERE id=$1',
                [r.id],
              )
            ).rows[0];
            assert.equal(stored.refund_amount, '35.00');
            assert.equal(stored.status, 'CONFIRMED');
            assert.ok(stored.confirmed_at);
          },
        );
        await http.test(
          'list searches return number, purchase number, SKU, dates, status and pagination',
          async () => {
            for (const search of [r.returnNo, acceptance.po.orderNo, acceptance.p.sku])
              assert.equal(
                (
                  await api.list({
                    page: 1,
                    pageSize: 1,
                    search,
                    status: 'CONFIRMED',
                    from: form.returnDate,
                    to: form.returnDate,
                  })
                ).data[0].id,
                r.id,
              );
            assert.equal(
              (
                await api.list({
                  page: 1,
                  pageSize: 20,
                  status: 'DRAFT',
                  purchaseOrderId: acceptance.po.id,
                })
              ).data.length,
              0,
            );
          },
        );
        await http.test(
          'server refuses excess even bypassing local form, and cancellation never changes stock',
          async () => {
            await assert.rejects(
              api.create({
                ...returnInput(form, available),
                items: [{ purchaseOrderItemId: acceptance.po.items[0].id, quantity: 9 }],
              }),
              (e) => e.status === 409 && e.code === 'PURCHASE_RETURN_QTY_EXCEEDED' && !!e.requestId,
            );
            const draft = await api.create(returnInput(form, available));
            assert.equal((await api.cancel(draft.id)).status, 'CANCELLED');
            await api.cancel(draft.id);
            await assert.rejects(
              api.confirm(draft.id, randomUUID()),
              (e) => e.status === 409 && e.code === 'STATUS_CONFLICT',
            );
            assert.equal(
              (await inventory.balances({ page: 1, pageSize: 20, productId: acceptance.p.id }))
                .data[0].quantityOnHand,
              8,
            );
          },
        );
        await http.test(
          'Web permission checks and real server both reject unauthorized actions and foreign IDs',
          async () => {
            const foreign = await stock('TASK32-FOREIGN', b);
            await assert.rejects(api.returnable(foreign.po.id), (e) => e.status === 404);
            for (const actor of ['buyer', 'warehouse', 'viewer']) {
              const service = createPurchaseReturns(clients[actor], () => scopes[actor]);
              assert.equal((await service.detail(r.id)).id, r.id);
              if (actor !== 'warehouse') {
                await assert.rejects(service.confirm(r.id, randomUUID()), (e) => e.status === 403);
                await assert.rejects(
                  clients[actor].request('/purchase-returns/' + r.id + '/confirm', {
                    tenantId: a.tenant.id,
                    method: 'POST',
                    body: { clientOperationId: randomUUID() },
                  }),
                  (e) => e.status === 403,
                );
              }
              if (actor !== 'buyer') {
                await assert.rejects(
                  service.create(returnInput(form, available)),
                  (e) => e.status === 403,
                );
                await assert.rejects(service.cancel(r.id), (e) => e.status === 403);
              }
            }
            const viewed = await createPurchaseReturns(clients.viewer, () => scopes.viewer).detail(
              r.id,
            );
            assert.equal(viewed.reason, '[已隐藏]');
          },
        );
        await http.test(
          'uncertain confirmation response reuses UUID and cannot double deduct',
          async () => {
            const draft = await api.create(returnInput(form, available)),
              storage = memory(),
              begin = returnConfirmation(storage, scopes.owner.userId, a.tenant.id, draft.id);
            const responseLost = createPurchaseReturns(
              {
                request: async (...args) => {
                  await clients.owner.request(...args);
                  throw new ApiFailure(0, 'NETWORK_ERROR', 'Response lost after server commit');
                },
              },
              () => activeScope,
            );
            // Failure injection after a genuine server commit; no mock stock transaction.
            await assert.rejects(
              responseLost.confirm(draft.id, begin()),
              (e) => e.code === 'NETWORK_ERROR',
            );
            const recreated = returnConfirmation(
              storage,
              scopes.owner.userId,
              a.tenant.id,
              draft.id,
            );
            const result = await api.confirm(draft.id, recreated());
            assert.equal(result.confirmOperationId, begin());
            assert.equal(
              (await inventory.balances({ page: 1, pageSize: 20, productId: acceptance.p.id }))
                .data[0].quantityOnHand,
              6,
            );
            assert.equal(
              (
                await db.query(
                  "SELECT count(*)::int n FROM stock_movements m JOIN purchase_return_items i ON i.id=m.source_item_id WHERE i.purchase_return_id=$1 AND m.source_type='PURCHASE_RETURN'",
                  [draft.id],
                )
              ).rows[0].n,
              1,
            );
          },
        );
        await http.test(
          'multiple SKUs have the same cent rounding in preview and server response',
          async () => {
            const p1 = (await request('/products', { sku: 'RETURN-ROUND-1', name: '尾差商品1' }))
              .data;
            const p2 = (await request('/products', { sku: 'RETURN-ROUND-2', name: '尾差商品2' }))
              .data;
            let po = (
              await request('/purchase-orders', {
                warehouseId: a.defaultWarehouse.id,
                platform: 'JD',
                purchaseDate: '2026-10-25',
                recipient: { name: '测试', phone: '13800000000', address: '虚构地址' },
                items: [
                  { productId: p1.id, quantity: 3, unitPrice: '0.01', discountAmount: '0.02' },
                  { productId: p2.id, quantity: 3, unitPrice: '0.03', discountAmount: '0.01' },
                ],
              })
            ).data;
            po = (await request('/purchase-orders/' + po.id + '/place', {})).data;
            const pkg = (
              await request('/purchase-orders/' + po.id + '/packages', {
                carrierCode: 'SF',
                trackingNo: '000' + randomUUID(),
                expectedItems: [],
              })
            ).data;
            await request('/receipts', {
              packageId: pkg.id,
              clientOperationId: randomUUID(),
              items: po.items.map((i) => ({ purchaseOrderItemId: i.id, receivedQty: 3 })),
            });
            const input = {
              ...blankReturn(),
              purchaseOrderId: po.id,
              reason: '多 SKU 尾差测试',
              refundAmount: '0.07',
              quantities: Object.fromEntries(po.items.map((i) => [i.id, '2'])),
            };
            const sources = await api.returnable(po.id),
              draft = await api.create(returnInput(input, sources));
            assert.equal(returnEstimate(input, sources), '0.06');
            assert.equal(draft.estimatedRefundAmount, '0.06');
            assert.deepEqual(draft.items.map((i) => i.estimatedRefundAmount).sort(), [
              '0.01',
              '0.05',
            ]);
            assert.equal((await api.confirm(draft.id, randomUUID())).refundAmount, '0.07');
          },
        );
        await http.test('late response after workspace switch is discarded', async () => {
          let release;
          const gate = new Promise((resolve) => {
            release = resolve;
          });
          const delayed = createPurchaseReturns(
            {
              request: async (...args) => {
                const result = await clients.owner.request(...args);
                await gate;
                return result;
              },
            },
            () => activeScope,
          );
          const pending = delayed.detail(r.id);
          await delay(100);
          activeScope = { ...scopes.owner, tenantId: b.tenant.id };
          release();
          await assert.rejects(pending, (e) => e.code === 'SCOPE_CHANGED');
          activeScope = scopes.owner;
        });
        await http.test('production Web build contains all return pages', async () => {
          const assets = await readdir(new URL('../apps/admin-web/dist/assets/', import.meta.url));
          for (const page of [
            'PurchaseReturnsView',
            'PurchaseReturnFormView',
            'PurchaseReturnDetailView',
          ])
            assert.ok(
              assets.some((file) => file.startsWith(page + '-') && file.endsWith('.js')),
              page,
            );
        });

        if (process.env.TASK32_BROWSER === '1') {
          const fixture = await stock('TASK32-BROWSER');
          const { createServer } = createRequire(
            new URL('../apps/admin-web/package.json', import.meta.url),
          )('vite');
          const web = await createServer({
            root: fileURLToPath(new URL('../apps/admin-web/', import.meta.url)),
            configFile: fileURLToPath(new URL('../apps/admin-web/vite.config.ts', import.meta.url)),
            logLevel: 'silent',
            server: {
              host: '127.0.0.1',
              port: 0,
              strictPort: true,
              proxy: { '/api': { target: base, changeOrigin: false } },
            },
          });
          const state = new URL('../test-results/task32-browser.json', import.meta.url),
            done = new URL('../test-results/task32-browser.done', import.meta.url);
          try {
            await unlink(done).catch((e) => {
              if (e.code !== 'ENOENT') throw e;
            });
            await web.listen();
            await writeFile(
              state,
              JSON.stringify({
                url: 'http://127.0.0.1:' + web.httpServer.address().port,
                ...credentials,
                tenantId: a.tenant.id,
                purchaseOrderId: fixture.po.id,
                productId: fixture.p.id,
              }),
            );
            process.stdout.write(
              'Task 32 browser fixture ready: test-results/task32-browser.json\n',
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
            assert.ok(finished, 'Browser acceptance must explicitly complete');
            const result = (
              await db.query(
                `SELECT r.status,r.refund_amount::text,r.id,r.purchase_order_id FROM purchase_returns r WHERE r.purchase_order_id=$1`,
                [fixture.po.id],
              )
            ).rows;
            assert.equal(result.length, 1);
            assert.equal(result[0].status, 'CONFIRMED');
            assert.equal(result[0].refund_amount, '35.00');
            const balance = (
              await db.query(
                'SELECT quantity_on_hand,total_cost::text FROM stock_balances WHERE tenant_id=$1 AND product_id=$2',
                [a.tenant.id, fixture.p.id],
              )
            ).rows[0];
            assert.deepEqual(balance, { quantity_on_hand: 8, total_cost: '152.0000' });
            const ledger = (
              await db.query(
                "SELECT quantity_before,quantity_delta,quantity_after FROM stock_movements WHERE tenant_id=$1 AND product_id=$2 AND source_type='PURCHASE_RETURN'",
                [a.tenant.id, fixture.p.id],
              )
            ).rows;
            assert.deepEqual(ledger, [
              { quantity_before: 10, quantity_delta: -2, quantity_after: 8 },
            ]);
          } finally {
            await web.close();
            await unlink(state).catch(() => {});
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
