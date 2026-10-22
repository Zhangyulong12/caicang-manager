# 任务 17 报告 — 核心验收入库事务

## 一、结论

`POST /api/v1/receipts`、`GET /api/v1/receipts`、`GET /api/v1/receipts/{id}` 已实现，并在真实 PostgreSQL 隔离库 + 真实 API 进程上验证。

用户验收口径已实测：**首次确认 6 件，库存增加 6 件；同一请求重发 10 次（另加 5 次并发重发），库存仍只增加 6 件，收货单、明细、流水、审计都只有 1 条。**

## 二、接口

| 方法与路径（统一前缀 /api/v1） | 成功 | 权限 |
| --- | --- | --- |
| POST /receipts | 201 首次 / 200 幂等重放，ReceiptData | OWNER/ADMIN/WAREHOUSE，`receiving:confirm` |
| GET /receipts | 200，分页 ReceiptData | 全角色，`packages:read` |
| GET /receipts/{id} | 200，ReceiptData | 全角色，`packages:read` |

请求体只有验收事实：

```json
{
  "packageId": "uuid",
  "clientOperationId": "uuid",
  "items": [{ "purchaseOrderItemId": "uuid", "receivedQty": 6 }],
  "remark": "外箱完好"
}
```

字段、错误码与示例见 [RECEIPTS.md](RECEIPTS.md)。

## 三、16 条要求的落地

| # | 要求 | 实现 | 验证 |
| --- | --- | --- | --- |
| 1 | 商家与仓管权限 | `@Roles('OWNER','ADMIN','WAREHOUSE')` + `receiving:confirm`，事务内再次解析 membership 与权限 | BUYER/VIEWER 403，WAREHOUSE 201 且 `receivedBy` 为仓管 |
| 2 | 采购单、包裹、SKU 归属 | 包裹按 `(tenant_id,id)` 查；采购单从包裹取得；采购行在 `(tenant_id, purchase_order_id)` 范围内加载 | 跨商家包裹 404；不属于该单的采购行 422 |
| 3 | 采购单可收货 | 仅 `PLACED`/`PARTIAL_RECEIVED`，否则 409 `STATUS_CONFLICT` | 已取消订单 409 |
| 4 | 累计不超采购数量 | `SUM(receipt_items.quantity)` 与采购数量用 BigInt 比较 | 超收 409 `RECEIPT_QTY_EXCEEDED`，返回实际可收量 |
| 5 | PostgreSQL 事务 | `TenantContextService.run(..., write=true)` 单个 `$transaction` | 多行请求第二行超收时，第一行不落库 |
| 6 | 行锁与唯一约束 | 商家 → 采购单 → 包裹 → 库存余额（按 `product_id`）FOR UPDATE；`(tenant_id, client_operation_id)` 与 `(tenant_id, source_type, source_item_id)` 唯一 | 并发抢同一采购数量只有一笔成功；并发重试只留一张单 |
| 7 | 入库单与明细 | `receipts` + `receipt_items`（成本快照 `landed_unit_cost`） | 明细返回 SKU/名称/单位/数量/成本 |
| 8 | 库存余额与移动加权成本 | `stock_balances.quantity_on_hand` / `total_cost` 累加，Decimal 精度 60，落库 4 位；平均价查询时推导 | 4×10 + 6×20 = 10 件 / 160.0000；再加两笔 5×30 = 20 件 / 460.0000 |
| 9 | 不可变流水 | `stock_movements` 记录前后数量/成本，`sourceType=RECEIPT`，数据库 CHECK 保证 `before + delta = after` | 全表校验 `before+delta<>after` 计数为 0；余额与流水合计一致 |
| 10 | 采购单与包裹状态 | 采购单按全行累计判定 `PARTIAL_RECEIVED`/`RECEIVED`；有计划的包裹收满自动 `RECEIVED` + `receivingClosedAt` | 6+4 后订单 `RECEIVED`，两箱均关闭 |
| 11 | 审计 | `audit_logs.action='RECEIPT_CONFIRMED'`，记录单号、包裹、采购单、状态与逐行数量/成本 | 首次入库审计 1 条，重放不增加 |
| 12 | 任一步失败全回滚 | 全部写入在同一事务，异常直接抛出 | 多行请求失败后收货单/明细/库存/流水均为 0 增量 |
| 13 | clientOperationId 幂等 | 唯一键 + `request_hash`；三层检查（进事务、取锁后、唯一键兜底） | 重发 10 次、并发 5 次均只加 6 件 |
| 14 | 同 ID 同请求返回原结果 | 返回首次 ReceiptData，HTTP 200 | id/单号/`receivedAt` 完全一致 |
| 15 | 同 ID 不同请求 409 | 摘要不同（含只改备注）抛 `IDEMPOTENCY_CONFLICT` | 改数量、改备注均 409，库存不变 |
| 16 | 禁止前端提交库存余额 | DTO 白名单 + 全局 `forbidNonWhitelisted`，多余字段 400 | 提交 `quantityOnHand`/`totalCost`/`warehouseId` 返回 400 `VALIDATION_ERROR` |

## 四、新增与修改文件

新增：

| 文件 | 作用 |
| --- | --- |
| `apps/api/src/modules/receipts/receipts.service.ts` | 验收入库事务、幂等、库存/成本、状态、审计、列表与详情 |
| `apps/api/src/modules/receipts/receipts.controller.ts` | 三个路由，201/200 动态状态码，角色与权限声明 |
| `apps/api/src/modules/receipts/receipt.dto.ts` | 请求/列表查询/Swagger 响应 DTO |
| `apps/api/src/modules/receipts/receipts.module.ts` | 模块注册 |
| `scripts/receipts.test.mjs` | 22 项真实 PostgreSQL 测试 |
| `docs/RECEIPTS.md` | 接口、幂等、锁序、成本与错误码 |
| `docs/TASK_17_REPORT.md` | 本报告 |

修改：

| 文件 | 改动 |
| --- | --- |
| `packages/api-contract/src/index.ts` | 新增 `ReceiptData`/`ReceiptItemData` |
| `apps/api/src/app.module.ts` | 注册 ReceiptsModule |
| `package.json` | 新增 `test:receipts`，并加入全仓 `test` |
| `scripts/packages.test.mjs` | 任务 14 的 OpenAPI 断言由"不存在 /receipts"改为"已文档化" |
| `scripts/smoke.test.mjs` | `/receipts` 由"未来路由 404"改为"未登录 401" |
| `docs/API_SPEC.md` | 重写入库小节，补列表/详情与错误码 |
| `docs/ARCHITECTURE.md`、`docs/CODEX_TASKS.md`、`docs/DECISIONS.md`（ADR-024） | 任务 17 架构、清单与决策记录 |
| `README.md`、`CHANGELOG.md`、`docs/PACKAGES.md` | 交付说明与入口 |

无新表、无迁移、无新依赖。

## 五、实际执行的测试

| 命令 | 结果 |
| --- | --- |
| `pnpm test:receipts` | **22 通过 / 0 失败**（多次复跑均通过） |
| `pnpm test`（全仓） | **477 通过 / 0 失败**，构建 API/Web/uni-app H5/共享包成功 |
| `pnpm typecheck` | 通过（api、admin-web、mobile、共享包） |
| `pnpm lint` | 通过，0 warning |
| `pnpm format:check` | 通过 |

专项测试覆盖：首次 6 件入库与逐行成本、10 次顺序重放、5 次并发重放、同 ID 改数量/改备注 409、仓管角色提交、超整单/超包裹计划、多行请求失败无副作用、已取消订单、已关闭包裹、跨商家 404、BUYER/VIEWER 403、未知字段 400、空数组/重复行/0 数量 400、并发抢同一采购数量、移动加权成本、并发不同订单累加、列表筛选与分页、详情与 VIEWER 隐藏备注、OpenAPI 契约、流水与余额恒等式。

## 六、未完成与未验证

- **未做浏览器/真机验收**：本任务只交付后端与数据库行为，管理端与手机端都没有入库 UI，无法点击验收；APK 仍未构建。
- **出库扣减、库存调整、库存查询、报表**未实现，属后续任务。
- **"包裹在等待锁期间被改绑"** 分支已加防护（`PACKAGE_MOVED` 409），但未构造确定性并发测试——需要精确控制 PATCH 与收货的交错，现有测试框架做不到稳定复现。
- 幂等重放依赖客户端复用同一个 `clientOperationId`；若客户端每次生成新 ID，重复提交会按"另一笔验收"处理，只能靠数量上限拦截，这一点已在文档中写明。
- 测试用隔离库（`caicang_test_*`）在结束时删除；开发库未被写入。

## 七、Git 状态

改动未提交，等待确认。`git status` 显示 12 个已修改文件与 4 个新增路径（`apps/api/src/modules/receipts/`、`scripts/receipts.test.mjs`、`docs/RECEIPTS.md`、`docs/TASK_17_REPORT.md`），`git diff --check` 通过；本次未创建新分支，也未推送。
