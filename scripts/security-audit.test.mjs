import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { reportFixture } from './report-fixture.mjs';
import { startTestApi } from './api-test-server.mjs';
import { SafeLogger, safeFailureMetadata } from '../apps/api/dist/common/logging.js';
test(
  'task35: actual A/B business resources resist cross-tenant CRUD, filters and exports',
  { timeout: 240000 },
  async (t) => {
    await reportFixture(
      t,
      async ({ http, db, request, read, post, tenant, users, databaseUrl }) => {
        const credentials = {
          email: 'separate-owner-b@audit.example.test',
          password: randomBytes(24).toString('hex') + 'Aa1!',
        };
        await read(
          await post('/auth/register', credentials, { actor: null, workspace: null }),
          201,
        );
        users.ownerB = await read(
          await post('/auth/login', credentials, { actor: null, workspace: null }),
        );
        const b = await read(
          await post(
            '/tenants',
            { name: 'Security audit B' },
            { actor: 'ownerB', workspace: null },
          ),
          201,
        );
        async function bundle(workspace, actor, prefix) {
          const options = { workspace, actor };
          const create = async (path, body, status = 201) =>
            read(await post(path, body, options), status);
          const product = await create('/products', {
            sku: prefix + '-SKU',
            name: prefix + ' product',
            unit: '件',
          });
          const account = await create('/purchase-accounts', {
            platform: 'TAOBAO',
            alias: prefix + ' account',
          });
          const draft = await create('/purchase-orders', {
            warehouseId: workspace.defaultWarehouse.id,
            platform: 'TAOBAO',
            purchaseAccountId: account.id,
            purchaseDate: '2026-10-28',
            recipient: {
              name: 'Audit fixture',
              phone: '13800000000',
              address: 'Isolated test only',
            },
            items: [{ productId: product.id, quantity: 10, unitPrice: '10.00' }],
          });
          const purchase = await create('/purchase-orders/' + draft.id + '/place', {}, 200);
          const pkg = await create('/purchase-orders/' + purchase.id + '/packages', {
            carrierCode: 'SF',
            trackingNo: prefix + '-000001',
            expectedItems: [],
          });
          const receipt = await create('/receipts', {
            packageId: pkg.id,
            clientOperationId: randomUUID(),
            items: [{ purchaseOrderItemId: purchase.items[0].id, receivedQty: 10 }],
          });
          const adjustment = await create('/inventory/adjustments', {
            warehouseId: workspace.defaultWarehouse.id,
            productId: product.id,
            quantityDelta: 1,
            reason: 'STOCKTAKE_GAIN',
            clientOperationId: randomUUID(),
          });
          const returned = await create('/purchase-returns', {
            purchaseOrderId: purchase.id,
            reason: 'Audit fixture',
            returnDate: '2026-10-28',
            refundAmount: '9.50',
            items: [{ purchaseOrderItemId: purchase.items[0].id, quantity: 1 }],
          });
          await create('/purchase-returns/' + returned.id + '/confirm', {
            clientOperationId: randomUUID(),
          });
          const outbound = await create('/outbound-orders', {
            warehouseId: workspace.defaultWarehouse.id,
            customerName: 'Audit',
            customerPhone: '13800000000',
            customerAddress: 'Isolated fixture',
            items: [{ productId: product.id, quantity: 1 }],
          });
          await create('/outbound-orders/' + outbound.id + '/ship', {
            clientOperationId: randomUUID(),
          });
          return {
            workspace,
            product,
            account,
            purchase,
            pkg,
            receipt,
            adjustment,
            returned,
            outbound,
          };
        }
        const aFacts = await bundle(tenant, 'owner', 'AUDIT-A'),
          bFacts = await bundle(b, 'ownerB', 'AUDIT-B');
        const before = JSON.stringify(
          (
            await db.query(
              `SELECT (SELECT jsonb_agg(t ORDER BY id) FROM products t WHERE tenant_id=$1) products,(SELECT jsonb_agg(t ORDER BY id) FROM stock_balances t WHERE tenant_id=$1) balances,(SELECT jsonb_agg(t ORDER BY id) FROM stock_movements t WHERE tenant_id=$1) movements,(SELECT jsonb_agg(t ORDER BY id) FROM purchase_orders t WHERE tenant_id=$1) orders,(SELECT jsonb_agg(t ORDER BY id) FROM audit_logs t WHERE tenant_id=$1) audits`,
              [b.tenant.id],
            )
          ).rows,
        );
        const f = bFacts;
        const attacks = [
          ['GET', '/products/' + f.product.id],
          ['PATCH', '/products/' + f.product.id, { name: 'HACKED' }],
          ['PATCH', '/purchase-accounts/' + f.account.id, { alias: 'HACKED' }],
          ['DELETE', '/purchase-accounts/' + f.account.id],
          ['GET', '/purchase-orders/' + f.purchase.id],
          ['PATCH', '/purchase-orders/' + f.purchase.id, { remark: 'HACKED' }],
          ['POST', '/purchase-orders/' + f.purchase.id + '/place', {}],
          ['POST', '/purchase-orders/' + f.purchase.id + '/cancel', {}],
          [
            'POST',
            '/purchase-orders/' + f.purchase.id + '/packages',
            { carrierCode: 'SF', trackingNo: 'HACKED', expectedItems: [] },
          ],
          ['GET', '/packages/' + f.pkg.id],
          ['GET', '/packages/' + f.pkg.id + '/receivable'],
          ['PATCH', '/packages/' + f.pkg.id, { trackingNo: 'HACKED' }],
          ['POST', '/packages/' + f.pkg.id + '/complete-receiving', {}],
          ['GET', '/receipts/' + f.receipt.id],
          [
            'POST',
            '/receipts',
            {
              packageId: f.pkg.id,
              clientOperationId: randomUUID(),
              items: [{ purchaseOrderItemId: f.purchase.items[0].id, receivedQty: 1 }],
            },
          ],
          ['GET', '/inventory/balances?productId=' + f.product.id],
          ['GET', '/inventory/movements?warehouseId=' + b.defaultWarehouse.id],
          ['GET', '/inventory/adjustments/' + f.adjustment.id],
          [
            'POST',
            '/inventory/adjustments',
            {
              warehouseId: b.defaultWarehouse.id,
              productId: f.product.id,
              quantityDelta: 1,
              reason: 'STOCKTAKE_GAIN',
              clientOperationId: randomUUID(),
            },
          ],
          ['GET', '/purchase-orders/' + f.purchase.id + '/returnable'],
          ['GET', '/purchase-returns/' + f.returned.id],
          ['PATCH', '/purchase-returns/' + f.returned.id, { remark: 'HACKED' }],
          [
            'POST',
            '/purchase-returns/' + f.returned.id + '/confirm',
            { clientOperationId: randomUUID() },
          ],
          ['POST', '/purchase-returns/' + f.returned.id + '/cancel', {}],
          [
            'POST',
            '/purchase-returns',
            {
              purchaseOrderId: f.purchase.id,
              reason: 'HACKED',
              returnDate: '2026-10-28',
              refundAmount: '0.00',
              items: [{ purchaseOrderItemId: f.purchase.items[0].id, quantity: 1 }],
            },
          ],
          ['GET', '/outbound-orders/' + f.outbound.id],
          ['PATCH', '/outbound-orders/' + f.outbound.id, { remark: 'HACKED' }],
          [
            'POST',
            '/outbound-orders/' + f.outbound.id + '/ship',
            { clientOperationId: randomUUID() },
          ],
          ['POST', '/outbound-orders/' + f.outbound.id + '/cancel', {}],
          ['GET', '/reports/overview?purchaseAccountId=' + f.account.id],
          ['GET', '/reports/table?dataset=inventory&warehouseId=' + b.defaultWarehouse.id],
          ['GET', '/reports/export?dataset=accounts&purchaseAccountId=' + f.account.id],
          ['GET', '/reports/export.csv?dataset=inventory&warehouseId=' + b.defaultWarehouse.id],
          ['PATCH', '/members/' + b.membership.id, { role: 'ADMIN' }],
        ];
        for (const [method, path, body] of attacks)
          await http.test(
            `${method} ${path.split('?')[0]} foreign resource is denied`,
            async () => {
              const response = await request(path, { method, body });
              // Inventory list filters intentionally return an empty page for foreign IDs,
              // matching the existing public contract; details and writes must deny access.
              if (
                path.startsWith('/inventory/balances?') ||
                path.startsWith('/inventory/movements?')
              ) {
                assert.equal(response.status, 200);
                const json = await response.json();
                assert.deepEqual(json.data, []);
                assert.equal(json.pagination.total, 0);
                return;
              }
              assert.ok(
                [403, 404].includes(response.status),
                `${method} ${path}: ${response.status}`,
              );
              const json = await response.json();
              assert.equal(json.data, undefined);
              assert.equal(JSON.stringify(json).includes('AUDIT-B'), false);
            },
          );
        const lists = [
          '/products',
          '/purchase-accounts',
          '/purchase-orders',
          '/packages',
          '/receipts',
          '/inventory/balances',
          '/inventory/movements',
          '/inventory/adjustments',
          '/purchase-returns',
          '/outbound-orders',
          '/reports/table?dataset=accounts',
          '/reports/table?dataset=inventory',
          '/reports/table?dataset=returns',
          '/reports/export?dataset=purchase-lines',
        ];
        await http.test(
          'all list/aggregate/export responses remain in A, and forged B workspace fails membership',
          async () => {
            for (const path of lists) {
              const data = await read(await request(path));
              assert.equal(JSON.stringify(data).includes('AUDIT-B'), false, path);
              await read(await request(path, { workspace: b }), 403);
              await read(await request(path, { actor: null }), 401);
            }
            await read(await request('/tenants/current', { workspace: b }), 403);
            const result = await read(await request('/reports/overview'));
            assert.equal(result.purchaseAmount, '100.00');
            assert.equal(result.inventoryQuantity, '9');
          },
        );
        await http.test(
          'body tenant injection rejected, roles remain distinct and revocation takes effect',
          async () => {
            await read(
              await post('/products', {
                tenantId: b.tenant.id,
                sku: 'INJECT',
                name: 'INJECT',
                unit: '件',
              }),
              400,
            );
            await read(
              await post(
                '/products',
                { sku: 'VIEWER', name: 'VIEWER', unit: '件' },
                { actor: 'viewer' },
              ),
              403,
            );
            await read(await request('/reports/overview', { actor: 'warehouse' }), 403);
            await read(await request('/reports/export?dataset=accounts', { actor: 'viewer' }), 403);
            const members = await read(await request('/members'));
            const viewer = members.find((m) => m.userId === users.viewer.user.id);
            await read(
              await request('/members/' + viewer.id, {
                method: 'PATCH',
                body: { isActive: false },
              }),
            );
            await read(await request('/inventory/balances', { actor: 'viewer' }), 403);
          },
        );
        await http.test(
          'all failed attacks leave B documents, stock, ledger and audit unchanged',
          async () => {
            const after = JSON.stringify(
              (
                await db.query(
                  `SELECT (SELECT jsonb_agg(t ORDER BY id) FROM products t WHERE tenant_id=$1) products,(SELECT jsonb_agg(t ORDER BY id) FROM stock_balances t WHERE tenant_id=$1) balances,(SELECT jsonb_agg(t ORDER BY id) FROM stock_movements t WHERE tenant_id=$1) movements,(SELECT jsonb_agg(t ORDER BY id) FROM purchase_orders t WHERE tenant_id=$1) orders,(SELECT jsonb_agg(t ORDER BY id) FROM audit_logs t WHERE tenant_id=$1) audits`,
                  [b.tenant.id],
                )
              ).rows,
            );
            assert.equal(after, before);
            assert.equal(aFacts.product.tenantId, tenant.tenant.id);
          },
        );
        await http.test(
          'production CORS does not trust forged Host/Origin; signup gate and IP spoofing protection',
          async (prod) => {
            const base = await startTestApi(prod, {
              env: {
                DATABASE_URL: databaseUrl,
                NODE_ENV: 'production',
                WEB_ORIGIN: 'https://caicang.example.test',
                TRUSTED_PROXIES: '',
                PUBLIC_REGISTRATION_ENABLED: 'false',
              },
            });
            const denied = await fetch(base + '/api/v1/health', {
              headers: { Host: 'evil.test', Origin: 'http://evil.test' },
            });
            assert.equal(denied.status, 403);
            assert.equal(
              (
                await fetch(base + '/api/v1/health', {
                  headers: { Origin: 'https://caicang.example.test' },
                })
              ).status,
              200,
            );
            assert.equal((await fetch(base + '/api/docs-json')).status, 404);
            const register = await fetch(base + '/api/v1/auth/register', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                email: 'closed@example.test',
                password: randomBytes(24).toString('hex') + 'Aa1!',
              }),
            });
            assert.equal(register.status, 403);
            for (let i = 0; i < 6; i++) {
              const response = await fetch(base + '/api/v1/auth/login', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-Forwarded-For': `198.51.100.${i + 1}`,
                },
                body: JSON.stringify({
                  email: 'absent@example.test',
                  password: 'WrongPassword!123',
                }),
              });
              assert.equal(response.status, i < 5 ? 401 : 429);
            }
          },
        );
      },
    );
  },
);
test('diagnostic logs expose only fixed exception metadata, never raw error messages or credentials', () => {
  const error = Object.assign(
    new Error('password=HIDDEN Token=HIDDEN postgresql://private:private@private/private'),
    { code: 'P1001' },
  );
  error.stack += '\n    at service (file:///app/dist/main.js:10:2)';
  const text = JSON.stringify(safeFailureMetadata(error));
  assert.ok(text.includes('P1001'));
  assert.ok(text.includes('main.js'));
  assert.equal(text.includes('HIDDEN'), false);
  assert.equal(text.includes('postgresql'), false);
  const lines = [],
    original = process.stdout.write;
  try {
    process.stdout.write = (line) => {
      lines.push(String(line));
      return true;
    };
    new SafeLogger().failure(randomUUID(), error);
  } finally {
    process.stdout.write = original;
  }
  assert.ok(lines.join('').includes('request_failed'));
  assert.equal(lines.join('').includes('HIDDEN'), false);
  assert.equal(
    safeFailureMetadata(
      Object.assign(new Error('secret'), { name: 'PASSWORD_SECRET', code: 'TOKEN_SECRET' }),
    ).name,
    'Error',
  );
});
