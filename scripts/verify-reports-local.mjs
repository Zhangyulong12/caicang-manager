// Explicit, additive local acceptance fixture. Never deletes or updates existing business data.
// Credentials and document IDs are saved only under ignored test-results/.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
const base = 'http://127.0.0.1:3000/api/v1',
  marker = randomUUID().slice(0, 8);
let token = '',
  tenant;
async function call(path, body, method = body === undefined ? 'GET' : 'POST') {
  const r = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(tenant ? { 'X-Tenant-Id': tenant.tenant.id } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = await r.json();
  assert.ok(r.ok, `${path}: ${r.status} ${json.error?.code}`);
  return json.data;
}
const email = `task33-${marker}@acceptance.example.test`,
  password = randomBytes(24).toString('hex') + 'Aa1!';
await call('/auth/register', { email, password });
token = (await call('/auth/login', { email, password })).accessToken;
tenant = await call('/tenants', { name: '任务33采购对账验收-' + marker });
const a = await call('/purchase-accounts', { platform: 'TAOBAO', alias: '淘宝主账号' }),
  b = await call('/purchase-accounts', { platform: 'JD', alias: '京东采购号' });
const p = await call('/products', {
    sku: 'R33-CHARGER',
    articleNo: 'CHARGER',
    name: '验收充电器',
    unit: '件',
  }),
  c = await call('/products', {
    sku: 'R33-CABLE',
    articleNo: 'CABLE',
    name: '验收数据线',
    unit: '条',
  });
const today = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());
async function purchase(account, items, freightAmount = '0.00') {
  const draft = await call('/purchase-orders', {
    warehouseId: tenant.defaultWarehouse.id,
    platform: account.platform,
    purchaseAccountId: account.id,
    purchaseDate: today,
    freightAmount,
    platformOrderNo: 'R33-' + marker + '-' + account.platform,
    recipient: { name: '统计隔离验收', phone: '13800000000', address: '仅测试，不实际配送' },
    items: items.map(([product, quantity, unitPrice, discountAmount = '0.00']) => ({
      productId: product.id,
      quantity,
      unitPrice,
      discountAmount,
    })),
  });
  return call('/purchase-orders/' + draft.id + '/place', {});
}
const taobao = await purchase(
    a,
    [
      [p, 10, '18.50', '5.00'],
      [c, 4, '5.00'],
    ],
    '10.00',
  ),
  jd = await purchase(b, [[p, 2, '20.00']]);
async function receive(order, quantities) {
  const pkg = await call('/purchase-orders/' + order.id + '/packages', {
    carrierCode: 'SF',
    trackingNo: 'R33-' + randomUUID(),
    expectedItems: order.items.map((i) => ({
      purchaseOrderItemId: i.id,
      expectedQuantity: i.quantity,
    })),
  });
  return call('/receipts', {
    packageId: pkg.id,
    clientOperationId: randomUUID(),
    items: order.items.map((i, n) => ({ purchaseOrderItemId: i.id, receivedQty: quantities[n] })),
  });
}
const receipt = await receive(taobao, [5, 2]);
await receive(jd, [2]);
const outbound = await call('/outbound-orders', {
  warehouseId: tenant.defaultWarehouse.id,
  customerName: '统计验收',
  customerPhone: '13800000000',
  customerAddress: '仅测试，不实际配送',
  items: [{ productId: p.id, quantity: 2 }],
});
await call('/outbound-orders/' + outbound.id + '/ship', { clientOperationId: randomUUID() });
const returned = await call('/purchase-returns', {
  purchaseOrderId: taobao.id,
  returnDate: today,
  reason: '统计隔离验收',
  refundAmount: '17.00',
  items: [{ purchaseOrderItemId: taobao.items[0].id, quantity: 1 }],
});
await call('/purchase-returns/' + returned.id + '/confirm', { clientOperationId: randomUUID() });
const summary = await call('/reports/overview');
assert.equal(summary.purchaseAmount, '250.00');
assert.equal(summary.pendingAmount, '105.0000');
assert.equal(summary.inventoryCost, '87.3571');
assert.equal(summary.outboundCost, '38.4286');
assert.equal(summary.returnRefundAmount, '17.00');
const csv = await call('/reports/export?dataset=accounts');
await mkdir('test-results/task33', { recursive: true });
await writeFile(
  'test-results/task33/local-acceptance-private.json',
  JSON.stringify(
    { email, password, tenant, taobao, jd, receipt, outbound, returned, summary },
    null,
    2,
  ),
);
await writeFile('test-results/task33/accounts.csv', csv.csv, 'utf8');
console.log(
  JSON.stringify(
    {
      workspace: tenant.tenant.name,
      tenantId: tenant.tenant.id,
      summary,
      privateCredentials: 'test-results/task33/local-acceptance-private.json',
    },
    null,
    2,
  ),
);
