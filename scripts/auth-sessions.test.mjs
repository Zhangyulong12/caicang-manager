import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { startTestApi } from './api-test-server.mjs';

const requireApi = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { Client } = requireApi('pg');
const { JwtService } = requireApi('@nestjs/jwt');
const runFile = promisify(execFile);
loadEnvFile(new URL('../.env', import.meta.url));
const digest = (value) => createHash('sha256').update(value).digest('hex');
const randomToken = () => randomBytes(32).toString('base64url');

test(
  'persistent refresh rotation, replay protection and logout with real PostgreSQL and two API processes',
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
    const password = 'SessionTests!2026';
    const settings = {
      DATABASE_URL: url.toString(),
      NODE_ENV: 'test',
      JWT_ACCESS_SECRET: secret,
      TRUSTED_PROXIES: '127.0.0.1/32,::1/128',
    };
    let created = false,
      connected = false;
    let logs = '',
      counter = 0,
      surviving;
    const credentials = new Set([secret, password]);
    const read = async (response, status, code) => {
      assert.equal(response.status, status);
      const body = await response.json();
      assert.equal(body.requestId, response.headers.get('x-request-id'));
      if (code) {
        assert.equal(body.error.code, code);
        assert.deepEqual(body.error.details, {});
      }
      if (body.data?.accessToken) {
        credentials.add(body.data.accessToken);
        credentials.add(body.data.refreshToken);
      }
      assert.equal(JSON.stringify(body).includes('passwordHash'), false);
      return body.data ?? body;
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
      await t.test('HTTP session lifecycle', async (http) => {
        const options = {
          env: settings,
          onOutput: (chunk) => {
            logs += chunk;
          },
        };
        const base = await startTestApi(http, options);
        const second = await startTestApi(http, options);
        const request = (path, body, server = base, headers = {}) =>
          fetch(`${server}/api/v1${path}`, {
            method: body === undefined ? 'GET' : 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Forwarded-For': `192.0.2.${++counter}`,
              ...headers,
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          });
        const post = (path, body, server, headers) =>
          request(`/auth/${path}`, body, server, headers);
        const me = (accessToken, server) =>
          request('/me', undefined, server, { Authorization: `Bearer ${accessToken}` });
        const refresh = (refreshToken, server) => post('refresh', { refreshToken }, server);
        const logout = (refreshToken, server, headers) =>
          post('logout', { refreshToken }, server, headers);
        const login = async (email = 'session@example.com') =>
          read(await post('login', { email, password }), 200);
        const sessionId = (pair) => jwt.decode(pair.accessToken).sid;
        const session = async (pair) =>
          (await db.query('SELECT * FROM auth_sessions WHERE id=$1', [sessionId(pair)])).rows[0];
        const sign = (claims) =>
          jwt.signAsync(claims, { issuer: 'caicang-api', audience: 'caicang-clients' });
        const user = (
          await read(await post('register', { email: 'session@example.com', password }), 201)
        ).user;
        const other = (
          await read(await post('register', { email: 'other-session@example.com', password }), 201)
        ).user;

        await http.test(
          'login issues unique random credentials and only SHA-256 digests are stored',
          async () => {
            const pair = await login();
            const another = await login();
            assert.match(pair.refreshToken, /^[A-Za-z0-9_-]{43}$/);
            assert.equal(Buffer.from(pair.refreshToken, 'base64url').length, 32);
            assert.notEqual(pair.refreshToken, another.refreshToken);
            assert.notEqual(sessionId(pair), sessionId(another));
            assert.equal(pair.expiresIn, 900);
            assert.ok(pair.refreshExpiresIn > 604790 && pair.refreshExpiresIn <= 604800);
            const saved = (
              await db.query('SELECT * FROM refresh_tokens WHERE session_id=$1', [sessionId(pair)])
            ).rows;
            assert.equal(saved.length, 1);
            assert.equal(saved[0].token_hash, digest(pair.refreshToken));
            credentials.add(saved[0].token_hash);
            assert.equal(JSON.stringify(saved).includes(pair.refreshToken), false);
            await read(await me(pair.accessToken, second), 200);
          },
        );
        await http.test(
          'refresh replaces both tokens, consumes old hash and preserves absolute expiry',
          async () => {
            const first = await login();
            const before = await session(first);
            const next = await read(await refresh(first.refreshToken, second), 200);
            assert.notEqual(next.refreshToken, first.refreshToken);
            assert.notEqual(next.accessToken, first.accessToken);
            assert.equal(sessionId(next), sessionId(first));
            assert.equal(next.user.id, user.id);
            assert.equal(
              (await session(next)).expires_at.toISOString(),
              before.expires_at.toISOString(),
            );
            const saved = (
              await db.query('SELECT * FROM refresh_tokens WHERE session_id=$1', [sessionId(first)])
            ).rows;
            assert.equal(saved.length, 2);
            assert.ok(saved.find((r) => r.token_hash === digest(first.refreshToken)).used_at);
            assert.equal(
              saved.find((r) => r.token_hash === digest(next.refreshToken)).used_at,
              null,
            );
            await read(await me(next.accessToken), 200);
            surviving = await read(await refresh(next.refreshToken), 200);
          },
        );
        await http.test(
          'reusing an old credential commits revocation of all descendants',
          async () => {
            const pair = await login();
            const next = await read(await refresh(pair.refreshToken), 200);
            await read(await refresh(pair.refreshToken, second), 401, 'INVALID_REFRESH_TOKEN');
            assert.ok((await session(pair)).revoked_at);
            await read(await refresh(next.refreshToken), 401, 'INVALID_REFRESH_TOKEN');
            await read(await me(pair.accessToken), 401, 'INVALID_ACCESS_TOKEN');
            await read(await me(next.accessToken, second), 401, 'INVALID_ACCESS_TOKEN');
          },
        );
        await http.test(
          'concurrent refresh across API processes permits one rotation and revokes on replay',
          async () => {
            const pair = await login();
            const responses = await Promise.all([
              refresh(pair.refreshToken),
              refresh(pair.refreshToken, second),
            ]);
            assert.deepEqual(responses.map((r) => r.status).sort(), [200, 401]);
            let winner;
            for (const response of responses) {
              if (response.status === 200) winner = await read(response, 200);
              else await read(response, 401, 'INVALID_REFRESH_TOKEN');
            }
            assert.equal(
              (
                await db.query(
                  'SELECT count(*)::int AS n FROM refresh_tokens WHERE session_id=$1',
                  [sessionId(pair)],
                )
              ).rows[0].n,
              2,
            );
            assert.ok((await session(pair)).revoked_at);
            await read(await refresh(winner.refreshToken), 401, 'INVALID_REFRESH_TOKEN');
            await read(await me(winner.accessToken), 401, 'INVALID_ACCESS_TOKEN');
          },
        );
        await http.test(
          'expired Access Token returns standard 401 but still allows refresh without Authorization',
          async () => {
            const pair = await login();
            const now = Math.floor(Date.now() / 1000);
            const expired = await sign({
              sub: user.id,
              sid: sessionId(pair),
              type: 'access',
              jti: randomUUID(),
              iat: now - 300,
              exp: now - 1,
            });
            credentials.add(expired);
            await read(await me(expired), 401, 'INVALID_ACCESS_TOKEN');
            const next = await read(await refresh(pair.refreshToken), 200);
            await read(await me(next.accessToken), 200);
          },
        );
        await http.test(
          'expired refresh session is revoked and cannot authorize either credential',
          async () => {
            const pair = await login();
            await db.query(
              "UPDATE auth_sessions SET expires_at=now()-interval '1 second' WHERE id=$1",
              [sessionId(pair)],
            );
            await read(await me(pair.accessToken), 401, 'INVALID_ACCESS_TOKEN');
            await read(await refresh(pair.refreshToken), 401, 'INVALID_REFRESH_TOKEN');
            assert.ok((await session(pair)).revoked_at);
          },
        );
        await http.test(
          'logout works even with an expired Authorization header and is idempotent',
          async () => {
            const pair = await login();
            const response = await logout(pair.refreshToken, second, {
              Authorization: 'Bearer expired.invalid.token',
            });
            assert.equal(response.headers.get('cache-control'), 'no-store');
            assert.deepEqual(await read(response, 200), { loggedOut: true });
            const revokedAt = (await session(pair)).revoked_at.toISOString();
            await read(await refresh(pair.refreshToken), 401, 'INVALID_REFRESH_TOKEN');
            await read(await me(pair.accessToken), 401, 'INVALID_ACCESS_TOKEN');
            await read(await logout(pair.refreshToken), 200);
            assert.equal((await session(pair)).revoked_at.toISOString(), revokedAt);
          },
        );
        await http.test(
          'logout with an already rotated credential also invalidates the current child',
          async () => {
            const pair = await login();
            const next = await read(await refresh(pair.refreshToken), 200);
            await read(await logout(pair.refreshToken), 200);
            await read(await refresh(next.refreshToken), 401, 'INVALID_REFRESH_TOKEN');
            await read(await me(next.accessToken), 401, 'INVALID_ACCESS_TOKEN');
          },
        );
        await http.test(
          'logout affects one device only, including two users with unrelated credentials',
          async () => {
            const first = await login();
            const sameUser = await login();
            const otherUser = await login(other.email);
            await read(await logout(first.refreshToken), 200);
            for (const pair of [sameUser, otherUser]) {
              await read(await me(pair.accessToken, second), 200);
              await read(await refresh(pair.refreshToken), 200);
            }
          },
        );
        await http.test('logout racing refresh leaves no usable descendant', async () => {
          const pair = await login();
          const [rotated, exited] = await Promise.all([
            refresh(pair.refreshToken),
            logout(pair.refreshToken, second),
          ]);
          await read(exited, 200);
          if (rotated.status === 200) {
            const next = await read(rotated, 200);
            await read(await refresh(next.refreshToken), 401, 'INVALID_REFRESH_TOKEN');
            await read(await me(next.accessToken), 401, 'INVALID_ACCESS_TOKEN');
          } else await read(rotated, 401, 'INVALID_REFRESH_TOKEN');
          assert.ok((await session(pair)).revoked_at);
        });
        await http.test(
          'unknown and mutated credentials cannot refresh; unknown logout is harmless',
          async () => {
            const pair = await login();
            const bad = (pair.refreshToken[0] === 'A' ? 'B' : 'A') + pair.refreshToken.slice(1);
            for (const token of [randomToken(), bad]) {
              await read(await refresh(token), 401, 'INVALID_REFRESH_TOKEN');
              assert.deepEqual(await read(await logout(token), 200), { loggedOut: true });
            }
            assert.equal((await session(pair)).revoked_at, null);
            await read(await refresh(pair.refreshToken), 200);
          },
        );
        for (const [name, body] of Object.entries({
          missing: {},
          null: { refreshToken: null },
          number: { refreshToken: 123 },
          object: { refreshToken: {} },
          array: { refreshToken: [] },
          blank: { refreshToken: '' },
          short: { refreshToken: 'short' },
          long: { refreshToken: 'a'.repeat(44) },
          spaces: { refreshToken: ' ' + randomToken() },
          nonCanonical: { refreshToken: 'A'.repeat(42) + 'B' },
          identityInjection: { refreshToken: randomToken(), userId: user.id },
        })) {
          await http.test(
            `both refresh and logout validate ${name} without echoing credentials`,
            async () => {
              for (const route of ['refresh', 'logout']) {
                const response = await post(route, body);
                assert.equal(response.status, 400);
                const error = await response.json();
                assert.equal(error.error.code, 'VALIDATION_ERROR');
                assert.ok(error.error.details.fields.length > 0);
                if (typeof body.refreshToken === 'string' && body.refreshToken.length > 10)
                  assert.equal(JSON.stringify(error).includes(body.refreshToken), false);
              }
            },
          );
        }
        await http.test(
          'access and refresh credentials are not interchangeable or accepted from query parameters',
          async () => {
            const pair = await login();
            await read(await me(pair.refreshToken), 401, 'INVALID_ACCESS_TOKEN');
            const response = await post('refresh', { refreshToken: pair.accessToken });
            assert.equal(response.status, 400);
            assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
            assert.equal(
              (await request(`/auth/refresh?refreshToken=${pair.refreshToken}`, {})).status,
              400,
            );
          },
        );
        await http.test(
          'Access Token session binding rejects missing or mismatched session identities',
          async () => {
            const pair = await login();
            const now = Math.floor(Date.now() / 1000);
            const claims = {
              sub: user.id,
              sid: sessionId(pair),
              type: 'access',
              jti: randomUUID(),
              iat: now,
              exp: now + 300,
            };
            for (const modified of [
              { ...claims, sid: undefined },
              { ...claims, sid: randomUUID() },
              { ...claims, sub: other.id },
            ])
              await read(await me(await sign(modified)), 401, 'INVALID_ACCESS_TOKEN');
          },
        );
        await http.test(
          'a disabled user cannot refresh; reactivation does not revive the revoked session',
          async () => {
            const pair = await login(other.email);
            await db.query('UPDATE users SET is_active=false WHERE id=$1', [other.id]);
            await read(await me(pair.accessToken), 401, 'UNAUTHENTICATED');
            await read(await refresh(pair.refreshToken), 401, 'INVALID_REFRESH_TOKEN');
            await db.query('UPDATE users SET is_active=true WHERE id=$1', [other.id]);
            await read(await refresh(pair.refreshToken), 401, 'INVALID_REFRESH_TOKEN');
          },
        );
        await http.test(
          'a failed rotation rolls back consumption and can be retried successfully',
          async () => {
            const pair = await login();
            await db.query(
              "CREATE FUNCTION test_reject_refresh() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'TOKEN_SECRET_MUST_NOT_LEAK'; END $$",
            );
            await db.query(
              'CREATE TRIGGER test_refresh_failure BEFORE INSERT ON refresh_tokens FOR EACH ROW EXECUTE FUNCTION test_reject_refresh()',
            );
            try {
              await read(await refresh(pair.refreshToken), 500, 'INTERNAL_ERROR');
              const saved = (
                await db.query('SELECT used_at FROM refresh_tokens WHERE token_hash=$1', [
                  digest(pair.refreshToken),
                ])
              ).rows[0];
              assert.equal(saved.used_at, null);
              assert.equal((await session(pair)).revoked_at, null);
            } finally {
              await db.query('DROP TRIGGER test_refresh_failure ON refresh_tokens');
              await db.query('DROP FUNCTION test_reject_refresh()');
            }
            await read(await refresh(pair.refreshToken), 200);
          },
        );
        await http.test(
          'database hash format, uniqueness, foreign keys and cascade cleanup are real',
          async () => {
            const pair = await login(other.email);
            for (const [query, params, code] of [
              [
                'INSERT INTO refresh_tokens(session_id,token_hash) VALUES($1,$2)',
                [sessionId(pair), digest(pair.refreshToken)],
                '23505',
              ],
              [
                'INSERT INTO refresh_tokens(session_id,token_hash) VALUES($1,$2)',
                [sessionId(pair), 'plaintext'],
                '23514',
              ],
              [
                'INSERT INTO refresh_tokens(session_id,token_hash) VALUES($1,$2)',
                [randomUUID(), digest(randomToken())],
                '23503',
              ],
            ])
              await assert.rejects(
                () => db.query(query, params),
                (e) => e.code === code,
              );
            await db.query('DELETE FROM users WHERE id=$1', [other.id]);
            assert.equal(
              (
                await db.query('SELECT count(*)::int AS n FROM auth_sessions WHERE user_id=$1', [
                  other.id,
                ])
              ).rows[0].n,
              0,
            );
            assert.equal(
              (
                await db.query(
                  'SELECT count(*)::int AS n FROM refresh_tokens WHERE session_id=$1',
                  [sessionId(pair)],
                )
              ).rows[0].n,
              0,
            );
            await read(await refresh(pair.refreshToken), 401, 'INVALID_REFRESH_TOKEN');
            await read(await me(pair.accessToken), 401, 'UNAUTHENTICATED');
          },
        );
        await http.test('refresh and logout use the real sensitive rate limiter', async () => {
          for (const [route, ip] of [
            ['refresh', '198.51.100.11'],
            ['logout', '198.51.100.12'],
          ]) {
            for (let i = 0; i < 5; i++)
              await read(
                await post(route, { refreshToken: randomToken() }, base, { 'X-Forwarded-For': ip }),
                route === 'refresh' ? 401 : 200,
                route === 'refresh' ? 'INVALID_REFRESH_TOKEN' : undefined,
              );
            const response = await post(route, { refreshToken: randomToken() }, base, {
              'X-Forwarded-For': ip,
            });
            assert.ok(Number(response.headers.get('retry-after')) >= 1);
            await read(response, 429, 'RATE_LIMITED');
          }
        });
        await http.test(
          'OpenAPI documents public refresh/logout, shared response and credential input',
          async () => {
            const doc = await (await fetch(`${base}/api/docs-json`)).json();
            for (const route of ['refresh', 'logout']) {
              const operation = doc.paths[`/api/v1/auth/${route}`].post;
              assert.ok(operation.responses['200']);
              assert.ok(!operation.security?.length);
            }
            assert.equal(
              doc.components.schemas.RefreshTokenDto.properties.refreshToken.writeOnly,
              true,
            );
            assert.ok(doc.components.schemas.LoginResultDto.properties.refreshToken);
            assert.ok(doc.components.schemas.LoginResultDto.properties.refreshExpiresIn);
            const response = await post('login', { email: user.email, password });
            assert.equal(response.headers.get('cache-control'), 'no-store');
            await read(response, 200);
          },
        );
        await http.test(
          'actual tokens, hashes, passwords and database exceptions never enter application logs',
          () => {
            assert.ok(logs.includes('http_request'));
            for (const value of credentials) assert.equal(logs.includes(value), false);
            assert.equal(logs.includes('TOKEN_SECRET_MUST_NOT_LEAK'), false);
          },
        );
      });
      await t.test(
        'new API process can refresh persistent credentials and its logout is durable',
        async (restart) => {
          const base = await startTestApi(restart, { env: settings });
          const post = (path, token) =>
            fetch(`${base}/api/v1/auth/${path}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ refreshToken: token }),
            });
          const next = await read(await post('refresh', surviving.refreshToken), 200);
          await read(await post('logout', next.refreshToken), 200);
          surviving = next;
        },
      );
      await t.test('another restart cannot revive a logged-out session', async (restart) => {
        const base = await startTestApi(restart, { env: settings });
        await read(
          await fetch(`${base}/api/v1/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken: surviving.refreshToken }),
          }),
          401,
          'INVALID_REFRESH_TOKEN',
        );
        await read(
          await fetch(`${base}/api/v1/me`, {
            headers: { Authorization: `Bearer ${surviving.accessToken}` },
          }),
          401,
          'INVALID_ACCESS_TOKEN',
        );
      });
    } finally {
      if (connected) await db.end();
      if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
      await admin.end();
    }
  },
);
