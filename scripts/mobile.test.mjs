/**
 * Task 19 — the mobile app's own request/session layer, executed against the real API.
 *
 * The client is deliberately framework-free (storage and transport are injected), so the same
 * file that ships in the App runs here in Node: real PostgreSQL, real NestJS, real tokens.
 * Screen structure, routing, tab bar, Android permissions and the built bundle's API address
 * are asserted separately so a green run means the app is actually wired, not just compiled.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
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
await writeFile(
  new URL('client.mjs', output),
  ts.transpileModule(await readFile(mobile('src/api/client.ts'), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText,
);
const { createApiClient, ApiFailure, SESSION_KEY, TENANT_KEY } = await import(
  new URL('client.mjs', output)
);
await writeFile(
  new URL('scan.mjs', output),
  ts.transpileModule(await readFile(mobile('src/services/scan.ts'), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText,
);
const { lookupPackages, classifyLookup } = await import(new URL('scan.mjs', output));

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
    keys: () => [...map.keys()],
  };
}

test(
  'mobile app: real login, token lifecycle, tenant switching and Android packaging',
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
      logs = '';
    try {
      await t.test('mobile shell and Android packaging are declared', async () => {
        const pages = JSON.parse(await readFile(mobile('src/pages.json'), 'utf8'));
        const paths = pages.pages.map((page) => page.path);
        assert.deepEqual(paths, [
          'pages/login/index',
          'pages/home/index',
          'pages/records/index',
          'pages/account/index',
          'pages/tenant/index',
          'pages/scan/index',
          'pages/package/index',
          'pages/receiving/index',
        ]);
        assert.equal(pages.pages[0].path, 'pages/login/index', '登录页是启动页');
        assert.deepEqual(
          pages.tabBar.list.map((item) => item.pagePath),
          ['pages/home/index', 'pages/records/index', 'pages/account/index'],
        );
        assert.equal(pages.tabBar.list.length, 3);
        for (const item of pages.tabBar.list)
          assert.ok(paths.includes(item.pagePath), 'tabBar 页面必须在 pages 中：' + item.pagePath);

        const manifest = JSON.parse(await readFile(mobile('src/manifest.json'), 'utf8'));
        const permissions = manifest['app-plus'].distribute.android.permissions.join(' ');
        for (const permission of ['INTERNET', 'ACCESS_NETWORK_STATE', 'CAMERA'])
          assert.match(permissions, new RegExp(permission));
        assert.equal(manifest.vueVersion, '3');
        assert.equal(manifest['app-plus'].distribute.android.minSdkVersion, 21);
        assert.ok(Number(manifest.versionCode) >= 200);

        const home = await readFile(mobile('src/pages/home/index.vue'), 'utf8');
        for (const label of ['扫码入库', '库存查询', '扫码出库', '入库记录'])
          assert.ok(home.includes(label), '首页缺少入口：' + label);

        const adapter = await readFile(mobile('src/api/index.ts'), 'utf8');
        assert.match(adapter, /uni\.request\(/, '必须走 uni.request，而不是浏览器 fetch');
        assert.match(adapter, /apiBaseUrl/);
        const config = await readFile(mobile('src/config.ts'), 'utf8');
        assert.match(config, /VITE_API_BASE_URL/);
      });

      await t.test('production bundle carries the address from .env.production', async () => {
        const envFile = await readFile(mobile('.env.production'), 'utf8');
        const match = envFile.match(/^VITE_API_BASE_URL=(.+)$/m);
        assert.ok(match, '.env.production 必须声明 VITE_API_BASE_URL');
        const expected = match[1].trim().replace(/\/+$/, '');
        assert.notEqual(expected, 'https://api.invalid.local/api/v1', '正式地址不能是占位兜底');
        const assets = await readdir(mobile('dist/build/h5/assets'));
        let bundle = '';
        for (const file of assets.filter((entry) => entry.endsWith('.js')))
          bundle += await readFile(mobile('dist/build/h5/assets/' + file), 'utf8');
        assert.ok(bundle.includes(expected), '构建产物没有使用正式环境地址 ' + expected);
      });

      // 数据库连接、建库和迁移失败必须使验收失败，不能被当作跳过。
      await admin.connect();
      assert.match(name, /^caicang_test_[a-f0-9]{32}$/);
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
      await t.test('real API integration', async (http) => {
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
        let ip = '198.51.100.10';
        let calls = [];
        const transport = async ({ url: target, method, headers, body }) => {
          calls.push({ url: target, method, headers });
          const response = await fetch(target, {
            method,
            headers: { ...headers, 'X-Forwarded-For': ip },
            body: body === undefined ? undefined : JSON.stringify(body),
          });
          const text = await response.text();
          let data;
          try {
            data = JSON.parse(text);
          } catch {
            data = text;
          }
          return { statusCode: response.status, data };
        };
        const apiBase = base + '/api/v1';
        const makeClient = (storage) => createApiClient({ baseUrl: apiBase, storage, transport });

        const credentials = {
          email: 'picker@mobile.example.test',
          password: 'MobileDemo!2026',
          displayName: '仓库小李',
        };
        const weakRegistration = await fetch(apiBase + '/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
          body: JSON.stringify({ ...credentials, password: 'Mobile!2026' }),
        });
        assert.equal(weakRegistration.status, 400, '11 字符密码必须被服务端拒绝');
        assert.equal((await weakRegistration.json()).error.code, 'VALIDATION_ERROR');
        const registered = await fetch(apiBase + '/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
          body: JSON.stringify(credentials),
        });
        assert.equal(registered.status, 201);

        await http.test('01 wrong password fails without leaving a session behind', async () => {
          ip = '198.51.100.11';
          const storage = memoryStorage();
          const client = makeClient(storage);
          await assert.rejects(
            () => client.login({ email: credentials.email, password: 'wrong-password' }),
            (error) => {
              assert.ok(error instanceof ApiFailure);
              assert.equal(error.status, 401);
              assert.equal(error.code, 'INVALID_CREDENTIALS');
              assert.match(error.message, /邮箱或密码/);
              return true;
            },
          );
          assert.equal(storage.getItem(SESSION_KEY), null);
        });

        let storage, client, session, tenantId;
        await http.test(
          '02 login persists the session and calls carry the bearer token',
          async () => {
            ip = '198.51.100.12';
            storage = memoryStorage();
            client = makeClient(storage);
            session = await client.login({
              email: credentials.email,
              password: credentials.password,
            });
            assert.equal(session.user.email, credentials.email);
            assert.equal(session.user.displayName, credentials.displayName);
            assert.ok(session.accessToken.length > 20);
            assert.ok(session.refreshToken.length > 20);
            assert.ok(session.accessExpiresAt > Date.now());
            assert.ok(session.refreshExpiresAt > session.accessExpiresAt);
            const persisted = JSON.parse(storage.getItem(SESSION_KEY));
            assert.equal(persisted.accessToken, session.accessToken);
            assert.equal(persisted.sessionKey, session.sessionKey);

            calls = [];
            const me = await client.request('/me');
            assert.equal(me.data.email, credentials.email);
            const call = calls.at(-1);
            assert.equal(call.headers.Authorization, 'Bearer ' + session.accessToken);
            assert.equal(call.url, apiBase + '/me');
          },
        );

        await http.test(
          '03 an expired access token refreshes itself and rotates the refresh token',
          async () => {
            ip = '198.51.100.13';
            const before = JSON.parse(storage.getItem(SESSION_KEY));
            storage.setItem(
              SESSION_KEY,
              JSON.stringify({ ...before, accessExpiresAt: Date.now() - 1000 }),
            );
            const me = await client.request('/me');
            assert.equal(me.data.email, credentials.email);
            const after = JSON.parse(storage.getItem(SESSION_KEY));
            assert.notEqual(after.accessToken, before.accessToken);
            assert.notEqual(after.refreshToken, before.refreshToken, '刷新凭证必须轮换');
            assert.equal(after.sessionKey, before.sessionKey, '"记住我"的会话标识不变');
            assert.ok(after.accessExpiresAt > Date.now());
            assert.equal(calls.at(-1).headers.Authorization, 'Bearer ' + after.accessToken);
            session = after;
          },
        );

        await http.test('04 a rejected access token is retried once after refreshing', async () => {
          ip = '198.51.100.14';
          const before = JSON.parse(storage.getItem(SESSION_KEY));
          const rejectedToken = randomUUID();
          storage.setItem(
            SESSION_KEY,
            JSON.stringify({
              ...before,
              accessToken: rejectedToken,
              accessExpiresAt: Date.now() + 600000,
            }),
          );
          calls = [];
          const me = await client.request('/me');
          assert.equal(me.data.email, credentials.email);
          assert.equal(calls.filter((call) => call.url.endsWith('/me')).length, 2, '只重试一次');
          const after = JSON.parse(storage.getItem(SESSION_KEY));
          assert.notEqual(after.accessToken, rejectedToken, '必须换成刷新后的新凭证');
          assert.ok(calls.at(-1).headers.Authorization.startsWith('Bearer '));
        });

        await http.test('05 a consumed refresh credential ends the session', async () => {
          ip = '198.51.100.15';
          const before = JSON.parse(storage.getItem(SESSION_KEY));
          const consumed = await fetch(apiBase + '/auth/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
            body: JSON.stringify({ refreshToken: before.refreshToken }),
          });
          assert.equal(consumed.status, 200, '先真实消费旧刷新凭证，再验证重放被拒绝');
          storage.setItem(
            SESSION_KEY,
            JSON.stringify({
              ...before,
              accessExpiresAt: Date.now() - 1000,
              refreshToken: before.refreshToken,
            }),
          );
          await assert.rejects(
            () => client.request('/me'),
            (error) => {
              assert.ok(error instanceof ApiFailure);
              assert.equal(error.status, 401);
              assert.ok(['INVALID_REFRESH_TOKEN', 'UNAUTHENTICATED'].includes(error.code));
              return true;
            },
          );
          assert.equal(storage.getItem(SESSION_KEY), null, '刷新失败必须清空本地会话');
        });

        await http.test(
          '06 an expired refresh token ends the session without a request',
          async () => {
            ip = '198.51.100.16';
            storage = memoryStorage();
            client = makeClient(storage);
            session = await client.login({
              email: credentials.email,
              password: credentials.password,
            });
            const stale = {
              ...session,
              accessExpiresAt: Date.now() - 1000,
              refreshExpiresAt: Date.now() - 1000,
            };
            const store = memoryStorage();
            store.setItem(SESSION_KEY, JSON.stringify(stale));
            const staleClient = makeClient(store);
            calls = [];
            await assert.rejects(
              () => staleClient.request('/me'),
              (error) => {
                assert.equal(error.code, 'SESSION_EXPIRED');
                return true;
              },
            );
            assert.equal(store.getItem(SESSION_KEY), null);
            assert.equal(calls.length, 0, '过期后不应再发网络请求');
          },
        );

        await http.test('07 offline devices get a readable network error', async () => {
          const offline = createApiClient({
            baseUrl: apiBase,
            storage: memoryStorage(),
            transport: async () => {
              throw new Error('no route to host');
            },
          });
          const store = memoryStorage();
          const seeded = createApiClient({
            baseUrl: apiBase,
            storage: store,
            transport: async () => {
              throw new Error('no route to host');
            },
          });
          store.setItem(
            SESSION_KEY,
            JSON.stringify({
              accessToken: 'offline',
              refreshToken: 'offline',
              accessExpiresAt: Date.now() + 600000,
              refreshExpiresAt: Date.now() + 600000,
              sessionKey: randomUUID(),
              user: { id: randomUUID(), email: 'offline@example.test', displayName: '离线' },
            }),
          );
          await assert.rejects(
            () => seeded.request('/me'),
            (error) => {
              assert.ok(error instanceof ApiFailure);
              assert.equal(error.status, 0);
              assert.equal(error.code, 'NETWORK_ERROR');
              assert.match(error.message, /网络/);
              return true;
            },
          );
          await assert.rejects(() => offline.request('/me'), /请先登录/);
        });

        await http.test(
          '08 switching tenants changes the X-Tenant-Id sent to the API',
          async () => {
            ip = '198.51.100.18';
            const first = (
              await client.request('/tenants', { method: 'POST', body: { name: '手机端 A' } })
            ).data;
            const second = (
              await client.request('/tenants', { method: 'POST', body: { name: '手机端 B' } })
            ).data;
            const list = await client.request('/tenants?page=1&pageSize=100');
            assert.equal(list.data.length >= 2, true);

            const currentA = await client.request('/tenants/current', {
              tenantId: first.tenant.id,
            });
            assert.equal(currentA.data.tenant.id, first.tenant.id);
            assert.ok(currentA.data.permissions.includes('receiving:confirm'));
            assert.equal(calls.at(-1).headers['X-Tenant-Id'], first.tenant.id);

            const currentB = await client.request('/tenants/current', {
              tenantId: second.tenant.id,
            });
            assert.equal(currentB.data.tenant.id, second.tenant.id);
            tenantId = second.tenant.id;

            await assert.rejects(
              () => client.request('/receipts'),
              (error) => {
                assert.equal(error.status, 400);
                assert.equal(error.code, 'INVALID_TENANT_HEADER');
                return true;
              },
            );
            const receipts = await client.request('/receipts?page=1&pageSize=20', {
              tenantId: second.tenant.id,
            });
            assert.deepEqual(receipts.data, []);
            assert.equal(calls.at(-1).headers['X-Tenant-Id'], second.tenant.id);
          },
        );

        await http.test('09 logout clears local state and revokes the refresh token', async () => {
          ip = '198.51.100.19';
          const before = JSON.parse(storage.getItem(SESSION_KEY));
          storage.setItem(TENANT_KEY, 'some-tenant');
          await client.logout();
          assert.equal(storage.getItem(SESSION_KEY), null);
          assert.equal(storage.getItem(TENANT_KEY), null);
          const replay = await fetch(apiBase + '/auth/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
            body: JSON.stringify({ refreshToken: before.refreshToken }),
          });
          assert.equal(replay.status, 401, '退出后刷新凭证必须失效');
        });

        await http.test('10 a 404 from the API keeps its server message', async () => {
          ip = '198.51.100.20';
          const fresh = makeClient(memoryStorage());
          await fresh.login({ email: credentials.email, password: credentials.password });
          await assert.rejects(
            () => fresh.request('/receipts/' + randomUUID(), { tenantId }),
            (error) => {
              assert.equal(error.status, 404);
              assert.equal(error.code, 'NOT_FOUND');
              assert.equal(error.message, '资源不存在');
              return true;
            },
          );
        });

        await http.test('11 scan lookup uses the real API without changing inventory', async () => {
          ip = '198.51.100.21';
          const reader = makeClient(memoryStorage());
          await reader.login({ email: credentials.email, password: credentials.password });
          const tenant = (
            await reader.request('/tenants', { method: 'POST', body: { name: '扫码联调商家' } })
          ).data;
          const options = { tenantId: tenant.tenant.id };
          const product = (
            await reader.request('/products', {
              ...options,
              method: 'POST',
              body: { name: '扫码联调商品', sku: 'SCAN-ONLY', unit: '件' },
            })
          ).data;
          const order = (
            await reader.request('/purchase-orders', {
              ...options,
              method: 'POST',
              body: {
                warehouseId: tenant.defaultWarehouse.id,
                platform: 'TAOBAO',
                purchaseDate: '2026-10-23',
                recipient: { name: '测试员', phone: '13800000000', address: '虚构测试仓库' },
                items: [{ productId: product.id, quantity: 100, unitPrice: '18.50' }],
              },
            })
          ).data;
          await reader.request('/purchase-orders/' + order.id + '/place', {
            ...options,
            method: 'POST',
          });
          const trackingNo = '0000123456789';
          const first = (
            await reader.request('/purchase-orders/' + order.id + '/packages', {
              ...options,
              method: 'POST',
              body: { carrierCode: 'ZTO', trackingNo },
            })
          ).data;
          const snapshot = async () => {
            const result = {};
            for (const table of ['receipts', 'receipt_items', 'stock_balances', 'stock_movements'])
              result[table] = (await db.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
            result.packages = (
              await db.query('SELECT id,status,receiving_closed_at FROM packages ORDER BY id')
            ).rows;
            result.orders = (
              await db.query('SELECT id,status FROM purchase_orders ORDER BY id')
            ).rows;
            return result;
          };
          let before = await snapshot();
          calls = [];
          const single = await lookupPackages(reader, trackingNo, tenant.tenant.id);
          assert.equal(classifyLookup(single), 'single');
          assert.equal(single[0].packageId, first.id);
          assert.equal(single[0].trackingNo, trackingNo);
          const detail = await reader.request('/packages/' + first.id, options);
          assert.equal(detail.data.trackingNo, trackingNo);
          assert.ok(calls.every((call) => call.method === 'GET'));
          assert.deepEqual(await snapshot(), before, '扫码与详情查询不得写库存或改变状态');

          const second = (
            await reader.request('/purchase-orders/' + order.id + '/packages', {
              ...options,
              method: 'POST',
              body: { carrierCode: 'YTO', trackingNo },
            })
          ).data;
          before = await snapshot();
          calls = [];
          const multiple = await lookupPackages(reader, trackingNo, tenant.tenant.id);
          assert.equal(classifyLookup(multiple), 'multiple');
          assert.deepEqual(
            new Set(multiple.map((row) => row.packageId)),
            new Set([first.id, second.id]),
          );
          assert.ok(multiple.every((row) => row.trackingNo === trackingNo));
          assert.deepEqual(await lookupPackages(reader, 'UNKNOWN-0000', tenant.tenant.id), []);
          assert.deepEqual(await lookupPackages(reader, trackingNo, tenantId), []);
          await assert.rejects(
            () => reader.request('/packages/' + first.id, { tenantId }),
            (error) => error.status === 404 && error.code === 'NOT_FOUND',
          );
          assert.ok(calls.every((call) => call.method === 'GET'));
          assert.deepEqual(await snapshot(), before, '多候选、未知及跨商家查询不得写库存');
        });

        assert.equal(/unhandled|bootstrap_failed/i.test(logs), false, 'API log: ' + logs);
      });
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
