import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
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
  'real warehouse API, tenant roles, concurrency and historical warehouse constraints',
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
    const password = 'WarehousesTests!2026';
    const settings = {
      DATABASE_URL: url.toString(),
      NODE_ENV: 'test',
      JWT_ACCESS_SECRET: secret,
      TRUSTED_PROXIES: '127.0.0.1/32,::1/128',
    };
    const accounts = {};
    let created = false,
      connected = false,
      logs = '',
      counter = 0,
      a,
      b,
      warehouse,
      foreign,
      adminMembership,
      persisted;
    const read = async (response, status, code) => {
      assert.equal(response.status, status);
      const body = await response.json();
      assert.equal(body.requestId, response.headers.get('x-request-id'));
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
      await t.test('production controllers with real PostgreSQL', async (http) => {
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
          { actor = 'ownerA', tenant = a, method = 'GET', body, server = base, headers = {} } = {},
        ) =>
          fetch(`${server}/api/v1${path}`, {
            method,
            headers: {
              'Content-Type': 'application/json',
              'X-Forwarded-For': `198.18.${Math.floor(++counter / 250)}.${(counter % 250) + 1}`,
              ...(actor && accounts[actor]
                ? { Authorization: `Bearer ${accounts[actor].accessToken}` }
                : {}),
              ...(tenant ? { 'X-Tenant-Id': tenant.tenant.id } : {}),
              ...headers,
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          });
        const create = (body, extra = {}) =>
          request('/warehouses', { method: 'POST', body, ...extra });
        const auditCount = async () =>
          (
            await db.query(
              "SELECT count(*)::int AS n FROM audit_logs WHERE action='WAREHOUSE_CREATED'",
            )
          ).rows[0].n;
        for (const actor of [
          'ownerA',
          'ownerB',
          'admin',
          'buyer',
          'warehouse',
          'viewer',
          'outsider',
        ]) {
          const email = actor.toLowerCase() + '@warehouses.example.com';
          await read(
            await request('/auth/register', {
              actor: null,
              tenant: null,
              method: 'POST',
              body: { email, password },
            }),
            201,
          );
          accounts[actor] = (
            await read(
              await request('/auth/login', {
                actor: null,
                tenant: null,
                method: 'POST',
                body: { email, password },
              }),
              200,
            )
          ).data;
        }
        for (const [actor, name] of [
          ['ownerA', '仓库商家 A'],
          ['ownerB', '仓库商家 B'],
        ]) {
          const tenant = (
            await read(
              await request('/tenants', { actor, tenant: null, method: 'POST', body: { name } }),
              201,
            )
          ).data;
          if (actor === 'ownerA') a = tenant;
          else b = tenant;
        }
        for (const [actor, role] of [
          ['admin', 'ADMIN'],
          ['buyer', 'BUYER'],
          ['warehouse', 'WAREHOUSE'],
          ['viewer', 'VIEWER'],
        ]) {
          const member = (
            await read(
              await request('/members', {
                method: 'POST',
                body: { email: accounts[actor].user.email, role },
              }),
              201,
            )
          ).data;
          if (actor === 'admin') adminMembership = member;
        }

        await http.test(
          'merchant creation persists exactly one default warehouse per merchant',
          async () => {
            for (const [tenant, actor] of [
              [a, 'ownerA'],
              [b, 'ownerB'],
            ]) {
              const list = await read(await request('/warehouses', { tenant, actor }), 200);
              assert.equal(list.pagination.total, 1);
              assert.equal(list.data[0].id, tenant.defaultWarehouse.id);
              assert.equal(list.data[0].code, 'DEFAULT');
              assert.equal(list.data[0].name, '默认仓库');
              assert.equal(list.data[0].remark, null);
              assert.equal(list.data[0].tenantId, tenant.tenant.id);
              assert.equal(
                (
                  await db.query('SELECT count(*)::int AS n FROM warehouses WHERE tenant_id=$1', [
                    tenant.tenant.id,
                  ])
                ).rows[0].n,
                1,
              );
            }
          },
        );
        await http.test(
          'authentication and a valid active membership are mandatory on both routes',
          async () => {
            for (const [path, method, body] of [
              ['/warehouses', 'GET'],
              ['/warehouses', 'POST', { name: 'x', code: 'x' }],
            ]) {
              await read(
                await request(path, { actor: null, method, body }),
                401,
                'UNAUTHENTICATED',
              );
              await read(
                await request(path, { tenant: null, method, body }),
                400,
                'INVALID_TENANT_HEADER',
              );
              for (const tenantId of ['invalid', randomUUID(), `${a.tenant.id},${b.tenant.id}`])
                await read(
                  await request(path, { method, body, headers: { 'X-Tenant-Id': tenantId } }),
                  tenantId.length === 36 ? 403 : 400,
                  tenantId.length === 36 ? 'FORBIDDEN' : 'INVALID_TENANT_HEADER',
                );
              await read(
                await request(path, {
                  actor: 'outsider',
                  method,
                  body,
                  headers: { 'X-Role': 'OWNER', 'X-User-Id': accounts.ownerA.user.id },
                }),
                403,
                'FORBIDDEN',
              );
            }
          },
        );
        await http.test(
          'OWNER creates a real warehouse with normalized fields and server timestamps',
          async () => {
            warehouse = (
              await read(
                await create({ name: ' 深圳二仓 ', code: ' SZ-02 ', remark: ' 小件商品存放区 ' }),
                201,
              )
            ).data;
            assert.deepEqual(
              Object.keys(warehouse).sort(),
              [
                'id',
                'tenantId',
                'name',
                'code',
                'remark',
                'isActive',
                'createdAt',
                'updatedAt',
              ].sort(),
            );
            assert.equal(warehouse.name, '深圳二仓');
            assert.equal(warehouse.code, 'SZ-02');
            assert.equal(warehouse.remark, '小件商品存放区');
            assert.equal(warehouse.tenantId, a.tenant.id);
            assert.equal(warehouse.isActive, true);
            assert.ok(Number.isFinite(Date.parse(warehouse.createdAt)));
            const stored = (
              await db.query('SELECT * FROM warehouses WHERE id=$1 AND tenant_id=$2', [
                warehouse.id,
                a.tenant.id,
              ])
            ).rows[0];
            assert.equal(stored.remark, warehouse.remark);
            assert.equal(stored.created_at.toISOString(), warehouse.createdAt);
          },
        );
        await http.test(
          'ADMIN can create; BUYER WAREHOUSE VIEWER cannot create or forge an owner role',
          async () => {
            await read(
              await create({ name: '管理员仓', code: 'ADMIN-01' }, { actor: 'admin' }),
              201,
            );
            const before = await auditCount();
            for (const actor of ['buyer', 'warehouse', 'viewer'])
              await read(
                await create(
                  { name: 'forbidden', code: actor },
                  { actor, headers: { 'X-Role': 'OWNER' } },
                ),
                403,
                'FORBIDDEN',
              );
            assert.equal(await auditCount(), before);
          },
        );
        await http.test(
          'all five active roles can read; count and rows exclude other merchants',
          async () => {
            for (const actor of ['ownerA', 'admin', 'buyer', 'warehouse', 'viewer']) {
              const list = await read(await request('/warehouses', { actor }), 200);
              assert.equal(list.pagination.total, 3);
              assert.ok(list.data.every((w) => w.tenantId === a.tenant.id));
              assert.ok(list.data.some((w) => w.id === warehouse.id));
            }
            const other = await read(
              await request('/warehouses', { actor: 'ownerB', tenant: b }),
              200,
            );
            assert.equal(other.pagination.total, 1);
            assert.equal(
              other.data.some((w) => w.id === warehouse.id),
              false,
            );
          },
        );
        await http.test(
          'same-merchant duplicate and reserved default code return safe 409 without extra audit',
          async () => {
            const before = await auditCount();
            for (const code of ['SZ-02', ' SZ-02 ', 'DEFAULT'])
              await read(
                await create({ name: 'duplicate', code }),
                409,
                'WAREHOUSE_CODE_ALREADY_EXISTS',
              );
            assert.equal(await auditCount(), before);
          },
        );
        await http.test('different merchants can use the same warehouse code', async () => {
          foreign = (
            await read(
              await create(
                { name: 'B 的二仓', code: 'SZ-02', remark: 'PRIVATE-B-REMARK' },
                { actor: 'ownerB', tenant: b },
              ),
              201,
            )
          ).data;
          assert.notEqual(foreign.id, warehouse.id);
          assert.equal(foreign.tenantId, b.tenant.id);
          assert.equal(foreign.code, warehouse.code);
          const list = await read(await request('/warehouses'), 200);
          assert.equal(JSON.stringify(list).includes('PRIVATE-B-REMARK'), false);
          assert.equal(list.pagination.total, 3);
        });
        await http.test(
          'a nonmember selecting another merchant cannot read or create there',
          async () => {
            await read(await request('/warehouses', { tenant: b }), 403, 'FORBIDDEN');
            await read(
              await create({ name: 'bad', code: 'FOREIGN' }, { tenant: b }),
              403,
              'FORBIDDEN',
            );
          },
        );
        await http.test(
          'one account switches merchants using its own membership role and isolated rows',
          async () => {
            await read(
              await request('/members', {
                actor: 'ownerB',
                tenant: b,
                method: 'POST',
                body: { email: accounts.ownerA.user.email, role: 'VIEWER' },
              }),
              201,
            );
            const list = await read(await request('/warehouses', { tenant: b }), 200);
            assert.equal(list.pagination.total, 2);
            assert.ok(list.data.every((w) => w.tenantId === b.tenant.id));
            assert.equal(
              list.data.some((w) => w.id === warehouse.id),
              false,
            );
            await read(
              await create({ name: 'bad', code: 'VIEWER-WRITE' }, { tenant: b }),
              403,
              'FORBIDDEN',
            );
          },
        );
        await http.test(
          'remarks may be omitted null or blank; codes preserve case and leading zeros',
          async () => {
            for (const [code, fields] of [
              ['001', {}],
              ['001-lower', { remark: null }],
              ['001-LOWER', { remark: '   ' }],
            ]) {
              const item = (await read(await create({ name: code, code, ...fields }), 201)).data;
              assert.equal(item.code, code);
              assert.equal(item.remark, null);
            }
            await read(
              await create({
                name: 'x'.repeat(100),
                code: 'c'.repeat(40),
                remark: 'r'.repeat(2000),
              }),
              201,
            );
          },
        );
        await http.test(
          'invalid bodies and client-selected identities or timestamps are rejected',
          async () => {
            const before = await auditCount();
            for (const body of [
              {},
              { name: '', code: 'x' },
              { name: null, code: 'x' },
              { name: 'x', code: null },
              { name: 'x', code: ' ' },
              { name: 'x'.repeat(101), code: 'x' },
              { name: 'x', code: 'c'.repeat(41) },
              { name: 'x', code: 'bad\ncode' },
              { name: 'x', code: ['x'] },
              { name: 'x', code: 'x', remark: 123 },
              { name: 'x', code: 'x', remark: 'bad\0note' },
              { name: 'x', code: 'x', remark: 'r'.repeat(2001) },
              ...['id', 'tenantId', 'address', 'isActive', 'createdAt', 'updatedAt', 'role'].map(
                (key) => ({ name: 'x', code: 'INJECT', [key]: b.tenant.id }),
              ),
            ]) {
              const response = await create(body);
              assert.equal(response.status, 400);
              assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
            }
            assert.equal(await auditCount(), before);
          },
        );
        await http.test(
          'lists paginate stably without tenant information leaking through rows or total',
          async () => {
            const expected = (
              await db.query(
                'SELECT id FROM warehouses WHERE tenant_id=$1 ORDER BY created_at DESC,id DESC',
                [a.tenant.id],
              )
            ).rows.map((r) => r.id);
            const ids = [];
            for (let page = 1; page <= Math.ceil(expected.length / 2); page++) {
              const list = await read(await request(`/warehouses?page=${page}&pageSize=2`), 200);
              assert.deepEqual(list.pagination, { page, pageSize: 2, total: expected.length });
              ids.push(...list.data.map((w) => w.id));
            }
            assert.deepEqual(ids, expected);
            assert.equal(new Set(ids).size, expected.length);
            assert.deepEqual(
              (await read(await request('/warehouses?page=100&pageSize=2'), 200)).data,
              [],
            );
          },
        );
        await http.test(
          'unknown query fields invalid pagination and offset overflow return standard errors',
          async () => {
            for (const query of [
              'page=0',
              'page=-1',
              'page=1.5',
              'page=x',
              'pageSize=101',
              'pageSize=0',
              'page=1&page=2',
              'tenantId=' + b.tenant.id,
              'id=' + foreign.id,
            ]) {
              const response = await request('/warehouses?' + query);
              assert.equal(response.status, 400);
              assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
            }
            await read(
              await request('/warehouses?page=2147483647&pageSize=100'),
              400,
              'BAD_REQUEST',
            );
          },
        );
        await http.test(
          'existing private address is excluded and inactive warehouses remain visible for history',
          async () => {
            await db.query(
              'UPDATE warehouses SET address=$1,is_active=false WHERE tenant_id=$2 AND id=$3',
              ['PRIVATE-FULL-WAREHOUSE-ADDRESS', a.tenant.id, warehouse.id],
            );
            const item = (await read(await request('/warehouses'), 200)).data.find(
              (w) => w.id === warehouse.id,
            );
            assert.equal(item.isActive, false);
            assert.equal('address' in item, false);
            await read(
              await create({ name: 'duplicate inactive', code: warehouse.code }),
              409,
              'WAREHOUSE_CODE_ALREADY_EXISTS',
            );
          },
        );
        await http.test(
          'concurrent duplicate creation across API processes commits one warehouse and one audit',
          async () => {
            const before = await auditCount();
            const results = await Promise.all([
              create({ name: 'race A', code: 'RACE' }),
              create({ name: 'race B', code: 'RACE' }, { server: second }),
            ]);
            assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
            for (const response of results)
              await read(
                response,
                response.status,
                response.status === 409 ? 'WAREHOUSE_CODE_ALREADY_EXISTS' : undefined,
              );
            assert.equal(await auditCount(), before + 1);
            assert.equal(
              (
                await db.query(
                  "SELECT count(*)::int AS n FROM warehouses WHERE tenant_id=$1 AND code='RACE'",
                  [a.tenant.id],
                )
              ).rows[0].n,
              1,
            );
          },
        );
        await http.test(
          'successful creation has tenant actor target requestId audit without free text',
          async () => {
            const requestId = randomUUID();
            const item = (
              await read(
                await create(
                  {
                    name: 'PRIVATE-WAREHOUSE-NAME',
                    code: 'AUDIT',
                    remark: 'PRIVATE-WAREHOUSE-REMARK',
                  },
                  { headers: { 'X-Request-Id': requestId } },
                ),
                201,
              )
            ).data;
            const audit = (
              await db.query("SELECT * FROM audit_logs WHERE metadata->>'requestId'=$1", [
                requestId,
              ])
            ).rows[0];
            assert.equal(audit.action, 'WAREHOUSE_CREATED');
            assert.equal(audit.tenant_id, a.tenant.id);
            assert.equal(audit.actor_id, accounts.ownerA.user.id);
            assert.equal(audit.object_id, item.id);
            assert.deepEqual(audit.metadata, { requestId, code: 'AUDIT' });
          },
        );
        await http.test(
          'audit insert failure rolls back warehouse insert and hides internal exception',
          async () => {
            const before = await auditCount();
            await db.query(
              "CREATE FUNCTION test_reject_warehouse_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'WAREHOUSE_TOKEN_PASSWORD_SECRET'; END $$",
            );
            await db.query(
              "CREATE TRIGGER test_warehouse_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW WHEN (NEW.action='WAREHOUSE_CREATED') EXECUTE FUNCTION test_reject_warehouse_audit()",
            );
            try {
              await read(
                await create({ name: 'rollback', code: 'ROLLBACK' }),
                500,
                'INTERNAL_ERROR',
              );
              assert.equal(await auditCount(), before);
              assert.equal(
                (await db.query("SELECT count(*)::int AS n FROM warehouses WHERE code='ROLLBACK'"))
                  .rows[0].n,
                0,
              );
            } finally {
              await db.query('DROP TRIGGER test_warehouse_audit_failure ON audit_logs');
              await db.query('DROP FUNCTION test_reject_warehouse_audit()');
            }
            await read(await create({ name: 'retry after rollback', code: 'ROLLBACK' }), 201);
          },
        );
        for (const operation of ['create', 'read'])
          await http.test(
            `transaction rechecks ${operation} permission after guard passed`,
            async () => {
              const before = await auditCount();
              const locker = new Client({ connectionString: url.toString() });
              await locker.connect();
              let pending;
              try {
                await locker.query('BEGIN');
                await locker.query('SELECT id FROM tenants WHERE id=$1 FOR UPDATE', [a.tenant.id]);
                pending =
                  operation === 'create'
                    ? create({ name: 'unauthorized', code: 'REVOKED' }, { actor: 'admin' })
                    : request('/warehouses', { actor: 'admin' });
                const deadline = Date.now() + 5000;
                let waiting = false;
                while (Date.now() < deadline) {
                  if (
                    (
                      await db.query(
                        "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1 AND wait_event_type='Lock' AND query LIKE '%FROM tenants WHERE id%'",
                        [databaseName],
                      )
                    ).rows[0].n
                  ) {
                    waiting = true;
                    break;
                  }
                  await delay(20);
                }
                assert.equal(waiting, true);
                if (operation === 'create')
                  await locker.query("UPDATE tenant_memberships SET role='VIEWER' WHERE id=$1", [
                    adminMembership.id,
                  ]);
                else
                  await locker.query('UPDATE tenant_memberships SET is_active=false WHERE id=$1', [
                    adminMembership.id,
                  ]);
                await locker.query('COMMIT');
                await read(await pending, 403, 'FORBIDDEN');
                pending = undefined;
                assert.equal(await auditCount(), before);
                assert.equal(
                  (await db.query("SELECT count(*)::int AS n FROM warehouses WHERE code='REVOKED'"))
                    .rows[0].n,
                  0,
                );
              } finally {
                await locker.query('ROLLBACK');
                await locker.end();
                if (pending) await pending;
                await read(
                  await request(`/members/${adminMembership.id}`, {
                    method: 'PATCH',
                    body: { role: 'ADMIN', isActive: true },
                  }),
                  200,
                );
              }
            },
          );
        await http.test(
          'inactive membership and inactive account cannot read or create with existing tokens',
          async () => {
            for (const target of ['membership', 'user']) {
              if (target === 'membership')
                await db.query('UPDATE tenant_memberships SET is_active=false WHERE id=$1', [
                  adminMembership.id,
                ]);
              else
                await db.query('UPDATE users SET is_active=false WHERE id=$1', [
                  accounts.admin.user.id,
                ]);
              try {
                for (const method of ['GET', 'POST'])
                  await read(
                    await request('/warehouses', {
                      actor: 'admin',
                      method,
                      ...(method === 'POST' ? { body: { name: 'bad', code: 'INACTIVE' } } : {}),
                    }),
                    target === 'membership' ? 403 : 401,
                    target === 'membership' ? 'FORBIDDEN' : 'UNAUTHENTICATED',
                  );
              } finally {
                if (target === 'membership')
                  await db.query('UPDATE tenant_memberships SET is_active=true WHERE id=$1', [
                    adminMembership.id,
                  ]);
                else
                  await db.query('UPDATE users SET is_active=true WHERE id=$1', [
                    accounts.admin.user.id,
                  ]);
              }
            }
          },
        );
        await http.test(
          'purchase requires a same-merchant target warehouse and restricts deletion of history',
          async () => {
            const sql =
              "INSERT INTO purchase_orders(tenant_id,warehouse_id,order_no,platform,created_by) VALUES($1,$2,$3,'JD',$4) RETURNING *";
            for (const [warehouseId, code] of [
              [null, '23502'],
              [foreign.id, '23503'],
              [randomUUID(), '23503'],
            ])
              await assert.rejects(
                db.query(sql, [a.tenant.id, warehouseId, randomUUID(), accounts.ownerA.user.id]),
                (error) => error.code === code,
              );
            const order = (
              await db.query(sql, [
                a.tenant.id,
                warehouse.id,
                'WAREHOUSE-HISTORY',
                accounts.ownerA.user.id,
              ])
            ).rows[0];
            await assert.rejects(
              db.query('DELETE FROM warehouses WHERE tenant_id=$1 AND id=$2', [
                a.tenant.id,
                warehouse.id,
              ]),
              (error) => error.code === '23503',
            );
            assert.deepEqual(
              (await db.query('SELECT * FROM purchase_orders WHERE id=$1', [order.id])).rows[0],
              order,
            );
          },
        );
        await http.test(
          'stock keys distinguish warehouses for one SKU and reject cross-merchant associations',
          async () => {
            // SQL fixtures in the owned isolated database only; no stock CRUD business endpoint is exposed.
            const product = (
              await read(
                await request('/products', {
                  method: 'POST',
                  body: { name: '20W 充电器', sku: 'CHARGER-20W' },
                }),
                201,
              )
            ).data;
            const sql =
              'INSERT INTO stock_balances(tenant_id,warehouse_id,product_id,quantity_on_hand,total_cost) VALUES($1,$2,$3,$4,$5) RETURNING *';
            await db.query(sql, [a.tenant.id, a.defaultWarehouse.id, product.id, 2, '37.0000']);
            await db.query(sql, [a.tenant.id, warehouse.id, product.id, 5, '92.5000']);
            const balances = (
              await db.query(
                'SELECT warehouse_id,quantity_on_hand,total_cost::text FROM stock_balances WHERE tenant_id=$1 AND product_id=$2 ORDER BY quantity_on_hand',
                [a.tenant.id, product.id],
              )
            ).rows;
            assert.deepEqual(balances, [
              { warehouse_id: a.defaultWarehouse.id, quantity_on_hand: 2, total_cost: '37.0000' },
              { warehouse_id: warehouse.id, quantity_on_hand: 5, total_cost: '92.5000' },
            ]);
            await assert.rejects(
              db.query(sql, [a.tenant.id, warehouse.id, product.id, 1, '18.5000']),
              (error) => error.code === '23505',
            );
            await assert.rejects(
              db.query(sql, [a.tenant.id, foreign.id, product.id, 1, '18.5000']),
              (error) => error.code === '23503',
            );
            await assert.rejects(
              db.query('DELETE FROM warehouses WHERE tenant_id=$1 AND id=$2', [
                a.tenant.id,
                a.defaultWarehouse.id,
              ]),
              (error) => error.code === '23503',
            );
          },
        );
        await http.test(
          'database enforces remark maximum and APIs do not expose delete patch or transfer',
          async () => {
            await assert.rejects(
              db.query('UPDATE warehouses SET remark=$1 WHERE id=$2', [
                'r'.repeat(2001),
                warehouse.id,
              ]),
              (error) => error.code === '23514',
            );
            for (const [path, method] of [
              [`/warehouses/${warehouse.id}`, 'DELETE'],
              [`/warehouses/${warehouse.id}`, 'PATCH'],
              ['/warehouses/transfers', 'POST'],
            ])
              await read(await request(path, { method }), 404, 'NOT_FOUND');
          },
        );
        await http.test(
          'Swagger publishes both routes with joint token and tenant requirements',
          async () => {
            const doc = await (await fetch(`${base}/api/docs-json`)).json();
            for (const method of ['get', 'post'])
              assert.deepEqual(doc.paths['/api/v1/warehouses'][method].security, [
                { bearer: [], tenant: [] },
              ]);
            const input = doc.components.schemas.CreateWarehouseDto;
            assert.equal(input.properties.code.maxLength, 40);
            assert.equal(input.properties.name.maxLength, 100);
            assert.equal(input.properties.remark.maxLength, 2000);
            assert.ok(input.required.includes('name') && input.required.includes('code'));
            assert.equal(
              doc.components.schemas.WarehouseDto.properties.createdAt.format,
              'date-time',
            );
            assert.equal('address' in doc.components.schemas.WarehouseDto.properties, false);
            const schema =
              doc.paths['/api/v1/warehouses'].get.responses['200'].content['application/json']
                .schema;
            assert.ok(schema.allOf.some((part) => part.properties?.data?.type === 'array'));
          },
        );
        await http.test(
          'application logs omit credentials full address free text and raw SQL errors',
          () => {
            assert.ok(logs.includes('http_request'));
            for (const account of Object.values(accounts))
              for (const value of [account.accessToken, account.refreshToken])
                assert.equal(logs.includes(value), false);
            for (const value of [
              password,
              secret,
              'PRIVATE-FULL-WAREHOUSE-ADDRESS',
              'PRIVATE-WAREHOUSE-NAME',
              'PRIVATE-WAREHOUSE-REMARK',
              'WAREHOUSE_TOKEN_PASSWORD_SECRET',
              '@warehouses.example.com',
            ])
              assert.equal(logs.includes(value), false);
          },
        );
        persisted = (await read(await request('/warehouses?pageSize=100'), 200)).data;
      });
      await t.test(
        'warehouse master data and creation timestamps persist across API restart',
        async (restarted) => {
          const base = await startTestApi(restarted, { env: settings });
          const list = await read(
            await fetch(`${base}/api/v1/warehouses?pageSize=100`, {
              headers: {
                Authorization: `Bearer ${accounts.ownerA.accessToken}`,
                'X-Tenant-Id': a.tenant.id,
              },
            }),
            200,
          );
          assert.deepEqual(list.data, persisted);
        },
      );
    } finally {
      if (connected) await db.end();
      if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
      await admin.end();
    }
  },
);
