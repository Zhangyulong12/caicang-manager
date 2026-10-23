/**
 * Task 20 — scan-to-lookup on the Android build.
 *
 * The scan logic is deliberately kept in a framework-free module (`services/scan.ts`), so the
 * exact code that ships in the App is transpiled and executed here in Node. These assertions
 * cover the parts a real device cannot prove repeatably: leading zeroes surviving the round trip,
 * the debounce gate, candidate classification, and the "query only, never write inventory"
 * guarantee. Camera permission prompts and `uni.scanCode` itself can only be observed on a phone;
 * that step is documented in docs/TASK_20_REPORT.md.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';

const mobile = (path) => new URL('../apps/mobile/' + path, import.meta.url);
const output = mobile('.test-build/');
await mkdir(output, { recursive: true });
await writeFile(
  new URL('scan.mjs', output),
  ts.transpileModule(await readFile(mobile('src/services/scan.ts'), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText,
);
const {
  MAX_TRACKING_LENGTH,
  DUPLICATE_WINDOW_MS,
  ScanGuard,
  ScanInputError,
  classifyLookup,
  lookupPackages,
  normalizeTrackingNo,
} = await import(new URL('scan.mjs', output));

const scanPage = await readFile(mobile('src/pages/scan/index.vue'), 'utf8');
const packagePage = await readFile(mobile('src/pages/package/index.vue'), 'utf8');
const scanService = await readFile(mobile('src/services/scan.ts'), 'utf8');
const pages = JSON.parse(await readFile(mobile('src/pages.json'), 'utf8'));

/** 只实现被调用到的部分，避免把整个会话客户端拖进单元测试。 */
function fakeClient(rows) {
  const calls = [];
  return {
    calls,
    request: async (path, options) => {
      calls.push({ path, options });
      return { data: rows, requestId: 'test' };
    },
  };
}

test('scan: a bar code keeps its leading zeroes end to end', () => {
  assert.equal(normalizeTrackingNo('000783456123'), '000783456123');
  assert.equal(typeof normalizeTrackingNo('000783456123'), 'string', '不能被当成数字');
  assert.equal(normalizeTrackingNo('  000783456123  '), '000783456123', '只裁掉首尾空白');
  assert.equal(normalizeTrackingNo('000T14-0'), '000T14-0', '内部符号和大小写原样保留');
  assert.equal(normalizeTrackingNo('SF0000000001'), 'SF0000000001');
  assert.equal(normalizeTrackingNo('0'), '0', '单个 0 也是合法单号');
});

test('scan: blank, oversized and unreadable input is rejected with a reason', () => {
  for (const input of ['', '   ', null, undefined]) {
    assert.throws(
      () => normalizeTrackingNo(input),
      (error) => error instanceof ScanInputError && error.code === 'EMPTY',
      '空值必须报 EMPTY：' + String(input),
    );
  }
  const tooLong = '0'.repeat(MAX_TRACKING_LENGTH + 1);
  assert.throws(
    () => normalizeTrackingNo(tooLong),
    (error) => error instanceof ScanInputError && error.code === 'TOO_LONG',
  );
  assert.equal(normalizeTrackingNo('0'.repeat(MAX_TRACKING_LENGTH)).length, MAX_TRACKING_LENGTH);
  assert.throws(
    () => normalizeTrackingNo('SF\u0000123'),
    (error) => error instanceof ScanInputError && error.code === 'INVALID',
  );
  assert.throws(() => normalizeTrackingNo(''), /请扫描或输入运单号/);
});

test('scan: the lookup request is a read-only GET with the exact code', async () => {
  const rows = [{ packageId: 'p1', trackingNo: '000783456123' }];
  const client = fakeClient(rows);
  const result = await lookupPackages(client, ' 000783456123 ', 'tenant-1');
  assert.deepEqual(result, rows);
  assert.equal(client.calls.length, 1);
  const call = client.calls[0];
  assert.equal(call.path, '/packages/lookup?trackingNo=000783456123', '前导零不能在 URL 里丢');
  assert.equal(call.path.includes('tenantId='), false, '商家走请求头，不进查询串');
  assert.equal(call.options.tenantId, 'tenant-1');
  assert.equal(call.options.method, undefined, '默认就是 GET');

  const special = fakeClient([]);
  await lookupPackages(special, 'SF 123/456#7', 'tenant-1');
  assert.equal(
    special.calls[0].path,
    '/packages/lookup?trackingNo=' + encodeURIComponent('SF 123/456#7'),
  );
});

test('scan: an invalid code never reaches the network', async () => {
  const client = fakeClient([]);
  await assert.rejects(() => lookupPackages(client, '   ', 'tenant-1'), /请扫描或输入运单号/);
  assert.equal(client.calls.length, 0);
});

test('scan: candidates are classified without silently picking the first one', () => {
  assert.equal(classifyLookup([]), 'none');
  assert.equal(classifyLookup([{ packageId: 'p1' }]), 'single');
  assert.equal(classifyLookup([{ packageId: 'p1' }, { packageId: 'p2' }]), 'multiple');
  assert.equal(
    classifyLookup([{ packageId: 'p1' }, { packageId: 'p2' }, { packageId: 'p3' }]),
    'multiple',
  );
});

test('scan: one lookup at a time and no duplicate request for the same code', () => {
  const guard = new ScanGuard();
  assert.equal(guard.begin('000783456123', 1000), 'ok');
  assert.equal(guard.begin('000783456123', 1001), 'busy', '上一次查询还没结束');
  assert.equal(guard.begin('999999', 1002), 'busy', '换单号也要等上一次结束');

  guard.end();
  assert.equal(guard.begin('000783456123', 2000), 'duplicate', '3 秒内同一单号不重复发请求');
  assert.equal(
    guard.begin('000783456123', 1000 + DUPLICATE_WINDOW_MS - 1),
    'duplicate',
    '时间窗从最后一次被接受的扫码算起',
  );
  assert.equal(
    guard.begin('000783456123', 1000 + DUPLICATE_WINDOW_MS),
    'ok',
    '超出窗口后允许重新查询',
  );
});

test('scan: a different parcel can be scanned immediately after the lookup finishes', () => {
  const guard = new ScanGuard();
  assert.equal(guard.begin('000783456123', 5000), 'ok');
  guard.end();
  assert.equal(guard.begin('000783456124', 5001), 'ok');
});

test('scan: "重新扫码" clears the duplicate window', () => {
  const guard = new ScanGuard();
  assert.equal(guard.begin('000783456123', 9000), 'ok');
  guard.end();
  assert.equal(guard.begin('000783456123', 9001), 'duplicate');
  guard.reset();
  assert.equal(guard.begin('000783456123', 9002), 'ok', '用户主动重扫必须放行');
});

test('scan: the pages are registered and the scan page uses the official camera API', () => {
  const paths = pages.pages.map((page) => page.path);
  assert.ok(paths.includes('pages/scan/index'), '扫码页必须在 pages 中');
  assert.ok(paths.includes('pages/package/index'), '包裹详情页必须在 pages 中');
  assert.equal(paths[0], 'pages/login/index', '登录页仍是启动页');
  assert.deepEqual(
    pages.tabBar.list.map((item) => item.pagePath),
    ['pages/home/index', 'pages/records/index', 'pages/account/index'],
  );

  assert.match(scanPage, /uni\.scanCode\(/, '必须使用官方扫码接口');
  assert.match(scanPage, /scanType:\s*\[\s*'barCode',\s*'qrCode'\s*\]/, '一维码和二维码都要支持');
  assert.match(scanPage, /onlyFromCamera:\s*true/, '扫码界面不允许从相册选图');
  assert.match(scanPage, /getAppAuthorizeSetting/, '需要检查相机授权状态');
  assert.match(scanPage, /openAppAuthorizeSetting/, '被拒绝时要能跳到系统设置');
  assert.match(scanPage, /view === 'denied'/, '必须渲染权限被拒绝的提示面板');
  assert.match(scanPage, /view === 'choose'/, '多个候选必须让用户选择');
  assert.match(scanPage, /view === 'notFound'/, '未知单号必须有异常提示');
  assert.match(scanPage, /manualCode/, '必须支持手动输入运单号');
  assert.match(scanPage, /rescan/, '必须可以重新扫码');
  assert.match(packagePage, /expectedItems/, '详情页要展示预计明细');
  assert.match(packagePage, /\/receipts\?packageId=/, '详情页要能看到该包裹的入库记录');
});

test('scan: nothing on the scan path writes inventory', () => {
  for (const [name, source] of [
    ['scan page', scanPage],
    ['scan service', scanService],
    ['package page', packagePage],
  ]) {
    assert.doesNotMatch(source, /method:\s*'(POST|PATCH|DELETE)'/, name + ' 不允许调用写接口');
    assert.doesNotMatch(
      source,
      /confirm-receiving|complete-receiving/,
      name + ' 不允许触发验收/完成动作',
    );
  }
  assert.match(scanService, /'\/packages\/lookup\?trackingNo='/);
  assert.match(scanPage, /扫码只用于查询包裹信息，不会修改库存/);
});
