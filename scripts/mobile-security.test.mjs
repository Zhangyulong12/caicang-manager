import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { reportFixture } from './report-fixture.mjs';
const output = new URL('../apps/mobile/.test-build/security/', import.meta.url);
await mkdir(output, { recursive: true });
await writeFile(
  new URL('client.mjs', output),
  ts.transpileModule(
    await readFile(new URL('../apps/mobile/src/api/client.ts', import.meta.url), 'utf8'),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } },
  ).outputText,
);
const { createApiClient, ApiFailure, TENANT_KEY } = await import(new URL('client.mjs', output));
const source = await readFile(
  new URL('../apps/mobile/src/stores/session.ts', import.meta.url),
  'utf8',
);
const storeCode = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
test(
  'mobile security: real API responses cannot cross account/workspace boundaries or restore another user cache',
  { timeout: 180000 },
  async (t) => {
    await reportFixture(t, async ({ http, base, users, tenant, other }) => {
      const values = new Map(),
        storage = {
          getItem: (k) => values.get(k) ?? null,
          setItem: (k, v) => values.set(k, v),
          removeItem: (k) => values.delete(k),
        };
      const sessionFor = (actor) => ({
        ...users[actor],
        user: users[actor].user,
        accessExpiresAt: Date.now() + 900000,
        refreshExpiresAt: Date.now() + 86400000,
        sessionKey: randomUUID(),
      });
      let delayPath = '',
        arrived,
        release,
        offline = false;
      let ready, gate;
      function delay(path) {
        delayPath = path;
        ready = new Promise((r) => {
          arrived = r;
        });
        gate = new Promise((r) => {
          release = r;
        });
      }
      const transport = async (request) => {
        if (offline) throw new Error('offline');
        const response = await fetch(request.url, {
          method: request.method,
          headers: request.headers,
          ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
        });
        const data = await response.json();
        if (request.url.endsWith(delayPath) && delayPath) {
          arrived();
          await gate;
        }
        return { statusCode: response.status, data };
      };
      const api = createApiClient({ baseUrl: base + '/api/v1', storage, transport });
      await http.test('late tenant response rejected after workspace switch', async () => {
        api.saveSession(sessionFor('owner'));
        storage.setItem(TENANT_KEY, tenant.tenant.id);
        delay('/tenants/current');
        const result = api.request('/tenants/current', { tenantId: tenant.tenant.id });
        const rejection = assert.rejects(result, (e) => e.code === 'SCOPE_CHANGED');
        await ready;
        storage.setItem(TENANT_KEY, other.tenant.id);
        release();
        await rejection;
        delayPath = '';
      });
      await http.test(
        'late account response and logout cannot replace or erase a newer session',
        async () => {
          api.saveSession(sessionFor('owner'));
          delay('/me');
          const result = api.profile(),
            rejection = assert.rejects(result, (e) => e.code === 'SESSION_CHANGED');
          await ready;
          const next = sessionFor('viewer');
          api.saveSession(next);
          release();
          await rejection;
          assert.equal(api.readSession().user.id, next.user.id);
          delayPath = '';
          api.saveSession(sessionFor('owner'));
          delay('/auth/logout');
          const outgoing = api.logout();
          await ready;
          api.saveSession(next);
          release();
          await outgoing;
          assert.equal(api.readSession().sessionKey, next.sessionKey);
          delayPath = '';
        },
      );
      await http.test('late refresh does not clear new account credentials', async () => {
        // Use an unrevoked session from the other fixture owner role account.
        api.saveSession(sessionFor('admin'));
        delay('/auth/refresh');
        const result = api.refreshNow(),
          rejection = assert.rejects(result, (e) => e.code === 'SESSION_CHANGED');
        await ready;
        const next = sessionFor('viewer');
        api.saveSession(next);
        release();
        await rejection;
        assert.equal(api.readSession().sessionKey, next.sessionKey);
        delayPath = '';
      });
      await http.test(
        'offline workspace cache is bound to the real logged-in user; online bootstrap revalidates roles',
        async () => {
          const vue = createRequire(new URL('../apps/mobile/package.json', import.meta.url))('vue');
          const module = { exports: {} };
          runInNewContext(storeCode, {
            exports: module.exports,
            module,
            require: (name) =>
              name === 'vue'
                ? vue
                : name === '../api'
                  ? { api, ApiFailure, TENANT_KEY }
                  : name === '../utils/feedback'
                    ? { errorMessage: (e) => e.message }
                    : (() => {
                        throw new Error('Unexpected module ' + name);
                      })(),
            uni: {
              getStorageSync: (k) => values.get(k) ?? '',
              setStorageSync: (k, v) => values.set(k, v),
              removeStorageSync: (k) => values.delete(k),
            },
            console,
          });
          const store = module.exports;
          api.saveSession(sessionFor('buyer'));
          await store.bootstrap();
          assert.equal(store.session.user.id, users.buyer.user.id);
          assert.equal(store.session.currentTenant.tenant.id, tenant.tenant.id);
          assert.equal(
            JSON.parse(values.get('caicang.mobile.cache.v1')).userId,
            users.buyer.user.id,
          );
          // The old cached display name/permissions must not appear when a different account is offline.
          api.saveSession(sessionFor('viewer'));
          offline = true;
          store.resetSession();
          await store.bootstrap();
          assert.equal(store.session.currentTenant, null);
          assert.equal(store.session.tenants.length, 0);
          offline = false;
        },
      );
    });
  },
);
