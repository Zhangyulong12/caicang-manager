import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

test('Android package explicitly includes its native barcode module and camera permission', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('../apps/mobile/src/manifest.json', import.meta.url), 'utf8'),
  );
  assert.ok(Object.hasOwn(manifest['app-plus'].modules, 'Barcode'));
  assert.ok(
    manifest['app-plus'].distribute.android.permissions.some((value) =>
      value.includes('android.permission.CAMERA'),
    ),
  );
});

const source = await readFile(new URL('../packages/utils/src/index.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;

test('App service context validates API addresses without the browser URL global', () => {
  const sandbox = { exports: {}, URL: undefined };
  runInNewContext(compiled, sandbox);
  const normalize = sandbox.exports.normalizeApiBaseUrl;
  assert.equal(
    normalize('http://192.168.243.90:3000/api/v1/'),
    'http://192.168.243.90:3000/api/v1',
  );
  assert.equal(normalize('https://api.example.com/api/v1'), 'https://api.example.com/api/v1');
  assert.equal(normalize('http://localhost:3000/api/v1'), 'http://localhost:3000/api/v1');
  for (const value of [
    'javascript:alert(1)',
    'https://user:password@api.example.com/api/v1',
    'http://',
    'http://api.example.com:70000/api/v1',
    'http://api.example.com\\@evil.example/api/v1',
    'http://api.example.com\n/api/v1',
  ])
    assert.throws(() => normalize(value), /API 地址/);
});

test('stock queries run without URLSearchParams and preserve encoded codes and tenant scope', async () => {
  const stockSource = await readFile(
    new URL('../apps/mobile/src/services/stock.ts', import.meta.url),
    'utf8',
  );
  const sandbox = { exports: {}, URL: undefined, URLSearchParams: undefined };
  runInNewContext(
    ts.transpileModule(stockSource, {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    }).outputText,
    sandbox,
  );
  const calls = [];
  const api = {
    request: async (path, options) => {
      calls.push({ path, options });
      return { data: [] };
    },
  };
  const input = { productId: 'product', warehouseId: 'warehouse', tenantId: 'tenant' };
  await sandbox.exports.searchStock(api, { ...input, text: '充电器 + A&B' });
  await sandbox.exports.findByCode(api, '0000123+&', input);
  await sandbox.exports.loadProductStock(api, input);
  await sandbox.exports.loadRecentMovements(api, input);
  assert.equal(calls.length, 6);
  assert.ok(calls.every(({ options }) => options.tenantId === 'tenant'));
  assert.equal(
    new URL('https://example.com' + calls[0].path).searchParams.get('search'),
    '充电器 + A&B',
  );
  for (const [index, filter] of [
    [1, 'barcode'],
    [2, 'sku'],
    [3, 'search'],
  ]) {
    const params = new URL('https://example.com' + calls[index].path).searchParams;
    assert.equal(params.get(filter), '0000123+&');
    assert.equal(params.get('warehouseId'), 'warehouse');
  }
  assert.equal(
    new URL('https://example.com' + calls[5].path).searchParams.get('warehouseId'),
    'warehouse',
  );
});
