import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import ts from 'typescript';
import { reportFixture } from './report-fixture.mjs';
const output = new URL('../apps/admin-web/.test-build/reports/', import.meta.url);
await mkdir(output, { recursive: true });
for (const [name, path] of [
  ['client', 'api/client'],
  ['reports', 'api/reports'],
  ['policy', 'router/policy'],
]) {
  const source = await readFile(
    new URL('../apps/admin-web/src/' + path + '.ts', import.meta.url),
    'utf8',
  );
  await writeFile(
    new URL(name + '.mjs', output),
    ts
      .transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
      })
      .outputText.replaceAll("'./client'", "'./client.mjs'"),
  );
}
const { createReports, reportParams, reportSource } = await import(new URL('reports.mjs', output));
const { ApiFailure } = await import(new URL('client.mjs', output));
const { allowed } = await import(new URL('policy.mjs', output));
test('web report filters and source navigation preserve explicit accounting scopes', () => {
  const q = {
    from: '2026-10-01',
    to: '2026-10-31',
    purchaseAccountId: randomUUID(),
    platform: 'JD',
    sku: '  SKU-1  ',
    articleNo: 'A',
  };
  const inventory = reportParams(q, 'inventory');
  assert.equal(inventory.has('from'), false);
  assert.equal(inventory.has('purchaseAccountId'), false);
  assert.equal(inventory.get('sku'), 'SKU-1');
  assert.equal(reportParams(q, 'returns').has('sku'), false);
  assert.equal(reportParams(q, 'purchase-lines').get('purchaseAccountId'), q.purchaseAccountId);
  assert.equal(allowed('/reports', ['tenant:read']), false);
  assert.equal(allowed('/reports', ['reports:read']), true);
  const id = randomUUID();
  for (const [dataset, row, path] of [
    ['receipts', { receiptId: id }, '/receipts/'],
    ['outbound', { outboundId: id }, '/outbound/'],
    ['returns', { key: id }, '/purchase-returns/'],
    ['adjustments', { adjustmentId: id }, '/inventory/adjustments/'],
    ['purchase-lines', { orderId: id }, '/purchases/'],
  ])
    assert.equal(reportSource(row, dataset), path + id);
  assert.equal(reportSource({ orderId: 'javascript:alert(1)' }, 'purchase-lines'), null);
});
test(
  'web client real API: account switching, persistence, CSV and permission errors',
  { timeout: 180000 },
  async (t) => {
    await reportFixture(
      t,
      async ({ http, request, read, base, users, tenant, other, account, product, purchase }) => {
        let scope = {
          userId: users.owner.user.id,
          sessionKey: 'reports-session',
          tenantId: tenant.tenant.id,
          permissions: ['reports:read', 'reports:export'],
        };
        const client = {
          request: async (path, init) => {
            const response = await fetch(base + '/api/v1' + path, {
              headers: {
                Authorization: 'Bearer ' + users.owner.accessToken,
                'X-Tenant-Id': init.tenantId,
              },
            });
            const result = await response.json();
            if (!response.ok)
              throw new ApiFailure(
                response.status,
                result.error.code,
                result.error.message,
                result.requestId,
              );
            return result;
          },
        };
        const api = createReports(client, () => scope);
        const a = await account('TAOBAO', 'Web account A'),
          b = await account('JD', 'Web account B'),
          p = await product('WEB-R33', 'WEB-R33');
        const order = await purchase(a, [[p, 3, '18.50']], { freight: '2.00' });
        await purchase(b, [[p, 2, '20.00']]);
        await http.test(
          'selected accounts independently query real saved orders and remain after recreating page client',
          async () => {
            assert.equal((await api.overview({ purchaseAccountId: a.id })).purchaseAmount, '57.50');
            assert.equal((await api.overview({ purchaseAccountId: b.id })).purchaseAmount, '40.00');
            const page = await createReports(client, () => scope).table('purchase-lines', {
              purchaseAccountId: a.id,
              sku: 'WEB-R33',
            });
            assert.equal(page.rows[0].orderId, order.id);
            assert.equal(page.rows[0].unitPrice, '18.50');
            const exported = await api.export('purchase-lines', { purchaseAccountId: a.id });
            assert.equal(exported.rowCount, 1);
            assert.equal(exported.csv.codePointAt(0), 0xfeff);
            assert.ok(exported.csv.includes('57.50'));
          },
        );
        await http.test('real cross-tenant ID errors and current tenant isolation', async () => {
          const foreign = await account('JD', 'Foreign', other);
          await assert.rejects(
            () => api.overview({ purchaseAccountId: foreign.id }),
            (e) => e.status === 404,
          );
          scope = { ...scope, tenantId: other.tenant.id };
          assert.equal((await api.table('accounts', {})).rows.length, 0);
          scope = { ...scope, tenantId: tenant.tenant.id };
          await read(await request('/reports/overview', { actor: 'warehouse' }), 403);
        });
        await http.test(
          'read-only cannot export, invalid paging refused, late old-workspace response discarded',
          async () => {
            scope = { ...scope, permissions: ['reports:read'] };
            await assert.rejects(
              () => api.export('accounts', {}),
              (e) => e.status === 403,
            );
            assert.throws(
              () => api.table('accounts', {}, 1, 101),
              (e) => e.status === 400,
            );
            // Delay only delivery of a real response, then change workspace while it is in flight.
            let release;
            const gate = new Promise((resolve) => {
              release = resolve;
            });
            const delayed = createReports(
              {
                request: async (...args) => {
                  const value = await client.request(...args);
                  await gate;
                  return value;
                },
              },
              () => scope,
            );
            const pending = delayed.overview({});
            scope = { ...scope, tenantId: other.tenant.id };
            release();
            await assert.rejects(pending, (e) => e.code === 'SCOPE_CHANGED');
            scope = null;
            await assert.rejects(
              () => api.overview({}),
              (e) => e.status === 403,
            );
          },
        );
      },
    );
  },
);
test('CSV handles formula prefixes, control characters, Unicode, comma, quote and line breaks', async () => {
  const { csvCell, reportCsv } = await import('../apps/api/dist/modules/reports/report-csv.js');
  for (const value of [
    '=1+1',
    '+1',
    '-1',
    '@SUM(1)',
    '  =1',
    '\t=1',
    '\r=1',
    '\ufeff=1',
    '＝1',
    '＋1',
    '－1',
    '＠1',
  ])
    assert.ok(csvCell(value).startsWith('"\''), JSON.stringify(value));
  assert.equal(csvCell('a,"b"\r\nc'), '"a,""b""\r\nc"');
  assert.equal(csvCell('淘宝'), '"淘宝"');
  assert.equal(csvCell(null), '""');
  const csv = reportCsv([{ key: 'v', label: '列', kind: 'text' }], [{ v: '=1' }]);
  assert.equal(Buffer.from(csv).subarray(0, 3).toString('hex'), 'efbbbf');
});
