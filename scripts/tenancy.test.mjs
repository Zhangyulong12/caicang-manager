import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { request as nativeRequest } from 'node:http';
import { createRequire } from 'node:module';
import { loadEnvFile } from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { startTestApi } from './api-test-server.mjs';

const requireApi = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { Client } = requireApi('pg');
const runFile = promisify(execFile);
loadEnvFile(new URL('../.env', import.meta.url));

test(
  'real tenant isolation, role enforcement, audit atomicity and concurrent authorization',
  { timeout: 180000 },
  async (t) => {
    const source = new URL(process.env.DATABASE_URL);
    assert.ok(['localhost', '127.0.0.1'].includes(source.hostname));
    assert.equal(source.pathname, '/caicang');
    const databaseName = `caicang_test_${randomUUID().replaceAll('-', '')}`;
    const url = new URL(source);
    url.pathname = `/${databaseName}`;
    const admin = new Client({ connectionString: source.toString() });
    const db = new Client({ connectionString: url.toString() });
    const secret = randomBytes(48).toString('hex');
    const password = 'TenantTests!2026';
    const settings = {
      DATABASE_URL: url.toString(),
      NODE_ENV: 'test',
      JWT_ACCESS_SECRET: secret,
      TRUSTED_PROXIES: '127.0.0.1/32,::1/128',
    };
    let created = false,
      connected = false,
      logs = '',
      counter = 0,
      persisted;
    const tokens = [];
    const accounts = {};
    const members = {};
    let a, b;
    const read = async (response, status, code) => {
      assert.equal(response.status, status);
      const body = await response.json();
      assert.equal(body.requestId, response.headers.get('x-request-id'));
      assert.equal(JSON.stringify(body).includes('passwordHash'), false);
      assert.equal(JSON.stringify(body).includes('password_hash'), false);
      if (code) {
        assert.equal(body.error.code, code);
        assert.deepEqual(body.error.details, {});
      }
      return body;
    };
    try {
      await admin.connect();
      assert.match(databaseName, /^caicang_test_[a-f0-9]{32}$/);
      await admin.query(`CREATE DATABASE "${databaseName}"`);
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
      await t.test('production controllers and shared authorization guards', async (http) => {
        const base = await startTestApi(http, {
          env: settings,
          onOutput: (chunk) => {
            logs += chunk;
          },
        });
        const second = await startTestApi(http, {
          env: settings,
          onOutput: (chunk) => {
            logs += chunk;
          },
        });
        const request = (
          path,
          { actor = 'ownerA', tenant, method = 'GET', body, server = base, headers = {} } = {},
        ) =>
          fetch(`${server}/api/v1${path}`, {
            method,
            headers: {
              'Content-Type': 'application/json',
              'X-Forwarded-For': `198.18.${Math.floor(++counter / 250)}.${(counter % 250) + 1}`,
              ...(actor && accounts[actor]
                ? { Authorization: `Bearer ${accounts[actor].accessToken}` }
                : {}),
              ...(tenant
                ? { 'X-Tenant-Id': typeof tenant === 'string' ? tenant : tenant.tenant.id }
                : {}),
              ...headers,
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          });
        const add = (actor, account, role, tenant = a, extra = {}) =>
          request('/members', {
            actor,
            tenant,
            method: 'POST',
            body: { email: accounts[account].user.email, role },
            ...extra,
          });
        const patch = (actor, id, body, tenant = a, extra = {}) =>
          request(`/members/${id}`, { actor, tenant, method: 'PATCH', body, ...extra });
        const auditCount = async () =>
          (await db.query('SELECT count(*)::int AS n FROM audit_logs')).rows[0].n;
        const counts = async () =>
          (
            await db.query(
              'SELECT (SELECT count(*)::int FROM tenants) AS tenants, (SELECT count(*)::int FROM tenant_memberships) AS members, (SELECT count(*)::int FROM warehouses) AS warehouses, (SELECT count(*)::int FROM audit_logs) AS audits',
            )
          ).rows[0];
        for (const name of [
          'ownerA',
          'ownerB',
          'admin',
          'buyer',
          'warehouse',
          'viewer',
          'extra',
          'race',
          'rollback',
          'disabled',
          'multi',
          'late',
        ]) {
          const email = `${name.toLowerCase()}@tenant.example.com`;
          await read(
            await request('/auth/register', {
              actor: null,
              method: 'POST',
              body: { email, password, displayName: name },
            }),
            201,
          );
          const response = await read(
            await request('/auth/login', {
              actor: null,
              method: 'POST',
              body: { email, password },
            }),
            200,
          );
          accounts[name] = response.data;
          tokens.push(response.data.accessToken, response.data.refreshToken);
        }
        await http.test(
          'anonymous requests cannot create or read tenants or manage members',
          async () => {
            for (const [path, method, body] of [
              ['/tenants', 'POST', { name: 'denied' }],
              ['/tenants/current', 'GET'],
              ['/members', 'GET'],
              ['/members', 'POST', {}],
              [`/members/${randomUUID()}`, 'PATCH', {}],
            ])
              await read(
                await request(path, { actor: null, method, body, tenant: randomUUID() }),
                401,
                'UNAUTHENTICATED',
              );
            assert.equal((await counts()).tenants, 0);
          },
        );
        await http.test(
          'creation transaction establishes owner, default warehouse and audit for two accounts',
          async () => {
            const requestId = randomUUID();
            const first = await read(
              await request('/tenants', {
                method: 'POST',
                body: { name: ' 商家 A ' },
                headers: { 'X-Request-Id': requestId },
              }),
              201,
            );
            a = first.data;
            b = (
              await read(
                await request('/tenants', {
                  actor: 'ownerB',
                  method: 'POST',
                  body: { name: '商家 B' },
                }),
                201,
              )
            ).data;
            assert.notEqual(a.tenant.id, b.tenant.id);
            for (const [result, actor, name] of [
              [a, 'ownerA', '商家 A'],
              [b, 'ownerB', '商家 B'],
            ]) {
              assert.equal(result.tenant.name, name);
              assert.equal(result.membership.userId, accounts[actor].user.id);
              assert.equal(result.membership.tenantId, result.tenant.id);
              assert.equal(result.membership.role, 'OWNER');
              assert.equal(result.defaultWarehouse.code, 'DEFAULT');
              assert.equal(result.defaultWarehouse.name, '默认仓库');
              assert.equal(result.defaultWarehouse.tenantId, result.tenant.id);
              assert.equal(result.defaultWarehouse.isActive, true);
            }
            assert.deepEqual(await counts(), { tenants: 2, members: 2, warehouses: 2, audits: 2 });
            const audit = (
              await db.query('SELECT * FROM audit_logs WHERE tenant_id=$1', [a.tenant.id])
            ).rows[0];
            assert.equal(audit.action, 'TENANT_CREATED');
            assert.equal(audit.actor_id, accounts.ownerA.user.id);
            assert.equal(audit.metadata.requestId, requestId);
          },
        );
        await http.test(
          'current tenant reads selected identity and A/B owners cannot read each other',
          async () => {
            for (const [actor, own, foreign] of [
              ['ownerA', a, b],
              ['ownerB', b, a],
            ]) {
              const body = await read(
                await request('/tenants/current', { actor, tenant: own }),
                200,
              );
              assert.equal(body.data.tenant.id, own.tenant.id);
              assert.equal(body.data.membership.role, 'OWNER');
              assert.equal(JSON.stringify(body).includes(foreign.tenant.name), false);
              await read(
                await request('/tenants/current', { actor, tenant: foreign }),
                403,
                'FORBIDDEN',
              );
              await read(await request('/members', { actor, tenant: foreign }), 403, 'FORBIDDEN');
            }
          },
        );
        for (const value of [
          undefined,
          'invalid',
          `${randomUUID()},${randomUUID()}`,
          '00000000-0000-0000-0000-00000000000z',
        ])
          await http.test(
            `invalid or missing tenant header ${value === undefined ? 'missing' : value.length}`,
            async () => {
              await read(
                await request('/tenants/current', {
                  headers: value === undefined ? {} : { 'X-Tenant-Id': value },
                }),
                400,
                'INVALID_TENANT_HEADER',
              );
            },
          );
        await http.test(
          'duplicate tenant headers are rejected on the real HTTP transport',
          async () => {
            const result = await new Promise((resolve, reject) => {
              const req = nativeRequest(
                `${base}/api/v1/tenants/current`,
                {
                  headers: {
                    Authorization: `Bearer ${accounts.ownerA.accessToken}`,
                    'X-Tenant-Id': [a.tenant.id, a.tenant.id],
                  },
                },
                (response) => {
                  let text = '';
                  response.on('data', (chunk) => {
                    text += chunk;
                  });
                  response.on('end', () =>
                    resolve({ status: response.statusCode, body: JSON.parse(text) }),
                  );
                },
              );
              req.on('error', reject);
              req.end();
            });
            assert.equal(result.status, 400);
            assert.equal(result.body.error.code, 'INVALID_TENANT_HEADER');
          },
        );
        await http.test(
          'tenant, role and user identity cannot be supplied through query/body/custom identity headers',
          async () => {
            await read(
              await request(`/tenants/current?tenantId=${a.tenant.id}`, {
                headers: { 'X-User-Id': accounts.ownerA.user.id, 'X-Role': 'OWNER' },
              }),
              400,
              'INVALID_TENANT_HEADER',
            );
            await read(
              await request('/tenants/current', {
                actor: 'ownerB',
                tenant: a,
                headers: { 'X-User-Id': accounts.ownerA.user.id, 'X-Role': 'OWNER' },
              }),
              403,
              'FORBIDDEN',
            );
            await read(
              await request('/tenants/current', { tenant: randomUUID() }),
              403,
              'FORBIDDEN',
            );
          },
        );
        await http.test(
          'owner adds registered accounts in all four assignable roles with safe fields',
          async () => {
            for (const [account, role] of [
              ['admin', 'ADMIN'],
              ['buyer', 'BUYER'],
              ['warehouse', 'WAREHOUSE'],
              ['viewer', 'VIEWER'],
            ]) {
              const body = await read(await add('ownerA', account, role), 201);
              members[account] = body.data;
              assert.equal(body.data.role, role);
              assert.equal(body.data.userId, accounts[account].user.id);
              assert.equal(body.data.tenantId, a.tenant.id);
              assert.deepEqual(Object.keys(body.data.user).sort(), [
                'displayName',
                'email',
                'id',
                'isActive',
              ]);
            }
          },
        );
        await http.test(
          'member list is paginated, tenant scoped and only available to managers',
          async () => {
            const first = await read(
              await request('/members?page=1&pageSize=2', { tenant: a }),
              200,
            );
            const secondPage = await read(
              await request('/members?page=2&pageSize=2', { actor: 'admin', tenant: a }),
              200,
            );
            assert.deepEqual(first.pagination, { page: 1, pageSize: 2, total: 5 });
            assert.equal(first.data.length, 2);
            assert.equal(secondPage.data.length, 2);
            assert.ok(first.data.every((member) => member.tenantId === a.tenant.id));
            assert.ok(
              first.data.every(
                (member) => !secondPage.data.some((other) => other.id === member.id),
              ),
            );
            const onlyB = await read(
              await request('/members', { actor: 'ownerB', tenant: b }),
              200,
            );
            assert.equal(onlyB.data.length, 1);
            assert.equal(onlyB.data[0].userId, accounts.ownerB.user.id);
            for (const actor of ['buyer', 'warehouse', 'viewer'])
              await read(await request('/members', { actor, tenant: a }), 403, 'FORBIDDEN');
          },
        );
        await http.test(
          'five roles can read current tenant, with buyer and warehouse permissions differing',
          async () => {
            const results = {};
            for (const actor of ['ownerA', 'admin', 'buyer', 'warehouse', 'viewer'])
              results[actor] = (
                await read(await request('/tenants/current', { actor, tenant: a }), 200)
              ).data;
            assert.ok(results.buyer.permissions.includes('purchase:write'));
            assert.equal(results.buyer.permissions.includes('receiving:confirm'), false);
            assert.ok(results.warehouse.permissions.includes('receiving:confirm'));
            assert.equal(results.warehouse.permissions.includes('purchase:write'), false);
            assert.equal(results.warehouse.permissions.includes('reports:read'), false);
            assert.ok(results.buyer.permissions.includes('reports:read'));
            assert.equal(results.viewer.permissions.includes('reports:export'), false);
            assert.deepEqual(results.viewer.permissions, [
              'reports:read',
              'tenant:read',
              'products:read',
              'warehouses:read',
              'purchase:read',
              'packages:read',
            ]);
          },
        );
        await http.test(
          'same account belongs to two tenants with independent roles and no cross-target lookup',
          async () => {
            members.multiA = (await read(await add('ownerA', 'multi', 'ADMIN'), 201)).data;
            members.multiB = (await read(await add('ownerB', 'multi', 'VIEWER', b), 201)).data;
            const ownA = (
              await read(await request('/tenants/current', { actor: 'multi', tenant: a }), 200)
            ).data;
            const ownB = (
              await read(await request('/tenants/current', { actor: 'multi', tenant: b }), 200)
            ).data;
            assert.equal(ownA.membership.role, 'ADMIN');
            assert.equal(ownB.membership.role, 'VIEWER');
            await read(await request('/members', { actor: 'multi', tenant: b }), 403, 'FORBIDDEN');
            await read(
              await patch('ownerA', members.multiB.id, { role: 'BUYER' }),
              404,
              'NOT_FOUND',
            );
            await read(await patch('ownerA', randomUUID(), { role: 'BUYER' }), 404, 'NOT_FOUND');
            await read(
              await patch('multi', members.multiB.id, { role: 'BUYER' }),
              404,
              'NOT_FOUND',
            );
            assert.equal(
              (
                await db.query('SELECT role FROM tenant_memberships WHERE id=$1', [
                  members.multiB.id,
                ])
              ).rows[0].role,
              'VIEWER',
            );
          },
        );
        await http.test(
          'foreign targets return the same generic 404 and leak no membership or tenant data',
          async () => {
            const foreign = await read(
              await patch('ownerA', b.membership.id, { isActive: false }),
              404,
              'NOT_FOUND',
            );
            const absent = await read(
              await patch('ownerA', randomUUID(), { isActive: false }),
              404,
              'NOT_FOUND',
            );
            assert.deepEqual(foreign.error, absent.error);
            assert.equal(JSON.stringify(foreign).includes(b.membership.id), false);
            assert.equal(JSON.stringify(foreign).includes(accounts.ownerB.user.email), false);
          },
        );
        await http.test(
          'ordinary members cannot add members or promote themselves even with forged role headers',
          async () => {
            const before = await auditCount();
            for (const actor of ['buyer', 'warehouse', 'viewer']) {
              await read(
                await add(actor, 'extra', 'OWNER', a, { headers: { 'X-Role': 'OWNER' } }),
                403,
                'FORBIDDEN',
              );
              for (const role of ['OWNER', 'ADMIN'])
                await read(await patch(actor, members[actor].id, { role }), 403, 'FORBIDDEN');
            }
            assert.equal(await auditCount(), before);
          },
        );
        await http.test(
          'OWNER cannot be assigned, transferred, demoted or disabled through generic endpoints',
          async () => {
            const before = await auditCount();
            await read(await add('ownerA', 'extra', 'OWNER'), 403, 'FORBIDDEN');
            await read(
              await patch('ownerA', members.viewer.id, { role: 'OWNER' }),
              403,
              'FORBIDDEN',
            );
            for (const actor of ['ownerA', 'admin'])
              for (const body of [{ role: 'VIEWER' }, { isActive: false }, { role: 'OWNER' }])
                await read(await patch(actor, a.membership.id, body), 403, 'FORBIDDEN');
            assert.equal(await auditCount(), before);
            const saved = (
              await db.query('SELECT role,is_active FROM tenant_memberships WHERE id=$1', [
                a.membership.id,
              ])
            ).rows[0];
            assert.deepEqual(saved, { role: 'OWNER', is_active: true });
          },
        );
        await http.test(
          'ADMIN manages ordinary roles but cannot grant ADMIN or edit another ADMIN or self',
          async () => {
            members.extra = (await read(await add('admin', 'extra', 'BUYER'), 201)).data;
            await read(await patch('admin', members.extra.id, { role: 'WAREHOUSE' }), 200);
            await read(await patch('admin', members.extra.id, { isActive: false }), 200);
            await read(await patch('admin', members.extra.id, { isActive: true }), 200);
            for (const role of ['ADMIN', 'OWNER'])
              await read(await add('admin', 'late', role), 403, 'FORBIDDEN');
            for (const id of [members.admin.id, members.multiA.id])
              await read(await patch('admin', id, { role: 'VIEWER' }), 403, 'FORBIDDEN');
            await read(await patch('admin', members.extra.id, { role: 'ADMIN' }), 403, 'FORBIDDEN');
          },
        );
        await http.test(
          'OWNER can promote/demote ADMIN, while existing access tokens use fresh database roles',
          async () => {
            await read(await patch('ownerA', members.extra.id, { role: 'ADMIN' }), 200);
            await read(await request('/members', { actor: 'extra', tenant: a }), 200);
            await read(await patch('ownerA', members.extra.id, { role: 'VIEWER' }), 200);
            await read(
              await request('/members', { actor: 'extra', tenant: a, server: second }),
              403,
              'FORBIDDEN',
            );
            assert.equal(
              (await read(await request('/tenants/current', { actor: 'extra', tenant: a }), 200))
                .data.membership.role,
              'VIEWER',
            );
          },
        );
        await http.test(
          'disabled membership loses tenant access immediately but retains account and other tenant access',
          async () => {
            await read(await patch('ownerA', members.multiA.id, { isActive: false }), 200);
            await read(
              await request('/tenants/current', { actor: 'multi', tenant: a, server: second }),
              403,
              'FORBIDDEN',
            );
            await read(await request('/members', { actor: 'multi', tenant: a }), 403, 'FORBIDDEN');
            await read(await request('/tenants/current', { actor: 'multi', tenant: b }), 200);
            await read(await request('/me', { actor: 'multi' }), 200);
            await read(await add('ownerA', 'multi', 'BUYER'), 409, 'MEMBER_ALREADY_EXISTS');
            await read(await patch('ownerA', members.multiA.id, { isActive: true }), 200);
            await read(await request('/members', { actor: 'multi', tenant: a }), 200);
          },
        );
        await http.test(
          'unknown/disabled global accounts are not added; global disable rejects existing sessions',
          async () => {
            await read(
              await request('/members', {
                tenant: a,
                method: 'POST',
                body: { email: 'unknown@tenant.example.com', role: 'VIEWER' },
              }),
              404,
              'NOT_FOUND',
            );
            await db.query('UPDATE users SET is_active=false WHERE id=$1', [
              accounts.disabled.user.id,
            ]);
            await read(await add('ownerA', 'disabled', 'VIEWER'), 404, 'NOT_FOUND');
            await db.query('UPDATE users SET is_active=false WHERE id=$1', [
              accounts.viewer.user.id,
            ]);
            await read(
              await request('/tenants/current', { actor: 'viewer', tenant: a }),
              401,
              'UNAUTHENTICATED',
            );
            await read(
              await patch('ownerA', members.viewer.id, { isActive: true }),
              409,
              'RESOURCE_CONFLICT',
            );
            await db.query('UPDATE users SET is_active=true WHERE id=$1', [
              accounts.viewer.user.id,
            ]);
          },
        );
        for (const [label, body] of Object.entries({
          empty: {},
          blank: { name: ' ' },
          null: { name: null },
          long: { name: 'x'.repeat(151) },
          nul: { name: 'bad\0name' },
          role: { name: 'bad', role: 'OWNER' },
          tenant: { name: 'bad', tenantId: randomUUID() },
          user: { name: 'bad', userId: randomUUID() },
        }))
          await http.test(`create tenant rejects ${label}`, async () => {
            const response = await request('/tenants', { method: 'POST', body });
            assert.equal(response.status, 400);
            assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
          });
        await http.test(
          'member input, parameters and pagination reject invalid values without disclosure',
          async () => {
            for (const body of [
              {},
              { email: 'bad', role: 'BUYER' },
              { email: accounts.extra.user.email, role: 'ROOT' },
              { email: accounts.extra.user.email, role: 'BUYER', tenantId: b.tenant.id },
              { email: accounts.extra.user.email, role: 'BUYER', isActive: false },
            ]) {
              const response = await request('/members', { tenant: a, method: 'POST', body });
              assert.equal(response.status, 400);
              assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
            }
            for (const body of [
              { role: null },
              { isActive: null },
              { isActive: 'false' },
              { role: 'buyer' },
              { userId: accounts.ownerA.user.id },
              { tenantId: b.tenant.id },
            ]) {
              const response = await patch('ownerA', members.extra.id, body);
              assert.equal(response.status, 400);
              assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
            }
            await read(await patch('ownerA', members.extra.id, {}), 400, 'BAD_REQUEST');
            const invalid = await patch('ownerA', 'not-a-uuid', { role: 'VIEWER' });
            assert.equal(invalid.status, 400);
            assert.equal((await invalid.json()).error.code, 'VALIDATION_ERROR');
            for (const query of ['page=0', 'pageSize=101', 'page=NaN', 'tenantId=' + b.tenant.id]) {
              const response = await request('/members?' + query, { tenant: a });
              assert.equal(response.status, 400);
              assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
            }
            await read(
              await request('/members?page=2147483647&pageSize=100', { tenant: a }),
              400,
              'BAD_REQUEST',
            );
          },
        );
        await http.test(
          'normalized registered email lookup and existing inactive relations never create duplicate members',
          async () => {
            await read(
              await request('/members', {
                tenant: a,
                method: 'POST',
                body: { email: '  BUYER@TENANT.EXAMPLE.COM  ', role: 'BUYER' },
              }),
              409,
              'MEMBER_ALREADY_EXISTS',
            );
            assert.equal(
              (
                await db.query(
                  'SELECT count(*)::int AS n FROM tenant_memberships WHERE tenant_id=$1 AND user_id=$2',
                  [a.tenant.id, accounts.buyer.user.id],
                )
              ).rows[0].n,
              1,
            );
          },
        );
        await http.test(
          'parallel additions across API processes create one membership and one audit',
          async () => {
            const before = await auditCount();
            const responses = await Promise.all([
              add('ownerA', 'race', 'BUYER'),
              add('ownerA', 'race', 'WAREHOUSE', a, { server: second }),
            ]);
            assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
            for (const response of responses) {
              const body = await read(
                response,
                response.status,
                response.status === 409 ? 'MEMBER_ALREADY_EXISTS' : undefined,
              );
              if (response.status === 201) members.race = body.data;
            }
            assert.equal(await auditCount(), before + 1);
            assert.equal(
              (
                await db.query(
                  'SELECT count(*)::int AS n FROM tenant_memberships WHERE tenant_id=$1 AND user_id=$2',
                  [a.tenant.id, accounts.race.user.id],
                )
              ).rows[0].n,
              1,
            );
          },
        );
        await http.test(
          'parallel identical patches are idempotent and audit exactly one state change',
          async () => {
            const role = members.race.role === 'VIEWER' ? 'BUYER' : 'VIEWER';
            const before = await auditCount();
            for (const response of await Promise.all([
              patch('ownerA', members.race.id, { role }),
              patch('ownerA', members.race.id, { role }, a, { server: second }),
            ]))
              assert.equal((await read(response, 200)).data.role, role);
            assert.equal(await auditCount(), before + 1);
          },
        );
        await http.test(
          'audit has authenticated actor, tenant, requestId and exact role/state before and after',
          async () => {
            const requestId = randomUUID();
            const before = (
              await db.query('SELECT role,is_active FROM tenant_memberships WHERE id=$1', [
                members.race.id,
              ])
            ).rows[0];
            await read(
              await patch('ownerA', members.race.id, { role: 'WAREHOUSE', isActive: false }, a, {
                headers: { 'X-Request-Id': requestId },
              }),
              200,
            );
            const audit = (
              await db.query(
                "SELECT * FROM audit_logs WHERE tenant_id=$1 AND metadata->>'requestId'=$2",
                [a.tenant.id, requestId],
              )
            ).rows[0];
            assert.equal(audit.actor_id, accounts.ownerA.user.id);
            assert.equal(audit.object_id, members.race.id);
            assert.equal(audit.action, 'MEMBER_UPDATED');
            assert.deepEqual(audit.metadata, {
              requestId,
              before: { role: before.role, isActive: before.is_active },
              after: { role: 'WAREHOUSE', isActive: false },
            });
            const raw = JSON.stringify((await db.query('SELECT metadata FROM audit_logs')).rows);
            assert.equal(raw.includes('@tenant.example.com'), false);
            assert.equal(raw.includes(password), false);
          },
        );
        await http.test(
          'audit failure rolls back tenant creation, default warehouse, member addition and role update',
          async () => {
            const before = await counts();
            const role = (
              await db.query('SELECT role FROM tenant_memberships WHERE id=$1', [members.extra.id])
            ).rows[0].role;
            await db.query(
              "CREATE FUNCTION test_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'AUDIT_PASSWORD_TOKEN_SECRET'; END $$",
            );
            await db.query(
              'CREATE TRIGGER test_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION test_reject_audit()',
            );
            try {
              await read(
                await request('/tenants', { method: 'POST', body: { name: 'must rollback' } }),
                500,
                'INTERNAL_ERROR',
              );
              await read(await add('ownerA', 'rollback', 'VIEWER'), 500, 'INTERNAL_ERROR');
              await read(
                await patch('ownerA', members.extra.id, { role: 'BUYER' }),
                500,
                'INTERNAL_ERROR',
              );
              assert.deepEqual(await counts(), before);
              assert.equal(
                (
                  await db.query('SELECT role FROM tenant_memberships WHERE id=$1', [
                    members.extra.id,
                  ])
                ).rows[0].role,
                role,
              );
            } finally {
              await db.query('DROP TRIGGER test_audit_failure ON audit_logs');
              await db.query('DROP FUNCTION test_reject_audit()');
            }
            await read(await add('ownerA', 'rollback', 'VIEWER'), 201);
          },
        );
        for (const revoke of ['role', 'inactive'])
          await http.test(
            `transaction rechecks ${revoke} after Guard passed and waited for tenant lock`,
            async () => {
              const locker = new Client({ connectionString: url.toString() });
              await locker.connect();
              let pending;
              try {
                await locker.query('BEGIN');
                await locker.query('SELECT id FROM tenants WHERE id=$1 FOR UPDATE', [a.tenant.id]);
                const before = await auditCount();
                pending = patch('admin', members.viewer.id, { role: 'BUYER' });
                const deadline = Date.now() + 3000;
                let waiting = false;
                while (Date.now() < deadline) {
                  const row = (
                    await db.query(
                      "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1 AND wait_event_type='Lock' AND query LIKE '%FROM tenants WHERE id%'",
                      [databaseName],
                    )
                  ).rows[0];
                  if (row.n > 0) {
                    waiting = true;
                    break;
                  }
                  await delay(20);
                }
                assert.equal(
                  waiting,
                  true,
                  'request must reach the service transaction before revocation',
                );
                await locker.query(
                  revoke === 'role'
                    ? "UPDATE tenant_memberships SET role='VIEWER' WHERE id=$1"
                    : 'UPDATE tenant_memberships SET is_active=false WHERE id=$1',
                  [members.admin.id],
                );
                await locker.query('COMMIT');
                await read(await pending, 403, 'FORBIDDEN');
                pending = undefined;
                assert.equal(await auditCount(), before);
                assert.equal(
                  (
                    await db.query('SELECT role FROM tenant_memberships WHERE id=$1', [
                      members.viewer.id,
                    ])
                  ).rows[0].role,
                  'VIEWER',
                );
              } finally {
                await locker.query('ROLLBACK');
                await locker.end();
                if (pending) await pending;
              }
              await read(
                await patch('ownerA', members.admin.id, { role: 'ADMIN', isActive: true }),
                200,
              );
            },
          );
        await http.test(
          'same user can create another merchant even while a VIEWER in an existing one',
          async () => {
            const result = (
              await read(
                await request('/tenants', {
                  actor: 'multi',
                  method: 'POST',
                  body: { name: '多商家个人创建' },
                }),
                201,
              )
            ).data;
            assert.equal(result.membership.role, 'OWNER');
            assert.equal(result.membership.userId, accounts.multi.user.id);
            assert.equal(
              (await read(await request('/tenants/current', { actor: 'multi', tenant: b }), 200))
                .data.membership.role,
              'VIEWER',
            );
          },
        );
        await http.test(
          'Swagger publishes merchant security, DTO roles and tenant-scoped operations only',
          async () => {
            const doc = await (await fetch(`${base}/api/docs-json`)).json();
            for (const [path, method] of [
              ['/tenants/current', 'get'],
              ['/members', 'get'],
              ['/members', 'post'],
              ['/members/{membershipId}', 'patch'],
            ]) {
              const operation = doc.paths['/api/v1' + path][method];
              assert.ok(operation.security.some((value) => Object.hasOwn(value, 'bearer')));
              assert.ok(operation.security.some((value) => Object.hasOwn(value, 'tenant')));
              assert.deepEqual(operation.security, [{ bearer: [], tenant: [] }]);
              assert.ok(
                operation.parameters.some(
                  (value) => value.name === 'X-Tenant-Id' && value.required,
                ),
              );
            }
            assert.deepEqual(doc.components.schemas.AddMemberDto.properties.role.enum, [
              'OWNER',
              'ADMIN',
              'BUYER',
              'WAREHOUSE',
              'VIEWER',
            ]);
            assert.ok(
              !doc.paths['/api/v1/tenants'].post.security.some((value) =>
                Object.hasOwn(value, 'tenant'),
              ),
            );
            assert.equal(JSON.stringify(doc).includes('__tenant-test'), false);
            assert.equal(JSON.stringify(doc).includes('passwordHash'), false);
            assert.equal((await request('/__tenant-test/purchase', { tenant: a })).status, 404);
          },
        );
        await http.test(
          'tokens, passwords, registered email and injected database exceptions are absent from application logs',
          () => {
            assert.ok(logs.includes('http_request'));
            for (const token of tokens) assert.equal(logs.includes(token), false);
            for (const value of [
              secret,
              password,
              '@tenant.example.com',
              'AUDIT_PASSWORD_TOKEN_SECRET',
            ])
              assert.equal(logs.includes(value), false);
          },
        );
        persisted = { tenantId: a.tenant.id, ownerToken: accounts.ownerA.accessToken };
      });
      await t.test(
        'role and permission decorators deny incorrect operations using the real shared Guards',
        async (fixture) => {
          const base = await startTestApi(fixture, {
            env: settings,
            entry: 'apps/api/.test-build/test/tenant-fixture-main.js',
          });
          const fetchRole = (path, actor, tenant = a) =>
            fetch(`${base}/api/v1${path}`, {
              headers: {
                Authorization: `Bearer ${accounts[actor].accessToken}`,
                'X-Tenant-Id': tenant.tenant.id,
              },
            });
          for (const actor of ['ownerA', 'admin', 'buyer', 'warehouse', 'viewer'])
            for (const [path, allowed] of [
              ['purchase', ['ownerA', 'admin', 'buyer']],
              ['receiving', ['ownerA', 'admin', 'warehouse']],
              ['outbound', ['ownerA', 'admin', 'warehouse']],
              ['buyer-only', ['buyer']],
            ])
              await fixture.test(`${actor} ${path}`, async () => {
                const accepted = allowed.includes(actor);
                await read(
                  await fetchRole('/__tenant-test/' + path, actor),
                  accepted ? 200 : 403,
                  accepted ? undefined : 'FORBIDDEN',
                );
              });
          await fixture.test(
            'new controller without an explicit tenant authorization declaration is denied even to OWNER',
            async () => read(await fetchRole('/__tenant-default-test', 'ownerA'), 403, 'FORBIDDEN'),
          );
          await fixture.test(
            'test permission routes also enforce foreign merchant membership',
            async () =>
              read(await fetchRole('/__tenant-test/purchase', 'buyer', b), 403, 'FORBIDDEN'),
          );
        },
      );
      await t.test('merchant data, roles and audit persist across API restart', async (restart) => {
        const base = await startTestApi(restart, { env: settings });
        const body = await read(
          await fetch(`${base}/api/v1/tenants/current`, {
            headers: {
              Authorization: `Bearer ${persisted.ownerToken}`,
              'X-Tenant-Id': persisted.tenantId,
            },
          }),
          200,
        );
        assert.equal(body.data.tenant.name, '商家 A');
        assert.equal(body.data.membership.role, 'OWNER');
        assert.ok((await db.query('SELECT count(*)::int AS n FROM audit_logs')).rows[0].n > 10);
      });
    } finally {
      if (connected) await db.end();
      if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
      await admin.end();
    }
  },
);
