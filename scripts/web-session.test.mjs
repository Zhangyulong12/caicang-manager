import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { loadEnvFile } from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';
import ts from 'typescript';
import { startTestApi } from './api-test-server.mjs';

// Transpile the real, framework-independent production client/policy; never duplicate its logic.
const output = new URL('../apps/admin-web/.test-build/', import.meta.url);
await mkdir(output, { recursive: true });
for (const [source, target] of [
  ['api/client.ts', 'client.mjs'],
  ['router/policy.ts', 'policy.mjs'],
]) {
  const code = await readFile(new URL('../apps/admin-web/src/' + source, import.meta.url), 'utf8');
  await writeFile(
    new URL(target, output),
    ts.transpileModule(code, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
    }).outputText,
  );
}
const { createApiClient, ApiFailure, SESSION_KEY } = await import(new URL('client.mjs', output));
const { allowed, safeRedirect, navigation } = await import(new URL('policy.mjs', output));
const { Client } = createRequire(new URL('../apps/api/package.json', import.meta.url))('pg');
const runFile = promisify(execFile);
loadEnvFile(new URL('../.env', import.meta.url));

test(
  'production Web session client with real PostgreSQL authentication, tenant list and expiry',
  { timeout: 210000 },
  async (t) => {
    const source = new URL(process.env.DATABASE_URL);
    assert.ok(['localhost', '127.0.0.1'].includes(source.hostname));
    assert.equal(source.pathname, '/caicang');
    const name = `caicang_test_${randomUUID().replaceAll('-', '')}`;
    const url = new URL(source);
    url.pathname = '/' + name;
    const admin = new Client({ connectionString: source.toString() });
    const db = new Client({ connectionString: url.toString() });
    let created = false,
      connected = false,
      logs = '',
      counter = 0,
      pending = 0,
      base,
      accountA,
      accountB,
      tenantA,
      tenantA2,
      tenantB;
    const password = 'WebSessionTests!2026';
    const store = new Map();
    const storage = {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, value),
      removeItem: (key) => store.delete(key),
    };
    // A deterministic substitute for the browser Web Locks scheduler, shared by two client instances.
    let tail = Promise.resolve();
    const lock = (work) => {
      const result = tail.then(work);
      tail = result.catch(() => {});
      return result;
    };
    const counts = new Map();
    const network = async (input, init) => {
      const path = new URL(input).pathname;
      counts.set(path, (counts.get(path) ?? 0) + 1);
      return fetch(input, {
        ...init,
        headers: {
          ...init.headers,
          'X-Forwarded-For': `198.18.${Math.floor(++counter / 250)}.${(counter % 250) + 1}`,
        },
      });
    };
    const makeClient = (extra = {}) =>
      createApiClient({
        baseUrl: base + '/api/v1',
        storage,
        lock,
        fetcher: network,
        onLoading: (delta) => {
          pending += delta;
          assert.ok(pending >= 0);
        },
        ...extra,
      });
    const failure = (status, code) => (error) =>
      error instanceof ApiFailure &&
      error.status === status &&
      (code === undefined || error.code === code);
    const alterDeadline = (value) => {
      const saved = JSON.parse(store.get(SESSION_KEY));
      saved.accessExpiresAt = value;
      store.set(SESSION_KEY, JSON.stringify(saved));
    };
    const raw = (path, token, body, method = body ? 'POST' : 'GET') =>
      network(base + '/api/v1' + path, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    try {
      await admin.connect();
      assert.match(name, /^caicang_test_[a-f0-9]{32}$/);
      await admin.query(`CREATE DATABASE "${name}"`);
      created = true;
      await runFile(
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
      await t.test('production API with the actual Web client', async (http) => {
        base = await startTestApi(http, {
          env: {
            DATABASE_URL: url.toString(),
            NODE_ENV: 'test',
            JWT_ACCESS_SECRET: randomBytes(48).toString('hex'),
            JWT_ACCESS_TTL_SECONDS: '60',
            TRUSTED_PROXIES: '127.0.0.1/32,::1/128',
          },
          onOutput: (chunk) => {
            logs += chunk;
          },
        });
        const client = makeClient();
        await http.test('an unauthenticated client sends no protected request', async () => {
          const before = counter;
          await assert.rejects(client.request('/me'), failure(401, 'SESSION_ENDED'));
          assert.equal(counter, before);
        });
        await http.test(
          'real registration login and reload restoration never save passwords or user profiles',
          async () => {
            await client.register({
              email: 'a@web.example.test',
              password,
              displayName: '采购工作台 A',
            });
            accountA = await client.login({ email: 'a@web.example.test', password });
            assert.equal(accountA.email, 'a@web.example.test');
            assert.equal('passwordHash' in accountA, false);
            const saved = store.get(SESSION_KEY);
            assert.equal(saved.includes(password), false);
            assert.equal(saved.includes(accountA.email), false);
            assert.equal((await makeClient().request('/me')).data.id, accountA.id);
          },
        );
        await http.test(
          'a new account has an empty real merchant list without tenant header',
          async () => {
            const result = await client.request('/tenants');
            assert.deepEqual(result.data, []);
            assert.deepEqual(result.pagination, { page: 1, pageSize: 20, total: 0 });
          },
        );
        await http.test(
          'merchant creation creates a default warehouse and the list contains only own memberships',
          async () => {
            tenantA = (
              await client.request('/tenants', { method: 'POST', body: { name: 'A 一号商家' } })
            ).data;
            tenantA2 = (
              await client.request('/tenants', { method: 'POST', body: { name: 'A 二号商家' } })
            ).data;
            assert.equal(tenantA.defaultWarehouse.code, 'DEFAULT');
            const result = await client.request('/tenants?pageSize=1');
            assert.equal(result.pagination.total, 2);
            assert.equal(result.data.length, 1);
            const second = await client.request('/tenants?page=2&pageSize=1');
            assert.notEqual(result.data[0].tenant.id, second.data[0].tenant.id);
            assert.ok(
              [...result.data, ...second.data].every(
                (item) => item.membership.userId === accountA.id && item.membership.isActive,
              ),
            );
          },
        );
        await http.test(
          'foreign accounts cannot enumerate merchant names ids or members through the list',
          async () => {
            const separate = new Map();
            const b = makeClient({
              storage: {
                getItem: (key) => separate.get(key) ?? null,
                setItem: (key, value) => separate.set(key, value),
                removeItem: (key) => separate.delete(key),
              },
            });
            await b.register({ email: 'b@web.example.test', password });
            accountB = await b.login({ email: 'b@web.example.test', password });
            tenantB = (
              await b.request('/tenants', { method: 'POST', body: { name: 'B PRIVATE MERCHANT' } })
            ).data;
            const list = await client.request('/tenants');
            assert.equal(JSON.stringify(list).includes(tenantB.tenant.id), false);
            assert.equal(JSON.stringify(list).includes('B PRIVATE MERCHANT'), false);
            await assert.rejects(
              client.request('/tenants/current', { tenantId: tenantB.tenant.id }),
              failure(403, 'FORBIDDEN'),
            );
            await b.logout();
          },
        );
        await http.test(
          'inactive memberships disappear from the list and fail selection',
          async () => {
            await db.query('UPDATE tenant_memberships SET is_active=false WHERE id=$1', [
              tenantA2.membership.id,
            ]);
            const result = await client.request('/tenants');
            assert.equal(result.pagination.total, 1);
            assert.equal(result.data[0].tenant.id, tenantA.tenant.id);
            await assert.rejects(
              client.request('/tenants/current', { tenantId: tenantA2.tenant.id }),
              failure(403, 'FORBIDDEN'),
            );
            await db.query('UPDATE tenant_memberships SET is_active=true WHERE id=$1', [
              tenantA2.membership.id,
            ]);
          },
        );
        await http.test(
          'merchant list rejects identity injection invalid pages and unauthenticated access',
          async () => {
            for (const query of [
              'userId=' + accountB.id,
              'tenantId=' + tenantB.tenant.id,
              'page=0',
              'pageSize=101',
              'page=1&page=2',
            ])
              await assert.rejects(
                client.request('/tenants?' + query),
                failure(400, 'VALIDATION_ERROR'),
              );
            await assert.rejects(
              client.request('/tenants?page=2147483647&pageSize=100'),
              failure(400, 'BAD_REQUEST'),
            );
            assert.equal((await raw('/tenants')).status, 401);
          },
        );
        await http.test(
          'active account state is rechecked on global merchant discovery',
          async () => {
            await db.query('UPDATE users SET is_active=false WHERE id=$1', [accountA.id]);
            const saved = client.sync();
            const response = await raw('/tenants', saved.accessToken);
            assert.equal(response.status, 401);
            await db.query('UPDATE users SET is_active=true WHERE id=$1', [accountA.id]);
          },
        );
        await http.test(
          'Swagger describes merchant discovery as bearer-only standard pagination',
          async () => {
            const doc = await (await fetch(base + '/api/docs-json')).json();
            const op = doc.paths['/api/v1/tenants'].get;
            assert.deepEqual(op.security, [{ bearer: [] }]);
            assert.equal(
              op.parameters.some((param) => param.name === 'X-Tenant-Id'),
              false,
            );
            assert.ok(
              op.responses['200'].content['application/json'].schema.allOf.some(
                (part) => part.properties?.data?.type === 'array',
              ),
            );
          },
        );
        await http.test(
          'simultaneous proactive refresh across two clients consumes one credential',
          async () => {
            alterDeadline(0);
            const other = makeClient();
            const before = counts.get('/api/v1/auth/refresh') ?? 0;
            const result = await Promise.all(
              Array.from({ length: 8 }, (_, index) => (index % 2 ? client : other).request('/me')),
            );
            assert.ok(result.every((item) => item.data.id === accountA.id));
            assert.equal(counts.get('/api/v1/auth/refresh'), before + 1);
            assert.equal(pending, 0);
          },
        );
        await http.test(
          'real Access Token expiry triggers one reactive refresh and one retry per request',
          async () => {
            // Keep the actual API-issued token unchanged; only hide its local deadline to exercise 401 recovery.
            await client.login({ email: 'a@web.example.test', password });
            alterDeadline(Date.now() + 600000);
            const before = counts.get('/api/v1/auth/refresh') ?? 0;
            await delay(61000);
            const expired = await raw('/me', client.sync().accessToken);
            assert.equal(expired.status, 401);
            assert.equal((await expired.json()).error.code, 'INVALID_ACCESS_TOKEN');
            const result = await Promise.all(
              Array.from({ length: 5 }, () => client.request('/me')),
            );
            assert.ok(result.every((item) => item.data.id === accountA.id));
            assert.equal(counts.get('/api/v1/auth/refresh'), before + 1);
          },
        );
        await http.test(
          'invalid login gives a real standard error and never stores the entered password',
          async () => {
            await assert.rejects(
              client.login({ email: 'a@web.example.test', password: 'WrongPassword!2026' }),
              failure(401, 'INVALID_CREDENTIALS'),
            );
            assert.equal(store.get(SESSION_KEY).includes('WrongPassword'), false);
          },
        );
        await http.test(
          'logout network failure is reported with credentials retained for a safe retry',
          async () => {
            const broken = makeClient({
              fetcher: (input, init) =>
                String(input).endsWith('/auth/logout')
                  ? Promise.reject(new Error('offline'))
                  : network(input, init),
            });
            await assert.rejects(broken.logout(), failure(0, 'NETWORK_ERROR'));
            assert.ok(store.has(SESSION_KEY));
            assert.equal((await client.request('/me')).data.id, accountA.id);
          },
        );
        await http.test(
          'successful logout revokes server credentials and clears local state',
          async () => {
            const saved = client.sync();
            await client.logout();
            assert.equal(store.has(SESSION_KEY), false);
            assert.equal((await raw('/me', saved.accessToken)).status, 401);
            assert.equal(
              (await raw('/auth/refresh', null, { refreshToken: saved.refreshToken })).status,
              401,
            );
            await assert.rejects(client.request('/tenants'), failure(401, 'SESSION_ENDED'));
          },
        );
        await http.test(
          'late in-flight responses cannot resurrect a logged-out session',
          async () => {
            await client.login({ email: 'a@web.example.test', password });
            let release;
            const gate = new Promise((resolve) => {
              release = resolve;
            });
            let arrived;
            const ready = new Promise((resolve) => {
              arrived = resolve;
            });
            const slow = makeClient({
              fetcher: async (input, init) => {
                const response = await network(input, init);
                if (String(input).endsWith('/me')) {
                  arrived();
                  await gate;
                }
                return response;
              },
            });
            const request = slow.request('/me');
            const outcome = assert.rejects(request, failure(401, 'SESSION_CHANGED'));
            await ready;
            await client.logout();
            release();
            await outcome;
            assert.equal(store.has(SESSION_KEY), false);
          },
        );
        await http.test(
          'a changed account cannot receive the previous account response or be cleared by it',
          async () => {
            await client.login({ email: 'a@web.example.test', password });
            let release;
            const gate = new Promise((resolve) => {
              release = resolve;
            });
            let arrived;
            const ready = new Promise((resolve) => {
              arrived = resolve;
            });
            const slow = makeClient({
              fetcher: async (input, init) => {
                const response = await network(input, init);
                if (String(input).endsWith('/me')) {
                  arrived();
                  await gate;
                }
                return response;
              },
            });
            const outcome = assert.rejects(slow.request('/me'), failure(401, 'SESSION_CHANGED'));
            await ready;
            await client.login({ email: 'b@web.example.test', password });
            release();
            await outcome;
            assert.equal((await client.request('/me')).data.id, accountB.id);
            await client.logout();
          },
        );
        await http.test(
          'refresh response loss clears only the affected session and never retries old credentials',
          async () => {
            await client.login({ email: 'a@web.example.test', password });
            alterDeadline(0);
            const before = counts.get('/api/v1/auth/refresh') ?? 0;
            const ambiguous = makeClient({
              fetcher: async (input, init) => {
                const response = await network(input, init);
                if (String(input).endsWith('/auth/refresh'))
                  throw new Error('response lost after commit');
                return response;
              },
            });
            await assert.rejects(ambiguous.request('/me'), failure(0, 'NETWORK_ERROR'));
            assert.equal(store.has(SESSION_KEY), false);
            assert.equal(counts.get('/api/v1/auth/refresh'), before + 1);
          },
        );
        await http.test(
          'revoked server session fails refresh and clears persisted credentials',
          async () => {
            await client.login({ email: 'a@web.example.test', password });
            await raw('/auth/logout', null, { refreshToken: client.sync().refreshToken });
            await assert.rejects(client.request('/me'), failure(401, 'INVALID_REFRESH_TOKEN'));
            assert.equal(store.has(SESSION_KEY), false);
          },
        );
        await http.test(
          'transport failures balance global loading and preserve unconsumed session credentials',
          async () => {
            await client.login({ email: 'a@web.example.test', password });
            const offline = makeClient({ fetcher: () => Promise.reject(new Error('offline')) });
            await assert.rejects(offline.request('/me'), failure(0, 'NETWORK_ERROR'));
            assert.ok(store.has(SESSION_KEY));
            assert.equal(pending, 0);
            await client.logout();
          },
        );
        await http.test('corrupt persisted JSON is treated as signed out', async () => {
          store.set(SESSION_KEY, '{broken');
          assert.equal(makeClient().sync(), null);
          store.set(SESSION_KEY, JSON.stringify({ accessToken: 'incomplete' }));
          assert.equal(makeClient().sync(), null);
          store.clear();
        });
        await http.test(
          'all nine menu destinations exist and role guards refuse settings without permission',
          () => {
            assert.equal(navigation.length, 9);
            assert.equal(
              allowed('/settings', ['tenant:read', 'products:read', 'warehouses:read']),
              false,
            );
            assert.equal(allowed('/settings', ['members:read']), true);
            assert.equal(allowed('/products', ['products:read']), true);
            assert.equal(allowed('/unregistered', ['tenant:read']), false);
          },
        );
        await http.test('post-login redirect only accepts known internal destinations', () => {
          for (const value of [
            'https://evil.example',
            '//evil.example',
            '/\\evil.example',
            '/login',
            '/register',
            '/products?token=secret',
            ['https://evil.example'],
          ])
            assert.equal(safeRedirect(value), '/');
          assert.equal(safeRedirect('/settings'), '/settings');
          assert.equal(safeRedirect('/select-tenant'), '/select-tenant');
        });
        await http.test(
          'captured API logs omit passwords tokens raw database messages and credential storage',
          () => {
            assert.ok(logs.includes('http_request'));
            assert.equal(logs.includes(password), false);
            assert.equal(logs.includes('WrongPassword'), false);
            assert.equal(logs.includes('refreshToken'), false);
            assert.equal(pending, 0);
          },
        );
      });
    } finally {
      if (connected) await db.end();
      if (created) await admin.query(`DROP DATABASE "${name}"`);
      await admin.end();
    }
  },
);
