import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { productionApiUrl, releaseManifest } from './mobile-production-config.mjs';
test('formal mobile configuration rejects LAN/localhost/HTTP/examples and keeps the tested manifest untouched', async () => {
  for (const url of [
    'http://shop.company.cn/api/v1',
    'https://127.0.0.1/api/v1',
    'https://192.168.243.90/api/v1',
    'https://[::1]/api/v1',
    'https://localhost/api/v1',
    'https://api.example.com/api/v1',
    'https://caicang.test/api/v1',
    'https://user:password@shop.company.cn/api/v1',
    'https://shop.company.cn/api/v1?token=bad',
    'https://shop.company.cn:8443/api/v1',
    'https://shop.company.cn/api',
  ])
    assert.throws(() => productionApiUrl(url));
  // Syntax validation only; no network request or assertion that this illustrative domain is deployed.
  assert.equal(
    productionApiUrl('https://warehouse.my-business.cn/api/v1/'),
    'https://warehouse.my-business.cn/api/v1',
  );
  const original = JSON.parse(
      await readFile(new URL('../apps/mobile/src/manifest.json', import.meta.url), 'utf8'),
    ),
    before = JSON.stringify(original),
    release = releaseManifest(original);
  assert.equal(release['app-plus'].distribute.android.usesCleartextTraffic, false);
  assert.equal(JSON.stringify(original), before);
  assert.equal(release.appid, original.appid);
  assert.equal(release['app-plus'].modules.Barcode !== undefined, true);
});
