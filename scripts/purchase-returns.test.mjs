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
  'supplier returns: actual receipt quota, stock, cost, transactions and isolation',
  { timeout: 300000 },
  async (t) => {
    const source = new URL(process.env.DATABASE_URL);
    assert.equal(source.pathname, '/caicang');
    assert.ok(['localhost', '127.0.0.1'].includes(source.hostname));
    const name = 'caicang_test_' + randomUUID().replaceAll('-', '');
    const url = new URL(source);
    url.pathname = '/' + name;
    const admin = new Client({ connectionString: source.toString() });
    const db = new Client({ connectionString: url.toString() });
    let created = false,
      connected = false,
      count = 0,
      logs = '';
    try {
      await admin.connect();
      assert.match(name, /^caicang_test_[a-f0-9]{32}$/);
      await admin.query(`CREATE DATABASE "${name}"`);
      created = true;
      const migrate = () =>
        run(
          process.execPath,
          [
            fileURLToPath(
              new URL('../apps/api/node_modules/prisma/build/index.js', import.meta.url),
            ),
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
      await migrate();
      await migrate();
      await db.connect();
      connected = true;
      await t.test('real API and PostgreSQL', async (http) => {
        const env = {
          DATABASE_URL: url.toString(),
          NODE_ENV: 'test',
          JWT_ACCESS_SECRET: randomBytes(48).toString('hex'),
          TRUSTED_PROXIES: '127.0.0.1/32,::1/128',
        };
        const base = await startTestApi(http, {
          env,
          onOutput: (chunk) => {
            logs += chunk;
          },
        });
        const otherBase = await startTestApi(http, { env });
        const accounts = {};
        let a, b;
        const request = (
          path,
          { actor = 'owner', tenant = a, method = 'GET', body, server = base, headers = {} } = {},
        ) =>
          fetch(server + '/api/v1' + path, {
            method,
            headers: {
              'Content-Type': 'application/json',
              'X-Forwarded-For': `198.27.${Math.floor(++count / 250)}.${(count % 250) + 1}`,
              ...(actor && accounts[actor]
                ? { Authorization: 'Bearer ' + accounts[actor].accessToken }
                : {}),
              ...(tenant ? { 'X-Tenant-Id': tenant.tenant.id } : {}),
              ...headers,
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          });
        const read = async (response, status, code) => {
          const payload = await response.json();
          assert.equal(
            response.status,
            status,
            `${status} expected; actual ${response.status}, code ${payload.error?.code}`,
          );
          assert.equal(payload.requestId, response.headers.get('x-request-id'));
          if (code) assert.equal(payload.error.code, code);
          return payload.data;
        };
        for (const actor of ['owner', 'admin', 'buyer', 'warehouse', 'viewer']) {
          const input = {
            email: actor + '@supplier-returns.example.test',
            password: randomBytes(24).toString('hex') + '!Aa1',
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
          accounts[actor] = await read(
            await request('/auth/login', {
              actor: null,
              tenant: null,
              method: 'POST',
              body: input,
            }),
            200,
          );
        }
        a = await read(
          await request('/tenants', {
            tenant: null,
            method: 'POST',
            body: { name: '供应商退货 A' },
          }),
          201,
        );
        b = await read(
          await request('/tenants', {
            tenant: null,
            method: 'POST',
            body: { name: '供应商退货 B' },
          }),
          201,
        );
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

        const product = async (sku = 'RETURN-' + randomUUID(), tenant = a) =>
          read(
            await request('/products', {
              tenant,
              method: 'POST',
              body: { name: sku, sku, unit: '件' },
            }),
            201,
          );
        async function purchase(lines, tenant = a) {
          const draft = await read(
            await request('/purchase-orders', {
              tenant,
              method: 'POST',
              body: {
                warehouseId: tenant.defaultWarehouse.id,
                platform: 'TAOBAO',
                purchaseDate: '2026-10-25',
                recipient: { name: '隔离测试', phone: '13800000000', address: '虚构仓库' },
                items: lines.map(([p, quantity, unitPrice]) => ({
                  productId: p.id,
                  quantity,
                  unitPrice,
                })),
              },
            }),
            201,
          );
          return read(
            await request('/purchase-orders/' + draft.id + '/place', { tenant, method: 'POST' }),
            200,
          );
        }
        async function receive(po, quantities = po.items.map((i) => i.quantity), tenant = a) {
          const pkg = await read(
            await request('/purchase-orders/' + po.id + '/packages', {
              tenant,
              method: 'POST',
              body: {
                carrierCode: 'SF',
                trackingNo: '000' + randomUUID(),
                expectedItems: [],
              },
            }),
            201,
          );
          return read(
            await request('/receipts', {
              tenant,
              method: 'POST',
              body: {
                packageId: pkg.id,
                clientOperationId: randomUUID(),
                items: po.items.flatMap((i, index) =>
                  quantities[index]
                    ? [{ purchaseOrderItemId: i.id, receivedQty: quantities[index] }]
                    : [],
                ),
              },
            }),
            201,
          );
        }
        async function stocked(qty = 10, price = '18.50', tenant = a) {
          const p = await product(undefined, tenant),
            po = await purchase([[p, qty, price]], tenant);
          await receive(po, undefined, tenant);
          return { p, po };
        }
        const input = (po, qty = 2, extra = {}) => ({
          purchaseOrderId: po.id,
          reason: '供应商退货测试',
          returnDate: '2026-10-25',
          refundAmount: '29.99',
          items: [{ purchaseOrderItemId: po.items[0].id, quantity: qty }],
          ...extra,
        });
        const create = (body, opts = {}) =>
          request('/purchase-returns', { ...opts, method: 'POST', body });
        const patch = (id, body, opts = {}) =>
          request('/purchase-returns/' + id, { ...opts, method: 'PATCH', body });
        const confirm = (id, op = randomUUID(), opts = {}) =>
          request('/purchase-returns/' + id + '/confirm', {
            ...opts,
            method: 'POST',
            body: { clientOperationId: op },
          });
        const cancel = (id, opts = {}) =>
          request('/purchase-returns/' + id + '/cancel', { ...opts, method: 'POST', body: {} });
        const balance = async (p, tenant = a) =>
          (
            await db.query(
              'SELECT quantity_on_hand AS qty,total_cost::text AS cost FROM stock_balances WHERE tenant_id=$1 AND warehouse_id=$2 AND product_id=$3',
              [tenant.tenant.id, tenant.defaultWarehouse.id, p.id],
            )
          ).rows[0];
        const facts = async (id) =>
          (
            await db.query(
              `SELECT
        (SELECT row_to_json(r) FROM purchase_returns r WHERE r.id=$1) AS header,
        (SELECT count(*)::int FROM purchase_return_allocations x JOIN purchase_return_items i ON i.id=x.purchase_return_item_id WHERE i.purchase_return_id=$1) AS allocations,
        (SELECT count(*)::int FROM stock_movements m JOIN purchase_return_items i ON i.id=m.source_item_id WHERE i.purchase_return_id=$1 AND m.source_type='PURCHASE_RETURN') AS movements,
        (SELECT count(*)::int FROM audit_logs WHERE object_id=$1 AND object_type='purchase_return') AS audits`,
              [id],
            )
          ).rows[0];
        async function outgoing(p, qty) {
          return read(
            await request('/outbound-orders', {
              method: 'POST',
              body: {
                warehouseId: a.defaultWarehouse.id,
                customerName: '隔离收件人',
                customerPhone: '13800000000',
                customerAddress: '虚构地址',
                items: [{ productId: p.id, quantity: qty }],
              },
            }),
            201,
          );
        }
        const ship = (id, server = base) =>
          request('/outbound-orders/' + id + '/ship', {
            server,
            method: 'POST',
            body: { clientOperationId: randomUUID() },
          });
        let acceptance, accepted;

        await http.test(
          'receive 10, draft does not change stock, confirm 2 leaves 8; replay does not deduct again',
          async () => {
            acceptance = await stocked();
            const { p, po } = acceptance;
            const draft = await read(await create(input(po)), 201);
            assert.equal(draft.status, 'DRAFT');
            assert.equal(draft.stockCost, null);
            assert.deepEqual(await balance(p), { qty: 10, cost: '185.0000' });
            assert.equal((await facts(draft.id)).movements, 0);
            const op = randomUUID();
            accepted = await read(await confirm(draft.id, op), 201);
            assert.equal(accepted.status, 'CONFIRMED');
            assert.equal(accepted.stockCost, '37.0000');
            assert.equal(accepted.receivedCost, '37.0000');
            assert.equal(accepted.refundAmount, '29.99');
            assert.equal(accepted.confirmedBy, accounts.owner.user.id);
            assert.ok(accepted.confirmedAt);
            assert.equal(accepted.items[0].allocations[0].quantity, 2);
            assert.ok(accepted.items[0].allocations[0].receiptId);
            assert.deepEqual(await balance(p), { qty: 8, cost: '148.0000' });
            const before = await facts(draft.id);
            assert.equal(before.movements, 1);
            assert.equal(before.allocations, 1);
            assert.equal(before.audits, 2);
            assert.deepEqual(await read(await confirm(draft.id, op), 200), accepted);
            assert.deepEqual(await facts(draft.id), before);
            assert.deepEqual(await balance(p), { qty: 8, cost: '148.0000' });
            await read(await confirm(draft.id), 409, 'STATUS_CONFLICT');
            await read(await patch(draft.id, { refundAmount: '99.00' }), 409, 'STATUS_CONFLICT');
            await read(await cancel(draft.id), 409, 'STATUS_CONFLICT');
            const available = await read(
              await request('/purchase-orders/' + po.id + '/returnable'),
              200,
            );
            assert.equal(available.items[0].receivedQuantity, 10);
            assert.equal(available.items[0].returnedQuantity, 2);
            assert.equal(available.items[0].availableQuantity, 8);
            assert.equal(available.items[0].stockQuantity, 8);
            const movement = (
              await read(
                await request('/inventory/movements?type=PURCHASE_RETURN&productId=' + p.id),
                200,
              )
            )[0];
            assert.equal(movement.sourceDocumentId, accepted.id);
            assert.equal(movement.sourceNo, accepted.returnNo);
            assert.equal(movement.quantityDelta, -2);
            const original = await read(await request('/purchase-orders/' + po.id), 200);
            assert.equal(original.items[0].unitPrice, '18.50');
            assert.equal(original.items[0].receivedQuantity, 10);
          },
        );

        await http.test(
          'multiple SKUs, draft edit/cancel, cancelled documents have no stock effects',
          async () => {
            const x = await product(),
              y = await product(),
              po = await purchase([
                [x, 5, '10.00'],
                [y, 7, '20.00'],
              ]);
            await receive(po);
            let r = await read(await create(input(po, 1)), 201);
            r = await read(
              await patch(r.id, {
                items: po.items.map((i) => ({ purchaseOrderItemId: i.id, quantity: 2 })),
                refundAmount: '57.00',
                remark: '安全测试备注',
              }),
              200,
            );
            assert.equal(r.items.length, 2);
            assert.equal(r.refundAmount, '57.00');
            const beforeX = await balance(x),
              beforeY = await balance(y);
            const cancelled = await read(await cancel(r.id), 200);
            assert.equal(cancelled.status, 'CANCELLED');
            const f = await facts(r.id);
            await read(await cancel(r.id), 200);
            assert.deepEqual(await facts(r.id), f);
            await read(await confirm(r.id), 409, 'STATUS_CONFLICT');
            await read(await patch(r.id, { reason: '修改取消单' }), 409, 'STATUS_CONFLICT');
            assert.deepEqual(await balance(x), beforeX);
            assert.deepEqual(await balance(y), beforeY);
            const multi = await read(
              await create(
                input(po, 1, {
                  items: po.items.map((i) => ({ purchaseOrderItemId: i.id, quantity: 2 })),
                }),
              ),
              201,
            );
            const done = await read(await confirm(multi.id), 201);
            assert.equal(done.stockCost, '60.0000');
            assert.equal((await facts(multi.id)).movements, 2);
            assert.equal((await balance(x)).qty, 3);
            assert.equal((await balance(y)).qty, 5);
          },
        );

        await http.test(
          'only actually received quantities are returnable; FIFO and explicit receipt allocation',
          async () => {
            const p = await product(),
              po = await purchase([[p, 10, '2.00']]);
            await read(await create(input(po, 1)), 409, 'PURCHASE_RETURN_QTY_EXCEEDED');
            await receive(po, [6]);
            const first = await read(
              await request('/purchase-orders/' + po.id + '/returnable'),
              200,
            );
            await read(await create(input(po, 7)), 409, 'PURCHASE_RETURN_QTY_EXCEEDED');
            await receive(po, [4]);
            const r = await read(await create(input(po, 7)), 201);
            const done = await read(await confirm(r.id), 201);
            const sources = done.items[0].allocations;
            assert.equal(sources.length, 2);
            assert.equal(
              sources.find((s) => s.receiptItemId === first.items[0].receipts[0].receiptItemId)
                .quantity,
              6,
            );
            const available = await read(
              await request('/purchase-orders/' + po.id + '/returnable'),
              200,
            );
            const used = available.items[0].receipts.find((s) => s.availableQuantity === 0);
            const remaining = available.items[0].receipts.find((s) => s.availableQuantity === 3);
            await read(
              await create(
                input(po, 1, {
                  items: [
                    {
                      purchaseOrderItemId: po.items[0].id,
                      quantity: 1,
                      receiptItemId: used.receiptItemId,
                    },
                  ],
                }),
              ),
              409,
              'PURCHASE_RETURN_QTY_EXCEEDED',
            );
            const exact = await read(
              await create(
                input(po, 3, {
                  items: [
                    {
                      purchaseOrderItemId: po.items[0].id,
                      quantity: 3,
                      receiptItemId: remaining.receiptItemId,
                    },
                  ],
                }),
              ),
              201,
            );
            await read(await confirm(exact.id), 201);
            assert.equal((await balance(p)).qty, 0);
            await read(await create(input(po, 1)), 409, 'PURCHASE_RETURN_QTY_EXCEEDED');
          },
        );

        await http.test(
          'drafts do not reserve quota; confirmation rechecks confirmed returned quantities',
          async () => {
            const { p, po } = await stocked();
            const large = await read(await create(input(po, 10)), 201);
            const small = await read(await create(input(po, 1)), 201);
            await read(await confirm(small.id), 201);
            const before = await facts(large.id);
            await read(await confirm(large.id), 409, 'PURCHASE_RETURN_QTY_EXCEEDED');
            assert.deepEqual(await facts(large.id), before);
            assert.equal((await balance(p)).qty, 9);
          },
        );

        await http.test(
          'insufficient stock after real outbound is rejected atomically',
          async () => {
            const { p, po } = await stocked();
            const r = await read(await create(input(po, 2)), 201);
            const out = await outgoing(p, 9);
            await read(await ship(out.id), 201);
            const before = await facts(r.id),
              stock = await balance(p);
            await read(await confirm(r.id), 409, 'OUT_OF_STOCK');
            assert.deepEqual(await facts(r.id), before);
            assert.deepEqual(await balance(p), stock);
            assert.equal(stock.qty, 1);
          },
        );

        await http.test(
          'two API processes cannot over-return a source even with abundant current stock',
          async () => {
            const { p, po } = await stocked();
            const second = await purchase([[p, 10, '18.50']]);
            await receive(second);
            const one = await read(await create(input(po, 6)), 201),
              two = await read(await create(input(po, 6)), 201);
            const responses = await Promise.all([
              confirm(one.id),
              confirm(two.id, randomUUID(), { server: otherBase }),
            ]);
            assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
            for (const response of responses)
              await read(
                response,
                response.status,
                response.status === 409 ? 'PURCHASE_RETURN_QTY_EXCEEDED' : undefined,
              );
            assert.equal((await balance(p)).qty, 14);
          },
        );

        await http.test(
          'concurrent replay, operation UUID collision and outbound competition',
          async () => {
            const { p, po } = await stocked();
            const r = await read(await create(input(po)), 201),
              op = randomUUID();
            const results = await Promise.all([
              confirm(r.id, op),
              confirm(r.id, op, { server: otherBase }),
            ]);
            assert.deepEqual(results.map((r) => r.status).sort(), [200, 201]);
            for (const response of results) await read(response, response.status);
            assert.equal((await balance(p)).qty, 8);
            assert.equal((await facts(r.id)).movements, 1);
            const another = await read(await create(input(po)), 201);
            await read(await confirm(another.id, op), 409, 'IDEMPOTENCY_CONFLICT');
            const race = await stocked(),
              draft = await read(await create(input(race.po, 6)), 201),
              out = await outgoing(race.p, 6);
            const competed = await Promise.all([confirm(draft.id), ship(out.id, otherBase)]);
            assert.deepEqual(competed.map((r) => r.status).sort(), [201, 409]);
            for (const response of competed)
              await read(
                response,
                response.status,
                response.status === 409 ? 'OUT_OF_STOCK' : undefined,
              );
            assert.equal((await balance(race.p)).qty, 4);
          },
        );

        await http.test(
          'moving average stock cost, original receipt cost and actual refund remain separate',
          async () => {
            const { p, po } = await stocked();
            const more = await purchase([[p, 10, '30.00']]);
            await receive(more);
            const r = await read(await create(input(po, 2, { refundAmount: '35.00' })), 201);
            const done = await read(await confirm(r.id), 201);
            assert.equal(done.stockCost, '48.5000');
            assert.equal(done.receivedCost, '37.0000');
            assert.equal(done.refundAmount, '35.00');
            assert.deepEqual(await balance(p), { qty: 18, cost: '436.5000' });
            await read(
              await request('/products/' + p.id, {
                method: 'PATCH',
                body: { referencePurchasePrice: '99.00', isActive: false },
              }),
              200,
            );
            const again = await read(await request('/purchase-returns/' + r.id), 200);
            assert.deepEqual(again, done);
            assert.equal(
              (await read(await request('/purchase-orders/' + po.id), 200)).items[0].unitPrice,
              '18.50',
            );
          },
        );

        await http.test('rounding residual clears exactly when stock reaches zero', async () => {
          const { p, po } = await stocked(2, '0.01');
          const more = await purchase([[p, 1, '0.02']]);
          await receive(more);
          const r1 = await read(await create(input(more, 1)), 201);
          assert.equal((await read(await confirm(r1.id), 201)).stockCost, '0.0133');
          const r2 = await read(await create(input(po, 2)), 201);
          assert.equal((await read(await confirm(r2.id), 201)).stockCost, '0.0267');
          assert.deepEqual(await balance(p), { qty: 0, cost: '0.0000' });
        });

        await http.test(
          'tenant isolation and five roles; cross-source IDs do not leak data',
          async () => {
            const foreign = await stocked(10, '1.00', b);
            const foreignReturn = await read(await create(input(foreign.po), { tenant: b }), 201);
            await read(await request('/purchase-returns', { actor: null }), 401, 'UNAUTHENTICATED');
            await read(
              await request('/purchase-returns', { tenant: b, actor: 'viewer' }),
              403,
              'FORBIDDEN',
            );
            await read(await request('/purchase-returns/' + foreignReturn.id), 404, 'NOT_FOUND');
            await read(await confirm(foreignReturn.id), 404, 'NOT_FOUND');
            await read(await patch(foreignReturn.id, { reason: '不允许' }), 404, 'NOT_FOUND');
            await read(await cancel(foreignReturn.id), 404, 'NOT_FOUND');
            await read(
              await request('/purchase-orders/' + foreign.po.id + '/returnable'),
              404,
              'NOT_FOUND',
            );
            await read(await create(input(foreign.po)), 404, 'NOT_FOUND');
            await read(
              await create(
                input(acceptance.po, 1, {
                  items: [{ purchaseOrderItemId: foreign.po.items[0].id, quantity: 1 }],
                }),
              ),
              404,
              'NOT_FOUND',
            );
            const fAvailable = await read(
              await request('/purchase-orders/' + foreign.po.id + '/returnable', { tenant: b }),
              200,
            );
            await read(
              await create(
                input(acceptance.po, 1, {
                  items: [
                    {
                      purchaseOrderItemId: acceptance.po.items[0].id,
                      quantity: 1,
                      receiptItemId: fAvailable.items[0].receipts[0].receiptItemId,
                    },
                  ],
                }),
              ),
              404,
              'NOT_FOUND',
            );
            const draft = await read(
              await create(input(acceptance.po, 1), { actor: 'buyer' }),
              201,
            );
            await read(await confirm(draft.id, randomUUID(), { actor: 'buyer' }), 403, 'FORBIDDEN');
            await read(
              await create(input(acceptance.po, 1), { actor: 'warehouse' }),
              403,
              'FORBIDDEN',
            );
            await read(
              await create(input(acceptance.po, 1), { actor: 'viewer' }),
              403,
              'FORBIDDEN',
            );
            const viewed = await read(
              await request('/purchase-returns/' + draft.id, { actor: 'viewer' }),
              200,
            );
            assert.equal(viewed.reason, '[已隐藏]');
            assert.equal(viewed.remark, null);
            await read(await patch(draft.id, { remark: '管理员编辑' }, { actor: 'admin' }), 200);
            await read(await confirm(draft.id, randomUUID(), { actor: 'warehouse' }), 201);
            assert.equal(
              (await read(await request('/purchase-returns/' + draft.id), 200)).confirmedBy,
              accounts.warehouse.user.id,
            );
            assert.equal((await balance(foreign.p, b)).qty, 10);
            const ownList = await read(await request('/purchase-returns?pageSize=100'), 200);
            assert.ok(ownList.every((row) => row.tenantId === a.tenant.id));
          },
        );

        await http.test(
          'invalid DTOs, immutable ownership, filtered pagination and OpenAPI',
          async () => {
            const { po } = await stocked();
            for (const body of [
              input(po, 0),
              input(po, -1),
              input(po, 1.5),
              input(po, 1, { reason: '  ' }),
              input(po, 1, { returnDate: '2026-02-30' }),
              input(po, 1, { returnDate: '0000-01-01' }),
              input(po, 1, { refundAmount: '-1.00' }),
              input(po, 1, { refundAmount: 10 }),
              input(po, 1, { stockCost: '0.00' }),
              input(po, 1, { items: [input(po).items[0], input(po).items[0]] }),
            ])
              await read(await create(body), 400, 'VALIDATION_ERROR');
            const r = await read(await create(input(po)), 201);
            await read(
              await patch(r.id, { purchaseOrderId: acceptance.po.id }),
              400,
              'VALIDATION_ERROR',
            );
            await read(await patch(r.id, { items: null }), 400, 'VALIDATION_ERROR');
            await read(await patch(r.id, {}), 400, 'BAD_REQUEST');
            await read(
              await request('/purchase-returns/' + r.id + '/confirm', {
                method: 'POST',
                body: { clientOperationId: randomUUID(), quantity: 1 },
              }),
              400,
              'VALIDATION_ERROR',
            );
            await read(
              await request('/purchase-returns/' + r.id + '/cancel', {
                method: 'POST',
                body: { unexpected: true },
              }),
              400,
              'BAD_REQUEST',
            );
            await read(
              await request('/purchase-returns?from=2026-10-26&to=2026-10-25'),
              400,
              'BAD_REQUEST',
            );
            const list = await read(
              await request(
                '/purchase-returns?purchaseOrderId=' +
                  po.id +
                  '&status=DRAFT&from=2026-10-25&to=2026-10-25&pageSize=1',
              ),
              200,
            );
            assert.equal(list.length, 1);
            assert.equal(list[0].id, r.id);
            assert.equal(
              (await read(await request('/purchase-returns?search=%25_no_such_'), 200)).length,
              0,
            );
            const doc = await (await fetch(base + '/api/docs-json')).json();
            for (const [path, methods] of [
              ['/purchase-returns', ['get', 'post']],
              ['/purchase-returns/{id}', ['get', 'patch']],
              ['/purchase-returns/{id}/confirm', ['post']],
              ['/purchase-returns/{id}/cancel', ['post']],
              ['/purchase-orders/{id}/returnable', ['get']],
            ])
              assert.deepEqual(Object.keys(doc.paths['/api/v1' + path]).sort(), methods);
            assert.equal(doc.paths['/api/v1/stock-balances'], undefined);
            const raw = JSON.stringify(await read(await request('/purchase-returns/' + r.id), 200));
            assert.doesNotMatch(raw, /password|requestHash|accessToken/);
          },
        );

        await http.test(
          'audit failure rolls back draft changes, cancellation and confirmation including all stock writes',
          async () => {
            const { p, po } = await stocked();
            const r = await read(await create(input(po)), 201),
              op = randomUUID();
            const before = await facts(r.id),
              stock = await balance(p);
            const sentinel = 'private-return-audit-' + randomUUID();
            await db.query(`CREATE FUNCTION test_reject_return_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action LIKE 'PURCHASE_RETURN_%' THEN RAISE EXCEPTION '${sentinel}'; END IF; RETURN NEW; END $$;
          CREATE TRIGGER test_return_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION test_reject_return_audit()`);
            try {
              await read(await create(input(po, 1)), 500, 'INTERNAL_ERROR');
              await read(
                await patch(r.id, {
                  refundAmount: '5.00',
                  items: [{ purchaseOrderItemId: po.items[0].id, quantity: 1 }],
                }),
                500,
                'INTERNAL_ERROR',
              );
              await read(await cancel(r.id), 500, 'INTERNAL_ERROR');
              await read(await confirm(r.id, op), 500, 'INTERNAL_ERROR');
              assert.deepEqual(await facts(r.id), before);
              assert.deepEqual(await balance(p), stock);
              assert.equal(
                (
                  await db.query(
                    'SELECT count(*)::int AS n FROM purchase_returns WHERE purchase_order_id=$1',
                    [po.id],
                  )
                ).rows[0].n,
                1,
              );
            } finally {
              await db.query(
                'DROP TRIGGER test_return_audit ON audit_logs; DROP FUNCTION test_reject_return_audit()',
              );
            }
            await read(await confirm(r.id, op), 201);
            assert.equal((await balance(p)).qty, 8);
            assert.ok(!logs.includes(sentinel));
            assert.ok(!logs.includes(accounts.owner.accessToken));
            assert.ok(!logs.includes('安全测试备注'));
          },
        );

        await http.test(
          'database checks and composite foreign keys reject illegal data directly',
          async () => {
            const before = await balance(acceptance.p);
            await assert.rejects(
              db.query('UPDATE purchase_return_items SET quantity=0 WHERE id=$1', [
                accepted.items[0].id,
              ]),
              { code: '23514' },
            );
            await assert.rejects(
              db.query('UPDATE purchase_returns SET refund_amount=-1 WHERE id=$1', [accepted.id]),
              { code: '23514' },
            );
            await assert.rejects(
              db.query("UPDATE purchase_returns SET refund_amount='NaN' WHERE id=$1", [
                accepted.id,
              ]),
              { code: '23514' },
            );
            await assert.rejects(
              db.query('UPDATE purchase_returns SET confirmed_at=NULL WHERE id=$1', [accepted.id]),
              { code: '23514' },
            );
            await assert.rejects(
              db.query('UPDATE purchase_return_items SET tenant_id=$1 WHERE id=$2', [
                b.tenant.id,
                accepted.items[0].id,
              ]),
              { code: '23503' },
            );
            await assert.rejects(
              db.query(
                'UPDATE purchase_return_allocations SET quantity=0 WHERE purchase_return_item_id=$1',
                [accepted.items[0].id],
              ),
              { code: '23514' },
            );
            assert.deepEqual(await balance(acceptance.p), before);
          },
        );
        await http.test(
          'all balances reconcile to ledger quantities/cost and confirmed return lines',
          async () => {
            const mismatch = await db.query(`SELECT b.id FROM stock_balances b
          LEFT JOIN (SELECT tenant_id,warehouse_id,product_id,SUM(quantity_delta) qty,SUM(cost_delta) cost
            FROM stock_movements GROUP BY tenant_id,warehouse_id,product_id) m
          USING(tenant_id,warehouse_id,product_id)
          WHERE b.quantity_on_hand<>COALESCE(m.qty,0) OR b.total_cost<>COALESCE(m.cost,0)`);
            assert.equal(mismatch.rowCount, 0);
            const brokenReturn = await db.query(`SELECT i.id FROM purchase_return_items i
          JOIN purchase_returns r ON r.tenant_id=i.tenant_id AND r.id=i.purchase_return_id
          LEFT JOIN stock_movements m ON m.tenant_id=i.tenant_id AND m.source_item_id=i.id AND m.source_type='PURCHASE_RETURN'
          LEFT JOIN (SELECT tenant_id,purchase_return_item_id,SUM(quantity) qty FROM purchase_return_allocations GROUP BY tenant_id,purchase_return_item_id) a
            ON a.tenant_id=i.tenant_id AND a.purchase_return_item_id=i.id
          WHERE (r.status='CONFIRMED' AND (m.id IS NULL OR m.quantity_delta<>-i.quantity OR m.cost_delta<>-i.stock_cost OR COALESCE(a.qty,0)<>i.quantity))
             OR (r.status<>'CONFIRMED' AND (m.id IS NOT NULL OR a.qty IS NOT NULL))`);
            assert.equal(brokenReturn.rowCount, 0);
          },
        );
        assert.doesNotMatch(logs, /bootstrap_failed|unhandled/i);
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
