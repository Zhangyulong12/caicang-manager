/**
 * Task 21 — the mobile receiving flow: draft building, idempotent retry, real POST /receipts.
 *
 * The pure part (quantities, payload, UUID reuse, error wording) runs everywhere.
 * The second part is a real PostgreSQL + real API acceptance run: receive 5 of 10 units,
 * retry with the same operation id after a lost response (stock must stay at 5), then submit
 * a different quantity (new UUID, stock 10 -> 7) and an over-limit quantity (409 with the
 * remaining amount). It is skipped, not faked, when PostgreSQL is unavailable.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';
import ts from 'typescript';
import { startTestApi } from './api-test-server.mjs';

const { Client } = createRequire(new URL('../apps/api/package.json', import.meta.url))('pg');
const run = promisify(execFile);
loadEnvFile(new URL('../.env', import.meta.url));

const mobile = (path) => new URL('../apps/mobile/' + path, import.meta.url);
const output = mobile('.test-build/');
await mkdir(output, { recursive: true });
for (const [source, target] of [
  ['src/services/receiving.ts', 'receiving.mjs'],
  ['src/services/operation-log.ts', 'operation-log.mjs'],
  ['src/api/client.ts', 'client.mjs'],
])
  await writeFile(
    new URL(target, output),
    // 转译后三个模块同处一个目录：把相对路径改写成同目录的 .mjs，Node 才能解析。
    ts
      .transpileModule(await readFile(mobile(source), 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
      })
      .outputText.replaceAll("'../api/client'", "'./client.mjs'"),
  );

const {
  MAX_REMARK_LENGTH,
  PENDING_KEY,
  ReceiptInputError,
  ReceiptSubmitting,
  buildReceiptDraft,
  describeReceiptFailure,
  draftFingerprint,
  newOperationId,
  parseQuantity,
  receivingBlockedReason,
  toReceivableRows,
} = await import(new URL('receiving.mjs', output));
const { appendOperation, clearOperations, readOperations, OPERATION_LOG_LIMIT } = await import(
  new URL('operation-log.mjs', output)
);
const { createApiClient, ApiFailure, SESSION_KEY } = await import(new URL('client.mjs', output));

const receivingPage = await readFile(mobile('src/pages/receiving/index.vue'), 'utf8');
const detailPage = await readFile(mobile('src/pages/package/index.vue'), 'utf8');
const pages = JSON.parse(await readFile(mobile('src/pages.json'), 'utf8'));

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
    keys: () => [...map.keys()],
  };
}

const LINE_A = '11111111-1111-4111-8111-111111111111';
const LINE_B = '22222222-2222-4222-8222-222222222222';
const PACKAGE = '33333333-3333-4333-8333-333333333333';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('receiving: quantities are non-negative integers, blank means "not arrived"', () => {
  assert.match(newOperationId(), UUID_V4, '兜底生成的操作号也必须是合法 v4 UUID');
  assert.equal(parseQuantity(''), 0);
  assert.equal(parseQuantity('   '), 0);
  assert.equal(parseQuantity(null), 0);
  assert.equal(parseQuantity(undefined), 0);
  assert.equal(parseQuantity('5'), 5);
  assert.equal(parseQuantity('007'), 7);
  assert.equal(parseQuantity(0), 0);
  assert.equal(parseQuantity(12), 12);
  for (const bad of ['1.5', '-1', '1e3', '五件', '5 件'])
    assert.throws(
      () => parseQuantity(bad),
      (error) => error instanceof ReceiptInputError && error.code === 'INVALID_QTY',
      '必须拒绝：' + bad,
    );
  assert.throws(
    () => parseQuantity(String(2147483648)),
    (error) => error.code === 'INVALID_QTY',
  );
});

test('receiving: partial receipt drops zero lines and keeps multiple SKUs', () => {
  const draft = buildReceiptDraft({
    packageId: PACKAGE,
    lines: [
      { purchaseOrderItemId: LINE_B, quantity: '3' },
      { purchaseOrderItemId: LINE_A, quantity: '' },
    ],
    remark: '  少一件，已拍照  ',
  });
  assert.deepEqual(draft.items, [{ purchaseOrderItemId: LINE_B, receivedQty: 3 }]);
  assert.equal(draft.remark, '少一件，已拍照', '备注要去掉首尾空白');

  const both = buildReceiptDraft({
    packageId: PACKAGE,
    lines: [
      { purchaseOrderItemId: LINE_B, quantity: 2 },
      { purchaseOrderItemId: LINE_A, quantity: 3 },
    ],
  });
  assert.equal(both.items.length, 2, '一个包裹可以包含多个 SKU');
  assert.deepEqual(
    both.items.map((item) => item.purchaseOrderItemId),
    [LINE_A, LINE_B],
    '按行 ID 稳定排序，同样内容永远得到同样请求',
  );
  assert.equal(both.remark, null);

  assert.throws(
    () =>
      buildReceiptDraft({
        packageId: PACKAGE,
        lines: [{ purchaseOrderItemId: LINE_A, quantity: '' }],
      }),
    (error) => error.code === 'EMPTY',
  );
  assert.throws(
    () =>
      buildReceiptDraft({
        packageId: PACKAGE,
        lines: [
          { purchaseOrderItemId: LINE_A, quantity: 1 },
          { purchaseOrderItemId: LINE_A.toUpperCase(), quantity: 2 },
        ],
      }),
    (error) => error.code === 'DUPLICATE_LINE',
  );
  assert.throws(
    () =>
      buildReceiptDraft({
        packageId: PACKAGE,
        lines: [{ purchaseOrderItemId: LINE_A, quantity: 1 }],
        remark: 'x'.repeat(MAX_REMARK_LENGTH + 1),
      }),
    (error) => error.code === 'REMARK_TOO_LONG',
  );
});

test('receiving: the fingerprint only changes when the content changes', () => {
  const base = buildReceiptDraft({
    packageId: PACKAGE,
    lines: [
      { purchaseOrderItemId: LINE_A, quantity: 2 },
      { purchaseOrderItemId: LINE_B, quantity: 3 },
    ],
    remark: '完好',
  });
  const reordered = buildReceiptDraft({
    packageId: PACKAGE,
    lines: [
      { purchaseOrderItemId: LINE_B, quantity: 3 },
      { purchaseOrderItemId: LINE_A, quantity: 2 },
    ],
    remark: ' 完好 ',
  });
  assert.equal(draftFingerprint(base), draftFingerprint(reordered), '输入顺序和备注空白不影响内容');
  const changedQty = buildReceiptDraft({
    packageId: PACKAGE,
    lines: [
      { purchaseOrderItemId: LINE_A, quantity: 3 },
      { purchaseOrderItemId: LINE_B, quantity: 3 },
    ],
    remark: '完好',
  });
  assert.notEqual(draftFingerprint(base), draftFingerprint(changedQty), '改了数量就是另一次提交');
  const changedRemark = buildReceiptDraft({
    packageId: PACKAGE,
    lines: [
      { purchaseOrderItemId: LINE_A, quantity: 2 },
      { purchaseOrderItemId: LINE_B, quantity: 3 },
    ],
    remark: '有破损',
  });
  assert.notEqual(
    draftFingerprint(base),
    draftFingerprint(changedRemark),
    '改了备注也是另一次提交',
  );
});

test('receiving: a failed submit reuses its UUID, a changed quantity does not', async () => {
  const storage = memoryStorage();
  const calls = [];
  let mode = 'offline';
  const api = {
    request: async (path, options) => {
      calls.push({ path, options });
      if (mode === 'offline')
        throw new ApiFailure(0, 'NETWORK_ERROR', '网络连接失败，请检查网络后重试');
      return { data: { id: 'receipt-1', totalQuantity: 5, receiptNo: 'RCV-1' } };
    },
  };
  const submitter = new ReceiptSubmitting(api, storage, {
    now: () => 1700000000000,
    uuid: () => randomUUID(),
  });
  const draft = buildReceiptDraft({
    packageId: PACKAGE,
    lines: [{ purchaseOrderItemId: LINE_A, quantity: 5 }],
    remark: '实收 5 件',
  });

  await assert.rejects(() => submitter.submit(draft, 'tenant-1'), /网络/);
  const firstId = submitter.pendingFor(PACKAGE).operationId;
  assert.match(firstId, UUID_V4, 'clientOperationId 必须是合法 UUID');
  assert.equal(calls[0].path, '/receipts');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.tenantId, 'tenant-1');
  assert.deepEqual(calls[0].options.body, {
    packageId: PACKAGE,
    clientOperationId: firstId,
    items: [{ purchaseOrderItemId: LINE_A, receivedQty: 5 }],
    remark: '实收 5 件',
  });

  // 原样重试：同一个 UUID，同一份请求体
  await assert.rejects(() => submitter.submit(draft, 'tenant-1'));
  assert.equal(submitter.pendingFor(PACKAGE).operationId, firstId, '重试必须复用原 UUID');
  assert.deepEqual(calls[1].options.body, calls[0].options.body, '重试的请求内容必须完全一致');
  assert.equal(submitter.pendingFor(PACKAGE).attempts, 2);

  // 换一个实例（模拟杀掉 App 再打开），仍复用落盘的 UUID
  const restarted = new ReceiptSubmitting(api, storage, { uuid: () => randomUUID() });
  await assert.rejects(() => restarted.submit(draft, 'tenant-1'));
  assert.equal(restarted.pendingFor(PACKAGE).operationId, firstId, '重启后仍复用，避免重复入库');

  // 改了数量：新 UUID
  mode = 'online';
  const changed = buildReceiptDraft({
    packageId: PACKAGE,
    lines: [{ purchaseOrderItemId: LINE_A, quantity: 3 }],
    remark: '实收 5 件',
  });
  const outcome = await restarted.submit(changed, 'tenant-1');
  assert.notEqual(outcome.operationId, firstId, '修改数量重新提交必须生成新的 UUID');
  assert.equal(outcome.reused, false);
  assert.equal(calls.at(-1).options.body.clientOperationId, outcome.operationId);
  assert.equal(restarted.pendingFor(PACKAGE), null, '成功后清掉待提交记录');

  // 成功后再次提交同样内容 → 新操作（服务端会新增一张单），而不是被误当成重试
  const again = await restarted.submit(changed, 'tenant-1');
  assert.notEqual(again.operationId, outcome.operationId);
  assert.equal(again.reused, false);
});

test('receiving: retrying an unconfirmed submit is reported as a replay', async () => {
  const storage = memoryStorage();
  let fail = true;
  const api = {
    request: async () => {
      if (fail) {
        fail = false;
        throw new ApiFailure(0, 'NETWORK_ERROR', '网络连接失败，请检查网络后重试');
      }
      return { data: { id: 'receipt-9', totalQuantity: 5 } };
    },
  };
  const submitter = new ReceiptSubmitting(api, storage, { uuid: () => randomUUID() });
  const draft = buildReceiptDraft({
    packageId: PACKAGE,
    lines: [{ purchaseOrderItemId: LINE_A, quantity: 5 }],
  });
  await assert.rejects(() => submitter.submit(draft));
  const retried = await submitter.submit(draft);
  assert.equal(retried.reused, true, '第二次提交必须标记为幂等重试');
  assert.equal(retried.attempts, 2);
  assert.equal(retried.receipt.id, 'receipt-9');
});

test('receiving: error wording tells the operator whether stock moved', () => {
  const offline = describeReceiptFailure(
    new ApiFailure(0, 'NETWORK_ERROR', '网络连接失败，请检查网络后重试'),
  );
  assert.equal(offline.title, '未提交');
  assert.equal(offline.unconfirmed, true);
  assert.equal(offline.retryable, true);
  assert.match(offline.message, /不会提前增加库存/);

  const exceeded = describeReceiptFailure(
    new ApiFailure(409, 'RECEIPT_QTY_EXCEEDED', '收货数量超过可收数量', 'req', {
      purchaseOrderItemId: LINE_A,
      requestedQuantity: 5,
      maxReceivableQuantity: 3,
      scope: 'PACKAGE',
    }),
  );
  assert.equal(exceeded.title, '数量超过可收上限');
  assert.match(exceeded.message, /最多还能收 3 件/);
  assert.equal(exceeded.rejected, true);
  assert.equal(exceeded.needsEdit, true);

  const closed = describeReceiptFailure(
    new ApiFailure(409, 'STATUS_CONFLICT', '当前状态不允许此操作', 'req', {
      receivingClosed: true,
    }),
  );
  assert.equal(closed.title, '包裹已验收完成');

  const cancelled = describeReceiptFailure(
    new ApiFailure(409, 'STATUS_CONFLICT', '当前状态不允许此操作', 'req', {
      purchaseStatus: 'CANCELLED',
    }),
  );
  assert.match(cancelled.message, /已取消/);

  const conflict = describeReceiptFailure(
    new ApiFailure(409, 'IDEMPOTENCY_CONFLICT', '操作标识与原请求不一致'),
  );
  assert.equal(conflict.title, '操作号与请求内容不一致');
  assert.equal(conflict.needsEdit, true);
});

test('receiving: blocked packages are reported before any input', () => {
  const base = {
    packageId: PACKAGE,
    purchaseOrderId: 'po',
    purchaseOrderNo: 'PO-1',
    purchaseStatus: 'PLACED',
    packageStatus: 'ARRIVED',
    receivingStatus: 'NOT_RECEIVED',
    hasPlan: true,
    receivingClosed: false,
    receivedQuantity: 0,
    lines: [],
  };
  const line = {
    purchaseOrderItemId: LINE_A,
    productId: 'p',
    sku: 'SKU-1',
    name: '商品',
    unit: '件',
    orderedQuantity: 10,
    receivedQuantity: 0,
    orderRemainingQuantity: 10,
    inPackagePlan: true,
    expectedQuantity: 10,
    packageReceivedQuantity: 0,
    packageRemainingQuantity: 10,
    maxReceivableQuantity: 10,
  };
  assert.equal(receivingBlockedReason({ ...base, lines: [line] }), null);
  assert.match(receivingBlockedReason({ ...base }), /没有可收货的商品/);
  assert.match(
    receivingBlockedReason({ ...base, lines: [{ ...line, maxReceivableQuantity: 0 }] }),
    /没有可收数量/,
  );
  assert.match(
    receivingBlockedReason({ ...base, lines: [line], receivingClosed: true }),
    /完成验收/,
  );
  assert.match(
    receivingBlockedReason({ ...base, lines: [line], purchaseStatus: 'CANCELLED' }),
    /已取消/,
  );
  const rows = toReceivableRows({ ...base, lines: [line] });
  assert.equal(rows[0].suggestedQuantity, 10, '默认带出可收数量');
  assert.equal(rows[0].maxReceivableQuantity, 10);
});

test('receiving: the local operation log keeps the newest entries and survives bad data', () => {
  const storage = memoryStorage();
  for (let index = 0; index < OPERATION_LOG_LIMIT + 5; index += 1)
    appendOperation(
      storage,
      { kind: 'receipt', title: '操作 ' + index, detail: 'x', ok: true },
      1000 + index,
    );
  const logs = readOperations(storage);
  assert.equal(logs.length, OPERATION_LOG_LIMIT, '超出上限时丢弃最老记录');
  assert.equal(logs[0].title, '操作 ' + (OPERATION_LOG_LIMIT + 4), '最新的在最前面');
  storage.setItem('caicang.mobile.operation-log.v1', 'not-json');
  assert.deepEqual(readOperations(storage), [], '损坏时返回空列表而不是崩溃');
  appendOperation(storage, { kind: 'error', title: '失败', detail: '原因', ok: false }, 2000);
  assert.equal(readOperations(storage).length, 1);
  clearOperations(storage);
  assert.deepEqual(readOperations(storage), []);
});

test('receiving: page is wired to the real transaction and has no optimistic stock', () => {
  const paths = pages.pages.map((page) => page.path);
  assert.ok(paths.includes('pages/receiving/index'), '收货页必须注册');
  assert.equal(paths[0], 'pages/login/index');

  assert.match(receivingPage, /\/receivable/, '必须读取服务端可收明细');
  assert.match(receivingPage, /uni\.showModal/, '提交前必须二次确认');
  assert.match(receivingPage, /确认入库/, '确认框按钮文案');
  assert.match(receivingPage, /继续扫下一包裹/, '成功后可以继续扫下一包裹');
  assert.match(receivingPage, /result\.totalQuantity/, '成功页展示服务端返回的本次入库数量');
  assert.match(receivingPage, /remark/, '支持收货备注');
  assert.match(receivingPage, /description|备注/, '备注输入存在');

  assert.match(detailPage, /确认收货/, '包裹详情页提供确认收货入口');
  assert.doesNotMatch(receivingPage, /quantityOnHand/, '页面不得自行推算库存');
  assert.doesNotMatch(receivingPage, /stock_balances/, '页面不得直接读写库存表');
});

test(
  'receiving: real API — 5 units added once, retries and changes stay consistent',
  { timeout: 300000 },
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
      skipReason = '';
    try {
      try {
        await admin.connect();
        await admin.query(`CREATE DATABASE "${name}"`);
        created = true;
        await run(
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
        await db.connect();
        connected = true;
      } catch (error) {
        skipReason =
          'PostgreSQL 不可用，跳过真实入库验收（请先启动 Docker Desktop）：' +
          (error instanceof Error ? error.message : String(error));
      }

      await t.test(
        'scan → receive 5 → stock +5',
        { skip: skipReason || undefined },
        async (http) => {
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
          const apiBase = base + '/api/v1';
          let ip = 0;
          const nextIp = () => '203.0.113.' + (++ip % 250);
          const call = (path, { method = 'GET', token, tenant, body } = {}) =>
            fetch(apiBase + path, {
              method,
              headers: {
                'Content-Type': 'application/json',
                'X-Forwarded-For': nextIp(),
                ...(token ? { Authorization: 'Bearer ' + token } : {}),
                ...(tenant ? { 'X-Tenant-Id': tenant } : {}),
              },
              ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            });
          const json = async (response, status) => {
            assert.equal(
              response.status,
              status,
              'HTTP ' + response.status + ' body=' + (await response.clone().text()),
            );
            return (await response.json()).data;
          };

          const account = { email: 'picker@receive.example.test', password: 'Receive!2026' };
          await json(await call('/auth/register', { method: 'POST', body: account }), 201);
          const session = await json(
            await call('/auth/login', { method: 'POST', body: account }),
            200,
          );
          const token = session.accessToken;
          const tenant = await json(
            await call('/tenants', { method: 'POST', token, body: { name: '收货验收' } }),
            201,
          );
          const tenantId = tenant.tenant.id;

          const product = await json(
            await call('/products', {
              method: 'POST',
              token,
              tenant: tenantId,
              body: { name: '20W 充电器', sku: 'CHARGER-RCV', unit: '件' },
            }),
            201,
          );
          const draftOrder = await json(
            await call('/purchase-orders', {
              method: 'POST',
              token,
              tenant: tenantId,
              body: {
                warehouseId: tenant.defaultWarehouse.id,
                platform: 'TAOBAO',
                purchaseDate: '2026-10-23',
                recipient: { name: '验收员', phone: '13800000000', address: '虚构仓库地址' },
                items: [{ productId: product.id, quantity: 10, unitPrice: '18.50' }],
              },
            }),
            201,
          );
          const order = await json(
            await call('/purchase-orders/' + draftOrder.id + '/place', {
              method: 'POST',
              token,
              tenant: tenantId,
            }),
            200,
          );
          const lineId = order.items[0].id;
          const pkg = await json(
            await call('/purchase-orders/' + order.id + '/packages', {
              method: 'POST',
              token,
              tenant: tenantId,
              body: {
                carrierCode: 'ZTO',
                trackingNo: '000RECEIVE-21',
                expectedItems: [{ purchaseOrderItemId: lineId, expectedQuantity: 10 }],
              },
            }),
            201,
          );

          const storage = memoryStorage();
          let lostResponse = true;
          const transport = async (request) => {
            const response = await fetch(request.url, {
              method: request.method,
              headers: { ...request.headers, 'X-Forwarded-For': nextIp() },
              body: request.body === undefined ? undefined : JSON.stringify(request.body),
            });
            const text = await response.text();
            // 模拟"服务端已入库但响应在路上丢了"：首次提交成功落库，客户端却只看到断网。
            if (lostResponse && request.url.endsWith('/receipts')) {
              lostResponse = false;
              throw new Error('network down after request');
            }
            return { statusCode: response.status, data: text ? JSON.parse(text) : null };
          };
          const client = createApiClient({ baseUrl: apiBase, storage, transport });
          await client.login(account);
          assert.ok(storage.getItem(SESSION_KEY));
          const submitter = new ReceiptSubmitting(client, storage);

          const draft = buildReceiptDraft({
            packageId: pkg.id,
            lines: [{ purchaseOrderItemId: lineId, quantity: 5 }],
            remark: '实收 5 件，外箱完好',
          });
          await assert.rejects(
            () => submitter.submit(draft, tenantId),
            (error) => {
              const info = describeReceiptFailure(error);
              assert.equal(info.title, '未提交');
              assert.equal(info.unconfirmed, true);
              return true;
            },
            '响应丢失时客户端只能报告未提交',
          );
          const stockAfterLost = await db.query(
            'SELECT quantity_on_hand FROM stock_balances WHERE tenant_id=$1 AND product_id=$2',
            [tenantId, product.id],
          );
          assert.equal(
            Number(stockAfterLost.rows[0]?.quantity_on_hand ?? 0),
            5,
            '服务端已入库 5 件',
          );

          const retried = await submitter.submit(draft, tenantId);
          assert.equal(retried.reused, true, '重试复用同一 clientOperationId');
          assert.equal(retried.receipt.totalQuantity, 5);
          const stockAfterRetry = await db.query(
            'SELECT quantity_on_hand FROM stock_balances WHERE tenant_id=$1 AND product_id=$2',
            [tenantId, product.id],
          );
          assert.equal(Number(stockAfterRetry.rows[0].quantity_on_hand), 5, '重试不得再次加库存');

          const second = await submitter.submit(
            buildReceiptDraft({
              packageId: pkg.id,
              lines: [{ purchaseOrderItemId: lineId, quantity: 2 }],
              remark: '剩余 2 件补齐',
            }),
            tenantId,
          );
          assert.equal(second.reused, false, '改了数量必须换新 UUID');
          const stockAfterSecond = await db.query(
            'SELECT quantity_on_hand FROM stock_balances WHERE tenant_id=$1 AND product_id=$2',
            [tenantId, product.id],
          );
          assert.equal(Number(stockAfterSecond.rows[0].quantity_on_hand), 7, '累计入库 7 件');

          await assert.rejects(
            () =>
              submitter.submit(
                buildReceiptDraft({
                  packageId: pkg.id,
                  lines: [{ purchaseOrderItemId: lineId, quantity: 5 }],
                }),
                tenantId,
              ),
            (error) => {
              assert.ok(error instanceof ApiFailure);
              assert.equal(error.status, 409);
              assert.equal(error.code, 'RECEIPT_QTY_EXCEEDED');
              assert.equal(error.details.maxReceivableQuantity, 3, '只能再收 3 件');
              const info = describeReceiptFailure(error);
              assert.match(info.message, /最多还能收 3 件/);
              return true;
            },
          );
          const stockAfterReject = await db.query(
            'SELECT quantity_on_hand FROM stock_balances WHERE tenant_id=$1 AND product_id=$2',
            [tenantId, product.id],
          );
          assert.equal(
            Number(stockAfterReject.rows[0].quantity_on_hand),
            7,
            '被拒绝的提交不改库存',
          );

          const receipts = await client.request(
            '/receipts?packageId=' + pkg.id + '&page=1&pageSize=20',
            { tenantId },
          );
          assert.equal(receipts.data.length, 2, '两次不同数量的提交产生两张入库单');
          assert.equal(storage.getItem(PENDING_KEY), JSON.stringify({ ops: {} }));
          assert.equal(/unhandled|bootstrap_failed/i.test(logs), false, 'API log: ' + logs);
        },
      );
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
