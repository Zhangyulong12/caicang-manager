import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { loadEnvFile } from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';
import ts from 'typescript';
import { startTestApi } from './api-test-server.mjs';

const { Client } = createRequire(new URL('../apps/api/package.json', import.meta.url))('pg');
const { createServer } = await import(
  new URL('../apps/admin-web/node_modules/vite/dist/node/index.js', import.meta.url)
);
const run = promisify(execFile);
loadEnvFile(new URL('../.env', import.meta.url));
const artifact = new URL('../apps/admin-web/.test-build/registration-client.mjs', import.meta.url);
await mkdir(new URL('.', artifact), { recursive: true });
await writeFile(
  artifact,
  ts.transpileModule(
    await readFile(new URL('../apps/admin-web/src/api/client.ts', import.meta.url), 'utf8'),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } },
  ).outputText,
);
const { createApiClient, ApiFailure } = await import(artifact);

test(
  'registration through the real Web proxy preserves origin and all authorization boundaries',
  { timeout: 600000 },
  async (t) => {
    const source = new URL(process.env.DATABASE_URL);
    assert.equal(source.pathname, '/caicang');
    assert.ok(['localhost', '127.0.0.1'].includes(source.hostname));
    const name = 'caicang_test_' + randomUUID().replaceAll('-', '');
    assert.match(name, /^caicang_test_[a-f0-9]{32}$/);
    const url = new URL(source);
    url.pathname = '/' + name;
    const admin = new Client({ connectionString: source.toString() });
    const db = new Client({ connectionString: url.toString() });
    let created = false,
      connected = false;
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
      await t.test('real NestJS, PostgreSQL and Vite', async (http) => {
        let logs = '';
        const api = await startTestApi(http, {
          env: {
            DATABASE_URL: url.toString(),
            NODE_ENV: 'test',
            JWT_ACCESS_SECRET: randomBytes(48).toString('hex'),
            WEB_ORIGIN: 'http://localhost:5173,http://localhost:5174',
            TRUSTED_PROXIES: '127.0.0.1/32,::1/128',
          },
          onOutput: (chunk) => {
            logs += chunk;
          },
        });
        const web = await createServer({
          root: fileURLToPath(new URL('../apps/admin-web/', import.meta.url)),
          configFile: fileURLToPath(new URL('../apps/admin-web/vite.config.ts', import.meta.url)),
          logLevel: 'silent',
          server: {
            host: '127.0.0.1',
            port: 0,
            strictPort: true,
            proxy: { '/api': { target: api } },
          },
        });
        try {
          await web.listen();
          const origin = 'http://127.0.0.1:' + web.httpServer.address().port;
          let counter = 0;
          const calls = [];
          const network = async (target, init = {}) => {
            const id = randomUUID();
            const response = await fetch(target, {
              ...init,
              headers: {
                Origin: origin,
                ...init.headers,
                'X-Request-Id': id,
                'X-Forwarded-For': `198.19.0.${++counter}`,
              },
            });
            calls.push({
              path: new URL(target).pathname,
              method: init.method ?? 'GET',
              status: response.status,
              requestId: id,
            });
            assert.equal(response.headers.get('x-request-id'), id);
            return response;
          };
          const makeClient = () => {
            const storage = new Map();
            return createApiClient({
              baseUrl: origin + '/api/v1',
              storage: {
                getItem: (key) => storage.get(key) ?? null,
                setItem: (key, value) => storage.set(key, value),
                removeItem: (key) => storage.delete(key),
              },
              lock: async (work) => await work(),
              fetcher: network,
            });
          };
          const client = makeClient();
          const account = {
            email: `proxy-${randomUUID()}@registration.example.test`,
            password: randomBytes(24).toString('base64url') + 'Aa1!',
          };
          const fails = (status, code) => (error) =>
            error instanceof ApiFailure && error.status === status && error.code === code;
          await http.test(
            'anonymous registration page loads without requiring a tenant',
            async () => {
              const response = await fetch(origin + '/register?redirect=/');
              assert.equal(response.status, 200);
              assert.match(await response.text(), /id="app"/);
              assert.equal(client.sync(), null);
            },
          );
          let user;
          await http.test(
            '127.0.0.1 proxy registration reaches the public endpoint and creates only a user',
            async () => {
              const result = await client.register(account);
              user = result.user;
              assert.equal(user.email, account.email);
              assert.equal('passwordHash' in user, false);
              assert.equal(client.sync(), null, 'registration does not fabricate a login');
              assert.deepEqual(
                (
                  await db.query(
                    'SELECT (SELECT count(*)::int FROM users) AS users, (SELECT count(*)::int FROM tenants) AS tenants, (SELECT count(*)::int FROM tenant_memberships) AS memberships, (SELECT count(*)::int FROM warehouses) AS warehouses',
                  )
                ).rows[0],
                { users: 1, tenants: 0, memberships: 0, warehouses: 0 },
              );
            },
          );
          await http.test('duplicate email and weak password retain precise failures', async () => {
            await assert.rejects(
              () => client.register(account),
              fails(409, 'EMAIL_ALREADY_EXISTS'),
            );
            await assert.rejects(
              () =>
                client.register({
                  ...account,
                  email: 'weak@registration.example.test',
                  password: 'weak',
                }),
              fails(400, 'VALIDATION_ERROR'),
            );
            assert.equal((await db.query('SELECT count(*)::int AS n FROM users')).rows[0].n, 1);
          });
          let tenantA;
          await http.test(
            'login first, then create OWNER membership and default warehouse atomically',
            async () => {
              const loggedIn = await client.login(account);
              assert.equal(loggedIn.id, user.id);
              assert.deepEqual((await client.request('/tenants')).data, []);
              tenantA = (
                await client.request('/tenants', {
                  method: 'POST',
                  body: { name: '隔离注册商家A' },
                })
              ).data;
              assert.equal(tenantA.membership.role, 'OWNER');
              assert.equal(tenantA.defaultWarehouse.code, 'DEFAULT');
              assert.equal(tenantA.defaultWarehouse.tenantId, tenantA.tenant.id);
            },
          );
          await http.test('protected routes and foreign tenant data remain protected', async () => {
            const unauth = await network(origin + '/api/v1/products');
            assert.equal(unauth.status, 401);
            const other = makeClient();
            const input = {
              email: `other-${randomUUID()}@registration.example.test`,
              password: randomBytes(24).toString('base64url') + 'Aa1!',
            };
            await other.register(input);
            await other.login(input);
            const tenantB = (
              await other.request('/tenants', { method: 'POST', body: { name: '隔离注册商家B' } })
            ).data;
            await assert.rejects(
              () => client.request('/tenants/current', { tenantId: tenantB.tenant.id }),
              fails(403, 'FORBIDDEN'),
            );
            const product = (
              await other.request('/products', {
                tenantId: tenantB.tenant.id,
                method: 'POST',
                body: { name: '隔离商品', sku: 'REGISTER-ISOLATION' },
              })
            ).data;
            await assert.rejects(
              () => client.request('/products/' + product.id, { tenantId: tenantA.tenant.id }),
              fails(404, 'NOT_FOUND'),
            );
          });
          await http.test(
            'untrusted Origin and direct non-whitelisted API calls still fail',
            async () => {
              for (const [target, requestOrigin] of [
                [origin, 'https://untrusted.example'],
                [api, origin],
              ]) {
                const response = await network(target + '/api/v1/auth/register', {
                  method: 'POST',
                  headers: { Origin: requestOrigin, 'Content-Type': 'application/json' },
                  body: '{}',
                });
                assert.equal(response.status, 403);
                assert.equal((await response.json()).error.code, 'FORBIDDEN');
              }
              assert.ok(logs.includes(calls[0].requestId));
              assert.equal(logs.includes(account.password), false);
            },
          );
          if (process.env.REGISTRATION_BROWSER_CHECK === '1') {
            const nonce = randomUUID();
            const done = new URL(
              `../test-results/registration-browser-${nonce}.done.json`,
              import.meta.url,
            );
            const state = new URL(
              `../test-results/registration-browser-state-${nonce}.json`,
              import.meta.url,
            );
            const email = `browser-${nonce}@registration.example.test`;
            await writeFile(
              state,
              JSON.stringify({
                url: origin + '/register?redirect=/',
                email,
                done: fileURLToPath(done),
                database: name,
              }),
            );
            process.stdout.write('# Browser verification ready: ' + fileURLToPath(state) + '\n');
            const deadline = Date.now() + 300000;
            let completed = false;
            while (Date.now() < deadline) {
              try {
                await access(done);
                completed = true;
                break;
              } catch {
                await delay(500);
              }
            }
            assert.ok(completed, 'browser verification was not completed');
            const row = (
              await db.query(
                'SELECT u.id, m.role, w.code FROM users u JOIN tenant_memberships m ON m.user_id=u.id JOIN warehouses w ON w.tenant_id=m.tenant_id WHERE u.email=$1',
                [email],
              )
            ).rows;
            assert.equal(row.length, 1);
            assert.equal(row[0].role, 'OWNER');
            assert.equal(row[0].code, 'DEFAULT');
            http.diagnostic(
              'Browser account, OWNER membership and default warehouse verified in isolated PostgreSQL.',
            );
          }
        } finally {
          await web.close();
        }
      });
    } finally {
      if (connected) await db.end();
      if (created) await admin.query(`DROP DATABASE "${name}"`);
      await admin.end();
    }
  },
);
