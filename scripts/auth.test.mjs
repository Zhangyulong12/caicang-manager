import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { startTestApi } from './api-test-server.mjs';

const requireApi = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { Client } = requireApi('pg');
const { compare, hash } = requireApi('bcryptjs');
const { JwtService } = requireApi('@nestjs/jwt');
const runFile = promisify(execFile);
loadEnvFile(new URL('../.env', import.meta.url));

const publicKeys = ['createdAt', 'displayName', 'email', 'id', 'isActive', 'updatedAt'];
function assertPublicUser(user) {
  assert.deepEqual(Object.keys(user).sort(), publicKeys);
  assert.equal(typeof user.email, 'string');
  assert.equal(typeof user.displayName, 'string');
  assert.match(user.id, /^[0-9a-f-]{36}$/);
}
async function readResponse(response, status, code) {
  assert.equal(response.status, status);
  const body = await response.json();
  assert.equal(body.requestId, response.headers.get('x-request-id'));
  assert.equal(JSON.stringify(body).includes('passwordHash'), false);
  assert.equal(JSON.stringify(body).includes('password_hash'), false);
  if (code) {
    assert.equal(body.error.code, code);
    if (code === 'VALIDATION_ERROR') assert.ok(Array.isArray(body.error.details.fields));
    else assert.deepEqual(body.error.details, {});
  }
  return body;
}

test(
  'real PostgreSQL registration, login, token authentication, input failures and concurrency',
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
    const jwt = new JwtService({ secret });
    let created = false,
      connected = false;
    let user, token;
    const password = 'CaicangDemo!2026';
    const settings = {
      DATABASE_URL: url.toString(),
      JWT_ACCESS_SECRET: secret,
      NODE_ENV: 'test',
      TRUSTED_PROXIES: '127.0.0.1/32,::1/128',
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
      await t.test('API uses the actual migrated users table', async (http) => {
        let logs = '';
        const base = await startTestApi(http, {
          env: settings,
          onOutput: (chunk) => {
            logs += chunk;
          },
        });
        let counter = 0;
        const request = (path, options = {}) =>
          fetch(`${base}/api/v1${path}`, {
            ...options,
            headers: {
              'Content-Type': 'application/json',
              'X-Forwarded-For': `192.0.2.${++counter}`,
              ...options.headers,
            },
          });
        const post = (path, body, options = {}) =>
          request(path, { method: 'POST', body: JSON.stringify(body), ...options });
        await http.test(
          'register normalizes email, stores bcrypt cost 12 and returns only public fields',
          async () => {
            const result = await readResponse(
              await post('/auth/register', { email: '  Owner@Example.com  ', password }),
              201,
            );
            user = result.data.user;
            assertPublicUser(user);
            assert.equal(user.email, 'owner@example.com');
            assert.equal(user.displayName, 'owner');
            assert.equal(user.isActive, true);
            const saved = (
              await db.query('SELECT password_hash,is_active FROM users WHERE id=$1', [user.id])
            ).rows[0];
            assert.match(saved.password_hash, /^\$2[ab]\$12\$/);
            assert.notEqual(saved.password_hash, password);
            assert.equal(await compare(password, saved.password_hash), true);
            assert.equal(saved.is_active, true);
            assert.equal((await db.query('SELECT count(*)::int AS n FROM tenants')).rows[0].n, 0);
          },
        );
        await http.test(
          'duplicate normalized email is rejected without resetting password',
          async () => {
            await readResponse(
              await post('/auth/register', {
                email: 'OWNER@example.COM',
                password: 'OtherPassword!2026',
              }),
              409,
              'EMAIL_ALREADY_EXISTS',
            );
            assert.equal((await db.query('SELECT count(*)::int AS n FROM users')).rows[0].n, 1);
            const saved = (await db.query('SELECT password_hash FROM users WHERE id=$1', [user.id]))
              .rows[0];
            assert.equal(await compare(password, saved.password_hash), true);
          },
        );
        await http.test(
          'login immediately after registration returns a verifiable short-lived access token',
          async () => {
            const result = await readResponse(
              await post('/auth/login', { email: ' OWNER@EXAMPLE.COM ', password }),
              200,
            );
            assert.equal(result.data.tokenType, 'Bearer');
            assert.equal(result.data.expiresIn, 900);
            assertPublicUser(result.data.user);
            token = result.data.accessToken;
            const claims = await jwt.verifyAsync(token, {
              algorithms: ['HS256'],
              issuer: 'caicang-api',
              audience: 'caicang-clients',
            });
            assert.equal(claims.sub, user.id);
            assert.equal(claims.type, 'access');
            assert.equal(claims.exp - claims.iat, 900);
            for (const key of ['password', 'passwordHash', 'email', 'tenantId', 'role'])
              assert.equal(claims[key], undefined);
            const second = await readResponse(
              await post('/auth/login', { email: user.email, password }),
              200,
            );
            assert.notEqual(
              second.data.accessToken,
              token,
              'jti makes separate token issuance unique',
            );
          },
        );
        await http.test('me returns current user without requiring a tenant', async () => {
          const body = await readResponse(
            await request('/me', { headers: { Authorization: `Bearer ${token}` } }),
            200,
          );
          assertPublicUser(body.data);
          assert.equal(body.data.id, user.id);
        });
        await http.test(
          'missing bearer credentials do not authenticate query or custom-header identities',
          async () => {
            await readResponse(
              await request(`/me?accessToken=${token}&userId=${user.id}`, {
                headers: { 'X-User-Id': user.id },
              }),
              401,
              'UNAUTHENTICATED',
            );
          },
        );
        await http.test(
          'wrong password, unknown email and disabled account have the same failure message',
          async () => {
            const wrong = await readResponse(
              await post('/auth/login', { email: user.email, password: 'WrongPassword!2026' }),
              401,
              'INVALID_CREDENTIALS',
            );
            const unknown = await readResponse(
              await post('/auth/login', { email: 'unknown@example.com', password }),
              401,
              'INVALID_CREDENTIALS',
            );
            assert.deepEqual(wrong.error, unknown.error);
            await db.query('UPDATE users SET is_active=false WHERE id=$1', [user.id]);
            const disabled = await readResponse(
              await post('/auth/login', { email: user.email, password }),
              401,
              'INVALID_CREDENTIALS',
            );
            assert.deepEqual(disabled.error, wrong.error);
            await readResponse(
              await request('/me', { headers: { Authorization: `Bearer ${token}` } }),
              401,
              'UNAUTHENTICATED',
            );
            await db.query('UPDATE users SET is_active=true WHERE id=$1', [user.id]);
          },
        );
        const inputs = {
          missing: {},
          badEmail: { email: 'invalid', password },
          emailObject: { email: { $ne: null }, password },
          short: { email: 'bad@example.com', password: 'Aa1!short' },
          weak: { email: 'bad@example.com', password: 'alllowercasepassword' },
          numericPassword: { email: 'bad@example.com', password: 123456 },
          extraRole: { email: 'bad@example.com', password, role: 'OWNER' },
          hashInjection: { email: 'bad@example.com', password, passwordHash: 'injected' },
          tenantInjection: { email: 'bad@example.com', password, tenantId: randomUUID() },
          longPassword: { email: 'bad@example.com', password: 'Aa1!' + 'x'.repeat(69) },
          multibyteOverflow: { email: 'bad@example.com', password: 'Aa1!' + '中'.repeat(23) },
          controlCharacter: { email: 'bad@example.com', password: password + '\0' },
          displayNameBlank: { email: 'bad@example.com', password, displayName: '  ' },
          displayNameNull: { email: 'bad@example.com', password, displayName: null },
          displayNameNullByte: { email: 'bad@example.com', password, displayName: 'bad\0name' },
        };
        for (const [label, body] of Object.entries(inputs))
          await http.test(`registration rejects ${label}`, async () => {
            const response = await readResponse(
              await post('/auth/register', body),
              400,
              'VALIDATION_ERROR',
            );
            assert.equal(JSON.stringify(response).includes(password), false);
          });
        await http.test('invalid login inputs use safe DTO failures', async () => {
          for (const body of [
            { email: 'invalid', password },
            { email: user.email },
            { email: user.email, password: {} },
            { email: user.email, password: 'x'.repeat(73) },
            { email: user.email, password, admin: true },
          ]) {
            const result = await readResponse(
              await post('/auth/login', body),
              400,
              'VALIDATION_ERROR',
            );
            assert.equal(JSON.stringify(result).includes(password), false);
          }
        });
        await http.test(
          'password whitespace is preserved and valid 72-byte passwords are not truncated',
          async () => {
            const spaced = ` ${password} `;
            await readResponse(
              await post('/auth/register', {
                email: 'space@example.com',
                password: spaced,
                displayName: ' 仓管测试 ',
              }),
              201,
            );
            const ok = await readResponse(
              await post('/auth/login', { email: 'space@example.com', password: spaced }),
              200,
            );
            assert.equal(ok.data.user.displayName, '仓管测试');
            await readResponse(
              await post('/auth/login', { email: 'space@example.com', password }),
              401,
              'INVALID_CREDENTIALS',
            );
            const boundary = 'Aa1!' + 'x'.repeat(68);
            await readResponse(
              await post('/auth/register', { email: 'boundary@example.com', password: boundary }),
              201,
            );
            await readResponse(
              await post('/auth/login', { email: 'boundary@example.com', password: boundary }),
              200,
            );
            await readResponse(
              await post('/auth/login', {
                email: 'boundary@example.com',
                password: boundary + 'y',
              }),
              400,
              'VALIDATION_ERROR',
            );
          },
        );
        await http.test(
          'concurrent case-variant registrations create exactly one user',
          async () => {
            const results = await Promise.all(
              ['Race@Example.com', 'race@example.COM'].map((email) =>
                post('/auth/register', { email, password }),
              ),
            );
            assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
            for (const response of results)
              await readResponse(
                response,
                response.status,
                response.status === 409 ? 'EMAIL_ALREADY_EXISTS' : undefined,
              );
            assert.equal(
              (
                await db.query(
                  "SELECT count(*)::int AS n FROM users WHERE lower(btrim(email))='race@example.com'",
                )
              ).rows[0].n,
              1,
            );
          },
        );
        await http.test(
          'normalized uniqueness is enforced even for direct SQL; legacy email text is preserved',
          async () => {
            const legacy = (
              await db.query(
                'INSERT INTO users(email,display_name,password_hash) VALUES($1,$2,$3) RETURNING id,email',
                ['  Legacy@Example.COM  ', 'Legacy', await hash(password, 12)],
              )
            ).rows[0];
            const result = await readResponse(
              await post('/auth/login', { email: 'legacy@example.com', password }),
              200,
            );
            assert.equal(result.data.user.id, legacy.id);
            await assert.rejects(
              () =>
                db.query('INSERT INTO users(email,display_name,password_hash) VALUES($1,$2,$3)', [
                  'OWNER@EXAMPLE.COM',
                  'Duplicate',
                  'unused',
                ]),
              (e) => e.code === '23505',
            );
            await readResponse(
              await post('/auth/register', { email: 'legacy@example.com', password }),
              409,
              'EMAIL_ALREADY_EXISTS',
            );
            assert.equal(
              (await db.query('SELECT email FROM users WHERE id=$1', [legacy.id])).rows[0].email,
              legacy.email,
            );
          },
        );
        await http.test(
          'current identity cannot be replaced with another user or tenant header/query',
          async () => {
            const other = await readResponse(
              await post('/auth/register', { email: 'other@example.com', password }),
              201,
            );
            const result = await readResponse(
              await request(`/me?userId=${other.data.user.id}`, {
                headers: {
                  Authorization: `Bearer ${token}`,
                  'X-User-Id': other.data.user.id,
                  'X-Tenant-Id': randomUUID(),
                },
              }),
              200,
            );
            assert.equal(result.data.id, user.id);
            assert.notEqual(result.data.id, other.data.user.id);
          },
        );
        await http.test(
          'bad scheme, malformed token and tampered signature are rejected',
          async () => {
            for (const authorization of [
              'Basic abc',
              'Bearer nope',
              `Bearer ${token} extra`,
              `Bearer ${token.slice(0, -8)}xxxxxxxx`,
            ])
              await readResponse(
                await request('/me', { headers: { Authorization: authorization } }),
                401,
                'INVALID_ACCESS_TOKEN',
              );
          },
        );
        const now = Math.floor(Date.now() / 1000);
        const claims = {
          sub: user.id,
          sid: jwt.decode(token).sid,
          type: 'access',
          jti: randomUUID(),
          iat: now,
          exp: now + 300,
        };
        const tokens = {
          expired: await jwt.signAsync(
            { ...claims, iat: now - 300, exp: now - 1 },
            { issuer: 'caicang-api', audience: 'caicang-clients' },
          ),
          issuer: await jwt.signAsync(claims, { issuer: 'other', audience: 'caicang-clients' }),
          audience: await jwt.signAsync(claims, { issuer: 'caicang-api', audience: 'other' }),
          algorithm: await jwt.signAsync(claims, {
            algorithm: 'HS384',
            issuer: 'caicang-api',
            audience: 'caicang-clients',
          }),
          refreshType: await jwt.signAsync(
            { ...claims, type: 'refresh' },
            { issuer: 'caicang-api', audience: 'caicang-clients' },
          ),
          missingExpiry: await jwt.signAsync(
            { sub: user.id, type: 'access', jti: randomUUID(), iat: now },
            { issuer: 'caicang-api', audience: 'caicang-clients' },
          ),
          futureIssued: await jwt.signAsync(
            { ...claims, iat: now + 100, exp: now + 400 },
            { issuer: 'caicang-api', audience: 'caicang-clients' },
          ),
          invalidSubject: await jwt.signAsync(
            { ...claims, sub: 'invalid' },
            { issuer: 'caicang-api', audience: 'caicang-clients' },
          ),
          longLived: await jwt.signAsync(
            { ...claims, exp: now + 1800 },
            { issuer: 'caicang-api', audience: 'caicang-clients' },
          ),
        };
        for (const [label, badToken] of Object.entries(tokens))
          await http.test(`token validation rejects ${label}`, async () =>
            readResponse(
              await request('/me', { headers: { Authorization: `Bearer ${badToken}` } }),
              401,
              'INVALID_ACCESS_TOKEN',
            ),
          );
        await http.test(
          'a deleted identity is not accepted even when the signature remains valid',
          async () => {
            const gone = await jwt.signAsync(
              { ...claims, sub: randomUUID() },
              { issuer: 'caicang-api', audience: 'caicang-clients' },
            );
            await readResponse(
              await request('/me', { headers: { Authorization: `Bearer ${gone}` } }),
              401,
              'UNAUTHENTICATED',
            );
          },
        );
        await http.test(
          'registration and login enforce the existing five-per-minute sensitive limit',
          async () => {
            for (const [path, body, ip] of [
              ['/auth/login', { email: 'nobody@example.com', password }, '198.51.100.1'],
              ['/auth/register', {}, '198.51.100.2'],
            ]) {
              for (let i = 0; i < 5; i++)
                await readResponse(
                  await post(path, body, { headers: { 'X-Forwarded-For': ip } }),
                  path.endsWith('login') ? 401 : 400,
                  path.endsWith('login') ? 'INVALID_CREDENTIALS' : 'VALIDATION_ERROR',
                );
              const response = await post(path, body, { headers: { 'X-Forwarded-For': ip } });
              assert.ok(Number(response.headers.get('retry-after')) >= 1);
              await readResponse(response, 429, 'RATE_LIMITED');
            }
          },
        );
        await http.test(
          'same-origin Swagger login and protected request work with an Origin header',
          async () => {
            const response = await post(
              '/auth/login',
              { email: user.email, password },
              { headers: { Origin: base } },
            );
            assert.equal(response.headers.get('access-control-allow-origin'), base);
            const result = await readResponse(response, 200);
            await readResponse(
              await request('/me', {
                headers: { Origin: base, Authorization: `Bearer ${result.data.accessToken}` },
              }),
              200,
            );
            await readResponse(
              await post(
                '/auth/login',
                { email: user.email, password },
                { headers: { Origin: 'https://untrusted.example' } },
              ),
              403,
              'FORBIDDEN',
            );
          },
        );
        await http.test(
          'Swagger includes runnable examples and me Bearer security without password-hash schema',
          async () => {
            const doc = await (await request('/../docs-json')).json();
            assert.ok(doc.paths['/api/v1/auth/register'].post.responses['201']);
            assert.ok(doc.paths['/api/v1/auth/login'].post.responses['200']);
            assert.deepEqual(doc.paths['/api/v1/me'].get.security, [{ bearer: [] }]);
            assert.equal(
              doc.components.schemas.RegisterDto.properties.email.example,
              'new-user@example.com',
            );
            assert.equal(doc.components.schemas.RegisterDto.properties.password.example, password);
            assert.equal(doc.components.schemas.RegisterDto.properties.password.writeOnly, true);
            assert.equal(JSON.stringify(doc).includes('passwordHash'), false);
          },
        );
        await http.test(
          'passwords and actual access tokens never appear in captured application logs',
          async () => {
            assert.ok(logs.includes('http_request'));
            assert.equal(logs.includes(password), false);
            assert.equal(logs.includes(token), false);
            assert.equal(logs.includes(secret), false);
            assert.equal(logs.includes('owner@example.com'), false);
          },
        );
      });
      await t.test(
        'restart retains real accounts and previously issued access tokens with the same key',
        async (restarted) => {
          const base = await startTestApi(restarted, { env: settings });
          const result = await readResponse(
            await fetch(`${base}/api/v1/me`, { headers: { Authorization: `Bearer ${token}` } }),
            200,
          );
          assert.equal(result.data.id, user.id);
        },
      );
    } finally {
      if (connected) await db.end();
      if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
      await admin.end();
    }
  },
);
