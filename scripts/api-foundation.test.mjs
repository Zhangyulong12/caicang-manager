import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { startTestApi, projectRoot } from './api-test-server.mjs';
import { validateEnvironment } from '../apps/api/dist/config/env.js';
import { SafeLogger, redactSensitive } from '../apps/api/dist/common/logging.js';

loadEnvFile(new URL('../.env', import.meta.url));
const runFile = promisify(execFile);
const validEnv = {
  DATABASE_URL: 'postgresql://demo:test-password-for-validation@localhost:5432/caicang',
  JWT_ACCESS_SECRET: 'unit-test-only-signing-key-that-is-not-a-production-credential',
};
const assertError = async (response, status, code) => {
  assert.equal(response.status, status);
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ['error', 'requestId']);
  assert.equal(body.error.code, code);
  assert.equal(typeof body.error.message, 'string');
  assert.equal(typeof body.error.details, 'object');
  assert.equal(body.requestId, response.headers.get('x-request-id'));
  assert.match(body.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(JSON.stringify(body).includes('SECRET_EXCEPTION'), false);
  return body;
};

test('configuration rejects invalid development and production values without exposing credentials', async (t) => {
  await t.test('valid defaults, explicit HTTPS production and trusted proxy ranges', () => {
    assert.equal(validateEnvironment(validEnv).port, 3000);
    assert.equal(validateEnvironment(validEnv).swaggerEnabled, true);
    const production = validateEnvironment({
      ...validEnv,
      NODE_ENV: 'production',
      WEB_ORIGIN: 'https://admin.example',
      TRUSTED_PROXIES: '127.0.0.1,10.0.0.0/24,::1',
    });
    assert.equal(production.swaggerEnabled, false);
    assert.equal(production.trustedProxies.length, 3);
  });
  for (const [key, value] of Object.entries({
    NODE_ENV: 'unknown',
    DATABASE_URL: 'mysql://secret:password@host/db',
    API_PORT: '0',
    API_HOST: 'invalid',
    WEB_ORIGIN: '*',
    SWAGGER_ENABLED: 'yes',
    TRUSTED_PROXIES: 'true',
    RATE_LIMIT_LIMIT: '0',
    RATE_LIMIT_TTL_MS: 'NaN',
    API_BODY_LIMIT_KB: '-1',
    JWT_ACCESS_SECRET: 'short',
    JWT_ACCESS_TTL_SECONDS: '901',
    REFRESH_TOKEN_TTL_SECONDS: '2592001',
  })) {
    await t.test(`invalid ${key}`, () =>
      assert.throws(
        () => validateEnvironment({ ...validEnv, [key]: value }),
        (error) =>
          error.message === `Invalid configuration: ${key}` && !error.message.includes(value),
      ),
    );
  }
  for (const origin of [
    'http://admin.example',
    'https://admin.example/path',
    'https://admin.example/',
    'https://user:password@admin.example',
    'null',
    'https://*.example',
  ])
    await t.test(`reject production origin ${origin.split('@').at(-1)}`, () =>
      assert.throws(
        () => validateEnvironment({ ...validEnv, NODE_ENV: 'production', WEB_ORIGIN: origin }),
        /WEB_ORIGIN/,
      ),
    );
  await t.test('production requires explicit origins and disables public Swagger', () => {
    assert.throws(() => validateEnvironment({ ...validEnv, NODE_ENV: 'production' }), /WEB_ORIGIN/);
    assert.throws(
      () =>
        validateEnvironment({
          ...validEnv,
          NODE_ENV: 'production',
          WEB_ORIGIN: 'https://admin.example',
          SWAGGER_ENABLED: 'true',
        }),
      /SWAGGER_ENABLED/,
    );
  });
  await t.test('signing keys are required and token duration stays short', () => {
    for (const secret of [
      undefined,
      'short',
      'replace-with-long-random-secret-that-is-still-placeholder',
    ])
      assert.throws(
        () => validateEnvironment({ ...validEnv, JWT_ACCESS_SECRET: secret }),
        /JWT_ACCESS_SECRET/,
      );
    for (const ttl of ['0', '59', '901', 'NaN'])
      assert.throws(
        () => validateEnvironment({ ...validEnv, JWT_ACCESS_TTL_SECONDS: ttl }),
        /JWT_ACCESS_TTL_SECONDS/,
      );
    assert.equal(
      validateEnvironment({ ...validEnv, JWT_ACCESS_TTL_SECONDS: '60' }).jwtAccessTtlSeconds,
      60,
    );
  });
  await t.test('production never permits missing, weak or placeholder JWT keys', () => {
    for (const key of [undefined, '', 'short', 'changeme'.repeat(10)])
      assert.throws(
        () =>
          validateEnvironment({
            ...validEnv,
            NODE_ENV: 'production',
            WEB_ORIGIN: 'https://admin.example',
            JWT_ACCESS_SECRET: key,
          }),
        /JWT_ACCESS_SECRET/,
      );
    for (const ttl of ['0', '3599', '2592001', 'NaN'])
      assert.throws(
        () => validateEnvironment({ ...validEnv, REFRESH_TOKEN_TTL_SECONDS: ttl }),
        /REFRESH_TOKEN_TTL_SECONDS/,
      );
    assert.equal(validateEnvironment(validEnv).refreshTokenTtlSeconds, 604800);
    assert.equal(
      validateEnvironment({ ...validEnv, REFRESH_TOKEN_TTL_SECONDS: '3600' })
        .refreshTokenTtlSeconds,
      3600,
    );
  });
});

test('logger drops free text, exceptions and unsafe context; nested sensitive fields are redacted', () => {
  const lines = [];
  const original = process.stdout.write;
  try {
    process.stdout.write = (line) => {
      lines.push(String(line));
      return true;
    };
    const logger = new SafeLogger();
    logger.log('PASSWORD_SECRET', 'TOKEN_CONTEXT_SECRET');
    logger.error(new Error('ADDRESS_SECRET'), 'TOKEN_SECRET', 'TOKEN_CONTEXT_SECRET');
    logger.warn({ password: 'PASSWORD_SECRET', address: 'ADDRESS_SECRET' });
  } finally {
    process.stdout.write = original;
  }
  const output = lines.join('');
  for (const value of ['PASSWORD_SECRET', 'TOKEN_SECRET', 'TOKEN_CONTEXT_SECRET', 'ADDRESS_SECRET'])
    assert.equal(output.includes(value), false);
  const redacted = redactSensitive({
    PASSWORD: 'x',
    nested: [{ access_token: 'x', recipient_address: 'x', count: 2 }],
  });
  assert.deepEqual(redacted, {
    PASSWORD: '[REDACTED]',
    nested: [{ access_token: '[REDACTED]', recipient_address: '[REDACTED]', count: 2 }],
  });
});

test('all controllers inherit global HTTP foundations', async (t) => {
  let logs = '';
  const base = await startTestApi(t, {
    entry: 'apps/api/.test-build/test/fixture-main.js',
    onOutput: (chunk) => {
      logs += chunk;
    },
  });
  const endpoint = `${base}/api/v1/__test`;
  await t.test('new controllers require authentication by default', async () =>
    assertError(await fetch(`${base}/api/v1/__private-test`), 401, 'UNAUTHENTICATED'),
  );
  const payload = { name: 'sample', items: [{ sku: '001', quantity: 2 }] };
  const post = (body, path = 'validate') =>
    fetch(`${endpoint}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  await t.test('successful DTO is wrapped once and preserves HTTP 201', async () => {
    const response = await post(payload);
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.deepEqual(body.data, payload);
    assert.equal(body.requestId, response.headers.get('x-request-id'));
  });
  for (const [name, input] of Object.entries({
    missing: {},
    unknown: { ...payload, tenantId: randomUUID() },
    nestedUnknown: { ...payload, items: [{ sku: '001', quantity: 1, admin: true }] },
    stringNumber: { ...payload, items: [{ sku: '001', quantity: '2' }] },
    zero: { ...payload, items: [{ sku: '001', quantity: 0 }] },
    emptyItems: { ...payload, items: [] },
    nestedWrong: { ...payload, items: [{}] },
    array: [payload],
    null: null,
    boolean: true,
  })) {
    await t.test(`global DTO rejects ${name}`, async () => {
      const response = await post(input);
      const body = await assertError(
        response,
        400,
        name === 'boolean' || name === 'null' ? 'BAD_REQUEST' : 'VALIDATION_ERROR',
      );
      assert.equal(JSON.stringify(body).includes('target'), false);
      assert.equal(JSON.stringify(body).includes('value'), false);
    });
  }
  await t.test(
    'validation never reflects secret values or attacker-chosen property names',
    async () => {
      const response = await post({
        name: { password: 'SENSITIVE_PAYLOAD_PASSWORD' },
        items: [{ sku: '001', quantity: 'SENSITIVE_PAYLOAD_NUMBER' }],
        SENSITIVE_PROPERTY_SECRET: 'ADDRESS_PAYLOAD_SECRET',
      });
      const body = await assertError(response, 400, 'VALIDATION_ERROR');
      for (const value of [
        'SENSITIVE_PAYLOAD',
        'SENSITIVE_PROPERTY_SECRET',
        'ADDRESS_PAYLOAD_SECRET',
      ])
        assert.equal(JSON.stringify(body).includes(value), false);
      assert.ok(body.error.details.fields.length > 0);
    },
  );
  await t.test('pagination is explicitly transformed, bounded, and has a requestId', async () => {
    const response = await fetch(`${endpoint}/page?page=2&pageSize=5`);
    const body = await response.json();
    assert.deepEqual(body.pagination, { page: 2, pageSize: 5, total: 1 });
    assert.deepEqual(body.data, [{ sku: 'TEST' }]);
    assert.equal(body.requestId, response.headers.get('x-request-id'));
    for (const query of ['page=0', 'pageSize=101', 'page=oops', 'page=1.5', 'unexpected=secret'])
      await assertError(await fetch(`${endpoint}/page?${query}`), 400, 'VALIDATION_ERROR');
  });
  await t.test('business data fields remain data and undefined becomes null', async () => {
    assert.deepEqual((await (await fetch(`${endpoint}/reserved`)).json()).data, {
      data: 'business field',
      pagination: 'business field',
    });
    assert.equal((await (await fetch(`${endpoint}/empty`)).json()).data, null);
    assert.deepEqual((await (await fetch(`${endpoint}/money`)).json()).data, { price: '123.45' });
  });
  await t.test(
    'business exceptions use registry messages and safe structured details',
    async () => {
      const body = await assertError(await fetch(`${endpoint}/business`), 409, 'OUT_OF_STOCK');
      assert.equal(body.error.details.available, 2);
      assert.equal(body.error.details.password, '[REDACTED]');
      assert.equal(body.error.details.nested.refreshToken, '[REDACTED]');
      assert.equal(body.error.details.nested.recipientAddress, '[REDACTED]');
    },
  );
  for (const [status, code] of Object.entries({
    400: 'BAD_REQUEST',
    401: 'UNAUTHENTICATED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    405: 'METHOD_NOT_ALLOWED',
    409: 'RESOURCE_CONFLICT',
    413: 'PAYLOAD_TOO_LARGE',
    415: 'UNSUPPORTED_MEDIA_TYPE',
    422: 'BUSINESS_VALIDATION_FAILED',
    429: 'RATE_LIMITED',
    500: 'INTERNAL_ERROR',
    503: 'SERVICE_UNAVAILABLE',
  }))
    await t.test(`normalizes HTTP ${status}`, async () =>
      assertError(await fetch(`${endpoint}/http/${status}`), Number(status), code),
    );
  await t.test('unexpected exceptions and Prisma errors never expose stack/SQL', async () => {
    await assertError(await fetch(`${endpoint}/crash`), 500, 'INTERNAL_ERROR');
    await assertError(await fetch(`${endpoint}/prisma`), 409, 'RESOURCE_CONFLICT');
  });
  await t.test('parser errors and oversized payloads use the same error envelope', async () => {
    await assertError(
      await fetch(`${endpoint}/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"password":"SECRET_EXCEPTION_PARSE",',
      }),
      400,
      'BAD_REQUEST',
    );
    await assertError(await post({ blob: 'x'.repeat(70000) }), 413, 'PAYLOAD_TOO_LARGE');
  });
  await t.test(
    'requestId is shared by headers, success, errors and logs; invalid IDs replaced',
    async () => {
      for (const path of ['page', 'crash']) {
        const id = randomUUID();
        const response = await fetch(`${endpoint}/${path}`, { headers: { 'X-Request-Id': id } });
        assert.equal(response.headers.get('x-request-id'), id);
        assert.equal((await response.json()).requestId, id);
      }
      const response = await fetch(`${endpoint}/page`, {
        headers: { 'X-Request-Id': 'UNTRUSTED_TOKEN_SECRET' },
      });
      assert.notEqual(response.headers.get('x-request-id'), 'UNTRUSTED_TOKEN_SECRET');
      const ids = await Promise.all(
        Array.from(
          { length: 10 },
          async () => (await (await fetch(`${endpoint}/page`)).json()).requestId,
        ),
      );
      assert.equal(new Set(ids).size, 10);
    },
  );
  await t.test(
    'CORS supports authenticated write preflight and rejects unknown origins',
    async () => {
      const response = await fetch(`${endpoint}/validate`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:5173',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'authorization,content-type,x-tenant-id,x-request-id',
        },
      });
      assert.equal(response.status, 204);
      assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
      assert.ok(response.headers.get('access-control-allow-methods').includes('POST'));
      assert.ok(response.headers.get('access-control-allow-headers').includes('X-Tenant-Id'));
      const denied = await fetch(`${endpoint}/page`, {
        headers: { Origin: 'https://untrusted.example' },
      });
      assert.equal(denied.headers.get('access-control-allow-origin'), null);
      await assertError(denied, 403, 'FORBIDDEN');
    },
  );
  await t.test('security headers exist on success, failure, preflight and OpenAPI', async () => {
    for (const [path, options] of [
      [`${endpoint}/page`, {}],
      [`${endpoint}/missing`, {}],
      [`${base}/api/docs-json`, {}],
      [
        `${endpoint}/page`,
        {
          method: 'OPTIONS',
          headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'GET' },
        },
      ],
    ]) {
      const response = await fetch(path, options);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(response.headers.get('x-frame-options'), 'DENY');
      assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
      assert.equal(response.headers.get('x-powered-by'), null);
      assert.ok(response.headers.get('content-security-policy'));
      assert.equal(response.headers.get('strict-transport-security'), null);
    }
  });
  await t.test(
    'concurrent limits cannot be bypassed with forged X-Forwarded-For; reset works',
    async () => {
      const responses = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          fetch(`${endpoint}/rate`, { headers: { 'X-Forwarded-For': `192.0.2.${i + 1}` } }),
        ),
      );
      assert.equal(responses.filter((r) => r.status === 200).length, 3);
      assert.equal(responses.filter((r) => r.status === 429).length, 7);
      const denied = responses.find((r) => r.status === 429);
      assert.ok(Number(denied.headers.get('retry-after')) >= 1);
      await assertError(denied, 429, 'RATE_LIMITED');
      await delay(1100);
      assert.equal((await fetch(`${endpoint}/rate`)).status, 200);
    },
  );
  await t.test('sensitive endpoint decorator sets five requests per minute', async () => {
    for (let i = 0; i < 5; i++) assert.equal((await fetch(`${endpoint}/sensitive`)).status, 200);
    await assertError(await fetch(`${endpoint}/sensitive`), 429, 'RATE_LIMITED');
  });
  await t.test(
    'raw OpenAPI includes uniform errors, tracing and future authentication schemes',
    async () => {
      const doc = await (await fetch(`${base}/api/docs-json`)).json();
      assert.ok(doc.paths['/api/v1/health'].get.responses['503']);
      assert.ok(doc.components.schemas.ApiErrorResponseDto);
      assert.ok(doc.components.securitySchemes.bearer);
      assert.ok(doc.components.securitySchemes.tenant);
      assert.ok(doc.paths['/api/v1/health'].get.parameters.some((p) => p.name === 'X-Request-Id'));
      assert.equal((await fetch(`${base}/api/docs`)).status, 200);
    },
  );
  await t.test(
    'access logs exclude payload, headers, query, unknown path, passwords, tokens and full addresses',
    async () => {
      const password = 'PRIVATE_PASSWORD_781';
      const token = 'PRIVATE_TOKEN_762';
      const address = '上海市测试路完整收货地址999号';
      const id = randomUUID();
      await fetch(`${endpoint}/log?token=${token}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'X-Request-Id': id,
        },
        body: JSON.stringify({
          password,
          nested: { refreshToken: token, recipientAddress: address },
        }),
      });
      await fetch(`${base}/api/v1/${encodeURIComponent(address)}?password=${password}`);
      await delay(100);
      for (const secret of [
        password,
        token,
        address,
        'TOKEN_CONTEXT_SECRET',
        'SECRET_EXCEPTION_TEXT',
        'UNTRUSTED_TOKEN_SECRET',
      ])
        assert.equal(logs.includes(secret), false, `leaked ${secret}`);
      assert.ok(
        logs
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line))
          .some(
            (line) =>
              line.event === 'http_request' && line.requestId === id && line.statusCode === 201,
          ),
      );
    },
  );
});

test('production bootstrap has security headers and no public Swagger or fixture routes', async (t) => {
  const base = await startTestApi(t, {
    env: { NODE_ENV: 'production', WEB_ORIGIN: 'https://admin.example', SWAGGER_ENABLED: 'false' },
  });
  const response = await fetch(`${base}/api/v1/health`);
  assert.equal(response.status, 200);
  assert.ok(response.headers.get('strict-transport-security'));
  for (const path of ['/api/docs', '/api/docs-json', '/api/v1/__test/page', '/api/v1/auth/refresh'])
    await assertError(await fetch(`${base}${path}`), 404, 'NOT_FOUND');
});

test('invalid production configuration exits nonzero before listening and hides credential values', async () => {
  await assert.rejects(
    () =>
      runFile(process.execPath, ['apps/api/dist/main.js'], {
        cwd: projectRoot,
        windowsHide: true,
        timeout: 20000,
        env: {
          ...process.env,
          NODE_ENV: 'production',
          WEB_ORIGIN: '*',
          DATABASE_URL: 'mysql://PRIVATE_PASSWORD_123@host/db',
        },
      }),
    (error) => {
      assert.equal(error.code, 1);
      const output = error.stdout + error.stderr;
      assert.equal(output.includes('PRIVATE_PASSWORD_123'), false);
      assert.ok(output.includes('bootstrap_failed'));
      return true;
    },
  );
});
