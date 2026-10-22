# 任务 16 验收报告：扫码查询与待收数量计算

- 完成日期：2026-10-22
- 分支：`main`，基线提交 `fc16ede`（任务 15）
- 范围：`GET /packages/lookup` 完善、`GET /packages/{id}/receivable`、`POST /packages/{id}/complete-receiving`
- 未包含：`POST /receipts` 正式入库、库存、出库、手机端页面、真机扫码

## 一、需求对照

| # | 要求 | 实现 |
| --- | --- | --- |
| 1 | 根据运单号查找包裹 | `GET /packages/lookup?trackingNo=`（任务 14 已有，本次仅增强返回字段） |
| 2 | 找到包裹后显示对应采购单 | 候选返回 `purchaseOrderId`、`purchaseOrderNo`；可收明细返回 `purchaseStatus` |
| 3 | 展示 SKU、名称和采购数量 | `lines[].sku` / `name` / `unit` / `orderedQuantity`（优先采购快照） |
| 4 | 查询每个 SKU 已累计收货数量 | `receivedQuantity` = 整单全部包裹 `receipt_items` 累计 |
| 5 | 计算本次最大可收数量 | `maxReceivableQuantity` |
| 6 | 考虑同单其他包裹的收货 | 全单聚合，`orderRemainingQuantity = ordered − 全单实收`（最小 0） |
| 7 | 有预计明细时限制包裹剩余 | `packageRemainingQuantity = expected − 本包裹实收`，最大可收取两者最小值 |
| 8 | 无预计明细支持人工选择剩余 SKU | `hasPlan=false` 时 `lines` 返回采购单仍有剩余的 SKU，`expectedQuantity=null` |
| 9 | 未知单号返回空候选、不增加库存 | 返回 `[]`；测试断言 `receipts`/`stock_balances`/`stock_movements` 未变化 |
| 10 | 多候选不能擅自选择第一个 | 返回全部候选（按公司/UUID 排序），无「默认项」字段；测试用同号双承运商验证 |
| 11 | 无预计明细包裹允许人工标记验收完成 | `POST /packages/{id}/complete-receiving` |

验收口径：采购 10 件、另一包裹已收 4 件时，本包裹（预计 6）返回 `orderedQuantity=10`、`receivedQuantity=4`、`orderRemainingQuantity=6`、`packageRemainingQuantity=6`、`maxReceivableQuantity=6`，即「购买 10 件、已入库 4 件、还可入库 6 件」。测试用例 `receiving another package deducts the shared purchase quantity` 断言了这五个数字。

## 二、接口行为

### GET /packages/lookup

- 权限不变：OWNER/ADMIN/BUYER/WAREHOUSE，`packages:lookup`；VIEWER 403。
- 精确字符串匹配运单号（保留前导零），未知返回 `[]`，不创建任何记录。
- 新增 `hasReceipts`、`receivedQuantity` 两个字段（向后兼容），供多候选页面直接显示进度。

### GET /packages/{id}/receivable

- 权限：OWNER/ADMIN/WAREHOUSE，`receiving:confirm`；BUYER/VIEWER 403，跨商家 404，非法 UUID 400。
- 只读事务（`FOR SHARE` 锁商家行 + 重查成员），不写收货单、不改库存。
- 有预计明细：只返回本包裹计划行（含已收满的行，`maxReceivableQuantity=0`），便于显示进度。
- 无预计明细：返回采购单仍有剩余的 SKU，`inPackagePlan=false`、`expectedQuantity=null`、`packageRemainingQuantity=null`。
- 包裹已关闭：`receivingClosed=true`，所有行的 `maxReceivableQuantity=0`。
- 历史超收数据（实收 > 采购数量）向下夹到 0，永不返回负数。

### POST /packages/{id}/complete-receiving

- 权限：OWNER/ADMIN/WAREHOUSE，`receiving:confirm`；成功 200（`@HttpCode(200)`）。
- 仅接受**无预计明细**的包裹：有预计明细返回 409 `STATUS_CONFLICT`；采购单已取消同样 409。
- 写入 `receivingClosedAt` 与 `status=RECEIVED`，同事务写审计 `PACKAGE_RECEIVING_CLOSED`；不建收货单、不改库存、不改采购单状态。
- 重复调用返回 200，`receivingClosedAt`/`updatedAt` 不变，不重复审计；两个并发请求经商家行锁串行化，只留一条审计。

## 三、对既有行为的唯一改动

`receivingStatus` 推导顺序改为「关闭标记优先」：

- 之前：零收货的已关闭包裹仍显示 `NOT_RECEIVED`。
- 现在：`receivingClosedAt != null` 直接为 `RECEIVED`，符合「显式关闭 = 验收完成（含空包/破损无货）」。
- 有收货且关闭的行为不变；未关闭的有收货仍是 `PARTIAL_RECEIVED`；物流 `ARRIVED` 依旧不影响收货状态。

任务 14 的 OpenAPI 契约测试原来断言「不存在 complete-receiving 端点」，本次随着功能实现改为断言该端点存在、且仍不存在 `POST /receipts`。这是契约随功能演进的必要同步，不是放宽校验。

## 四、新增与修改文件

新增：

- `scripts/receivables.test.mjs`（17 项专项测试）
- `docs/TASK_16_REPORT.md`（本报告）

修改：

| 文件 | 作用 |
| --- | --- |
| `packages/api-contract/src/index.ts` | 新增 `PackageReceivableLineData`、`PackageReceivableData`；`PackageLookupData` 增加 `hasReceipts`、`receivedQuantity` |
| `apps/api/src/modules/packages/package.dto.ts` | 新增两个响应 DTO（Swagger） |
| `apps/api/src/modules/packages/packages.service.ts` | `lookup` 补字段、新增 `receivable`/`completeReceiving`/`orderLines`、`mapPackage` 关闭优先 |
| `apps/api/src/modules/packages/packages.controller.ts` | 两个新路由 + `HttpCode(200)` |
| `package.json` | 新增 `test:receivables`，并入 `test` |
| `scripts/packages.test.mjs` | 同步 OpenAPI 契约断言 |
| `docs/PACKAGES.md`、`docs/API_SPEC.md`、`docs/SCAN_FLOW.md`、`docs/ARCHITECTURE.md`、`docs/DECISIONS.md`（ADR-023）、`docs/CODEX_TASKS.md`、`README.md`、`CHANGELOG.md` | 接口、口径、决策与任务状态 |

没有新增表、迁移或第三方依赖。

## 五、实际执行的测试

| 命令 | 结果 |
| --- | --- |
| `pnpm test:receivables` | **17 通过 / 0 失败**（重构后复跑仍 17/17） |
| `pnpm test:packages` | **32 通过 / 0 失败**（任务 14 回归，含同步后的契约断言） |
| `pnpm test:web-packages` | **16 通过 / 0 失败**（任务 15 回归） |
| `pnpm test`（全仓） | **455 通过 / 0 失败**，约 5 分 30 秒 |
| `pnpm typecheck` | 四个包全部通过 |
| `pnpm lint` / `pnpm format:check` | 通过 |

专项测试使用真实 PostgreSQL 随机隔离库（每轮 `CREATE DATABASE` + 六个迁移 + 结束后 `DROP`）、真实生产 API 进程，覆盖：

1. 未知运单号 → 空数组，`receipts`/`stock_balances`/`stock_movements` 全部为 0；
2. 同号双承运商 → 两个候选都返回，不自动选第一个；
3. 有计划包裹初始可收 = 预计量，且只列计划行；
4. 另一包裹已收 4 → 本包裹显示「购买 10、已收 4、还可收 6」；
5. 本包裹收满 6 → 全单剩余 0，包裹自动 `RECEIVED`；
6. 无计划包裹 → 回退到采购单剩余 SKU，收 2 件后剩余 3；
7. 超收夹具（收 12 件 / 采购 10）→ 剩余与最大可收夹到 0，不出现负数；
8. 有计划的包裹人工完成 → 409；无计划的包裹 → 200 且 `receivingStatus=RECEIVED`；
9. 重复完成 → 时间不变、审计仍 1 条；
10. 并发两次完成 → 都 200、同时间戳、审计 1 条；
11. 跨商家 → 404；非法 UUID → 400；BUYER/VIEWER → 403；WAREHOUSE → 200；未登录 → 401；
12. 采购单取消后完成 → 409，只读明细仍可查询；
13. OpenAPI 收录两个新操作；
14. 全程无库存行、无测试产生的收货单。

开发库（`caicang`）未被写入，测试库自动清理。

## 六、未完成 / 未验证

- **`POST /receipts` 未实现**：本次只计算「最多可收多少」，真正写入收货单、更新库存与采购单状态属于后续任务。因此 `complete-receiving` 只是结束包裹验收，不代表商品已入库。
- **手机端页面未开发**：扫码页、多候选选择页、数量核对页尚未实现，也没有 APK；真机扫码验收仍待后续任务。
- **未做浏览器/真机点击验收**：两个新接口只有 API 层验证（真实数据库 + 真实进程），没有 UI 可点。
- 本次没有并发「收货写入」场景可测（写入接口尚不存在）；`complete-receiving` 的并发幂等已覆盖。

## 七、复现步骤

```powershell
cd D:\Dev\caicang-manager
pnpm db:up
pnpm prisma:migrate:deploy
pnpm start:api
# http://localhost:3000/api/docs ，Bearer + X-Tenant-Id
pnpm test:receivables
```
