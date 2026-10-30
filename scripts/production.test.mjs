import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, appendFile, copyFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { request as httpsRequest } from 'node:https';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { promisify } from 'node:util';
const run = promisify(execFile),
  root = fileURLToPath(new URL('../', import.meta.url));
const freePort = async () => {
  const s = createServer();
  s.listen(0, '127.0.0.1');
  await once(s, 'listening');
  const port = s.address().port;
  await new Promise((r) => s.close(r));
  return port;
};
test(
  'production Compose: private database, real TLS, core transactions, migration and backup/restore',
  { timeout: 1200000 },
  async (t) => {
    const marker = randomUUID().slice(0, 8),
      project = 'caicang-t35-' + marker,
      dir = join(root, 'test-results/task35', project),
      secrets = join(dir, 'secrets');
    await mkdir(secrets, { recursive: true });
    const hidden = [];
    for (const name of ['owner_password', 'app_password', 'jwt_secret']) {
      const value = randomBytes(48).toString('hex');
      hidden.push(value);
      await writeFile(join(secrets, name), value, { mode: 0o600 });
    }
    const httpPort = await freePort(),
      httpsPort = await freePort(),
      envFile = join(dir, '.env.production.local'),
      override = join(dir, 'acceptance.yml');
    const acceptanceConfig = join(dir, 'Caddyfile.acceptance');
    await copyFile(join(root, 'infra/production/Caddyfile.acceptance'), acceptanceConfig);
    await writeFile(
      envFile,
      `COMPOSE_PROJECT_NAME=${project}\nRELEASE_TAG=task35\nSITE_DOMAIN=caicang35.test\nACME_EMAIL=acceptance@example.test\nSECRETS_DIR=${secrets.replaceAll('\\', '/')}\nPOSTGRES_DB=caicang\nPUBLIC_BIND_ADDRESS=127.0.0.1\nHTTP_PORT=${httpPort}\nHTTPS_PORT=${httpsPort}\nPROXY_SUBNET=10.253.${parseInt(marker.slice(0, 2), 16)}.0/29\nPROXY_IP=10.253.${parseInt(marker.slice(0, 2), 16)}.2\nAPI_PROXY_IP=10.253.${parseInt(marker.slice(0, 2), 16)}.3\nPUBLIC_REGISTRATION_ENABLED=true\n`,
    );
    await writeFile(
      override,
      `services:\n  web:\n    volumes:\n      - type: bind\n        source: ${JSON.stringify(acceptanceConfig.replaceAll('\\', '/'))}\n        target: /etc/caddy/Caddyfile\n        read_only: true\n`,
    );
    const base = [
      'compose',
      '--env-file',
      envFile,
      '-p',
      project,
      '-f',
      join(root, 'infra/production/compose.yml'),
      '-f',
      override,
    ];
    async function docker(...args) {
      try {
        const r = await run('docker', [...base, ...args], {
          cwd: root,
          env: process.env,
          windowsHide: true,
          timeout: 900000,
          maxBuffer: 16 * 1024 * 1024,
        });
        await appendFile(
          join(dir, 'commands.log'),
          args.join(' ') + '\n' + r.stdout + '\n' + r.stderr + '\n',
        );
        return r.stdout;
      } catch (error) {
        await appendFile(
          join(dir, 'commands.log'),
          args.join(' ') + '\n' + (error.stdout ?? '') + '\n' + (error.stderr ?? '') + '\n',
        );
        throw error;
      }
    }
    async function db(target, query) {
      return (
        await docker(
          'exec',
          '-T',
          'postgres',
          'psql',
          '-X',
          '-A',
          '-t',
          '-v',
          'ON_ERROR_STOP=1',
          '-U',
          'caicang_owner',
          '-d',
          target,
          '-c',
          query,
        )
      ).trim();
    }
    let started = false;
    try {
      await docker('config', '--quiet');
      const buildArgs = process.env.CAICANG_BUILD_PROXY
        ? [
            '--build-arg',
            'HTTPS_PROXY=' + process.env.CAICANG_BUILD_PROXY,
            '--build-arg',
            'HTTP_PROXY=' + process.env.CAICANG_BUILD_PROXY,
          ]
        : [];
      await docker('build', ...buildArgs);
      started = true;
      await docker('up', '-d', '--wait', '--wait-timeout', '240');
      const certificate = join(dir, 'root.crt');
      await docker('cp', 'web:/data/caddy/pki/authorities/local/root.crt', certificate);
      const ca = await readFile(certificate);
      const users = {};
      let tenant;
      async function request(
        path,
        { method = 'GET', body, actor = 'owner', workspace = tenant, headers = {} } = {},
      ) {
        return new Promise((resolve, reject) => {
          const req = httpsRequest(
            {
              hostname: '127.0.0.1',
              port: httpsPort,
              servername: 'caicang35.test',
              ca,
              method,
              path,
              headers: {
                Host: 'caicang35.test',
                ...(users[actor] ? { Authorization: 'Bearer ' + users[actor].accessToken } : {}),
                ...(workspace ? { 'X-Tenant-Id': workspace.tenant.id } : {}),
                ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
                ...headers,
              },
              timeout: 20000,
            },
            (response) => {
              assert.equal(response.socket.authorized, true);
              const chunks = [];
              response.on('data', (c) => chunks.push(c));
              response.on('end', () => {
                const raw = Buffer.concat(chunks);
                let json;
                try {
                  json = JSON.parse(raw.toString('utf8'));
                } catch {
                  /* CSV/static resources intentionally are not JSON. */
                }
                resolve({ status: response.statusCode, headers: response.headers, raw, json });
              });
            },
          );
          req.on('timeout', () => req.destroy(new Error('HTTPS request timed out')));
          req.on('error', reject);
          req.end(body === undefined ? undefined : JSON.stringify(body));
        });
      }
      const read = (r, status = 200) => {
        assert.equal(r.status, status, r.json?.error?.code ?? r.raw.toString().slice(0, 100));
        return r.json?.data;
      };
      const post = (path, body, options = {}) =>
        request('/api/v1' + path, { ...options, method: 'POST', body });
      await t.test(
        'non-root/read-only containers, no DB/API host ports and restricted DB runtime role',
        async () => {
          for (const service of ['api', 'postgres']) {
            const id = (await docker('ps', '-q', service)).trim();
            const data = JSON.parse(
              (await run('docker', ['inspect', id], { windowsHide: true })).stdout,
            )[0];
            assert.deepEqual(data.HostConfig.PortBindings, {});
            if (service === 'api') {
              assert.equal(data.Config.User, 'node');
              assert.equal(data.HostConfig.ReadonlyRootfs, true);
              assert.equal(
                data.Config.Env.some((v) => /^(DATABASE_URL|JWT_ACCESS_SECRET)=/.test(v)),
                false,
              );
            }
          }
          const role = JSON.parse(
            await db(
              'caicang',
              "SELECT row_to_json(r) FROM (SELECT rolname,rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname='caicang_app') r",
            ),
          );
          assert.equal(role.rolsuper, false);
          assert.equal(role.rolcreatedb, false);
          assert.equal(role.rolcreaterole, false);
          assert.equal(
            await db(
              'caicang',
              "SELECT has_table_privilege('caicang_app','stock_movements','UPDATE') OR has_table_privilege('caicang_app','audit_logs','DELETE')",
            ),
            'f',
          );
        },
      );
      await t.test(
        'HTTPS certificate is verified; Web SPA, security headers, health and CORS work',
        async () => {
          const web = await request('/');
          assert.equal(web.status, 200);
          assert.ok(web.raw.toString('utf8').includes('采仓管家'));
          assert.ok(web.headers['content-security-policy'].includes("script-src 'self'"));
          assert.ok(web.headers['strict-transport-security']);
          assert.equal(web.headers.server, undefined);
          assert.equal((await request('/purchases')).status, 200);
          read(await request('/api/v1/health'));
          assert.equal((await request('/api/docs-json')).status, 404);
          assert.equal(
            (await request('/api/v1/health', { headers: { Origin: 'https://untrusted.example' } }))
              .status,
            403,
          );
        },
      );
      for (const actor of ['owner', 'ownerB', 'viewer']) {
        const input = {
          email: `${actor}-${marker}@production.example.test`,
          password: randomBytes(24).toString('hex') + 'Aa1!',
        };
        hidden.push(input.password, input.email);
        read(await post('/auth/register', input), 201);
        users[actor] = read(await post('/auth/login', input));
        hidden.push(users[actor].accessToken, users[actor].refreshToken);
      }
      tenant = read(await post('/tenants', { name: 'Production audit A' }), 201);
      const b = read(
        await post(
          '/tenants',
          { name: 'Production audit B' },
          { actor: 'ownerB', workspace: null },
        ),
        201,
      );
      read(await post('/members', { email: users.viewer.user.email, role: 'VIEWER' }), 201);
      const product = read(
        await post('/products', {
          sku: 'P35-CHARGER',
          name: 'Production test charger',
          unit: '件',
        }),
        201,
      );
      const account = read(
        await post('/purchase-accounts', { platform: 'TAOBAO', alias: 'Production test account' }),
        201,
      );
      const draft = read(
        await post('/purchase-orders', {
          warehouseId: tenant.defaultWarehouse.id,
          platform: 'TAOBAO',
          purchaseAccountId: account.id,
          purchaseDate: '2026-10-28',
          freightAmount: '10.00',
          recipient: {
            name: 'Production isolated fixture',
            phone: '13800000000',
            address: 'Not delivered',
          },
          items: [{ productId: product.id, quantity: 10, unitPrice: '18.50' }],
        }),
        201,
      );
      const purchase = read(await post('/purchase-orders/' + draft.id + '/place', {}));
      const pkg = read(
        await post('/purchase-orders/' + purchase.id + '/packages', {
          carrierCode: 'SF',
          trackingNo: 'P35-000' + marker,
          expectedItems: [],
        }),
        201,
      );
      await t.test(
        'scan lookup is read-only; real receipt and idempotent replay create one stock transaction',
        async () => {
          read(await request('/api/v1/packages/lookup?trackingNo=' + pkg.trackingNo));
          assert.equal(await db('caicang', 'SELECT COUNT(*) FROM stock_balances'), '0');
          const body = {
            packageId: pkg.id,
            clientOperationId: randomUUID(),
            items: [{ purchaseOrderItemId: purchase.items[0].id, receivedQty: 10 }],
          };
          read(await post('/receipts', body), 201);
          read(await post('/receipts', body));
          assert.equal(await db('caicang', 'SELECT quantity_on_hand FROM stock_balances'), '10');
        },
      );
      const out = read(
        await post('/outbound-orders', {
          warehouseId: tenant.defaultWarehouse.id,
          customerName: 'Isolated',
          customerPhone: '13800000000',
          customerAddress: 'Not delivered',
          items: [{ productId: product.id, quantity: 3 }],
        }),
        201,
      );
      await t.test(
        'production least-privilege API confirms outbound, return and adjustment atomically',
        async () => {
          const op = { clientOperationId: randomUUID() };
          read(await post('/outbound-orders/' + out.id + '/ship', op), 201);
          read(await post('/outbound-orders/' + out.id + '/ship', op));
          const ret = read(
            await post('/purchase-returns', {
              purchaseOrderId: purchase.id,
              reason: 'Production isolated fixture',
              returnDate: '2026-10-28',
              refundAmount: '35.00',
              items: [{ purchaseOrderItemId: purchase.items[0].id, quantity: 2 }],
            }),
            201,
          );
          read(
            await post('/purchase-returns/' + ret.id + '/confirm', {
              clientOperationId: randomUUID(),
            }),
            201,
          );
          read(
            await post('/inventory/adjustments', {
              warehouseId: tenant.defaultWarehouse.id,
              productId: product.id,
              quantityDelta: 1,
              reason: 'STOCKTAKE_GAIN',
              clientOperationId: randomUUID(),
            }),
            201,
          );
          const summary = read(await request('/api/v1/reports/overview'));
          assert.equal(summary.purchaseAmount, '195.00');
          assert.equal(summary.inventoryQuantity, '6');
          assert.equal(summary.inventoryCost, '117.0000');
          assert.equal(summary.outboundCost, '58.5000');
          assert.equal(summary.returnRefundAmount, '35.00');
          const csv = await request('/api/v1/reports/export.csv?dataset=accounts');
          assert.equal(csv.status, 200);
          assert.equal(csv.raw.subarray(0, 3).toString('hex'), 'efbbbf');
        },
      );
      await t.test(
        'role and tenant isolation also hold behind the actual production proxy',
        async () => {
          const foreign = read(
            await post(
              '/products',
              { sku: 'B-PRIVATE', name: 'B-PRIVATE', unit: '件' },
              { actor: 'ownerB', workspace: b },
            ),
            201,
          );
          assert.equal((await request('/api/v1/products/' + foreign.id)).status, 404);
          assert.equal((await request('/api/v1/products', { workspace: b })).status, 403);
          assert.equal(
            (await request('/api/v1/reports/export?dataset=accounts', { actor: 'viewer' })).status,
            403,
          );
          assert.equal(
            (
              await post(
                '/products',
                { sku: 'DENIED', name: 'DENIED', unit: '件' },
                { actor: 'viewer' },
              )
            ).status,
            403,
          );
        },
      );
      const tables = (
        await db(
          'caicang',
          "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
        )
      )
        .split('\n')
        .filter(Boolean);
      async function fingerprint(database) {
        const result = {};
        for (const name of tables) {
          assert.match(name, /^[a-z_]+$/);
          result[name] = await db(
            database,
            `SELECT COUNT(*)::text||':'||COALESCE(md5(string_agg(md5(row_to_json(t)::text),'' ORDER BY md5(row_to_json(t)::text))),'empty') FROM "${name}" t`,
          );
        }
        return result;
      }
      const original = await fingerprint('caicang');
      await t.test(
        'task36: database restart retains all business rows and API reconnects',
        async () => {
          await docker('restart', 'postgres');
          await docker('up', '-d', '--wait', '--wait-timeout', '120', 'postgres');
          assert.deepEqual(await fingerprint('caicang'), original);
          let healthy = false;
          for (let attempt = 0; attempt < 20; attempt++) {
            try {
              if ((await request('/api/v1/health')).status === 200) {
                healthy = true;
                break;
              }
            } catch {
              /* A reconnect may briefly fail during restart. */
            }
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
          assert.equal(healthy, true, 'API must reconnect to the restarted database');
        },
      );
      await t.test(
        'repeat migrate deploy preserves all existing business rows and constraints',
        async () => {
          await docker('run', '--rm', 'migrate');
          assert.deepEqual(await fingerprint('caicang'), original);
        },
      );
      let backup;
      const cli = async (...args) =>
        run(process.execPath, [join(root, 'scripts/production-db.mjs'), ...args], {
          cwd: root,
          windowsHide: true,
          timeout: 120000,
          maxBuffer: 4 * 1024 * 1024,
        });
      await t.test(
        'binary pg_dump backup really restores to an independent new database with identical rows',
        async () => {
          const output = await cli(
            'backup',
            '--env-file',
            envFile,
            '--output-dir',
            join(dir, 'backups'),
          );
          backup = JSON.parse(output.stdout).backup;
          const target = 'caicang_restore_' + marker;
          const restored = JSON.parse(
            (
              await cli(
                'restore',
                '--env-file',
                envFile,
                '--backup',
                backup,
                '--target-database',
                target,
              )
            ).stdout,
          );
          assert.equal(Number(restored.facts.negativeBalances), 0);
          assert.deepEqual(await fingerprint(target), original);
          assert.deepEqual(await fingerprint('caicang'), original);
          await docker('run', '--rm', '-e', 'POSTGRES_DB=' + target, 'migrate');
          assert.deepEqual(await fingerprint(target), original);
          await writeFile(
            join(dir, 'restore-fingerprints.json'),
            JSON.stringify({ source: original, restored: await fingerprint(target) }, null, 2),
          );
        },
      );
      await t.test(
        'restore refuses existing/live targets, bad checksums; retention defaults to dry-run',
        async () => {
          await assert.rejects(() =>
            cli(
              'restore',
              '--env-file',
              envFile,
              '--backup',
              backup,
              '--target-database',
              'caicang',
            ),
          );
          await assert.rejects(() =>
            cli(
              'restore',
              '--env-file',
              envFile,
              '--backup',
              backup,
              '--target-database',
              'caicang_restore_' + marker,
            ),
          );
          const damaged = join(dir, 'damaged.dump');
          await copyFile(backup, damaged);
          await copyFile(backup + '.json', damaged + '.json');
          await appendFile(damaged, 'CORRUPTED');
          await assert.rejects(() =>
            cli(
              'restore',
              '--env-file',
              envFile,
              '--backup',
              damaged,
              '--target-database',
              'caicang_restore_bad_' + marker,
            ),
          );
          const retention = JSON.parse(
            (await cli('prune', '--env-file', envFile, '--output-dir', join(dir, 'backups')))
              .stdout,
          );
          assert.equal(retention.mode, 'dry-run');
          assert.deepEqual(await fingerprint('caicang'), original);
        },
      );
      await t.test(
        'proxy does not accept spoofed forwarding chains to evade login throttling',
        async () => {
          let throttled = false;
          for (let i = 0; i < 6; i++) {
            const response = await post(
              '/auth/login',
              { email: 'absent@example.test', password: 'WrongPassword!123' },
              { headers: { 'X-Forwarded-For': `198.51.100.${i + 1}` } },
            );
            assert.ok([401, 429].includes(response.status));
            if (response.status === 429) throttled = true;
          }
          assert.equal(throttled, true);
        },
      );
      await t.test(
        'upstream failure logs also redact query strings and authorization headers',
        async () => {
          const privateMarker = 'PRIVATE_QUERY_' + randomUUID();
          hidden.push(privateMarker);
          const duplicate = await post('/auth/register', {
            email: users.owner.user.email,
            password: randomBytes(24).toString('hex') + 'Aa1!',
          });
          assert.equal(duplicate.status, 409);
          await docker('stop', 'api');
          const response = await request(
            '/api/v1/packages/lookup?trackingNo=' + privateMarker + '&token=' + privateMarker,
          );
          assert.equal(response.status, 502);
        },
      );
      await t.test(
        'production logs exclude credentials, tokens and full request bodies',
        async () => {
          const logs = await docker('logs', '--no-color');
          for (const secret of hidden) assert.equal(logs.includes(secret), false);
          assert.equal(logs.includes('Not delivered'), false);
          assert.ok(logs.includes('http_request'));
        },
      );
      await writeFile(
        join(dir, 'result.json'),
        JSON.stringify(
          {
            project,
            envFile,
            httpPort,
            httpsPort,
            verifiedTls: 'private CA explicitly trusted by this test client only',
            backup,
            productionPublicDeployment: false,
            androidDeviceAcceptance: false,
          },
          null,
          2,
        ),
      );
      t.diagnostic('Isolated evidence directory: ' + dir);
    } finally {
      if (started) {
        try {
          await docker('logs', '--no-color');
        } finally {
          await docker('stop');
        }
      }
    }
  },
);
