import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, access } from 'node:fs/promises';
import { test } from 'node:test';
import { startTestApi } from './api-test-server.mjs';

test('built NestJS serves real PostgreSQL health, OpenAPI and CORS policy', async (t) => {
  const base = await startTestApi(t);

  await t.test('health reads PostgreSQL and follows the JSON contract', async () => {
    const response = await fetch(`${base}/api/v1/health`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.status, 'ok');
    assert.equal(body.data.database, 'reachable');
    assert.equal(body.data.service, 'caicang-api');
    assert.ok(Number.isFinite(Date.parse(body.data.timestamp)));
    assert.match(body.requestId, /^[0-9a-f-]{36}$/);
  });
  await t.test('OpenAPI declares the health response schema', async () => {
    const response = await fetch(`${base}/api/docs-json`);
    assert.equal(response.status, 200);
    const schema = await response.json();
    assert.ok(schema.paths['/api/v1/health'].get.responses['200']);
    assert.ok(schema.components.schemas.HealthResponseDto);
  });
  await t.test('CORS allows local clients and rejects an unrelated origin', async () => {
    const allowed = await fetch(`${base}/api/v1/health`, {
      headers: { Origin: 'http://localhost:5173' },
    });
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    const denied = await fetch(`${base}/api/v1/health`, {
      headers: { Origin: 'https://untrusted.example' },
    });
    assert.equal(denied.headers.get('access-control-allow-origin'), null);
  });
  await t.test(
    'purchase and receipts require authentication and future routes are absent',
    async () => {
      const response = await fetch(`${base}/api/v1/purchase-orders`);
      assert.equal(response.status, 401);
      assert.equal((await response.json()).error.code, 'UNAUTHENTICATED');
      // /receipts now exists (task 17) and must reject anonymous callers like every business route.
      assert.equal((await fetch(`${base}/api/v1/receipts`)).status, 401);
      // /inventory/* exists too (task 22): a read-only route that still requires a tenant + token.
      for (const route of ['/inventory/balances', '/inventory/movements'])
        assert.equal((await fetch(`${base}/api/v1${route}`)).status, 401);
      // /outbound-orders exists too (task 24): shipping routes always need a token and a tenant.
      for (const route of ['/outbound-orders', '/outbound-orders/' + randomUUID()])
        assert.equal((await fetch(`${base}/api/v1${route}`)).status, 401);
    },
  );
});

test('Web and mobile H5 builds contain local production assets', async () => {
  for (const relative of [
    'apps/admin-web/dist/index.html',
    'apps/mobile/dist/build/h5/index.html',
  ]) {
    const url = new URL(`../${relative}`, import.meta.url);
    const html = await readFile(url, 'utf8');
    const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map(
      (match) => match[1],
    );
    assert.ok(assets.length > 0, `${relative}: no built assets`);
    for (const asset of assets)
      await access(new URL(`.${asset.startsWith('/') ? asset : `/${asset}`}`, url));
  }
});
