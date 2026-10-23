# 任务 23 报告 — Web 库存管理页面

## 一、结论

7 个页面全部上线，数据全部来自真实接口，页面只查询、不改库存：

| # | 要求 | 路由 | 实现 |
| --- | --- | --- | --- |
| 1 | 库存总览 | `/inventory` | 现存合计、账面总成本、均价、待入库、最近入库时间四张卡片 + 分仓明细 + 最近 5 笔流水 |
| 2 | 商品库存列表 | `/inventory/balances` | 要求的 8 列齐全，支持搜索 / 仓库 / 日期区间 / 分页 |
| 3 | SKU 库存详情 | `/inventory/sku/:productId` | 分仓余额 + 全部流水 + 合计卡片 |
| 4 | 库存变动流水 | `/inventory/movements` | 时间、类型、数量、操作前后、来源单据、操作人，可按类型/仓库/日期筛选 |
| 5 | 入库记录列表 | `/receipts` | 入库单号、采购单、运单、仓库、件数、金额、操作人、备注 |
| 6 | 入库记录详情 | `/receipts/:id` | 单据信息 + 逐 SKU 明细（数量、到岸单价、行金额）+ 备注 |
| 7 | 待入库采购商品查询 | `/inventory/pending` | 采购行粒度：订购 / 已入库 / 待入库 / 单价 / 待入库金额 |

- 验收路径在测试里跑通：**通过真实 `POST /receipts` 入库 20 件 → 库存列表显示 20 件（930.0000 / 均价 46.5000）→ 总览、流水、入库记录、SKU 详情全部读到同一笔数据**。
- `pnpm test:web-inventory` **12 通过 / 0 失败 / 0 跳过**；`pnpm test:inventory` **13 通过 / 0 失败 / 0 跳过**；`pnpm test` 全仓 **553 通过 / 0 失败 / 0 跳过**；typecheck / lint / format:check 通过。
- 页面与客户端**没有任何写请求**，也不出现 `stock_balances` / `stock_movements`，库存只能由手机端收货改变。

## 二、先补后端：页面需要的字段原来没有

任务 22 的接口够"查库存"，但不够"做页面"。这一轮补的都是只读字段和只读查询，没有任何写入口：

| 补充 | 为什么必须 |
| --- | --- |
| `balances.lastReceivedAt` | 要求列表显示"最近入库时间"，原来只有 `updatedAt`（库存行变动时间，出库也会变），语义不对 |
| `GET /inventory/summary` | 总览要"合计"，分页列表算不出全量合计；现在由数据库直接聚合，并返回 `generatedAt` 证明是实时数据 |
| `GET /inventory/pending` | 待入库页要按采购行展示单号、平台、采购日期、单价与待入库金额，`balances` 只按仓库+商品聚合，拿不到这些 |
| `movements.sourceDocumentId` | 流水里的来源单据要能点开；`sourceId` 是来源**行** ID，直接拿去查入库单会 404 |
| `receipts?from=&to=` | 入库记录要按日期筛选；原来只有 `packageId` / `purchaseOrderId` / `search` |

`/inventory/*` 仍然只有 GET。测试里对这四个路径的 POST/PUT/PATCH/DELETE 断言 404，并检查 OpenAPI 只有 `get`（任务 22 的用例继续有效，新增端点也纳入同一套检查）。

## 三、页面上怎么保证"不是假数据"

1. **只走 API**：每个页面都通过 `api/inventory.ts` / `api/receipts.ts` 发请求，没有内联数组、没有 `Math.random`、没有 `mock/demo` 字样（测试用正则守）。
2. **不自己算库存**：数量、金额、均价、待入库金额都是接口字段，前端只做千分位与货币格式化（`formatQuantity` / `formatMoney` / `formatUnitCost`）。
3. **空态说实话**：没有数据时显示"还没有库存；手机扫码验收后这里会出现真实数量"，而不是塞几行示例。
4. **数据时间可见**：总览卡片右下角显示服务端 `generatedAt`，刷新会变。

## 四、7 个页面的细节

### 4.1 库存总览

四张卡片：现存件数（附覆盖商品数 / 仓库数）、库存账面总成本（附均价）、采购待入库、最近一次入库（附数据时间）。
下面左右两栏：左「分仓库存」（仓库、商品数、现存、账面成本、待入库、最近入库），右「最近库存变动」（最新 5 笔，含类型、数量与来源单号）。两栏都有"查看全部"的跳转。

### 4.2 商品库存列表

列与要求逐项对应：商品名称（副标题规格或单位）、SKU（副标题条码）、仓库、当前数量（单位作副标题）、平均成本、库存总成本、待入库数量、最近入库时间。数量为 0 时灰色、待入库大于 0 时琥珀色。行点击进 SKU 详情。
筛选：搜索 / 仓库 / 变动日期区间（`updatedFrom`、`updatedTo`）；日期反向时前端提示并阻止提交。分页 10/20/50/100。

### 4.3 SKU 库存详情

顶部商品信息 + 刷新；四张卡片（合计现存、合计账面成本含均价、待入库合计、最近入库）；分仓余额表带状态标签（有库存 / 待入库 / 无库存）；下方是该商品全部流水，可翻页。
该商品既无库存也无待入库时，显示空态并提供返回按钮，不会报错。

### 4.4 库存变动流水

时间、类型（验收入库 / 出库发货 / 库存调整）、商品（跳 SKU 详情）、仓库、数量变动（正绿负红）、操作前、操作后、单位成本、来源单据（入库单号可点开详情）、操作人、备注。
筛选：搜索 / 类型 / 仓库 / 日期区间。

### 4.5 待入库采购商品

一条采购明细一行，只列 `PLACED` / `PARTIAL_RECEIVED` 且剩余大于 0 的行。采购单号可点进采购单详情，副标题是平台与采购状态；订购 / 已入库 / 待入库三个数字都由服务端给出；待入库金额 = 待入库数量 × 单价（服务端算好）。
底部"共 N 条 · 本页待入库 X 件 / ¥Y"，明确是本页合计。

### 4.6 入库记录列表 / 4.7 详情

列表行与单号都可点开详情；搜索支持入库单号、采购单号、运单号（前导零原样传入，`000783456123` 在测试里断言过）；日期区间作用于 `received_at`。
详情展示单号、时间、仓库、操作人、采购单与运单，四张卡片（件数、金额、采购单、承运商），逐 SKU 明细（数量、单位、到岸单价、行金额）与备注；明细行可以跳到对应商品的库存详情。VIEWER 看得到单据但备注被服务端隐藏。

## 五、实际执行的检查

| 命令 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过（api / admin-web / mobile / 两个 packages） |
| `pnpm lint` | 通过，0 warning |
| `pnpm format:check` | 通过 |
| `pnpm --filter @caicang/admin-web build` | 成功，7 个页面各自产出独立 chunk |
| `pnpm test:inventory` | **13 通过 / 0 失败** |
| `pnpm test:web-inventory` | **12 通过 / 0 失败** |
| `pnpm test`（全仓） | **553 通过 / 0 失败 / 0 跳过**（6 分 03 秒） |

### `scripts/web-inventory.test.mjs` 覆盖

它不是点 DOM，而是把页面真正使用的客户端代码（`api/client.ts`、`api/inventory.ts`、`api/receipts.ts`、`api/inventory-format.ts`）编译出来，配真实 PostgreSQL 与真实 API 跑一遍页面会发出的请求：

1. **路由与只读**：7 个路由存在、导航项去掉 `soon` 并按 `products:read` / `packages:read` 判定；7 个 `.vue` 里没有 `method: 'POST/PUT/PATCH/DELETE'`、没有 `stock_balances`/`stock_movements`、没有 mock/demo；两个客户端模块同样只有 GET。
2. **列表**：入库 20 件后 `balances` 返回 20、930.0000、均价 46.5000、`lastReceivedAt` 等于入库单的 `receivedAt`、条码前导零保留；格式化函数输出 `20` / `¥930.00` / `46.5000`。
3. **筛选与分页**：搜索、SKU、条码、仓库、`updatedFrom`（今天 1 行、未来 0 行）、`pageSize=1` 两页不重复；页码 0 在前端就被拦下不发请求。
4. **总览**：商品数 2、仓库数 1、现存 20、成本 930.0000、均价 46.5000、待入库 10、`generatedAt` 是当前时间。
5. **SKU 详情**：`productId` 过滤后，充电器一行同时有现货 20 与待入库 6；数据线只有待入库、`lastReceivedAt` 为 null、状态标签"待入库"。
6. **流水**：只有 1 条 RECEIPT，`0 → 20`、来源单号、`sourceDocumentId` 可跳详情、操作人；类型 / 仓库 / 日期筛选；反向区间 422。
7. **待入库**：2 行，充电器 6 件 × 47.00 = 282.0000，收完的那张单不再出现；搜索单号得到 2 行、搜"编织线"1 行。
8. **入库记录**：列表 1 条、运单前导零、件数 20、金额与接口一致、日期筛选有效、按运单号搜得到；详情逐 SKU 与备注；随机 ID 详情 404。
9. **隔离与只读角色**：另一商家 balances / summary / pending 全空；VIEWER 能看 2 行库存、1 条流水、1 张入库单，但详情里备注为 null。
10. **构建产物**：`dist/assets/*.js` 里包含「库存总览」「商品库存列表」「待入库采购商品」「入库记录」。

## 六、新增与修改文件

新增：

| 文件 | 作用 |
| --- | --- |
| `apps/admin-web/src/views/InventoryOverviewView.vue` | 库存总览 |
| `apps/admin-web/src/views/InventoryBalancesView.vue` | 商品库存列表 |
| `apps/admin-web/src/views/InventorySkuView.vue` | SKU 库存详情 |
| `apps/admin-web/src/views/InventoryMovementsView.vue` | 库存变动流水 |
| `apps/admin-web/src/views/InventoryPendingView.vue` | 待入库采购商品 |
| `apps/admin-web/src/views/ReceiptsView.vue` | 入库记录列表 |
| `apps/admin-web/src/views/ReceiptDetailView.vue` | 入库记录详情 |
| `apps/admin-web/src/components/InventoryTabs.vue` | 库存子导航 |
| `apps/admin-web/src/api/inventory.ts` | 库存查询客户端（只 GET，含分页参数校验） |
| `apps/admin-web/src/api/receipts.ts` | 入库单查询客户端 + 采购状态/平台名称 |
| `apps/admin-web/src/api/inventory-format.ts` | 数量/金额/成本/日期格式化、类型与状态映射 |
| `apps/admin-web/src/composables/inventory.ts` | `useInventory` / `useReceipts`（带会话快照校验） |
| `apps/admin-web/src/inventory.css` | 子导航、指标卡、库存数值配色 |
| `scripts/web-inventory.test.mjs` | 真实 API + 构建产物 + 静态只读检查 |
| `docs/WEB_INVENTORY.md` | 页面说明与手工验收步骤 |
| `docs/TASK_23_REPORT.md` | 本报告 |

修改：

| 文件 | 改动 |
| --- | --- |
| `apps/api/src/modules/inventory/inventory.service.ts` | `lastReceivedAt`（`last_receipt` CTE）、`summary()`、`pending()`、`sourceDocumentId` |
| `apps/api/src/modules/inventory/inventory.controller.ts` | 新增 `GET /inventory/summary`、`GET /inventory/pending` |
| `apps/api/src/modules/inventory/inventory.dto.ts` | 待入库查询参数、总览/分仓/待入库响应模型、`lastReceivedAt`、`sourceDocumentId` |
| `apps/api/src/modules/receipts/receipt.dto.ts` | 入库单列表增加 `from` / `to` |
| `apps/api/src/modules/receipts/receipts.service.ts` | 入库时间区间筛选（含反向区间 422） |
| `packages/api-contract/src/index.ts` | `InventorySummaryData`、`InventoryWarehouseSummaryData`、`InventoryPendingData`、`InventoryBalanceData.lastReceivedAt`、`InventoryMovementData.sourceDocumentId` |
| `apps/admin-web/src/router/index.ts` / `policy.ts` | 7 条路由、`inventoryPath`/`receiptPath` 权限判定、`safeRedirect` |
| `apps/admin-web/src/layouts/MainLayout.vue` | 库存图标改为 `Coin`、子页面保持父项高亮 |
| `apps/admin-web/src/main.ts` | 注册 `ElDatePicker`、引入 `inventory.css` |
| `scripts/inventory.test.mjs` | 补 lastReceivedAt / 总览 / 待入库 / 来源单据头 / 入库单日期筛选断言 |
| `package.json` | 新增 `test:web-inventory`，纳入 `test` 与 `test:web` |
| `docs/INVENTORY.md`、`README.md`、`CHANGELOG.md`、`docs/CODEX_TASKS.md` | 同步接口与页面说明 |

无新依赖、无新表、无迁移。

## 七、未验证与风险

- **没有做浏览器端 E2E**（没有 Playwright）。页面渲染由 `vue-tsc` + 生产构建 + 构建产物文案断言覆盖，交互（点击行跳转、日期控件）靠人工验收。要真正防回归，后续值得引入 Playwright 跑 7 个页面的冒烟。
- **真机 → Web 的验收未在真实账号环境手工走一遍**：测试里用 `POST /receipts` 模拟了"手机扫码入库"，数据链路与真实手机端完全一致（同一个接口、同一张入库单），但 Android 真机接收货仍需按 `docs/MOBILE_APP.md` 手工验收。
- **日期筛选按 UTC 比较**：页面传给服务端的是 `YYYY-MM-DD`，服务端按 UTC 当天首尾处理；中国时区用户在北京时间 08:00 之前查"今天"可能少看到几小时的数据。要彻底解决需要把仓库时区纳入商家配置，本任务没有做。
- **待入库金额用采购单价**：不含运费与折扣分摊（到岸成本在入库时才确定），所以待入库金额是"预计采购额"而不是"预计入库成本"。
- **总览分仓明细不分页**：仓库数量极少（一般 1–5 个），一次全量；如果将来出现几十个仓库需要加分页或折叠。
- **库存页仍是纯查询**：出库、盘点、库存调整都没有入口，出库 API 也尚未实现（阶段 06 剩余部分）。
