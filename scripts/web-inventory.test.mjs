/**
 * Task 23 — Web 库存页面：真实 API + 生产构建产物。
 *
 * 这里不点 DOM，而是把页面真正使用的客户端代码（api/inventory.ts、api/receipts.ts）
 * 编译出来，用真实 PostgreSQL + 真实 Nest API 跑一遍页面会发出的请求：
 * 手机扫码入库 → 库存列表/总览/流水/待入库/入库记录/详情 全部能读到同一笔真实数据。
 * 另外对 7 个 .vue 做静态检查：只读、列名齐全、数据来自 API。
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';
import ts from 'typescript';
import { startTestApi } from './api-test-server.mjs';

const output = new URL('../apps/admin-web/.test-build/inventory/', import.meta.url);
await mkdir(output, { recursive: true });
for (const file of ['client', 'inventory', 'receipts', 'inventory-format']) {
  const source = await readFile(
    new URL(`../apps/admin-web/src/api/${file}.ts`, import.meta.url),
    'utf8',
  );
  const compiled = ts
    .transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
    })
    .outputText.replace(/(['"])\.\/(client|inventory)\1/g, "'./$2.mjs'");
  await writeFile(new URL(file + '.mjs', output), compiled);
}
const { createApiClient, ApiFailure } = await import(new URL('client.mjs', output));
const { createInventory } = await import(new URL('inventory.mjs', output));
const { createReceipts } = await import(new URL('receipts.mjs', output));
const {
  formatDate,
  formatMoney,
  formatQuantity,
  formatUnitCost,
  movementLabel,
  movementTone,
  pageSummary,
  rangeProblem,
  stockState,
} = await import(new URL('inventory-format.mjs', output));

const { Client } = createRequire(new URL('../apps/api/package.json', import.meta.url))('pg');
const runFile = promisify(execFile);
loadEnvFile(new URL('../.env', import.meta.url));
const memory = () => {
  const values = new Map();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
};
const view = (name) =>
  readFile(new URL(`../apps/admin-web/src/views/${name}`, import.meta.url), 'utf8');
const apiSource = (name) =>
  readFile(new URL(`../apps/admin-web/src/api/${name}`, import.meta.url), 'utf8');

test(
  'Web inventory pages read real stock, ledger, receipts and pending lines',
  { timeout: 240000 },
  async (t) => {
    const source = new URL(process.env.DATABASE_URL);
    assert.equal(source.pathname, '/caicang');
    assert.ok(['localhost', '127.0.0.1'].includes(source.hostname));
    const name = 'caicang_test_' + randomUUID().replaceAll('-', '');
    const url = new URL(source);
    url.pathname = '/' + name;
    const admin = new Client({ connectionString: source.toString() }),
      db = new Client({ connectionString: url.toString() });
    let created = false,
      connected = false,
      counter = 0,
      logs = '';
    try {
      await admin.connect();
      await admin.query(`CREATE DATABASE "${name}"`);
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

      await t.test('the seven pages are routed and read-only', async () => {
        const router = await readFile(
          new URL('../apps/admin-web/src/router/index.ts', import.meta.url),
          'utf8',
        );
        const policy = await readFile(
          new URL('../apps/admin-web/src/router/policy.ts', import.meta.url),
          'utf8',
        );
        for (const chunk of [
          "path: 'inventory/balances'",
          "path: 'inventory/movements'",
          "path: 'inventory/pending'",
          "path: 'inventory/sku/:productId'",
          "path: 'receipts/:id'",
          'InventoryOverviewView.vue',
          'ReceiptsView.vue',
        ])
          assert.ok(router.includes(chunk), '路由缺少 ' + chunk);
        // 导航项已上线（不再带 soon），并按查询权限显示
        const inventoryEntry = policy.slice(policy.indexOf("path: '/inventory'"));
        assert.ok(inventoryEntry.includes("permission: 'products:read'"));
        assert.equal(
          /path: '\/inventory'[\s\S]{0,200}?soon: true/.test(policy),
          false,
          '库存管理不应再是"待开放"',
        );
        assert.ok(
          policy.includes("permission: 'packages:read'") && policy.includes('inventoryPath'),
          '库存/入库页面必须有权限判定',
        );

        const pages = {
          'InventoryOverviewView.vue': ['库存总览', '/inventory/balances', 'api.summary()'],
          'InventoryBalancesView.vue': [
            '商品库存列表',
            '商品名称',
            'SKU',
            '仓库',
            '当前数量',
            '平均成本',
            '库存总成本',
            '待入库数量',
            '最近入库时间',
            'api.balances(',
          ],
          'InventorySkuView.vue': ['SKU 库存详情', 'api.balances(', 'api.movements('],
          'InventoryMovementsView.vue': ['库存变动流水', '操作前', '操作后', '来源单据', '操作人'],
          'InventoryPendingView.vue': ['待入库采购商品', 'api.pending(', '待入库金额'],
          'ReceiptsView.vue': ['入库记录', 'api.list(', '入库件数'],
          'ReceiptDetailView.vue': ['入库记录详情', 'api.detail(', '到岸单价'],
        };
        for (const [file, chunks] of Object.entries(pages)) {
          const text = await view(file);
          for (const chunk of chunks) assert.ok(text.includes(chunk), file + ' 缺少 ' + chunk);
          // 库存页面只负责查询：不允许出现任何写请求
          for (const verb of ['POST', 'PUT', 'PATCH', 'DELETE']) {
            assert.equal(
              new RegExp(`method:\\s*['"]${verb}['"]`).test(text),
              false,
              file + ' 不应出现 ' + verb,
            );
          }
          assert.equal(
            /stock_balances|stock_movements|UPDATE\s+stock/i.test(text),
            false,
            file + ' 不应直接读写库存表',
          );
          // 没有固定演示数字：不允许出现 Math.random 或 mock/demo 数据
          assert.equal(/Math\.random|mockData|demoData|示例数据/i.test(text), false, file);
        }
        // 客户端同样只有 GET
        const inventoryClient = await apiSource('inventory.ts');
        const receiptsClient = await apiSource('receipts.ts');
        for (const text of [inventoryClient, receiptsClient]) {
          assert.equal(/method:\s*['"](POST|PUT|PATCH|DELETE)['"]/.test(text), false);
        }
        for (const path of [
          '/inventory/summary',
          '/inventory/balances',
          '/inventory/movements',
          '/inventory/pending',
        ])
          assert.ok(inventoryClient.includes(path), '库存客户端缺少 ' + path);
      });

      await t.test('real API feeds every inventory page', async (http) => {
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
        const clients = {};
        const make = () =>
          createApiClient({
            baseUrl: base + '/api/v1',
            storage: memory(),
            lock: (work) => work(),
            fetcher: (input, init) =>
              fetch(input, {
                ...init,
                headers: { ...init.headers, 'X-Forwarded-For': `198.20.6.${++counter % 250}` },
              }),
          });
        for (const actor of ['owner', 'viewer']) {
          const client = make();
          const credentials = {
            email: actor + '@inventory-ui.example.test',
            password: 'InventoryUi!2026',
          };
          await client.register(credentials);
          clients[actor] = { client, account: await client.login(credentials) };
        }
        const owner = clients.owner.client;
        const tenant = (
          await owner.request('/tenants', { method: 'POST', body: { name: '库存页面 A' } })
        ).data;
        await owner.request('/members', {
          tenantId: tenant.tenant.id,
          method: 'POST',
          body: { email: clients.viewer.account.email, role: 'VIEWER' },
        });
        const other = (
          await owner.request('/tenants', { method: 'POST', body: { name: '库存页面 B' } })
        ).data;
        const scope = async (record, tenantId) => {
          const current = (await record.client.request('/tenants/current', { tenantId })).data;
          return {
            userId: record.account.id,
            sessionKey: record.client.sync().sessionKey,
            tenantId,
            permissions: current.permissions,
          };
        };
        let scopeA = await scope(clients.owner, tenant.tenant.id);
        const api = createInventory(owner, () => scopeA);
        const receipts = createReceipts(owner, () => scopeA);

        const charger = (
          await owner.request('/products', {
            tenantId: scopeA.tenantId,
            method: 'POST',
            body: {
              name: '65W 氮化镓充电器',
              sku: 'GA-65W',
              unit: '件',
              barcode: '06912345000017',
              referencePurchasePrice: '45.00',
            },
          })
        ).data;
        const cable = (
          await owner.request('/products', {
            tenantId: scopeA.tenantId,
            method: 'POST',
            body: { name: '2 米编织线', sku: 'CABLE-2M', unit: '条' },
          })
        ).data;
        async function draftOrder(items) {
          const draft = (
            await owner.request('/purchase-orders', {
              tenantId: scopeA.tenantId,
              method: 'POST',
              body: {
                warehouseId: tenant.defaultWarehouse.id,
                platform: 'TAOBAO',
                purchaseDate: '2026-10-23',
                recipient: { name: '页面验收', phone: '13800000000', address: '虚构地址' },
                items,
              },
            })
          ).data;
          return (
            await owner.request('/purchase-orders/' + draft.id + '/place', {
              tenantId: scopeA.tenantId,
              method: 'POST',
              body: {},
            })
          ).data;
        }
        // 第一张单：收 20 件，模拟"手机扫码入库"走真实事务
        const placed = await draftOrder([
          { productId: charger.id, quantity: 20, unitPrice: '46.50' },
        ]);
        const line = placed.items[0].id;
        const pkg = (
          await owner.request('/purchase-orders/' + placed.id + '/packages', {
            tenantId: scopeA.tenantId,
            method: 'POST',
            body: {
              carrierCode: 'ZTO',
              trackingNo: '000783456123',
              expectedItems: [{ purchaseOrderItemId: line, expectedQuantity: 20 }],
            },
          })
        ).data;
        const receipt = (
          await owner.request('/receipts', {
            tenantId: scopeA.tenantId,
            method: 'POST',
            body: {
              packageId: pkg.id,
              clientOperationId: randomUUID(),
              items: [{ purchaseOrderItemId: line, receivedQty: 20 }],
              remark: '手机端确认，整箱完好',
            },
          })
        ).data;
        // 第二张单：6 件充电器 + 4 条线，保持待入库
        const pendingOrder = await draftOrder([
          { productId: charger.id, quantity: 6, unitPrice: '47.00' },
          { productId: cable.id, quantity: 4, unitPrice: '8.50' },
        ]);

        await http.test('库存列表：扫码入库 20 件后页面能查到这 20 件', async () => {
          const result = await api.balances({ page: 1, pageSize: 20 });
          assert.equal(result.pagination.total, 2, '充电器（现货 + 待入库）与数据线（只有待入库）');
          const row = result.data.find((item) => item.sku === 'GA-65W' && item.quantityOnHand > 0);
          assert.equal(row.quantityOnHand, 20);
          assert.equal(row.totalCost, '930.0000', '20 × 46.50');
          assert.equal(row.averageCost, '46.5000');
          assert.equal(row.pendingInboundQuantity, 6, '另一张单还有 6 件在路上');
          assert.equal(row.warehouseName, tenant.defaultWarehouse.name);
          assert.equal(row.barcode, '06912345000017');
          assert.equal(row.lastReceivedAt, receipt.receivedAt, '最近入库时间来自真实入库单');
          // 展示层不再自己算数
          assert.equal(formatQuantity(row.quantityOnHand), '20');
          assert.equal(formatMoney(row.totalCost), '¥930.00');
          assert.equal(formatUnitCost(row.averageCost), '46.5000');
          assert.equal(stockState(row).label, '有库存');
        });

        await http.test('搜索、仓库与日期筛选和分页都会带到服务端', async () => {
          assert.equal(
            (await api.balances({ page: 1, pageSize: 20, search: '编织' })).pagination.total,
            1,
          );
          assert.equal(
            (await api.balances({ page: 1, pageSize: 20, sku: 'GA-65W' })).pagination.total,
            1,
          );
          assert.equal(
            (await api.balances({ page: 1, pageSize: 20, barcode: '06912345000017' })).pagination
              .total,
            1,
          );
          assert.equal(
            (await api.balances({ page: 1, pageSize: 20, warehouseId: tenant.defaultWarehouse.id }))
              .pagination.total,
            2,
          );
          const today = new Date().toISOString().slice(0, 10);
          assert.equal(
            (await api.balances({ page: 1, pageSize: 20, updatedFrom: today })).pagination.total,
            1,
            '只有真正产生余额的商品带 updated_at',
          );
          const future = new Date(Date.now() + 48 * 3600_000).toISOString().slice(0, 10);
          assert.equal(
            (await api.balances({ page: 1, pageSize: 20, updatedFrom: future })).pagination.total,
            0,
          );
          const firstPage = await api.balances({ page: 1, pageSize: 1 });
          assert.equal(firstPage.data.length, 1);
          const secondPage = await api.balances({ page: 2, pageSize: 1 });
          assert.equal(secondPage.data.length, 1);
          assert.notEqual(
            firstPage.data[0].sku + firstPage.data[0].warehouseId,
            secondPage.data[0].sku + secondPage.data[0].warehouseId,
            '两页不能是同一行',
          );
          assert.equal(pageSummary(2, 2, 1), '共 2 条 · 第 2 / 2 页');
          await assert.rejects(
            api.balances({ page: 0, pageSize: 20 }),
            (error) => error instanceof ApiFailure && error.status === 400,
            '页码非法时前端就拦住，不发请求',
          );
        });

        await http.test('库存总览的合计与列表一致', async () => {
          const summary = await api.summary();
          assert.equal(summary.totalProducts, 2);
          assert.equal(summary.totalWarehouses, 1);
          assert.equal(summary.quantityOnHand, 20);
          assert.equal(summary.totalCost, '930.0000');
          assert.equal(summary.averageCost, '46.5000');
          assert.equal(summary.pendingInboundQuantity, 10);
          assert.equal(summary.lastReceivedAt, receipt.receivedAt);
          assert.equal(summary.warehouses.length, 1);
          assert.equal(summary.warehouses[0].skuCount, 2);
          assert.equal(summary.warehouses[0].pendingInboundQuantity, 10);
          assert.ok(Math.abs(new Date(summary.generatedAt).getTime() - Date.now()) < 60_000);
        });

        await http.test('SKU 详情页能按商品拿到分仓余额与流水', async () => {
          const balances = await api.balances({ page: 1, pageSize: 100, productId: charger.id });
          assert.equal(balances.pagination.total, 1, '同一仓库下现货与待入库合并成一行');
          const stocked = balances.data[0];
          assert.equal(stocked.quantityOnHand, 20);
          assert.equal(stocked.pendingInboundQuantity, 6);
          assert.equal(stocked.lastReceivedAt, receipt.receivedAt);
          assert.equal(stockState(stocked).label, '有库存');
          // 完全没入过库的商品只有待入库，没有余额行
          const pendingOnly = (await api.balances({ page: 1, pageSize: 100, productId: cable.id }))
            .data[0];
          assert.equal(pendingOnly.quantityOnHand, 0);
          assert.equal(pendingOnly.lastReceivedAt, null);
          assert.equal(stockState(pendingOnly).label, '待入库');

          const movements = await api.movements({ page: 1, pageSize: 20, productId: charger.id });
          assert.equal(movements.pagination.total, 1);
          const movement = movements.data[0];
          assert.equal(movement.type, 'RECEIPT');
          assert.equal(movement.quantityDelta, 20);
          assert.equal(movement.quantityBefore, 0);
          assert.equal(movement.quantityAfter, 20);
          assert.equal(movement.sourceNo, receipt.receiptNo);
          assert.equal(movement.sourceDocumentId, receipt.id, '流水能直接跳到入库单详情');
          assert.equal(movement.operatorName, receipt.receivedByName);
          assert.equal(movementLabel(movement.type), '验收入库');
          assert.equal(movementTone(movement.type), 'success');
        });

        await http.test('流水页支持类型、仓库与日期筛选', async () => {
          assert.equal((await api.movements({ page: 1, pageSize: 20 })).pagination.total, 1);
          assert.equal(
            (await api.movements({ page: 1, pageSize: 20, type: 'RECEIPT' })).pagination.total,
            1,
          );
          assert.equal(
            (await api.movements({ page: 1, pageSize: 20, type: 'OUTBOUND' })).pagination.total,
            0,
          );
          const today = new Date().toISOString().slice(0, 10);
          assert.equal(
            (await api.movements({ page: 1, pageSize: 20, from: today })).pagination.total,
            1,
          );
          assert.equal(
            (await api.movements({ page: 1, pageSize: 20, to: today })).pagination.total,
            1,
          );
          const future = new Date(Date.now() + 48 * 3600_000).toISOString().slice(0, 10);
          assert.equal(
            (await api.movements({ page: 1, pageSize: 20, from: future })).pagination.total,
            0,
          );
          assert.equal(
            (
              await api.movements({
                page: 1,
                pageSize: 20,
                warehouseId: tenant.defaultWarehouse.id,
              })
            ).pagination.total,
            1,
          );
          // 反向区间：前端先提示，服务端也会拒
          assert.equal(rangeProblem('2026-10-24', '2026-10-22'), '开始日期不能晚于结束日期');
          assert.equal(rangeProblem('2026-10-22', '2026-10-24'), '');
          await assert.rejects(
            api.movements({ page: 1, pageSize: 20, from: future, to: today }),
            (error) => error instanceof ApiFailure && error.status === 422,
          );
        });

        await http.test('待入库页只看未收完的采购行', async () => {
          const result = await api.pending({ page: 1, pageSize: 20 });
          assert.equal(result.pagination.total, 2);
          const chargerLine = result.data.find((row) => row.sku === 'GA-65W');
          assert.equal(chargerLine.orderNo, pendingOrder.orderNo);
          assert.equal(chargerLine.orderedQuantity, 6);
          assert.equal(chargerLine.receivedQuantity, 0);
          assert.equal(chargerLine.pendingQuantity, 6);
          assert.equal(chargerLine.unitPrice, '47.00');
          assert.equal(chargerLine.pendingAmount, '282.0000');
          assert.equal(chargerLine.purchaseDate, '2026-10-23');
          assert.equal(formatDate(chargerLine.purchaseDate), '2026-10-23');
          assert.equal(
            result.data.some((row) => row.purchaseOrderId === placed.id),
            false,
            '收完的单不再待入库',
          );
          assert.equal(
            (await api.pending({ page: 1, pageSize: 20, search: pendingOrder.orderNo })).pagination
              .total,
            2,
          );
          assert.equal(
            (await api.pending({ page: 1, pageSize: 20, search: '编织线' })).pagination.total,
            1,
          );
          assert.equal(
            (await api.pending({ page: 1, pageSize: 20, sku: 'CABLE-2M' })).pagination.total,
            1,
          );
          assert.equal(
            (await api.pending({ page: 1, pageSize: 20, from: '2026-10-24' })).pagination.total,
            0,
          );
        });

        await http.test('入库记录列表与详情来自真实收货单', async () => {
          const list = await receipts.list({ page: 1, pageSize: 20 });
          assert.equal(list.pagination.total, 1);
          const row = list.data[0];
          assert.equal(row.receiptNo, receipt.receiptNo);
          assert.equal(row.purchaseOrderNo, placed.orderNo);
          assert.equal(row.trackingNo, '000783456123', '运单前导零保留');
          assert.equal(row.totalQuantity, 20);
          assert.equal(row.totalCost, receipt.totalCost);
          assert.equal(row.receivedByName, receipt.receivedByName);
          const today = new Date().toISOString().slice(0, 10);
          assert.equal(
            (await receipts.list({ page: 1, pageSize: 20, from: today })).pagination.total,
            1,
          );
          const future = new Date(Date.now() + 48 * 3600_000).toISOString().slice(0, 10);
          assert.equal(
            (await receipts.list({ page: 1, pageSize: 20, from: future })).pagination.total,
            0,
          );
          assert.equal(
            (await receipts.list({ page: 1, pageSize: 20, search: '000783456123' })).pagination
              .total,
            1,
          );
          const detail = await receipts.detail(receipt.id);
          assert.equal(detail.id, receipt.id);
          assert.equal(detail.items.length, 1);
          assert.equal(detail.items[0].sku, 'GA-65W');
          assert.equal(detail.items[0].quantity, 20);
          assert.equal(detail.items[0].landedUnitCost, '46.5000');
          assert.equal(detail.remark, '手机端确认，整箱完好');
          await assert.rejects(
            receipts.detail(randomUUID()),
            (error) => error instanceof ApiFailure && error.status === 404,
          );
        });

        await http.test('另一商家看不到任何库存，只读角色可以看', async () => {
          const otherScope = await scope(clients.owner, other.tenant.id);
          scopeA = otherScope;
          const otherApi = createInventory(owner, () => scopeA);
          assert.deepEqual((await otherApi.balances({ page: 1, pageSize: 20 })).data, []);
          assert.equal((await otherApi.summary()).totalProducts, 0);
          assert.equal((await otherApi.summary()).quantityOnHand, 0);
          assert.deepEqual((await otherApi.pending({ page: 1, pageSize: 20 })).data, []);

          const viewerScope = await scope(clients.viewer, tenant.tenant.id);
          scopeA = viewerScope;
          const viewerApi = createInventory(clients.viewer.client, () => scopeA);
          const viewerReceipts = createReceipts(clients.viewer.client, () => scopeA);
          assert.equal((await viewerApi.balances({ page: 1, pageSize: 20 })).pagination.total, 2);
          assert.equal((await viewerApi.movements({ page: 1, pageSize: 20 })).pagination.total, 1);
          assert.equal((await viewerReceipts.list({ page: 1, pageSize: 20 })).pagination.total, 1);
          // VIEWER 看得到单据但没有备注内容（服务端隐藏）
          assert.equal((await viewerReceipts.detail(receipt.id)).remark, null);
        });

        assert.equal(
          /unhandled|bootstrap_failed/i.test(logs),
          false,
          'API log: ' + logs.slice(-800),
        );
      });

      await t.test('production build ships the new pages', async () => {
        const root = new URL('../apps/admin-web/dist/assets/', import.meta.url);
        const files = (await readdir(root)).filter((file) => file.endsWith('.js'));
        assert.ok(files.length > 0, '构建产物没有 JS 文件');
        let bundle = '';
        for (const file of files) bundle += await readFile(new URL(file, root), 'utf8');
        for (const text of ['库存总览', '商品库存列表', '待入库采购商品', '入库记录'])
          assert.ok(bundle.includes(text), '构建产物缺少 ' + text);
      });
    } finally {
      if (connected) await db.end();
      if (created) {
        await admin.query(
          'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',
          [name],
        );
        await admin.query(`DROP DATABASE "${name}"`);
      }
      await admin.end().catch(() => undefined);
    }
  },
);
