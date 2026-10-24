# 任务 29 报告 — 库存调整 API

## 一、结论

库存调整已实现为**唯一可以改数量的正规入口**，但它改的仍然不是余额本身：`POST /api/v1/inventory/adjustments` 在一个数据库事务里写「调整单 + `ADJUSTMENT` 库存流水 + 库存余额 + 审计」，余额只是流水的计算结果。模型复用任务 18 就存在的 `stock_adjustments` 表，**没有新建表**，只加了四个可空列、两个索引和一条原因枚举 CHECK。

原因限定五类（盘点盘盈 / 盘点盘亏 / 商品损坏 / 商品丢失 / 其他原因），盘盈只能加、盘亏损坏丢失只能减、其他原因正负皆可但**必须写备注**；方向不符 422。成本由服务端按移动加权平均推导，零库存盘盈用商品参考进货价、都没有记 0，减到 0 时成本池清零，客户端无法提交任何余额或成本字段。`clientOperationId` 幂等：同号同内容返回原单、不再扣减，同号改内容 409。

验收在真实 PostgreSQL + 真实 API 上跑通：**入库 10 件 @18.50（成本 185.0000）→ 盘亏 2 件 → 余额 8、流水 -2（成本 148.0000）→ 同操作号重放仍为 8、流水仍 1 条 → 库存 4 件时调整 -6 被拒（409 OUT_OF_STOCK），余额、调整单、流水全都没变**。

## 二、要求对照

| # | 要求 | 实现 | 对应测试 |
| --- | --- | --- | --- |
| 1 | 先检查现有 `StockAdjustment` 模型/表，复用不重复建表 | 表与 Prisma 模型在初始迁移就有，但此前**没有任何 service/controller/route**；本次只做增量列迁移 `20261023150000_stock_adjustment_api`，没有 `CREATE TABLE` | 迁移文件；`database-models.test.mjs` 的 drift 用例 |
| 2 | 调整原因至少含盘盈/盘亏/损坏/丢失/其他 | `ADJUSTMENT_REASONS` 五值 + `ADJUSTMENT_REASON_LABELS`；DTO `@IsIn`；数据库 CHECK 兜底 | `zero, unknown reasons, direction mismatches…` |
| 3 | 按仓库、商品、调整数量登记 | `warehouseId` / `productId` / `quantityDelta` 三个必填字段，仓库与商品都用 `(tenant_id, id)` 校验归属 | 同商家 201、跨商家 404 用例 |
| 4 | 必须填原因，必要时填备注 | `reason` 必填枚举；`remark` 仅 `OTHER` 必填（trim 后 1–500 字），其余选填 | `OTHER` 无备注 / 全空白 → 400；超长 501 → 400 |
| 5 | 正数增加、负数减少 | `quantityDelta` 非零整数，符号即方向；返回 `quantityBefore/After` 供页面直接展示 | 盘亏 -2 → 10/8；盘盈 +2 → 8/10 |
| 6 | 必须在数据库事务中完成 | `contexts.run(ctx, 'inventory:write', true, ...)` 包住全部读写；任一步失败整体回滚 | 库存不足用例：409 后无调整单/流水 |
| 7 | 同步更新余额、流水、审计 | 同一事务写 `stock_adjustments` + `stock_movements(ADJUSTMENT)` + `stock_balances` + `audit_logs(STOCK_ADJUSTED)` | 流水 `quantity_before/after`、`cost_delta` 与审计 `metadata` 逐字段断言 |
| 8 | 禁止负库存 | 减少前校验 `quantity > beforeQty`，否则 `409 OUT_OF_STOCK`，`details` 带 `available`/`requested`/`sku`；数据库原有 `quantity_on_hand >= 0` 继续兜底 | `an adjustment below zero fails and leaves every table untouched` |
| 9 | 禁止客户端提交并覆盖最终余额 | DTO 白名单：带 `quantityOnHand` / `totalCost` / `unitCost` / `adjustmentNo` 一律 400；服务端不读取任何余额字段 | `zero, unknown reasons…` 中的 8 条非法体用例 |
| 10 | `clientOperationId` 幂等，重复请求不重复调整 | 唯一键 `(tenant_id, client_operation_id)` + `request_hash`；同号同内容 200 返回原单，同号不同内容 409，并发双发只扣一次 | 重放 / 改数量 / 改备注 / 并发用例 |
| 11 | 明确的成本计算规则，成本、库存价值与异常有文档 | 四条规则写在 `docs/ADJUSTMENTS.md` 第四、五节（含示例表与"为什么盘亏不用参考价"），返回值带 `costSource` 便于核对 | 四种成本场景逐项断言 `costSource` 与金额 |
| 12 | 正确执行角色权限与商家隔离 | 新增 `inventory:write`（OWNER/ADMIN/WAREHOUSE）；列表/详情用 `products:read`；所有查询带 `tenant_id`，跨商家 404 | 三角色 201、BUYER/VIEWER 403、匿名 401、跨商家仓库/商品/详情 404 |
| 13 | 验收：10 件盘亏到 8 件，余额 8、流水 -2 | `quantity_on_hand = 8`、`total_cost = 148.0000`、流水 `10 → 8`、`cost_delta = -37.0000` | 主用例 |
| 14 | 验收：重复提交不重复扣减 | 重放 200 且同一 `id`，余额仍 8，流水/调整单仍各 1 条 | 幂等用例 |
| 15 | 验收：库存不足失败且数据不变 | 409 后余额仍 4、调整单与流水数量不变；同操作号改 -4 后成功 | 库存不足用例 |

## 三、新增与修改文件

新增：

- `packages/api-contract/src/index.ts`：权限 `inventory:write`、`ADJUSTMENT_REASONS` / `ADJUSTMENT_REASON_LABELS` / `ADJUSTMENT_REASON_DIRECTION` / `ADJUSTMENT_COST_SOURCES`、`StockAdjustmentData`、错误码 `ADJUSTMENT_REASON_MISMATCH`。
- `apps/api/src/common/errors.ts`：`ADJUSTMENT_REASON_MISMATCH`（422）。
- `apps/api/src/common/tenancy/tenant-policy.ts`：WAREHOUSE 角色加 `inventory:write`。
- `apps/api/src/modules/adjustments/adjustment.dto.ts`、`adjustments.service.ts`、`adjustments.controller.ts`、`adjustments.module.ts`。
- `apps/api/prisma/migrations/20261023150000_stock_adjustment_api/migration.sql`。
- `scripts/stock-adjustments.test.mjs`（`pnpm test:adjustments`）。
- `docs/ADJUSTMENTS.md`、`docs/TASK_29_REPORT.md`。

修改：

- `apps/api/prisma/schema.prisma`：`StockAdjustment` 增 `adjustmentNo` / `remark` / `requestHash` / `costSource` 四个可空列、单号唯一键、`(tenantId, createdAt desc)` 索引。
- `apps/api/src/app.module.ts`：注册 `AdjustmentsModule`。
- `apps/api/src/modules/inventory/inventory.controller.ts`：更正"库存只能由收货改变"的注释，指明调整入口。
- `apps/api/src/modules/inventory/inventory.service.ts`：流水 `sourceNo` 带出调整单号，`note` 回退到原因中文名（不再返回裸枚举）。
- `scripts/database-models.test.mjs`：调整行原因改为 `OTHER`，新增"未知原因 23514"用例。
- `package.json`：新增 `test:adjustments` 并纳入 `test`。
- `CHANGELOG.md`、`README.md`、`docs/INVENTORY.md`、`docs/API_SPEC.md`。

## 四、关键设计

### 4.1 事务顺序

```
锁租户行（与所有写操作同一层级）
→ 按操作号查重（命中即重放，不写任何东西）
→ 校验仓库、商品归属（复合键，跨商家 404）
→ INSERT stock_balances ... ON CONFLICT DO NOTHING
→ SELECT ... FOR UPDATE 锁余额行
→ 再查一次操作号（排队期间可能已被提交）
→ 推导成本 → 校验负库存
→ INSERT stock_adjustments → UPDATE stock_balances → INSERT stock_movements → INSERT audit_logs
```

"先查重 → 锁行 → 再查重"三步都是必要的：第一步挡住常规重试，第三步挡住排队期间别人已提交的同一操作号。

### 4.2 成本规则

| 场景 | 单位成本 | `costSource` |
| --- | --- | --- |
| 增加且有库存 | 当前均价 `total_cost / quantity_on_hand` | `AVERAGE` |
| 增加、零库存、有参考进货价 | `reference_purchase_price` | `REFERENCE` |
| 增加、零库存、无参考进货价 | `0` | `ZERO` |
| 减少 | 当前均价；减到 0 时 `costDelta = -total_cost` | `AVERAGE` |

盘亏按均价冲减，才能保持"数量 × 均价 = 成本池"继续成立，也不会让"改参考价不影响历史成本"失效；零库存盘盈没有任何历史成本可依，才退到参考价，并在 `costSource` 里标记来源。

### 4.3 幂等指纹

```
sha256({ warehouseId, productId, quantityDelta, reason, remark.trim() || null })
```

只包含业务意图，不含单号、成本、余额等派生值——否则重放永远对不上。`createdAt`、`createdBy` 也不参与。

### 4.4 增量迁移

```sql
ALTER TABLE "stock_adjustments"
  ADD COLUMN "adjustment_no" VARCHAR(32),
  ADD COLUMN "remark" VARCHAR(500),
  ADD COLUMN "request_hash" VARCHAR(64),
  ADD COLUMN "cost_source" VARCHAR(20);
CREATE UNIQUE INDEX "stock_adjustments_tenant_id_adjustment_no_key" ...
CREATE INDEX "idx_adjustment_tenant_time" ...
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_reason_known"
  CHECK ("reason" IN (...)) NOT VALID;
```

四列可空、`NOT VALID` 只约束新行，历史自由文本原因不会导致迁移失败；数量非零复用初始迁移已有的 `ck_stock_adjustments_1`，没有重复加。

## 五、验证结果

| 项目 | 结果 |
| --- | --- |
| `pnpm test:adjustments` | **8 通过 / 0 失败 / 0 跳过**（一次性 PostgreSQL + 真实 API，约 13 秒） |
| `pnpm typecheck` | 通过（api / admin-web / mobile / 两个包） |
| `pnpm lint` | 通过（0 error / 0 warning） |
| `pnpm format:check` | 通过 |
| 迁移漂移 | 临时库 `migrate deploy` 后 `migrate diff --from-config-datasource --to-schema` 无差异（`database-models.test.mjs` 覆盖） |
| `pnpm test:models` | **66 通过 / 0 失败 / 0 跳过**，含 `migrate diff` 无结构漂移、41 条 CHECK（新增 `stock_adjustments_reason_known`） |
| `pnpm test` 全仓 | **626 通过 / 0 失败 / 0 跳过（8 分 04 秒）** |

## 六、边界与未做

- **没有 Web / 手机端调整页面**：本任务只交付 API（题目要求），后台暂无"库存调整"入口；页面需要改 `router/policy.ts` 的导航与权限，属于后续任务。
- **没有审批流 / 双人复核**：一次调整即生效，留痕靠 `audit_logs`。
- **不做红冲**：填错只能反向再调整一次，不提供删除调整单的接口，避免账本与历史报表对不上。
- **不支持批次 / 库位**：调整粒度是"仓库 + SKU"。
- **不能调整成本**：只影响数量，成本按规则推导；成本修正需要另做能力。
- **方向规则在服务端**：数据库 CHECK 只兜原因枚举（方向要读余额），绕过接口写入仍建议走 API。
