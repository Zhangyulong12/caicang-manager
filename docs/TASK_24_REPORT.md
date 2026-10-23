# 任务 24 报告 — 出库发货系统

## 一、结论

6 个出库端点全部上线，12 条要求逐条落实：

| # | 要求 | 怎么实现的 | 对应测试 |
| --- | --- | --- | --- |
| 1 | 库存不足禁止确认出库 | 事务内锁住余额行后比对 `quantity_on_hand`，不足抛 `409 OUT_OF_STOCK` 并列出每个缺货 SKU 的申请量与可用量；草稿不受此限制（草稿不动库存） | `acceptance: shipping 8 with only 7 on hand is rejected` |
| 2 | 出库使用数据库事务 | `TenantContextService.run(..., write: true)` 包住整个发货过程，`prisma.$transaction` 单事务 | 全部发货用例 |
| 3 | 并发出库不能造成负库存 | 余额行 `FOR UPDATE` 行锁 + 按 `product_id` 升序加锁；锁后重读数量再判断；数据库还有 `quantity_on_hand >= 0` 约束兜底 | `two concurrent shipments cannot both take the last units` |
| 4 | 重复确认不能重复扣减 | 同一 `clientOperationId` 同内容重放返回原单据（200），不再动库存、不再写流水与审计 | `the same operation id never deducts twice`、`two concurrent retries of one shipment deduct once` |
| 5 | `clientOperationId` 幂等 | `outbound_orders.(tenant_id, confirm_operation_id)` 唯一键 + `confirm_request_hash` 比对；同 ID 不同内容 409、挪用到别的单也 409 | 同上 |
| 6 | 移动平均成本快照 | 发货前 `total_cost / quantity_on_hand` 取四位小数，写入 `outbound_order_items.shipped_unit_cost` 与流水 `unit_cost`；发完整批直接清空成本池 | `shipping takes a moving average cost snapshot and clears the pool` |
| 7 | 生成库存变动流水 | 每行一条 `stock_movements`，`source_type='OUTBOUND'`、`source_item_id=出库明细行`，带操作前后数量与成本 | `acceptance: … one ledger line appears`、`the outbound ledger is visible through the inventory API` |
| 8 | 写入操作审计日志 | `OUTBOUND_DRAFT_CREATED` / `OUTBOUND_DRAFT_UPDATED` / `OUTBOUND_SHIPPED` / `OUTBOUND_CANCELLED`，含 requestId、单号、仓库、逐行成本快照与合计 | 每个用例都查了 `audit_logs` |
| 9 | 只有合法角色可以确认出库 | `@Roles('OWNER','ADMIN','WAREHOUSE')` + `@RequirePermissions('outbound:write')`；BUYER / VIEWER 一律 403 | `only warehouse-capable roles may create, ship or cancel` |
| 10 | 已出库订单不能再次确认发货 | 状态必须为 `DRAFT`，否则 `409 STATUS_CONFLICT`（换新操作号也一样） | `the same operation id never deducts twice` |
| 11 | 草稿取消不扣除库存 | 取消只改 `status`，不写流水、不动余额；审计里记 `stockTouched: false` | `cancelling a draft never touches stock` |
| 12 | 任一步骤失败时全部回滚 | 整个发货在一个事务里；测试用数据库触发器让写审计时抛异常，验证库存、流水、审计、单据状态全部回到发货前，且同一操作号可直接重试成功 | `a failure while writing the audit rolls the whole shipment back` |

**验收路径已按题目数字跑通**：当前库存 10 件 → 发货 3 件 → 剩 7 件（账面 129.5000，均价 18.5000）→ 再发 8 件 → `409 OUT_OF_STOCK`（明确给出"要 8 只有 7"）→ 库存仍是 7 件、单据仍是 `DRAFT`、流水与审计都没有新增。

## 二、端点

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| POST | `/api/v1/outbound-orders` | `outbound:write` | 创建草稿（201），不碰库存 |
| GET | `/api/v1/outbound-orders` | `products:read` | 分页列表，支持仓库 / 状态 / 商品 / 创建日期 / 单号·运单号·收件人搜索 |
| GET | `/api/v1/outbound-orders/{id}` | `products:read` | 详情（含成本快照与实时可出库量） |
| PATCH | `/api/v1/outbound-orders/{id}` | `outbound:write` | 修改草稿，`items` 整单替换 |
| POST | `/api/v1/outbound-orders/{id}/ship` | `outbound:write` | 确认发货，首次 201 / 幂等重放 200 |
| POST | `/api/v1/outbound-orders/{id}/cancel` | `outbound:write` | 取消草稿，200 |

字段完全覆盖任务要求：出库单号 `outboundNo`、仓库、商品 SKU、数量、收件人 `customerName`、联系电话 `customerPhone`、收件地址 `customerAddress`、快递公司 `carrierCode`、发货运单号 `trackingNo`、备注 `remark`。这些都是既有表 `outbound_orders` / `outbound_order_items` 的列，本任务**没有新增迁移**。

## 三、发货事务为什么能同时满足 3 / 4 / 12

顺序是设计过的，不是随手写的：

```
① 按 confirm_operation_id 查重（幂等快路径，不锁表）
② SELECT … FROM outbound_orders … FOR UPDATE      ← 同一张单的并发请求在这里排队
③ 拿到锁后再查一次操作号                          ← 排队期间别人可能已经提交
④ 校验状态 DRAFT、明细非空、收件人/电话/地址齐全
⑤ 按 product_id 升序：INSERT … ON CONFLICT DO NOTHING + SELECT … FOR UPDATE
⑥ 所有行都校验完才写                              ← 缺货一次性报全，避免写到一半才失败
⑦ 逐行：算单价快照 → 改余额与成本池 → 回写明细快照 → 写流水
⑧ 单据置 SHIPPED + 确认字段 + 物流信息
⑨ 写审计
```

- **为什么能防超卖**：⑤ 的 `FOR UPDATE` 让并发的第二个事务卡住，等它拿到锁时读到的是 10-6=4，于是 6 > 4 直接判缺货。没有任何"先读后写"的窗口。
- **为什么不会死锁**：⑤ 按 `product_id` 排序加锁，两张都发 A、B 的单加锁顺序一致。
- **为什么能回滚**：⑦⑧⑨ 全在一个事务里，任何一步抛异常整体回滚，包括已经改过的余额行。
- **为什么重复确认不重复扣**：①③ 两层查重 + 数据库唯一键 `(tenant_id, confirm_operation_id)` 兜底；第二次请求走重放分支，连流水都不会多一条。

并发不靠"重试到成功"，也不靠 `UPDATE ... WHERE quantity >= n` 的乐观写法（那种写法在成本计算上没法保证前后一致）。

## 四、成本快照口径

```
发货前：10 件 / 160.0000  → 均价 16.0000
发 3 件：costDelta = -(16.0000 × 3) = -48.0000
发货后：7 件 / 112.0000   → 均价仍是 16.0000，快照留在明细行上
```

- **发完整批时 `costDelta = -total_cost`**，直接把成本池清零，避免"数量 0 却还剩 0.0001 成本"的尾差。
- 如果四舍五入让扣减额略微超过成本池，成本池夹到 0，保证 `total_cost >= 0` 约束不被打破（`ck_stock_movements_8` 要求 `total_cost_before + cost_delta = total_cost_after`，所以写进流水的 `cost_delta` 用的是夹取后的实际差值）。
- 快照写在 `outbound_order_items.shipped_unit_cost`，之后库存均价再变也不会回溯改它——这正是"快照"的意义。

## 五、测试

| 命令 | 结果 |
| --- | --- |
| `pnpm test:outbound` | **16 通过 / 0 失败 / 0 跳过**（一次性 PostgreSQL + 真实 API） |
| `pnpm test:inventory` | **13 通过 / 0 失败 / 0 跳过**（出库改为调真实接口） |
| `pnpm test`（全仓） | **569 通过 / 0 失败 / 0 跳过**（6 分 19 秒） |
| `pnpm typecheck` / `lint` / `format:check` | 全部通过，0 warning |

`scripts/outbound.test.mjs`（`pnpm test:outbound`）在一次性 PostgreSQL 库 + 真实 API 进程上跑，**16 通过 / 0 失败 / 0 跳过**，覆盖：

1. **草稿**：单号格式、状态、金额 0、成本快照为 null、`availableQuantity` 实时；建草稿后库存分毫未动、流水 0 条、审计 1 条。同时拒绝空明细、数量 0、重复商品、缺仓库、非法电话、以及夹带 `totalCost` 的请求。
2. **PATCH**：替换明细（旧行删除而不是叠加）、改收件人、空 body 422、不存在 404、已取消再改 409。
3. **验收路径**：10 → 发 3 → 7；流水 `-3`、`10→7`、成本 `185.0000→129.5000`、来源行 ID 对得上；审计里 `totalCost 55.5000`、`unitCost 18.5000`。
4. **超发拒绝**：发 8 时 `409 OUT_OF_STOCK`，`details.shortages` 精确到"要 8 只有 7"；库存、流水、审计都没变，单据仍是 `DRAFT`。
5. **幂等**：同操作号重放 200 且库存不变、流水仍 1 条、审计仍 1 条；同号改内容 409 `IDEMPOTENCY_CONFLICT`；换号重发 409 `STATUS_CONFLICT`；已发货再 PATCH / 取消都 409；操作号挪用给另一张单也 409。
6. **并发超卖**：两张单各发 6，库存 10 → 一个 201、一个 `OUT_OF_STOCK`（可用量 4），最终库存 4，全表没有负库存行。
7. **并发重复**：同一操作号两个请求同时打同一张单 → 一个 201、一个 200，库存只扣一次，流水一条。
8. **取消**：状态变 `CANCELLED`、库存不变、流水不变、审计 1 条；重复取消 200 且 `cancelled=false` 不再写审计；取消后再发 409。
9. **权限**：BUYER / VIEWER 建单、发货、取消全部 403；WAREHOUSE 建单 + ADMIN 发货成功且 `shippedByName` 正确；VIEWER 能读列表与详情但 `remark` 为 null；匿名 401；跨商家 404。
10. **回滚**：审计触发器抛异常 → 500，库存/流水/审计/单据状态全部回滚，同一操作号重试成功。
11. **账本与库存视图**：`/inventory/movements` 能看到 `OUTBOUND` 那笔（`sourceNo`=出库单号、`sourceDocumentId`=出库单 ID、`unitCost`=快照、`direction=OUT`）；`/inventory/balances` 数量与均价同步；余额=流水数量合计、成本池=成本变动合计、每条流水 `before+delta=after`。
12. **列表**：总数、排序、状态/仓库/商品/日期/单号/运单号筛选、反向日期 422、非法状态 400、跨商家空数组。
13. **OpenAPI**：四个路径的方法集合正好是 `get+post` / `get+patch` / `post` / `post`；创建请求体字段正好是 8 个（夹带派生字段会被 whitelist 拒绝）；不存在 `/stock-balances`、`/stock-movements`。

### 顺带修正的旧测试

- `scripts/smoke.test.mjs` 原来断言 `/outbound-orders` **404**（"出库仍是计划中的端点"），现在路由存在，改为断言匿名访问 401（列表与详情两条）。
- `scripts/inventory.test.mjs` 原来用一段手写 SQL 模拟出库（写单 + 扣余额 + 写流水），现在改成**调真实出库接口发货 8 件**，验证查询侧读到的就是发货事务写下的账。

## 六、文件

新增：

| 文件 | 作用 |
| --- | --- |
| `apps/api/src/modules/outbound/outbound.controller.ts` | 6 个端点、角色与权限注解、201/200 语义 |
| `apps/api/src/modules/outbound/outbound.service.ts` | 草稿/修改/发货事务/取消/列表/详情 |
| `apps/api/src/modules/outbound/outbound.dto.ts` | 请求与响应 DTO、校验规则、OpenAPI 模型 |
| `apps/api/src/modules/outbound/outbound.module.ts` | 模块注册 |
| `scripts/outbound.test.mjs` | 16 项集成测试 |
| `docs/OUTBOUND.md` | 端点、事务顺序、成本口径、错误码、核对 SQL |
| `docs/TASK_24_REPORT.md` | 本报告 |

修改：

| 文件 | 改动 |
| --- | --- |
| `packages/api-contract/src/index.ts` | `OUTBOUND_STATUSES`、`OutboundStatus`、`OutboundItemData`、`OutboundOrderData` |
| `apps/api/src/app.module.ts` | 注册 `OutboundOrdersModule` |
| `scripts/smoke.test.mjs` | `/outbound-orders*` 由 404 改为 401 |
| `scripts/inventory.test.mjs` | 模拟出库改为真实接口出库 |
| `package.json` | 新增 `test:outbound`，纳入 `test` |
| `README.md`、`CHANGELOG.md`、`docs/CODEX_TASKS.md`、`docs/API_SPEC.md`、`docs/INVENTORY.md` | 同步出库说明 |

无新依赖、无新表、无迁移（`outbound_orders` / `outbound_order_items` 在建库时已存在，含 `status IN ('DRAFT','SHIPPED','CANCELLED')` 与"已发货必须带齐确认字段"的约束）。

## 七、未验证与风险

- **没有 Web / App 出库页面**：本任务只交付 API。手机端首页的"扫码出库"入口仍是置灰的占位，管理后台也没有出库单页面——两者都需要后续任务。
- **没有部分发货 / 拆分包裹**：一张单要么全发要么不发；需要分批就建多张单。
- **没有退货与逆向出库**：发错货目前只能通过后续盘点调整（`POST /inventory/adjustments` 仍未实现）纠正。
- **`availableQuantity` 是提示值**：它在发货事务外读取，页面拿它做展示，真正的判定在事务内的行锁之后，所以极短时间内的并发可能让页面先乐观后报错——这是正确权衡（页面不能为了展示去锁库存行）。
- **未做压测**：并发用例只验证"两张单同时发"和"同一请求同时重试"，没有做过 50/100 并发的排队时长测试。行锁在极端热点商品上会让请求串行，属于预期行为，但吞吐上限未知。
- **物流信息没有强校验**：`trackingNo` 只按字符串存（最多 128 字符、拒绝控制字符），没有校验快递公司编码是否在允许列表内，也不做运单号格式校验。
