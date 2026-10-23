# 任务 22 报告 — 库存查询系统

## 一、结论

新增两个**只读**接口 `GET /inventory/balances` 与 `GET /inventory/movements`：余额行给出「现存数量 / 采购待入库 / 移动加权平均成本 / 账面总成本」，流水行给出「时间 / 类型 / 数量 / 操作前后库存 / 来源单据 / 操作人」，两者都按商家隔离、可按仓库/商品/SKU/条码/子串/时间筛选并分页。

- 10 项要求全部落地，本机 PostgreSQL 可用，`node --test scripts/inventory.test.mjs` **10 通过 / 0 失败 / 0 跳过**，是真实数据库上跑出来的数字。
- 验收路径已被测试覆盖：**入库 20 件 → 查询显示 20 件（总成本 370.0000、均价 18.5000）→ 出库 8 件 → 查询显示剩 12 件（总成本 222.0000）**，且流水链 0 → 20 → 12 首尾相接、数量合计等于当前余额。
- 库存数量全部来自 `stock_balances` 与 `stock_movements` 的真实查询，**没有写接口**：`/inventory/*` 只有 GET，POST/PUT/PATCH/DELETE 一律 404，OpenAPI 里也只有一个 `get`。测试会先读余额、再对四个写方法各打一次、最后确认余额未变。
- `typecheck` / `lint` / `format:check` 通过。

## 二、10 项要求的落地

| # | 要求 | 实现 | 位置 |
| --- | --- | --- | --- |
| 1 | 按商家、仓库、SKU 查询 | `X-Tenant-Id` + `TenantContextService.run` 强制商家隔离；`warehouseId`、`productId`、`sku`、`barcode`、`search` 可任意组合 | `inventory.service.ts` `commonFilter` |
| 2 | 商品现存数量 | `stock_balances.quantity_on_hand`，无余额行时 `COALESCE(...,0)` | `balanceWith` / `mapBalance` |
| 3 | 采购待入库数量 | 采购单状态为 `PLACED` / `PARTIAL_RECEIVED` 的明细行 `quantity - 已入库量`，按商品+仓库聚合 | `balanceWith` 的 `pending` CTE |
| 4 | 移动加权平均成本 | `平均成本 = stock_balances.total_cost / quantity_on_hand`，四位小数；数量为 0 时返回 `0.0000` | `mapBalance` |
| 5 | 库存账面总成本 | `stock_balances.total_cost`，四位小数字符串（避免浮点误差） | 同上 |
| 6 | 完整库存变动流水 | `GET /inventory/movements` 读不可变的 `stock_movements`，按时间倒序 | `movementFrom` |
| 7 | 流水字段齐全 | 时间 `occurredAt`、类型 `type`+`direction`、数量 `quantityDelta`、操作前后 `quantityBefore/After`、来源单据 `sourceNo`+`sourceId`+`sourceType`、操作人 `operatorId`+`operatorName` | `mapMovement` |
| 8 | 按商品、仓库、时间筛选 | 余额：`updatedFrom`/`updatedTo`；流水：`from`/`to` + `type`；日期只写 `YYYY-MM-DD` 时上界补到当天 23:59:59.999Z | `instant` / `assertRange` |
| 9 | 分页 | 复用仓库统一 `page`/`pageSize` 与 `PageResult`，`pagination.total` 是 `count(*)` 真实总数 | `offset` |
| 10 | 按 SKU 或条码查询 | `sku`/`barcode` 精确匹配（条码前导零、大小写都保留），另给 `search` 做 SKU/名称/条码的不区分大小写子串搜索 | `commonFilter` |

## 三、为什么这里不能有 CRUD

要求写明「不允许编写直接修改 stock_balances 的普通 CRUD 接口」。做法是把库存做成**纯读模型**：

```
业务动作（收货 / 出库 / 盘点）
        └── 一个数据库事务里：INSERT stock_movements（带 before/after）+ UPDATE stock_balances
                              ↑ 唯一的写入口，已有任务 17 的 POST /receipts

查询（本任务）
        └── SELECT ... FROM stock_balances / stock_movements   ← 只有读，没有任何写动词
```

三点保证：

1. `InventoryController` 只声明 `@Get`，没有 `@Post/@Patch/@Put/@Delete`；`@RequirePermissions('products:read')` 让只读角色（VIEWER）也能查。
2. 服务层通过 `TenantContextService.run(context, 'products:read', false, ...)` 进入，第三个参数 `write: false` 明确表示这是只读上下文。
3. 测试做双向封堵：对两个路径的 POST/PUT/PATCH/DELETE 断言 404，再读一次 `stock_balances` 确认数量没被改动，最后检查 `/api/docs-json` 中这两个 path 的方法列表**恰好等于 `['get']`**。将来谁加了一个写接口，这条断言会直接红。

## 四、数据口径

### 4.1 余额行的行集来源

余额不是"只列 `stock_balances` 有记录的行"。`keys` 用 `UNION` 把两类键合起来：

- `stock_balances` 里已有的（收过货、或出过库的）；
- `pending` 里出现的（**只有待入库、一件都还没到**的商品）。

所以"下单 6 件、货还在路上"的商品在仓库视图里是一条 `quantityOnHand = 0`、`pendingInboundQuantity = 6` 的行，而不是查不到。这一条对应验收里的"显示采购待入库数量"，也被测试单独断言（二仓两行、默认仓 1 行、总数 3）。

### 4.2 待入库不重复计算

`received` CTE 先按 `purchase_order_item_id` 汇总 `receipt_items.quantity`，再用 `GREATEST(poi.quantity - received, 0)` 夹到非负。部分收货 20 件中的 14 件，待入库就是 6 而不是 20；超收（理论上被 `POST /receipts` 拦住）也不会算出负数。

### 4.3 移动加权平均成本

成本池就是 `stock_balances.total_cost`：收货时把「实收数量 × 采购单价」加进去，出库时按当前均价扣减。因此

```
平均成本 = total_cost / quantity_on_hand
```

就是移动加权平均价，不需要在查询时重放整条流水。出库 8 件后 `total_cost` 从 370.0000 变 222.0000、`quantity_on_hand` 从 20 变 12，均价仍为 18.5000——测试断言的正是这个不变性。

金额一律走 `Prisma.Decimal`（precision 60、HALF_UP）并以四位小数字符串返回，不用 JS number 承载金额。

### 4.4 流水与来源单据

`movementFrom` 按 `source_type` 分别 LEFT JOIN 回三张单据表：

| `source_type` | 来源单号 | 备注来源 |
| --- | --- | --- |
| `RECEIPT` | `receipts.receipt_no` | `receipts.remark` |
| `OUTBOUND` | `outbound_orders.outbound_no` | `outbound_orders.remark` |
| `ADJUSTMENT` | 无（`null`） | `stock_adjustments.reason` |

`sourceId` 是来源**行** ID（`receipt_items.id` / `outbound_order_items.id` / `stock_adjustments.id`），能一路追到具体凭证。操作人 `JOIN users`，展示 `display_name`，为空时回落 `email`。

## 五、接口契约

### 5.1 `GET /api/v1/inventory/balances`

| 参数 | 说明 |
| --- | --- |
| `warehouseId` / `productId` | UUID，精确 |
| `sku` / `barcode` | 精确匹配，trim 后比较；条码不做数字转换 |
| `search` | SKU / 名称 / 条码的字面子串，ILIKE；`%`、`_`、`\` 已转义，搜 `%` 不会变成"全表" |
| `updatedFrom` / `updatedTo` | ISO 8601，作用在 `stock_balances.updated_at` |
| `page` / `pageSize` | 统一分页 |

响应 `data[]`：`warehouseId, warehouseName, productId, sku, barcode, name, specification, unit, quantityOnHand, pendingInboundQuantity, averageCost, totalCost, updatedAt`。

### 5.2 `GET /api/v1/inventory/movements`

| 参数 | 说明 |
| --- | --- |
| `warehouseId` / `productId` / `sku` / `barcode` / `search` | 同上 |
| `type` | `RECEIPT` / `OUTBOUND` / `ADJUSTMENT` |
| `from` / `to` | ISO 8601；只写日期时 `from` = 当天 00:00:00.000Z，`to` = 当天 23:59:59.999Z |
| `page` / `pageSize` | 统一分页，默认按 `created_at DESC, id DESC` |

响应 `data[]`：`id, occurredAt, type, direction, quantityDelta, quantityBefore, quantityAfter, costDelta, unitCost, totalCostBefore, totalCostAfter, warehouseId, warehouseName, productId, sku, productName, unit, sourceType, sourceNo, sourceId, note, operatorId, operatorName`。

`from > to` 返回 422 `BUSINESS_VALIDATION_FAILED`，`error.details.field = 'from'`（测试断言了这个字段，前端可以精确定位到哪个输入框）。

## 六、实际执行的检查

| 命令 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过（api / admin-web / mobile / 两个 packages） |
| `pnpm lint` | 通过，0 warning |
| `pnpm format:check` | 通过 |
| `pnpm test:inventory` | **10 通过 / 0 失败 / 0 跳过**（真实 PostgreSQL 16） |
| `pnpm test`（全仓） | **538 通过 / 0 失败 / 0 跳过**（6 分 28 秒） |

全仓跑第一遍时 `scripts/smoke.test.mjs` 有一条红：它把 `/inventory/balances` 当作"未来路由"断言 404。路由现在存在（匿名访问 401），说明这条断言本身过期了而不是接口有问题——已改为断言 `/inventory/balances`、`/inventory/movements` 匿名 401，`/outbound-orders` 保留 404。改完复跑全仓 538 通过。

`scripts/inventory.test.mjs` 每个用例都建一个一次性数据库（`caicang_test_<uuid>`），跑 migrations，起真实 API 进程，用真实 `fetch` 打接口，结束后 `DROP DATABASE`。8 个子用例：

1. **入库 20 → 显示 20**：`quantityOnHand = 20`、`pendingInboundQuantity = 0`（整单收完）、`totalCost = 370.0000`、`averageCost = 18.5000`、条码 `06912345678901` 前导零未丢。
2. **入库流水字段**：`type=RECEIPT`、`direction=IN`、`0 → 20`、`unitCost=18.5000`、`sourceNo` 等于服务端返回的入库单号、`sourceId` 等于入库单行 ID、`note` 等于收货备注、`operatorName` 等于操作人。
3. **待入库**：新开一张 6 件充电器 + 4 件数据线的采购单（未收货），二仓两行都出现，`quantityOnHand=0`、`averageCost=0.0000`、待入库分别为 6 和 4；总数从 1 变 3，默认仓的 20 件不受影响。
4. **筛选**：SKU（同 SKU 两仓库各一行）、条码（精确，少一位前导零查不到）、商品 ID、仓库、中文子串 `充电`、大小写不敏感 `charger`、组合筛选、无结果；分页 `pageSize=2` → 首页 2 行、次页 1 行、`total=3`；流水侧同参数复验。
5. **跨商家隔离**：另一个商家（新注册 + 新建商家）查余额、按 SKU 搜、按**别人的 productId** 查、查流水，**全部返回空数组**；同时商家 A 自己的 3 行仍在。
6. **出库 8 → 剩 12**：出库 API 还没实现（属于后续任务），测试用同一个事务完成"写 `outbound_orders`(SHIPPED) + 写 `outbound_order_items` + 扣 `stock_balances` + 写 `stock_movements`"，然后断言余额 12 / 成本 222.0000 / 均价 18.5000，流水变为 `OUTBOUND -8 20→12` 与 `RECEIPT +20 0→20` 两条，且**首尾相接**、`quantityDelta` 之和等于当前余额。
7. **时间与类型**：`from` 近期 2 条、`from` 未来 0 条、`to` 未来 2 条、`type=OUTBOUND` 1 条、`type=RECEIPT` 1 条、`to=<今天>` 按当天末尾算得到 2 条；反向区间 422 且 `details.field='from'`；`pageSize=1` 分页顺序与总数正确。
8. **只读角色 + 无写接口**：VIEWER 能读 3 行余额与 2 条流水；POST/PUT/PATCH/DELETE 对两个路径全 404；调用前后 `stock_balances.quantity_on_hand` 不变；OpenAPI 中两个 path 只允许 `get`。

## 七、新增与修改文件

新增：

| 文件 | 作用 |
| --- | --- |
| `apps/api/src/modules/inventory/inventory.controller.ts` | 两个 GET 端点，`products:read` 权限，无任何写动词 |
| `apps/api/src/modules/inventory/inventory.service.ts` | CTE 余额查询、流水查询、筛选、分页、Decimal 映射 |
| `apps/api/src/modules/inventory/inventory.dto.ts` | 查询参数校验（UUID / 长度 / 可打印字符 / ISO 时间）与 Swagger 响应模型 |
| `apps/api/src/modules/inventory/inventory.module.ts` | 模块注册 |
| `scripts/inventory.test.mjs` | 真实数据库集成测试（8 个子用例，含验收路径、隔离、账本一致性、无写接口） |
| `docs/INVENTORY.md` | 库存查询模块说明：端点、字段口径、错误、隔离、账本对账 SQL |
| `docs/TASK_22_REPORT.md` | 本报告 |

修改：

| 文件 | 改动 |
| --- | --- |
| `packages/api-contract/src/index.ts` | 新增 `STOCK_MOVEMENT_TYPES`、`StockMovementType`、`StockMovementDirection`、`InventoryBalanceData`、`InventoryMovementData` |
| `apps/api/src/app.module.ts` | 注册 `InventoryModule` |
| `package.json` | 新增 `test:inventory`，并把 `scripts/inventory.test.mjs` 纳入全仓 `test` |
| `scripts/smoke.test.mjs` | 原来断言 `/inventory/balances` 是 404（当时还是"未来路由"）；现在该路由存在且要求登录，改为断言 401，`/outbound-orders` 仍断言 404 |

无新依赖、无新表、无迁移。

## 八、未验证与风险

- **出库 API 尚不存在**：验收里的"出库之后"由测试用同一事务模拟（写单 + 扣余额 + 写流水），验证的是**查询侧**能正确反映剩余库存。真正的 `POST /outbounds` 属后续任务，届时它必须复用同一套"写流水 + 改余额"路径，否则账本会断链。
- **盘点（ADJUSTMENT）**：查询已支持该类型与 `stock_adjustments.reason` 作为备注，但目前没有创建盘点单的接口，所以测试数据里没有真实盘点流水。
- **移动加权平均价的边界**：全部库存出清后 `quantity_on_hand = 0`，均价按约定返回 `0.0000`（不保留历史均价）。若后续要做"零库存仍显示参考成本"，需要另存一列最近均价。
- **性能**：余额查询每次都会按商家聚合全部采购明细来算待入库。现有索引（`idx_po_item_po`、`receipt_items` 主键路径、`idx_movement_filter (tenant_id, warehouse_id, product_id, created_at DESC)`）够支撑当前规模，测试库数据下两个接口都是毫秒级，但**没有做压力测试**。若采购明细上到百万行，应把待入库改为增量维护（`stock_balances` 旁加 `pending_inbound` 列，由收货/取消订单时同步），否则每次翻页都要重算全量聚合。
- **前端未接入**：管理端与手机端的库存页面属后续任务，本任务只交付 API 与契约。手机端首页「库存查询」入口虽然已有 `products:read` 权限判断，但还没有 `url`，点击不会跳转。
- 时间筛选按 UTC 比较，页面若按本地时区展示需要自己换算边界（服务端只接受 ISO 8601 或纯日期）。
