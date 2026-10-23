/**
 * Task 25 — Web 出库页面：真实 API + 生产构建产物。
 *
 * 不点 DOM：把页面真正 import 的客户端模块（api/outbound.ts、api/inventory.ts）编译出来，
 * 配真实 PostgreSQL + 真实 Nest API，按页面会走的顺序跑一遍完整发货流程：
 * 查可用库存 → 存草稿 → 确认发货 → 库存减少 → 再发超量被拒且库存不变。
 * 另外对 4 个 .vue 做静态检查：字段齐全、不本地算库存、错误原样展示。
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

const output = new URL('../apps/admin-web/.test-build/outbound/', import.meta.url);
await mkdir(output, { recursive: true });
for (const file of ['client', 'inventory', 'outbound']) {
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
const outboundModule = await import(new URL('outbound.mjs', output));
const {
  blankOutbound,
  carrierName,
  createOutbound,
  lineShortage,
  outboundErrors,
  outboundFailureText,
  outboundForm,
  outboundLineFromBalance,
  outboundPayload,
  outboundStatusLabel,
  outboundStatusTone,
  recipientMissing,
  shipFingerprint,
  shortagesOf,
} = outboundModule;

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
const component = (name) =>
  readFile(new URL(`../apps/admin-web/src/components/${name}`, import.meta.url), 'utf8');
const apiSource = (name) =>
  readFile(new URL(`../apps/admin-web/src/api/${name}`, import.meta.url), 'utf8');

test(
  'Web outbound pages create a draft and ship it against real stock',
  { timeout: 300000 },
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

      await t.test(
        'the pages are routed, write only through the API, and never do stock math',
        async () => {
          const router = await readFile(
            new URL('../apps/admin-web/src/router/index.ts', import.meta.url),
            'utf8',
          );
          const policy = await readFile(
            new URL('../apps/admin-web/src/router/policy.ts', import.meta.url),
            'utf8',
          );
          for (const chunk of [
            "path: 'outbound/new'",
            "path: 'outbound/:id/edit'",
            "path: 'outbound/:id'",
            'OutboundView.vue',
            'OutboundFormView.vue',
            'OutboundDetailView.vue',
          ])
            assert.ok(router.includes(chunk), '路由缺少 ' + chunk);
          const entry = policy.slice(policy.indexOf("path: '/outbound'"));
          assert.ok(entry.includes("permission: 'products:read'"), '出库列表对所有角色可读');
          assert.equal(
            /path: '\/outbound'[\s\S]{0,220}?soon: true/.test(policy),
            false,
            '出库管理不应再是"待开放"',
          );
          assert.ok(policy.includes('outboundPath'), '出库页面必须有权限判定');
          assert.ok(
            /outboundPath\(path\)[\s\S]{0,180}?outbound:write/.test(policy),
            '新建/修改草稿需要 outbound:write',
          );

          const pages = {
            'OutboundView.vue': [
              '出库管理',
              '出库单号',
              '状态',
              '仓库',
              '收件人',
              '快递 / 运单号',
              'api.list(',
              '新建出库单',
              'outboundStatusNames',
            ],
            'OutboundFormView.vue': [
              '发货仓库',
              '商品明细',
              '可用库存',
              '发货数量',
              '收件人',
              '联系电话',
              '收件地址',
              '快递公司',
              '发货运单号',
              '备注',
              'api.create(',
              'api.update(',
              'refreshAvailability',
              'OutboundProductPicker',
            ],
            'OutboundDetailView.vue': [
              '确认发货',
              'api.ship(',
              'api.cancel(',
              'clientOperationId',
              'outboundFailureText',
              'serverError',
              '成本快照',
            ],
          };
          for (const [file, chunks] of Object.entries(pages)) {
            const text = await view(file);
            for (const chunk of chunks) assert.ok(text.includes(chunk), file + ' 缺少 ' + chunk);
            // 页面不能自己改库存：不写库存表、不出现任何自算余额
            assert.equal(
              /stock_balances|stock_movements|UPDATE\s+stock/i.test(text),
              false,
              file + ' 不应直接读写库存表',
            );
            assert.equal(
              /quantityOnHand\s*[-+*/]?=[^=]|totalCost\s*[-+*/]?=[^=]/.test(text),
              false,
              file + ' 不应在本地改写库存或成本',
            );
            assert.equal(/Math\.random|mockData|demoData|示例数据/i.test(text), false, file);
          }
          // 选品器只查库存余额，不落库
          const picker = await component('OutboundProductPicker.vue');
          for (const chunk of ['选择出库商品', 'api.balances(', '可用库存', 'warehouseId'])
            assert.ok(picker.includes(chunk), '选品器缺少 ' + chunk);
          assert.equal(/method:\s*['"](POST|PUT|PATCH|DELETE)['"]/.test(picker), false);

          // 客户端：写操作只打 /outbound-orders，库存模块仍然只有 GET
          const outboundClient = await apiSource('outbound.ts');
          for (const path of ['/outbound-orders?', "'/outbound-orders'", '/ship', '/cancel'])
            assert.ok(outboundClient.includes(path), '出库客户端缺少 ' + path);
          for (const verb of ['POST', 'PATCH']) {
            assert.ok(
              new RegExp(`method:\\s*['"]${verb}['"]`).test(outboundClient),
              '出库客户端应使用 ' + verb,
            );
          }
          const inventoryClient = await apiSource('inventory.ts');
          assert.equal(
            /method:\s*['"](POST|PUT|PATCH|DELETE)['"]/.test(inventoryClient),
            false,
            '库存客户端只能读',
          );
        },
      );

      await t.test('a real shipment is created, shipped and reflected in stock', async (http) => {
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
                headers: { ...init.headers, 'X-Forwarded-For': `198.20.7.${++counter % 250}` },
              }),
          });
        for (const actor of ['owner', 'viewer']) {
          const client = make();
          const credentials = {
            email: actor + '@outbound-ui.example.test',
            password: 'OutboundUi!2026',
          };
          await client.register(credentials);
          clients[actor] = { client, account: await client.login(credentials) };
        }
        const owner = clients.owner.client;
        const tenant = (
          await owner.request('/tenants', { method: 'POST', body: { name: '出库页面 A' } })
        ).data;
        await owner.request('/members', {
          tenantId: tenant.tenant.id,
          method: 'POST',
          body: { email: clients.viewer.account.email, role: 'VIEWER' },
        });
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
        const api = createOutbound(owner, () => scopeA);
        const inventory = createInventory(owner, () => scopeA);

        // 先备货：采购 10 件 → 包裹 → 验收入库，库存从真实收货事务来。
        const charger = (
          await owner.request('/products', {
            tenantId: scopeA.tenantId,
            method: 'POST',
            body: { name: '65W 氮化镓充电器', sku: 'GA-65W', unit: '件' },
          })
        ).data;
        const placed = (
          await owner.request('/purchase-orders', {
            tenantId: scopeA.tenantId,
            method: 'POST',
            body: {
              warehouseId: tenant.defaultWarehouse.id,
              platform: 'TAOBAO',
              purchaseDate: '2026-10-23',
              recipient: { name: '出库验收', phone: '13800000000', address: '虚构地址' },
              items: [{ productId: charger.id, quantity: 10, unitPrice: '20.00' }],
            },
          })
        ).data;
        await owner.request('/purchase-orders/' + placed.id + '/place', {
          tenantId: scopeA.tenantId,
          method: 'POST',
          body: {},
        });
        const line = placed.items[0].id;
        const pkg = (
          await owner.request('/purchase-orders/' + placed.id + '/packages', {
            tenantId: scopeA.tenantId,
            method: 'POST',
            body: {
              carrierCode: 'ZTO',
              trackingNo: '007700112233',
              expectedItems: [{ purchaseOrderItemId: line, expectedQuantity: 10 }],
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
              items: [{ purchaseOrderItemId: line, receivedQty: 10 }],
              remark: '待出库备货',
            },
          })
        ).data;

        const balanceOf = async () => {
          const result = await inventory.balances({
            page: 1,
            pageSize: 20,
            warehouseId: tenant.defaultWarehouse.id,
            productId: charger.id,
          });
          return result.data[0];
        };
        const stocked = await balanceOf();
        // 页面就是这么拿"可用库存"的：一份真实余额行，不是前端算的。
        assert.equal(stocked.quantityOnHand, 10);
        assert.equal(stocked.averageCost, '20.0000');

        let draft;
        await http.test('新建草稿：选商品与数量，草稿不动库存', async () => {
          const form = blankOutbound();
          form.warehouseId = tenant.defaultWarehouse.id;
          form.customerName = '张三';
          form.customerPhone = '13900000000';
          form.customerAddress = '上海市浦东新区世纪大道 100 号 8 楼';
          form.carrierCode = 'SF';
          form.trackingNo = 'SF0012345678901';
          form.remark = '客户要求工作日送达';
          const line = outboundLineFromBalance(stocked);
          line.quantity = '3';
          form.items = [line];
          assert.deepEqual(outboundErrors(form), {});
          assert.equal(lineShortage(line), false);
          assert.deepEqual(recipientMissing(form), []);
          assert.equal(outboundPayload(form).items[0].quantity, 3);

          draft = await api.create(outboundPayload(form));
          assert.equal(draft.status, 'DRAFT');
          assert.match(draft.outboundNo, /^OUT-/);
          assert.equal(draft.customerName, '张三');
          assert.equal(draft.carrierCode, 'SF');
          assert.equal(draft.trackingNo, 'SF0012345678901');
          assert.equal(draft.totalQuantity, 3);
          assert.equal(draft.items[0].sku, 'GA-65W');
          assert.equal(draft.items[0].availableQuantity, 10, '草稿里就能看到可用库存');
          assert.equal(draft.items[0].shippedUnitCost, null, '草稿没有成本快照');
          assert.equal(draft.shippedAt, null);
          // 草稿只是计划：库存仍是 10
          assert.equal((await balanceOf()).quantityOnHand, 10);
          // 详情页重新读一次也是草稿
          const detail = await api.detail(draft.id);
          assert.equal(detail.status, 'DRAFT');
          assert.equal(detail.remark, '客户要求工作日送达');
          // 页面表单回填能原样再提交
          assert.deepEqual(outboundPayload(outboundForm(detail)), outboundPayload(form));
        });

        await http.test('确认发货：库存 10 件发 3 件后剩 7 件', async () => {
          const shipped = await api.ship(draft.id, {
            clientOperationId: randomUUID(),
            carrierCode: 'SF',
            trackingNo: 'SF0012345678901',
          });
          assert.equal(shipped.status, 'SHIPPED');
          assert.equal(shipped.totalQuantity, 3);
          assert.equal(shipped.items[0].quantity, 3);
          assert.equal(shipped.items[0].shippedUnitCost, '20.0000', '移动平均成本快照');
          assert.equal(shipped.items[0].lineCost, '60.0000');
          assert.equal(shipped.totalCost, '60.0000');
          assert.ok(shipped.shippedAt);
          assert.ok(shipped.shippedByName.length > 0, '发货人由服务端记录');
          // 服务端扣减后的余额就是页面下一次读到的数字
          const after = await balanceOf();
          assert.equal(after.quantityOnHand, 7);
          assert.equal(after.totalCost, '140.0000');
          const detail = await api.detail(draft.id);
          assert.equal(detail.status, 'SHIPPED');
          assert.equal(detail.items[0].availableQuantity, 7);
          // 流水与审计是发货事务写的
          const movements = await inventory.movements({
            page: 1,
            pageSize: 20,
            type: 'OUTBOUND',
            productId: charger.id,
          });
          assert.equal(movements.pagination.total, 1);
          const movement = movements.data[0];
          assert.equal(movement.quantityDelta, -3);
          assert.equal(movement.quantityBefore, 10);
          assert.equal(movement.quantityAfter, 7);
          assert.equal(movement.sourceNo, draft.outboundNo);
          assert.equal(movement.sourceDocumentId, draft.id);
          assert.ok(receipt.receiptNo);
        });

        await http.test('库存不足：再发 8 件被拒，库存仍是 7 件', async () => {
          const form = blankOutbound();
          form.warehouseId = tenant.defaultWarehouse.id;
          form.customerName = '李四';
          form.customerPhone = '13700000000';
          form.customerAddress = '北京市朝阳区建国路 8 号';
          const row = outboundLineFromBalance(await balanceOf());
          row.quantity = '8';
          form.items = [row];
          assert.equal(lineShortage(row), true, '页面先提示超量');
          const tooMany = await api.create(outboundPayload(form));
          assert.equal(tooMany.status, 'DRAFT');

          let failure;
          await assert.rejects(
            api.ship(tooMany.id, { clientOperationId: randomUUID() }),
            (error) => {
              failure = error;
              return error instanceof ApiFailure;
            },
          );
          assert.equal(failure.status, 409);
          assert.equal(failure.code, 'OUT_OF_STOCK');
          // 页面把服务端原因原样拼出来：要多少、只有多少
          const message = outboundFailureText(failure);
          assert.match(message, /库存不足/);
          assert.match(message, /GA-65W 需要 8 件、可用 7 件/);
          const shortages = shortagesOf(failure);
          assert.equal(shortages.length, 1);
          assert.equal(shortages[0].requestedQuantity, 8);
          assert.equal(shortages[0].availableQuantity, 7);
          // 拒绝后一切不变：库存、单据状态、流水
          assert.equal((await balanceOf()).quantityOnHand, 7);
          const still = await api.detail(tooMany.id);
          assert.equal(still.status, 'DRAFT');
          assert.equal(still.items[0].shippedUnitCost, null);
          const movements = await inventory.movements({
            page: 1,
            pageSize: 20,
            type: 'OUTBOUND',
            productId: charger.id,
          });
          assert.equal(movements.pagination.total, 1, '被拒的发货没有写流水');
        });

        await http.test('重复确认与超量发货都不会二次扣减', async () => {
          const operationId = randomUUID();
          const form = blankOutbound();
          form.warehouseId = tenant.defaultWarehouse.id;
          form.customerName = '王五';
          form.customerPhone = '13600000000';
          form.customerAddress = '广州市天河区体育西路 1 号';
          const row = outboundLineFromBalance(await balanceOf());
          row.quantity = '2';
          form.items = [row];
          const order = await api.create(outboundPayload(form));
          const body = { clientOperationId: operationId, carrierCode: 'YTO' };
          const first = await api.ship(order.id, body);
          assert.equal(first.status, 'SHIPPED');
          assert.equal((await balanceOf()).quantityOnHand, 5);
          // 页面复用的操作号：同单同内容重放，返回原单据，不再扣减
          const replay = await api.ship(order.id, body);
          assert.equal(replay.status, 'SHIPPED');
          assert.equal(replay.id, first.id);
          assert.equal((await balanceOf()).quantityOnHand, 5, '重放没有二次扣减');
          // 换操作号再确认已发货的单：409，且仍是 5
          await assert.rejects(
            api.ship(order.id, { clientOperationId: randomUUID() }),
            (error) =>
              error instanceof ApiFailure &&
              error.status === 409 &&
              error.code === 'STATUS_CONFLICT',
          );
          assert.equal((await balanceOf()).quantityOnHand, 5);
          // 已发货的单不能在页面里再改
          await assert.rejects(
            api.update(order.id, outboundPayload(form)),
            (error) => error instanceof ApiFailure && error.status === 409,
          );
        });

        await http.test('取消草稿不扣库存，重复取消不报错', async () => {
          const before = (await balanceOf()).quantityOnHand;
          const form = blankOutbound();
          form.warehouseId = tenant.defaultWarehouse.id;
          const row = outboundLineFromBalance(await balanceOf());
          row.quantity = '1';
          form.items = [row];
          const draft = await api.create(outboundPayload(form));
          const first = await api.cancel(draft.id);
          assert.equal(first.cancelled, true);
          assert.equal(first.order.status, 'CANCELLED');
          assert.equal((await balanceOf()).quantityOnHand, before, '取消不动库存');
          const again = await api.cancel(draft.id);
          assert.equal(again.cancelled, false, '重复取消是幂等的');
          assert.equal((await balanceOf()).quantityOnHand, before);
          // 已取消的单不能发货
          await assert.rejects(
            api.ship(draft.id, { clientOperationId: randomUUID() }),
            (error) => error instanceof ApiFailure && error.status === 409,
          );
        });

        await http.test('列表筛选与状态展示来自服务端', async () => {
          const all = await api.list({ page: 1, pageSize: 20 });
          assert.ok(all.pagination.total >= 4);
          const shipped = await api.list({ page: 1, pageSize: 20, status: 'SHIPPED' });
          assert.ok(shipped.data.every((row) => row.status === 'SHIPPED'));
          assert.equal(
            (await api.list({ page: 1, pageSize: 20, status: 'CANCELLED' })).data.length >= 1,
            true,
          );
          assert.equal(
            (await api.list({ page: 1, pageSize: 20, search: draft.outboundNo })).pagination.total,
            1,
          );
          assert.equal(
            (await api.list({ page: 1, pageSize: 20, productId: charger.id })).pagination.total,
            all.pagination.total,
          );
          assert.equal(
            (
              await api.list({
                page: 1,
                pageSize: 20,
                warehouseId: tenant.defaultWarehouse.id,
              })
            ).pagination.total,
            all.pagination.total,
          );
          const today = new Date().toISOString().slice(0, 10);
          assert.ok((await api.list({ page: 1, pageSize: 20, from: today })).pagination.total > 0);
          const future = new Date(Date.now() + 48 * 3600_000).toISOString().slice(0, 10);
          assert.equal(
            (await api.list({ page: 1, pageSize: 20, from: future })).pagination.total,
            0,
          );
          assert.equal(outboundStatusLabel('DRAFT'), '待发货');
          assert.equal(outboundStatusLabel('SHIPPED'), '已发货');
          assert.equal(outboundStatusLabel('CANCELLED'), '已取消');
          assert.equal(outboundStatusTone('SHIPPED'), 'success');
          assert.equal(carrierName('SF'), '顺丰速运');
          assert.equal(carrierName(null), '未填写');
          await assert.rejects(
            api.list({ page: 0, pageSize: 20 }),
            (error) => error instanceof ApiFailure && error.status === 400,
            '页码非法时前端就拦住',
          );
        });

        await http.test('只读角色看不到写入口，服务端也拒绝', async () => {
          const viewerScope = await scope(clients.viewer, tenant.tenant.id);
          scopeA = viewerScope;
          const viewerApi = createOutbound(clients.viewer.client, () => scopeA);
          // 读：可以看列表，但备注被服务端隐藏
          assert.ok((await viewerApi.list({ page: 1, pageSize: 20 })).pagination.total >= 4);
          assert.equal((await viewerApi.detail(draft.id)).remark, null);
          const form = blankOutbound();
          form.warehouseId = tenant.defaultWarehouse.id;
          const row = outboundLineFromBalance(await balanceOf());
          form.items = [row];
          // 写：客户端以 scope 权限先挡（页面据此隐藏按钮），不发请求
          await assert.rejects(
            viewerApi.create(outboundPayload(form)),
            (error) => error instanceof ApiFailure && error.status === 403,
          );
          await assert.rejects(
            viewerApi.ship(draft.id, { clientOperationId: randomUUID() }),
            (error) => error instanceof ApiFailure && error.status === 403,
          );
          await assert.rejects(
            viewerApi.cancel(draft.id),
            (error) => error instanceof ApiFailure && error.status === 403,
          );
          // 服务端同样会拒：绕过客户端直接请求
          const forbidden = await clients.viewer.client
            .request('/outbound-orders/' + draft.id + '/ship', {
              tenantId: tenant.tenant.id,
              method: 'POST',
              body: { clientOperationId: randomUUID() },
            })
            .then(
              () => null,
              (error) => error,
            );
          assert.equal(forbidden.status, 403);
          scopeA = await scope(clients.owner, tenant.tenant.id);
        });

        await http.test('表单校验与幂等指纹在本地就挡住明显错误', async () => {
          const form = blankOutbound();
          form.warehouseId = tenant.defaultWarehouse.id;
          assert.ok(outboundErrors(form).items);
          const row = outboundLineFromBalance(stocked);
          row.quantity = '0';
          form.items = [row];
          assert.ok(outboundErrors(form)['items.0.quantity']);
          row.quantity = '1';
          form.items = [row, { ...row, key: 'dup' }];
          assert.ok(outboundErrors(form)['items.1.productId'], '同一 SKU 不能重复');
          form.items = [row];
          form.customerPhone = '不是电话';
          assert.ok(outboundErrors(form).customerPhone);
          form.customerPhone = '';
          form.customerName = '';
          assert.deepEqual(recipientMissing(form), ['收件人', '联系电话', '收件地址']);
          form.items = [];
          // 没有明细时服务端也会拒，页面提示更早
          await assert.rejects(
            api.create({ ...outboundPayload(form), items: [] }),
            (error) => error instanceof ApiFailure && error.status === 400,
          );
          // 指纹只跟"这次要发什么"有关：改了运单号就要换操作号
          const base = { carrierCode: 'SF', trackingNo: 'SF1' };
          assert.equal(
            shipFingerprint(draft.id, base),
            shipFingerprint(draft.id.toUpperCase(), base),
            '单号大小写不影响指纹',
          );
          assert.notEqual(
            shipFingerprint(draft.id, base),
            shipFingerprint(draft.id, { ...base, trackingNo: 'SF2' }),
          );
          assert.notEqual(shipFingerprint(draft.id, base), shipFingerprint(randomUUID(), base));
        });

        assert.equal(
          /unhandled|bootstrap_failed/i.test(logs),
          false,
          'API log: ' + logs.slice(-800),
        );
      });

      await t.test('production build ships the outbound pages', async () => {
        const root = new URL('../apps/admin-web/dist/assets/', import.meta.url);
        const files = (await readdir(root)).filter((file) => file.endsWith('.js'));
        assert.ok(files.length > 0, '构建产物没有 JS 文件');
        let bundle = '';
        for (const file of files) bundle += await readFile(new URL(file, root), 'utf8');
        for (const text of ['出库管理', '新建出库单', '确认发货', '客户收货信息'])
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
