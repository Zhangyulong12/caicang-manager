import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, access } from 'node:fs/promises';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('built NestJS serves real PostgreSQL health, OpenAPI and CORS policy', async (t) => {
  const port = await freePort();
  const child = spawn(process.execPath, ['apps/api/dist/main.js'], {
    cwd: root,
    env: { ...process.env, API_PORT: String(port) },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (data) => {
    output = (output + data.toString()).slice(-4000);
  });
  child.stderr.on('data', (data) => {
    output = (output + data.toString()).slice(-4000);
  });
  t.after(async () => {
    if (child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
  });

  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 300; attempt++) {
    if (child.exitCode !== null) assert.fail(`API exited during startup: ${output}`);
    try {
      const response = await fetch(`${base}/api/v1/health`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      /* Retry only while the test server starts. */
    }
    await delay(100);
  }
  assert.ok(ready, `API did not become ready: ${output}`);

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
  await t.test('unimplemented business routes are absent', async () => {
    const response = await fetch(`${base}/api/v1/purchase-orders`);
    assert.equal(response.status, 404);
  });
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
