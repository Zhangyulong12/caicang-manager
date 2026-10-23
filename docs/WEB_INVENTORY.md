# Web 库存页面（任务 23）

## 一、页面与入口

左侧导航「库存管理」「入库记录」两项在本任务上线（不再是「待开放」）。

| 页面 | 路由 | 权限 | 数据来源 |
| --- | --- | --- | --- |
| 库存总览 | `/inventory` | `products:read` | `GET /inventory/summary` + `GET /inventory/movements?pageSize=5` |
| 商品库存列表 | `/inventory/balances` | `products:read` | `GET /inventory/balances` |
| SKU 库存详情 | `/inventory/sku/:productId` | `products:read` | `GET /inventory/balances?productId=` + `GET /inventory/movements?productId=` |
| 库存变动流水 | `/inventory/movements` | `products:read` | `GET /inventory/movements` |
| 待入库采购商品 | `/inventory/pending` | `products:read` | `GET /inventory/pending` |
| 入库记录列表 | `/receipts` | `packages:read` | `GET /receipts` |
| 入库记录详情 | `/receipts/:id` | `packages:read` | `GET /receipts/{id}` |

「库存管理」下四个页面共用一条子导航（`InventoryTabs.vue`），互相跳转不丢当前仓库上下文（筛选是页面本地的，切页即重置）。

## 二、库存列表显示什么

`/inventory/balances` 的表格列与任务要求一一对应：

| 列 | 字段 | 说明 |
| --- | --- | --- |
| 商品名称 | `name` + `specification`/`unit` | 规格缺失时显示单位 |
| SKU | `sku` + `barcode` | 条码为「无条码」时说明未登记 |
| 仓库 | `warehouseName` | |
| 当前数量 | `quantityOnHand` | 0 显示为灰色，避免误读成"有货" |
| 平均成本 | `averageCost` | 服务端算好的移动加权平均，四位小数 |
| 库存总成本 | `totalCost` | `¥` 千分位两位展示 |
| 待入库数量 | `pendingInboundQuantity` | 大于 0 时用琥珀色 |
| 最近入库时间 | `lastReceivedAt` | 来自 `receipts.received_at` 的最大值；从未入库显示 `—` |

工具栏：搜索（SKU / 商品名称 / 条码子串）、仓库下拉、变动日期区间（作用于 `stock_balances.updated_at`）、刷新、清除筛选。分页 10/20/50/100，底部显示「共 N 条 · 第 x / y 页」。

点任意一行进入该商品的 SKU 详情。

## 三、SKU 库存详情

- 头部：商品名、SKU、规格、单位、条码；右上角刷新。
- 四张卡片：合计现存、合计账面成本（含均价）、待入库合计、最近入库时间（取所有仓库最晚一次）。
- 分仓余额表：仓库、状态（有库存 / 待入库 / 无库存）、现存、均价、账面成本、待入库、最近入库。
- 变动流水表：该商品全部流水，含时间、类型、仓库、数量变动、操作前→后、来源单据、操作人，可分页。

这一页用来回答"这个数是怎么变成现在这样的"：卡片看结果，流水看过程。

## 四、库存变动流水

列：时间、类型（验收入库/出库发货/库存调整）、商品（可点进 SKU 详情）、仓库、数量变动（正绿负红）、操作前、操作后、单位成本、来源单据（入库单可直接点进详情）、操作人。

筛选：搜索、类型、仓库、日期区间；`from > to` 前端先提示"开始日期不能晚于结束日期"并阻止提交，服务端还有 422 兜底。

底部备注展示入库备注 / 出库备注 / 盘点原因，作为来源单据的补充。

## 五、待入库采购商品

行级粒度：一条采购明细一行，只列状态为 `PLACED` / `PARTIAL_RECEIVED` 且**还有剩余**的采购行。

| 列 | 说明 |
| --- | --- |
| 采购单 | 单号可点进采购单详情，副标题是平台与采购状态 |
| 采购日期 | `purchase_date`（DATE） |
| 仓库 | 采购单指定仓库 |
| 商品 | 名称 + SKU |
| 订购 / 已入库 / 待入库 | 三个数量都由服务端给出，前端不自己减 |
| 采购单价 | 采购行单价 |
| 待入库金额 | 待入库数量 × 单价，服务端算好 |

底部除分页外还显示"本页待入库 N 件 / ¥X"，明确标注是**本页**合计，避免被当成全量。

筛选：搜索（采购单号 / 商品名 / SKU）、仓库、采购日期区间。

## 六、入库记录

列表：入库单号（可点开）、入库时间、采购单号、运单号、仓库、入库件数、入库金额、操作人、备注。

筛选：搜索（入库单号 / 采购单号 / 运单号）、入库日期区间。行点击与单号点击都进详情。

详情：入库单号、时间、仓库、操作人、采购单号与运单号、四张指标卡（本次入库件数、入库金额、采购单、承运商）、逐 SKU 明细（数量、单位、到岸单价、行金额）、备注。明细行可以跳到该商品的库存详情。

VIEWER 角色能看到单据，但备注由服务端隐藏（返回 `null`），页面显示"未填写"。

## 七、只读边界

- 7 个页面与两个客户端模块（`api/inventory.ts`、`api/receipts.ts`）**没有任何写请求**：客户端只发 GET，页面里没有 `method: 'POST'` 之类的东西，也不出现 `stock_balances` / `stock_movements` 字样。
- 页面不自己推算库存：数量、成本、待入库金额全部来自接口字段；前端只做千分位与货币格式化。
- 库存变化只能来自手机端扫码收货（`POST /receipts`），Web 端刷新即看到最新值。
- 测试 `scripts/web-inventory.test.mjs` 用正则守住以上三条。

## 八、怎么自己验证一遍

1. `pnpm db:up` → `pnpm prisma:migrate:deploy` → `pnpm start:api`，另开终端 `pnpm dev:web`。
2. 手机（或 `pnpm dev:mobile` 的 H5）对一张已下单的采购单扫码收货 20 件。
3. 电脑打开 http://localhost:5173/inventory → 现存件数 +20、最近入库时间为刚才那一刻；「商品库存」能看到该 SKU 的 20 件与均价；「变动流水」出现一条 `验收入库 +20 0→20`；「入库记录」出现该入库单，点进去核对明细。
4. 再开一张采购单不下单收货，「待入库采购」能看到剩余数量与金额。
