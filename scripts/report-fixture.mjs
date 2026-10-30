import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { startTestApi } from './api-test-server.mjs';
const { Client } = createRequire(new URL('../apps/api/package.json', import.meta.url))('pg');
loadEnvFile(new URL('../.env', import.meta.url));
export async function reportFixture(t, execute) {
  const source = new URL(process.env.DATABASE_URL);
  assert.equal(source.pathname, '/caicang');
  assert.ok(['localhost', '127.0.0.1'].includes(source.hostname));
  const name = 'caicang_test_' + randomUUID().replaceAll('-', '');
  const url = new URL(source);
  url.pathname = '/' + name;
  const admin = new Client({ connectionString: source.toString() }),
    db = new Client({ connectionString: url.toString() });
  let created = false,
    connected = false;
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    await promisify(execFile)(
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
    await t.test('isolated PostgreSQL and real NestJS API', async (http) => {
      let logs = '';
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
      const users = {};
      let tenant = null,
        count = 0;
      const request = (path, { actor = 'owner', workspace = tenant, method = 'GET', body } = {}) =>
        fetch(base + '/api/v1' + path, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'X-Forwarded-For': `198.28.${Math.floor(++count / 250)}.${(count % 250) + 1}`,
            ...(users[actor] ? { Authorization: 'Bearer ' + users[actor].accessToken } : {}),
            ...(workspace ? { 'X-Tenant-Id': workspace.tenant.id } : {}),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      const read = async (response, status = 200) => {
        const json = await response.json();
        assert.equal(response.status, status, JSON.stringify(json));
        return json.data;
      };
      const post = (path, body, opts = {}) => request(path, { ...opts, method: 'POST', body });
      for (const actor of ['owner', 'admin', 'buyer', 'warehouse', 'viewer']) {
        const input = {
          email: actor + '@reports.example.test',
          password: randomBytes(24).toString('hex') + 'Aa1!',
        };
        await read(await post('/auth/register', input), 201);
        users[actor] = await read(await post('/auth/login', input));
      }
      tenant = await read(await post('/tenants', { name: 'Task 33 isolated A' }), 201);
      const other = await read(await post('/tenants', { name: 'Task 33 isolated B' }), 201);
      for (const actor of ['admin', 'buyer', 'warehouse', 'viewer'])
        await read(
          await post('/members', { email: users[actor].user.email, role: actor.toUpperCase() }),
          201,
        );
      const account = async (platform, alias, workspace = tenant) =>
        read(await post('/purchase-accounts', { platform, alias }, { workspace }), 201);
      const product = async (sku, articleNo) =>
        read(await post('/products', { sku, name: sku, articleNo, unit: '件' }), 201);
      const purchase = async (
        account,
        items,
        { date = '2026-10-01', freight = '0.00', place = true } = {},
      ) => {
        const draft = await read(
          await post('/purchase-orders', {
            warehouseId: tenant.defaultWarehouse.id,
            platform: account?.platform ?? 'OTHER',
            purchaseAccountId: account?.id,
            platformOrderNo: 'R33-' + randomUUID(),
            purchaseDate: date,
            recipient: { name: 'Test', phone: '13800000000', address: 'Isolated fixture only' },
            freightAmount: freight,
            items: items.map(([p, quantity, unitPrice, discountAmount = '0.00']) => ({
              productId: p.id,
              quantity,
              unitPrice,
              discountAmount,
            })),
          }),
          201,
        );
        return place ? read(await post('/purchase-orders/' + draft.id + '/place')) : draft;
      };
      const receive = async (order, quantities) => {
        const pkg = await read(
          await post('/purchase-orders/' + order.id + '/packages', {
            carrierCode: 'SF',
            trackingNo: '000' + randomUUID(),
            expectedItems: order.items.map((i) => ({
              purchaseOrderItemId: i.id,
              expectedQuantity: i.quantity,
            })),
          }),
          201,
        );
        const receipt = await read(
          await post('/receipts', {
            packageId: pkg.id,
            clientOperationId: randomUUID(),
            items: order.items.flatMap((i, n) =>
              quantities[n] ? [{ purchaseOrderItemId: i.id, receivedQty: quantities[n] }] : [],
            ),
          }),
          201,
        );
        return { pkg, receipt };
      };
      try {
        await execute({
          databaseUrl: url.toString(),
          http,
          db,
          request,
          read,
          post,
          base,
          users,
          tenant,
          other,
          account,
          product,
          purchase,
          receive,
        });
      } catch (error) {
        if (logs.includes('INTERNAL_ERROR'))
          console.error('API reported an internal error; see requestId in assertion.');
        throw error;
      }
    });
  } finally {
    if (connected) await db.end();
    if (created) {
      await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1', [
        name,
      ]);
      await admin.query(`DROP DATABASE "${name}"`);
    }
    await admin.end();
  }
}
