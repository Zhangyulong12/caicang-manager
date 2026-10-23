/**
 * Task 26 — mobile stock lookup and scan-outbound.
 *
 * Part one is pure: barcode normalisation, quantity merging on repeated scans, draft
 * building, idempotent ship retry, and the wording of every failure.
 *
 * Part two is a real PostgreSQL + real API acceptance run driven through the same modules
 * the pages import: receive 10 units, scan the barcode, see 10, add 3, save a draft (stock
 * still 10), confirm shipping (stock 7), replay the operation id (still 7), then try 8
 * (409, still 7), fix the draft to 2 and ship again (5). The Web inventory client is
 * compiled from apps/admin-web to prove both ends read the same numbers.
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
const output = mobile('.test-build/outbound/');
await mkdir(output, { recursive: true });

/** 页面 import 的模块原样转译；相对路径统一改成同目录 .mjs，Node 才能解析。 */
for (const [source, target] of [
  ['src/api/client.ts', 'client.mjs'],
  ['src/services/receiving.ts', 'receiving.mjs'],
  ['src/services/outbound.ts', 'outbound.mjs'],
  ['src/services/stock.ts', 'stock.mjs'],
  ['src/services/scan.ts', 'scan.mjs'],
])
  await writeFile(
    new URL(target, output),
    ts
      .transpileModule(await readFile(mobile(source), 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
      })
      .outputText.replaceAll("'../api/client'", "'./client.mjs'")
      .replaceAll("'./receiving'", "'./receiving.mjs'"),
  );

// Web 端读库存的模块：证明"App 发完货，Web 刷新看到的是同一个数"。
const webOutput = new URL('../apps/admin-web/.test-build/mobile-outbound-web/', import.meta.url);
await mkdir(webOutput, { recursive: true });
for (const file of ['client', 'inventory']) {
  const source = await readFile(
    new URL(`../apps/admin-web/src/api/${file}.ts`, import.meta.url),
    'utf8',
  );
  const compiled = ts
    .transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
    })
    .outputText.replace(/(['"])\.\/(client|inventory)\1/g, "'./$2.mjs'");
  await writeFile(new URL(file + '.mjs', webOutput), compiled);
}

const {
  MAX_QUANTITY,
  OUTBOUND_PENDING_KEY,
  OutboundInputError,
  OutboundShipSubmitting,
  addOrIncrementLine,
  buildOutboundDraft,
  canShip,
  carrierName,
  createDraftBody,
  describeShipFailure,
  lineFromBalance,
  linesTotalQuantity,
  overStockLines,
  parseQuantity,
  phoneProblem,
  recipientMissing,
  removeLine,
  saveOutboundDraft,
  setLineQuantity,
  shipFingerprint,
  stepLineQuantity,
} = await import(new URL('outbound.mjs', output));
const {
  describeMiss,
  findByCode,
  loadProductStock,
  loadRecentMovements,
  loadWarehouses,
  movementDeltaLabel,
  movementLabel,
  normalizeQuery,
  normalizeScan,
  searchStock,
  stockTone,
  totalOnHand,
} = await import(new URL('stock.mjs', output));
const { ScanGuard } = await import(new URL('scan.mjs', output));
const { ApiFailure, createApiClient } = await import(new URL('client.mjs', output));
const { createApiClient: createWebClient } = await import(new URL('client.mjs', webOutput));
const { createInventory } = await import(new URL('inventory.mjs', webOutput));

const pages = JSON.parse(await readFile(mobile('src/pages.json'), 'utf8'));
const homePage = await readFile(mobile('src/pages/home/index.vue'), 'utf8');
const stockPage = await readFile(mobile('src/pages/stock/index.vue'), 'utf8');
const stockDetailPage = await readFile(mobile('src/pages/stock/detail.vue'), 'utf8');
const outboundPage = await readFile(mobile('src/pages/outbound/index.vue'), 'utf8');

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
    keys: () => [...map.keys()],
  };
}

const BALANCE = (overrides = {}) => ({
  warehouseId: '11111111-1111-4111-8111-111111111111',
  warehouseName: '主仓',
  productId: '22222222-2222-4222-8222-222222222222',
  sku: 'GA-65W',
  barcode: '06912345000017',
  name: '65W 氮化镓充电器',
  specification: null,
  unit: '件',
  quantityOnHand: 10,
  pendingInboundQuantity: 0,
  averageCost: '20.0000',
  totalCost: '200.0000',
  lastReceivedAt: null,
  updatedAt: null,
  ...overrides,
});

test('stock: scanned codes stay strings, queries are trimmed, missing data is explained', () => {
  assert.equal(normalizeScan(' 06912345000017 '), '06912345000017');
  assert.equal(normalizeScan('000783456123'), '000783456123', '前导零必须保留');
  assert.throws(() => normalizeScan(''), /请扫描或输入商品条码/);
  assert.throws(() => normalizeScan('   '), /请扫描或输入商品条码/);
  assert.throws(() => normalizeScan('a'.repeat(129)), /条码不能超过/);
  assert.throws(() => normalizeScan('12\u000034'), /控制字符/);
  assert.equal(normalizeQuery('  氮化镓 '), '氮化镓');
  assert.throws(() => normalizeQuery(' '), /请输入商品名称或 SKU/);
  assert.equal(totalOnHand([BALANCE(), BALANCE({ quantityOnHand: 3 })]), 13);
  assert.equal(stockTone(0), 'empty');
  assert.equal(stockTone(3), 'warn');
  assert.equal(stockTone(30), 'ok');
  assert.equal(movementLabel('OUTBOUND'), '出库发货');
  assert.equal(movementDeltaLabel({ quantityDelta: -3 }), '-3');
  assert.equal(movementDeltaLabel({ quantityDelta: 20 }), '+20');
  assert.match(describeMiss({ query: 'X1', byScan: true }), /没有登记条码|手动搜索 SKU/);
  assert.match(describeMiss({ query: '氮化镓', byScan: false }), /换个关键词/);
  // 扫码防抖：同一条码 3 秒内不重复请求，结束后可再扫
  const guard = new ScanGuard();
  assert.equal(guard.begin('06912345000017', 1000), 'ok');
  assert.equal(guard.begin('06912345000017', 1500), 'busy');
  guard.end();
  assert.equal(guard.begin('06912345000017', 2000), 'duplicate');
  guard.end();
  assert.equal(guard.begin('06912345000017', 9000), 'ok');
});

test('outbound: repeated scans merge into the same line and never touch stock', () => {
  assert.equal(parseQuantity('3'), 3);
  assert.equal(parseQuantity(7), 7);
  assert.throws(() => parseQuantity('0'), OutboundInputError);
  assert.throws(() => parseQuantity('-1'), OutboundInputError);
  assert.throws(() => parseQuantity('1.5'), OutboundInputError);
  assert.throws(() => parseQuantity(''), OutboundInputError);
  assert.throws(() => parseQuantity(String(MAX_QUANTITY + 1)), OutboundInputError);

  let lines = [];
  lines = addOrIncrementLine(lines, BALANCE());
  assert.equal(lines.length, 1);
  assert.equal(lines[0].quantity, 1);
  assert.equal(lines[0].availableQuantity, 10);
  lines = addOrIncrementLine(lines, BALANCE({ quantityOnHand: 9 }));
  lines = addOrIncrementLine(lines, BALANCE({ quantityOnHand: 9 }));
  assert.equal(lines.length, 1, '同一商品只占一行');
  assert.equal(lines[0].quantity, 3, '重复扫码累加待发数量');
  assert.equal(lines[0].availableQuantity, 9, '可用数量取最近一次服务端返回');
  assert.equal(linesTotalQuantity(lines), 3);
  // 累加只发生在内存里：函数没有网络、没有副作用，库存仍是 10
  assert.equal(BALANCE().quantityOnHand, 10);

  lines = stepLineQuantity(lines, lines[0].productId, 1);
  assert.equal(lines[0].quantity, 4);
  lines = stepLineQuantity(lines, lines[0].productId, -99);
  assert.equal(lines[0].quantity, 1, '减到 1 就停，不会出现 0 件发货');
  lines = setLineQuantity(lines, lines[0].productId, '6');
  assert.equal(lines[0].quantity, 6);
  assert.equal(overStockLines(lines).length, 0, '6 ≤ 可用 9');
  lines = setLineQuantity(lines, lines[0].productId, '12');
  assert.equal(overStockLines(lines).length, 1, '12 > 可用 9，页面据此提示');
  assert.equal(canShip(lines), true);
  lines = removeLine(lines, lines[0].productId);
  assert.deepEqual(lines, []);
  assert.equal(canShip(lines), false);

  // 另一个商品单独成行；数量超过上限直接拒绝
  const other = BALANCE({ productId: '33333333-3333-4333-8333-333333333333', sku: 'CABLE-2M' });
  assert.equal(addOrIncrementLine([], other).length, 1);
  assert.equal(lineFromBalance(other, 2).quantity, 2);
});

test('outbound: draft payload is the same no matter the scan order', () => {
  const a = BALANCE();
  const b = BALANCE({ productId: '33333333-3333-4333-8333-333333333333', sku: 'CABLE-2M' });
  const recipient = {
    customerName: ' 张三 ',
    customerPhone: '139 0000 0000',
    customerAddress: '上海市浦东新区世纪大道 100 号',
  };
  const draft = buildOutboundDraft({
    warehouseId: a.warehouseId,
    lines: [lineFromBalance(b, 2), lineFromBalance(a, 3)],
    recipient,
    carrierCode: 'SF',
    trackingNo: ' 007700112233 ',
    remark: ' 客户要求工作日送达 ',
    requireRecipient: true,
  });
  assert.deepEqual(
    draft.items.map((row) => row.productId),
    [a.productId, b.productId],
    '按 productId 排序，与扫码顺序无关',
  );
  assert.equal(draft.recipient.customerName, '张三', '首尾空白被裁掉');
  assert.equal(draft.trackingNo, '007700112233', '运单号前导零保留');
  assert.equal(draft.remark, '客户要求工作日送达');
  const body = createDraftBody(draft);
  assert.equal('quantityOnHand' in body, false, '不提交任何库存字段');
  assert.equal('totalCost' in body, false);
  assert.equal(body.items.length, 2);

  // 草稿可以没有收件信息，发货前必须补齐
  const bare = buildOutboundDraft({
    warehouseId: a.warehouseId,
    lines: [lineFromBalance(a, 1)],
    recipient: {},
  });
  assert.equal(bare.recipient.customerName, '');
  assert.throws(
    () =>
      buildOutboundDraft({
        warehouseId: a.warehouseId,
        lines: [lineFromBalance(a, 1)],
        recipient: {},
        requireRecipient: true,
      }),
    OutboundInputError,
  );
  assert.throws(
    () => buildOutboundDraft({ warehouseId: '', lines: [lineFromBalance(a, 1)], recipient }),
    /请先选择发货仓库/,
  );
  assert.throws(
    () => buildOutboundDraft({ warehouseId: a.warehouseId, lines: [], recipient }),
    /请至少扫描或搜索一个商品/,
  );
  assert.deepEqual(
    recipientMissing({ customerName: '张三', customerPhone: '', customerAddress: ' ' }),
    ['联系电话', '收件地址'],
  );
  assert.equal(phoneProblem('13900000000'), null);
  assert.equal(phoneProblem('021-1234 5678'), null);
  assert.match(phoneProblem('abc'), /只能包含数字/);
  assert.match(phoneProblem('---'), /至少要有一个数字/);
  assert.equal(carrierName('SF'), '顺丰速运');
  assert.equal(carrierName(null), '未填写');
});

test('outbound: a network failure reuses the operation id, a business rejection does not', async () => {
  const storage = memoryStorage();
  const calls = [];
  let mode = 'network';
  const fakeApi = {
    async request(path, options) {
      calls.push({ path, body: options.body });
      if (mode === 'network') throw new ApiFailure(0, 'NETWORK_ERROR', '网络连接失败');
      if (mode === 'stock')
        throw new ApiFailure(409, 'OUT_OF_STOCK', '库存不足', undefined, {
          shortages: [
            {
              productId: '22222222-2222-4222-8222-222222222222',
              sku: 'GA-65W',
              requestedQuantity: 8,
              availableQuantity: 7,
            },
          ],
        });
      return { data: { id: 'order-1', status: 'SHIPPED' } };
    },
  };
  const orderId = '44444444-4444-4444-8444-444444444444';
  const submitter = new OutboundShipSubmitting(fakeApi, storage, {
    uuid: () => '99999999-9999-4999-8999-999999999999',
  });

  await assert.rejects(submitter.submit(orderId, { carrierCode: 'SF' }));
  const first = calls[0].body.clientOperationId;
  assert.equal(first, '99999999-9999-4999-8999-999999999999');
  assert.ok(storage.getItem(OUTBOUND_PENDING_KEY), '待确认记录落盘，App 重启也能复用');
  assert.equal(submitter.pendingFor(orderId)?.attempts, 1);

  // 重启：新的实例读同一份存储，仍要复用同一个操作号
  const restarted = new OutboundShipSubmitting(fakeApi, storage, {
    uuid: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  });
  mode = 'ok';
  const outcome = await restarted.submit(orderId, { carrierCode: 'SF' });
  assert.equal(calls[1].body.clientOperationId, first, '重试必须复用原操作号，服务端才会只扣一次');
  assert.equal(outcome.reused, true);
  assert.equal(outcome.attempts, 2);
  assert.equal(restarted.pendingFor(orderId), null, '成功后清掉待确认记录');

  // 业务拒绝：服务端明确没扣库存，丢掉操作号，改完再发是新操作
  mode = 'stock';
  await assert.rejects(
    restarted.submit(orderId, { carrierCode: 'SF' }),
    (error) => error instanceof ApiFailure && error.code === 'OUT_OF_STOCK',
  );
  assert.equal(restarted.pendingFor(orderId), null, '库存不足不能留着旧操作号');
  const failure = describeShipFailure(
    new ApiFailure(409, 'OUT_OF_STOCK', '库存不足', undefined, {
      shortages: [{ sku: 'GA-65W', requestedQuantity: 8, availableQuantity: 7 }],
    }),
  );
  assert.equal(failure.title, '库存不足，未发货');
  assert.match(failure.message, /没有扣减任何库存/);
  assert.match(failure.message, /GA-65W 需要 8 件、可用 7 件/);
  assert.equal(failure.rejected, true);
  assert.equal(failure.needsEdit, true);
  assert.deepEqual(
    failure.shortages.map((row) => row.sku),
    ['GA-65W'],
  );

  // 指纹：单号大小写、空白不影响，内容变了才换
  assert.equal(
    shipFingerprint(orderId, { carrierCode: ' SF ', trackingNo: '' }),
    shipFingerprint(orderId.toUpperCase(), { carrierCode: 'SF', trackingNo: '   ' }),
  );
  assert.notEqual(
    shipFingerprint(orderId, { trackingNo: 'SF1' }),
    shipFingerprint(orderId, { trackingNo: 'SF2' }),
  );
  // 网络类错误不能被当成"已拒绝"，否则会丢操作号造成重复扣减
  assert.equal(describeShipFailure(new ApiFailure(0, 'NETWORK_ERROR', 'x')).unconfirmed, true);
  assert.equal(describeShipFailure(new ApiFailure(503, 'HTTP_ERROR', 'x')).rejected, false);
  assert.equal(describeShipFailure(new ApiFailure(403, 'FORBIDDEN', 'x')).title, '没有出库权限');
});

test('mobile pages are registered and only read stock', () => {
  const paths = pages.pages.map((page) => page.path);
  for (const path of ['pages/stock/index', 'pages/stock/detail', 'pages/outbound/index'])
    assert.ok(paths.includes(path), 'pages.json 缺少 ' + path);
  assert.ok(homePage.includes("url: '/pages/stock/index'"), '首页「库存查询」入口没接上');
  assert.ok(homePage.includes("url: '/pages/outbound/index'"), '首页「扫码出库」入口没接上');
  // 四个入口都必须有真实去向（url 或 tab），不能再落到"下一阶段开放"的兜底分支
  const entries = homePage.slice(
    homePage.indexOf('const entries'),
    homePage.indexOf('const ROLE_LABELS'),
  );
  assert.equal((entries.match(/url:|tab:/g) ?? []).length, 4);

  for (const [name, text, chunks] of [
    [
      'stock/index.vue',
      stockPage,
      ['库存查询', '扫描条码查询', '商品名称或 SKU', 'searchStock', 'findByCode', 'stockTone'],
    ],
    [
      'stock/detail.vue',
      stockDetailPage,
      ['各仓库库存', '最近库存流水', 'loadProductStock', 'loadRecentMovements', 'movementLabel'],
    ],
    [
      'outbound/index.vue',
      outboundPage,
      [
        '扫码出库',
        '扫描商品条码',
        '手动搜索 SKU',
        '创建出库草稿',
        '确认发货',
        'saveOutboundDraft',
        'OutboundShipSubmitting',
      ],
    ],
  ]) {
    for (const chunk of chunks) assert.ok(text.includes(chunk), name + ' 缺少 ' + chunk);
    assert.equal(/stock_balances|stock_movements|UPDATE\s+stock/i.test(text), false, name);
    assert.equal(/quantityOnHand\s*[-+*/]?=[^=]/.test(text), false, name + ' 不应本地改库存');
  }
  // 出库页的写操作只经过服务层，页面里不直接拼 ship 请求
  assert.equal(/\/ship['"]/.test(outboundPage), false, '发货必须走 OutboundShipSubmitting');
  assert.ok(outboundPage.includes('uni.scanCode'), '扫码出库必须真的调起相机');
  assert.ok(stockPage.includes('uni.scanCode'), '库存查询必须支持扫条码');
});

test(
  'mobile acceptance: scan, ship, and both App and Web read the new quantity',
  { timeout: 300000 },
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
      connected = false,
      counter = 0,
      logs = '';
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

      await t.test(
        'scan finds stock, repeated scans merge, drafts never move stock',
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
          const storage = memoryStorage();
          const client = createApiClient({
            baseUrl: base + '/api/v1',
            storage,
            // 手机端 transport 是 uni.request 的回调封装；这里用 fetch 做同样的搬运。
            transport: async (request) => {
              const response = await fetch(request.url, {
                method: request.method,
                headers: { ...request.headers, 'X-Forwarded-For': `198.20.8.${++counter % 250}` },
                body: request.body === undefined ? undefined : JSON.stringify(request.body),
              });
              const text = await response.text();
              return {
                statusCode: response.status,
                data: text ? JSON.parse(text) : null,
              };
            },
          });
          const credentials = { email: 'outbound-app@example.test', password: 'OutboundApp!2026' };
          const registered = await fetch(base + '/api/v1/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.20.8.250' },
            body: JSON.stringify({ ...credentials, displayName: '出库验收' }),
          });
          assert.equal(registered.status, 201);
          await client.login(credentials);

          const tenant = (
            await client.request('/tenants', {
              method: 'POST',
              body: { name: '出库 App 验收' },
            })
          ).data;
          const tenantId = tenant.tenant.id;
          const warehouseId = tenant.defaultWarehouse.id;

          const charger = (
            await client.request('/products', {
              tenantId,
              method: 'POST',
              body: {
                name: '65W 氮化镓充电器',
                sku: 'GA-65W',
                unit: '件',
                barcode: '06912345000017',
                referencePurchasePrice: '20.00',
              },
            })
          ).data;
          // 另建一个没有条码的商品：验证"没有条码时手动搜索 SKU"
          const cable = (
            await client.request('/products', {
              tenantId,
              method: 'POST',
              body: { name: '2 米编织数据线', sku: 'CABLE-2M', unit: '条' },
            })
          ).data;

          // 备货 10 件，走真实采购 → 包裹 → 验收入库
          const placed = (
            await client.request('/purchase-orders', {
              tenantId,
              method: 'POST',
              body: {
                warehouseId,
                platform: 'TAOBAO',
                purchaseDate: '2026-10-23',
                recipient: { name: '出库验收', phone: '13800000000', address: '虚构地址' },
                items: [
                  { productId: charger.id, quantity: 10, unitPrice: '20.00' },
                  { productId: cable.id, quantity: 5, unitPrice: '8.00' },
                ],
              },
            })
          ).data;
          await client.request('/purchase-orders/' + placed.id + '/place', {
            tenantId,
            method: 'POST',
            body: {},
          });
          const pkg = (
            await client.request('/purchase-orders/' + placed.id + '/packages', {
              tenantId,
              method: 'POST',
              body: {
                carrierCode: 'ZTO',
                trackingNo: '007700112233',
                expectedItems: placed.items.map((item) => ({
                  purchaseOrderItemId: item.id,
                  expectedQuantity: item.quantity,
                })),
              },
            })
          ).data;
          await client.request('/receipts', {
            tenantId,
            method: 'POST',
            body: {
              packageId: pkg.id,
              clientOperationId: randomUUID(),
              items: placed.items.map((item) => ({
                purchaseOrderItemId: item.id,
                receivedQty: item.quantity,
              })),
            },
          });

          const balanceOf = async (productId) => {
            const rows = await loadProductStock(client, { productId, tenantId });
            return rows.balances.find((row) => row.warehouseId === warehouseId) ?? rows.balances[0];
          };

          // ---- 1. 扫码查库存 ----
          const scanned = await findByCode(client, '06912345000017', { tenantId, warehouseId });
          assert.equal(scanned.match, 'barcode');
          assert.equal(scanned.rows.length, 1);
          assert.equal(scanned.rows[0].sku, 'GA-65W');
          assert.equal(scanned.rows[0].quantityOnHand, 10, '扫商品条码能查到库存');
          assert.equal(scanned.rows[0].warehouseName, tenant.defaultWarehouse.name);
          assert.equal(stockTone(scanned.rows[0].quantityOnHand), 'ok');

          // 手输名称 / SKU 也能查到（没有条码的商品靠这条路）
          assert.equal((await searchStock(client, { text: '氮化镓', tenantId })).rows.length, 1);
          assert.equal((await searchStock(client, { text: 'GA-65W', tenantId })).rows.length, 1);
          const cableByText = await searchStock(client, { text: 'CABLE-2M', tenantId });
          assert.equal(cableByText.rows[0].productId, cable.id);
          assert.equal(cableByText.rows[0].barcode, null, '这个商品没有条码，只能手输');
          assert.equal((await searchStock(client, { text: '编织', tenantId })).rows.length, 1);
          const missed = await findByCode(client, '0000000000000', { tenantId });
          assert.equal(missed.rows.length, 0);
          assert.equal(missed.match, null);

          // 库存详情的两张表
          const stock = await loadProductStock(client, { productId: charger.id, tenantId });
          assert.equal(stock.balances[0].quantityOnHand, 10);
          const movements = await loadRecentMovements(client, { productId: charger.id, tenantId });
          assert.equal(movements.length, 1);
          assert.equal(movements[0].type, 'RECEIPT');
          assert.equal(movements[0].quantityAfter, 10);
          assert.equal(movements[0].operatorName, '出库验收');
          assert.equal((await loadWarehouses(client, tenantId)).length, 1);

          // ---- 2. 扫码加入出库单：重复扫描只累加待发数量 ----
          let lines = [];
          lines = addOrIncrementLine(lines, scanned.rows[0]);
          lines = addOrIncrementLine(lines, scanned.rows[0]);
          assert.equal(lines[0].quantity, 2);
          assert.equal((await balanceOf(charger.id)).quantityOnHand, 10, '加入出库单不影响库存');

          // ---- 3. 创建草稿（3 件），库存仍是 10 ----
          const recipient = {
            customerName: '张三',
            customerPhone: '13900000000',
            customerAddress: '上海市浦东新区世纪大道 100 号 8 楼',
          };
          const draftPayload = buildOutboundDraft({
            warehouseId,
            lines: setLineQuantity(lines, charger.id, '3'),
            recipient,
            carrierCode: 'SF',
            trackingNo: 'SF0012345678901',
            remark: '客户要求工作日送达',
            requireRecipient: true,
          });
          const draft = await saveOutboundDraft(client, draftPayload, { tenantId });
          assert.equal(draft.status, 'DRAFT');
          assert.match(draft.outboundNo, /^OUT-/);
          assert.equal(draft.totalQuantity, 3);
          assert.equal(draft.customerName, '张三');
          assert.equal(draft.trackingNo, 'SF0012345678901');
          assert.equal((await balanceOf(charger.id)).quantityOnHand, 10, '草稿不动库存');

          // ---- 4. 二次确认后调用出库事务：10 → 7 ----
          const submitter = new OutboundShipSubmitting(client, storage);
          const shipped = await submitter.submit(
            draft.id,
            { carrierCode: 'SF', trackingNo: 'SF0012345678901', remark: '客户要求工作日送达' },
            tenantId,
          );
          assert.equal(shipped.order.status, 'SHIPPED');
          assert.equal(shipped.order.totalQuantity, 3);
          assert.equal(shipped.order.totalCost, '60.0000', '20.0000 × 3 的移动平均快照');
          assert.equal(shipped.order.items[0].shippedUnitCost, '20.0000');
          assert.ok(shipped.order.shippedAt);
          assert.equal((await balanceOf(charger.id)).quantityOnHand, 7);

          // ---- 5. Web 端读到同一个 7 ----
          const webClient = createWebClient({
            baseUrl: base + '/api/v1',
            storage: memoryStorage(),
            lock: (work) => work(),
            fetcher: (input, init) => fetch(input, init),
          });
          const webAccount = await webClient.login(credentials);
          const webScope = {
            userId: webAccount.id,
            sessionKey: webClient.sync().sessionKey,
            tenantId,
            permissions: (await webClient.request('/tenants/current', { tenantId })).data
              .permissions,
          };
          const webInventory = createInventory(webClient, () => webScope);
          const webRows = await webInventory.balances({
            page: 1,
            pageSize: 20,
            productId: charger.id,
          });
          assert.equal(webRows.data[0].quantityOnHand, 7, 'Web 与 App 看到的是同一个库存');
          assert.equal(webRows.data[0].totalCost, '140.0000');
          const webMovements = await webInventory.movements({
            page: 1,
            pageSize: 20,
            type: 'OUTBOUND',
            productId: charger.id,
          });
          assert.equal(webMovements.data[0].quantityAfter, 7);
          assert.equal(webMovements.data[0].sourceNo, draft.outboundNo);

          // ---- 6. 重放同一操作号：不重复扣减 ----
          const replay = await client.request('/outbound-orders/' + draft.id + '/ship', {
            tenantId,
            method: 'POST',
            body: {
              clientOperationId: shipped.operationId,
              carrierCode: 'SF',
              trackingNo: 'SF0012345678901',
              remark: '客户要求工作日送达',
            },
          });
          assert.equal(replay.data.status, 'SHIPPED');
          assert.equal(replay.data.id, draft.id);
          assert.equal((await balanceOf(charger.id)).quantityOnHand, 7, '重复请求没有二次扣减');

          // ---- 7. 再发 2 件 → 5 件 ----
          const cableBalance = (await loadProductStock(client, { productId: cable.id, tenantId }))
            .balances[0];
          assert.equal(cableBalance.quantityOnHand, 5);
          const second = await saveOutboundDraft(
            client,
            buildOutboundDraft({
              warehouseId,
              lines: [lineFromBalance(cableBalance, 2)],
              recipient,
            }),
            { tenantId },
          );
          const secondShip = await submitter.submit(second.id, { carrierCode: 'YTO' }, tenantId);
          assert.equal(secondShip.order.status, 'SHIPPED');
          assert.equal((await balanceOf(cable.id)).quantityOnHand, 3);

          // ---- 8. 发 8 件但只剩 7 件：服务端拒绝，库存不变 ----
          const tooMany = await saveOutboundDraft(
            client,
            buildOutboundDraft({
              warehouseId,
              lines: [{ ...lines[0], quantity: 8, availableQuantity: 7 }],
              recipient,
            }),
            { tenantId },
          );
          const before = (await balanceOf(charger.id)).quantityOnHand;
          assert.equal(before, 7);
          let rejection;
          await assert.rejects(
            submitter.submit(tooMany.id, { carrierCode: 'ZTO' }, tenantId),
            (error) => {
              rejection = error;
              return error instanceof ApiFailure && error.code === 'OUT_OF_STOCK';
            },
          );
          const info = describeShipFailure(rejection);
          assert.match(info.message, /GA-65W 需要 8 件、可用 7 件/);
          assert.equal(info.needsEdit, true);
          assert.equal((await balanceOf(charger.id)).quantityOnHand, 7, '被拒后库存仍是 7');
          const stillDraft = await client.request('/outbound-orders/' + tooMany.id, { tenantId });
          assert.equal(stillDraft.data.status, 'DRAFT');
          assert.equal(submitter.pendingFor(tooMany.id), null, '库存不足不留旧操作号');

          // ---- 9. 改成 2 件再发：新操作号，库存 7 → 5 ----
          const fixed = await saveOutboundDraft(
            client,
            buildOutboundDraft({
              warehouseId,
              lines: [{ ...lines[0], quantity: 2, availableQuantity: 7 }],
              recipient,
            }),
            { tenantId, orderId: tooMany.id },
          );
          assert.equal(fixed.totalQuantity, 2);
          const fixedShip = await submitter.submit(tooMany.id, { carrierCode: 'ZTO' }, tenantId);
          assert.equal(fixedShip.order.status, 'SHIPPED');
          assert.notEqual(fixedShip.operationId, shipped.operationId);
          assert.equal((await balanceOf(charger.id)).quantityOnHand, 5, '7 - 2 = 5');

          // ---- 10. Web 端再确认一次最新数量 ----
          const webAfter = await webInventory.balances({
            page: 1,
            pageSize: 20,
            productId: charger.id,
          });
          assert.equal(webAfter.data[0].quantityOnHand, 5, 'Web 与 App 同时看到 5');
          const webList = await webInventory.movements({
            page: 1,
            pageSize: 20,
            productId: charger.id,
          });
          assert.equal(
            webList.data.filter((row) => row.type === 'OUTBOUND').length,
            2,
            '两次成功出库各一条流水；被拒的那次没有流水',
          );
          assert.equal(
            (
              await db.query('SELECT quantity_on_hand FROM stock_balances WHERE product_id=$1', [
                charger.id,
              ])
            ).rows[0].quantity_on_hand,
            5,
            '数据库里的余额也是 5',
          );

          assert.equal(
            /unhandled|bootstrap_failed/i.test(logs),
            false,
            'API log: ' + logs.slice(-600),
          );
        },
      );
    } finally {
      if (connected) await db.end();
      if (created) {
        await admin.query(
          'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',
          [name],
        );
        await admin.query(`DROP DATABASE "${name}"`);
      }
      await admin.end().catch(() => undefined);
    }
  },
);
