# 库存调整（任务 29）

库存调整是系统里**唯一允许"直接改数量"的入口**，但它改的仍然不是余额本身：每次调整都在一个数据库事务里写「调整单 + 库存流水 + 库存余额 + 审计」，余额只是流水的计算结果。

模型复用任务 18 就已存在的 `stock_adjustments` 表，**没有新建表**；本次只加四个可空列（`adjustment_no`、`remark`、`request_hash`、`cost_source`）、两个索引和一条原因枚举检查，历史行原样可读。

---

## 一、为什么不是 `PATCH /stock-balances`

```
POST /inventory/adjustments  { warehouseId, productId, quantityDelta, reason, remark, clientOperationId }
    │
    ├─ 校验：原因方向对不对（盘盈 + / 盘亏 - / 其他 ±）
    ├─ 事务开始
    │   ├─ 锁租户行（所有写操作共用的锁层级）
    │   ├─ 按操作号查重（命中 → 重放，直接返回原单）
    │   ├─ 校验仓库、商品属于当前商家
    │   ├─ INSERT ... ON CONFLICT DO NOTHING + SELECT ... FOR UPDATE 锁库存行
    │   ├─ 再查一次操作号（排队期间别人可能已提交）
    │   ├─ 由服务端推导单位成本、成本变动、调整后余额
    │   ├─ INSERT stock_adjustments（单号、备注、哈希、成本来源）
    │   ├─ UPDATE stock_balances
    │   ├─ INSERT stock_movements（ADJUSTMENT，前后数量与成本齐全）
    │   └─ INSERT audit_logs（STOCK_ADJUSTED）
    └─ 201 首次 / 200 幂等重放
```

客户端可以提交的只有：仓库、商品、数量差、原因、备注、操作号。以下字段一律**不可提交**，带上会被全局白名单拒绝为 `400 VALIDATION_ERROR`：

`quantityOnHand`、`quantityAfter`、`totalCost`、`unitCost`、`costDelta`、`adjustmentNo`、`status`、`createdBy`。

---

## 二、端点

三个端点都要 Bearer + `X-Tenant-Id`。

### 2.1 `POST /api/v1/inventory/adjustments`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `warehouseId` | UUID | 是 | 调整发生的仓库，必须属于当前商家 |
| `productId` | UUID | 是 | 被调整的商品，必须属于当前商家 |
| `quantityDelta` | int | 是 | 正数增加、负数减少；`-2147483647 ~ 2147483647`，**不能为 0** |
| `reason` | enum | 是 | `STOCKTAKE_GAIN` / `STOCKTAKE_LOSS` / `DAMAGED` / `LOST` / `OTHER` |
| `remark` | string(1–500) | 条件 | `OTHER` 必填；其余选填。首尾空白被 trim，全空白按未填写处理 |
| `clientOperationId` | UUID | 是 | 客户端操作号，同商家内幂等 |

成功返回调整单：

| 字段 | 含义 |
| --- | --- |
| `id` | 调整单 ID（也是流水的 `sourceDocumentId`） |
| `adjustmentNo` | 调整单号 `ADJ-YYYYMMDD-XXXXXXXXXXXX`（12 位十六进制） |
| `warehouseId` / `warehouseName` | 仓库 |
| `productId` / `sku` / `productName` / `unit` | 商品 |
| `quantityDelta` | 本次数量变动（带符号） |
| `quantityBefore` / `quantityAfter` | 调整前后库存，取自同事务写入的流水 |
| `reason` / `reasonLabel` | 原因码 / 中文名（盘点盘盈、盘点盘亏、商品损坏、商品丢失、其他原因） |
| `remark` | 备注，未填写为 `null` |
| `unitCost` | 本次采用的单位成本，四位小数字符串 |
| `costDelta` | 成本变动，四位小数字符串；增加为正、减少为负 |
| `totalCostBefore` / `totalCostAfter` | 调整前后账面总成本 |
| `costSource` | 成本来源：`AVERAGE` / `REFERENCE` / `ZERO`（见第四节） |
| `clientOperationId` | 操作号 |
| `createdBy` / `createdByName` | 操作人 |
| `createdAt` | 创建时间（ISO 8601） |

首次登记 `201`；同一操作号同样内容的重放 `200`（响应体是同一张调整单）。

### 2.2 `GET /api/v1/inventory/adjustments`

| 参数 | 说明 |
| --- | --- |
| `warehouseId` / `productId` | 按仓库 / 商品筛选 |
| `reason` | 按原因筛选 |
| `search` | 调整单号、商品名称、SKU 的字面子串（`%`、`_`、`\` 已转义，不区分大小写） |
| `from` / `to` | 创建时间区间（`created_at`，含边界）；只写 `YYYY-MM-DD` 时上界补到当天 `23:59:59.999Z`；反向区间 422 |
| `page` / `pageSize` | 统一分页（`pageSize` 1–100） |

按 `created_at DESC, id DESC` 排序，返回 `PageResult`。前后余额来自一次性批量查询的 `ADJUSTMENT` 流水，不会 N+1。

### 2.3 `GET /api/v1/inventory/adjustments/{id}`

返回单条调整；不存在或属于其他商家都是 `404 NOT_FOUND`。

### 2.4 库存流水里的调整

`GET /inventory/movements?type=ADJUSTMENT` 每行：

- `sourceType = 'ADJUSTMENT'`，`sourceId` 是流水自己的来源行 ID（当前等于调整单 ID）；
- `sourceNo` 现在是**调整单号**（任务 29 之前调整没有单号，为 `null`）；
- `sourceDocumentId` = 调整单 ID，可直接跳 `GET /inventory/adjustments/{id}`；
- `note` = 调整备注；没有备注时回退为原因中文名，不再显示裸枚举值；
- `unitCost = |costDelta| / |quantityDelta|`，与调整单的 `unitCost` 一致。

---

## 三、原因与方向

| 原因码 | 中文 | 方向 | 备注 |
| --- | --- | --- | --- |
| `STOCKTAKE_GAIN` | 盘点盘盈 | 只能为正 | 实盘比账面多 |
| `STOCKTAKE_LOSS` | 盘点盘亏 | 只能为负 | 实盘比账面少 |
| `DAMAGED` | 商品损坏 | 只能为负 | 报废、破损出库 |
| `LOST` | 商品丢失 | 只能为负 | 丢失、被盗 |
| `OTHER` | 其他原因 | 正负皆可 | **必须写备注**，说明为什么 |

方向不符返回 `422 ADJUSTMENT_REASON_MISMATCH`，`details` 带 `reason` 与 `quantityDelta`。这条规则在服务端与数据库两层都有：数据库的 `stock_adjustments_reason_known` 只允许这五个值（方向由服务端判断，因为要读当前余额）。

`OTHER` 不强制方向，是因为它要覆盖"客户退回重新入库""样品领用"这类既可能加也可能减的场景；但必须写备注，否则一个月后没人知道这 3 件去哪了。

---

## 四、成本规则

库存成本用移动加权平均。调整只改数量，**不能由客户端指定成本**，服务端按下面四条推导：

| 场景 | 单位成本 | `costSource` |
| --- | --- | --- |
| 增加，且调整前有库存 | 当前均价 `total_cost / quantity_on_hand` | `AVERAGE` |
| 增加，调整前零库存，商品有参考进货价 | 商品 `reference_purchase_price` | `REFERENCE` |
| 增加，调整前零库存，且无参考进货价 | `0` | `ZERO` |
| 减少（任意原因） | 当前均价；若减到 0，成本池整体清零 | `AVERAGE` |

计算口径：

```
unitCost  = round(totalCostBefore / quantityBefore, 4)        // HALF_UP，中间精度 60 位
costDelta = round(unitCost × quantityDelta, 4)                // 正数增加、负数减少
若 quantityAfter = 0 且 quantityDelta < 0: costDelta = -totalCostBefore   // 清池，不留尾差
totalCostAfter = totalCostBefore + costDelta                  // 不足 0 时夹到 0，记账用夹取后的实际差额
```

例（真实测试数据）：

| 操作 | 调整前 | 数量差 | 单位成本 | 成本变动 | 调整后 |
| --- | --- | --- | --- | --- | --- |
| 盘亏 2（均价 18.50） | 10 件 / 185.0000 | -2 | 18.5000 | -37.0000 | 8 件 / 148.0000 |
| 盘盈 2（均价仍是 18.50，参考价改成 99 也不影响） | 8 件 / 148.0000 | +2 | 18.5000 | +37.0000 | 10 件 / 185.0000 |
| 零库存盘盈 4（参考价 25.00） | 0 件 / 0.0000 | +4 | 25.0000 | +100.0000 | 4 件 / 100.0000 |
| 零库存盘盈 3（无参考价） | 0 件 / 0.0000 | +3 | 0.0000 | 0.0000 | 3 件 / 0.0000 |
| 丢失全部 3 件（均价 10.00） | 3 件 / 30.0000 | -3 | 10.0000 | -30.0000 | 0 件 / 0.0000 |

**为什么盘亏不按参考进货价**：盘亏要冲减的是这批货的账面价值，只有移动加权平均能保证"数量 × 均价 = 成本池"继续成立。参考进货价是建档时的估值，用它冲减会和前面的入库成本打架，也会让"改参考价不影响历史成本"这条约定失效。

**为什么零库存盘盈要用参考价**：没有任何历史成本可依，用商品自己的参考进货价是唯一有据可查的估值，并在 `costSource` 里标记 `REFERENCE`，方便日后核对。两者都没有时宁可记 0（`ZERO`），也不凭空编一个数——账面价值偏低好过虚增。

**已知取舍**：整批出清后 `stock_balances.total_cost` 归零，历史均价不保留；零库存盘盈会因此重新按参考价（或 0）起步。若以后需要"最近成交价"作为兜底，应另存一列，而不是从已清空的成本池里猜。

---

## 五、异常与错误码

| 场景 | 状态 | 错误码 | 数据是否变化 |
| --- | --- | --- | --- |
| 未登录 / 无 `inventory:write` | 401 / 403 | `UNAUTHENTICATED` / `FORBIDDEN` | 不变 |
| `quantityDelta = 0`、原因不在枚举、`OTHER` 无备注、备注超长/含空字符、未知字段 | 400 | `VALIDATION_ERROR` | 不变 |
| 盘盈填负数、盘亏/损坏/丢失填正数 | 422 | `ADJUSTMENT_REASON_MISMATCH` | 不变 |
| 减后余额为负（库存不足） | 409 | `OUT_OF_STOCK` | 不变，`details` 带 `available` / `requested` / `sku` / `warehouseId` / `productId` |
| 同操作号不同内容 | 409 | `IDEMPOTENCY_CONFLICT` | 不变 |
| 仓库 / 商品不属于当前商家 | 404 | `NOT_FOUND` | 不变，`details.field` 指出是哪个字段 |
| 调整单不存在 / 属于其他商家 | 404 | `NOT_FOUND` | 不变 |

"不变"是字面意思：整个操作在一个事务里，校验失败或库存不足时不会留下调整单、流水或审计；余额也不动。失败的操作号**没有落库**，修正数量后可以复用同一个 `clientOperationId` 重新提交（测试里就覆盖了"先 -6 被拒，再用同一号 -4 成功"）。

---

## 六、幂等

- 数据库唯一键 `stock_adjustments.(tenant_id, client_operation_id)`，同商家内一个操作号只能对应一张调整单。
- 请求指纹：

  ```
  sha256({ warehouseId, productId, quantityDelta, reason, remark.trim() || null })
  ```

  只包含"这次调整是什么"，**不包含**单号、成本、余额等派生值，否则重放永远对不上。

- 同号 + 同内容 → `200`，返回原调整单，不再扣减、不再写流水与审计。
- 同号 + 不同内容（改数量、改备注、改原因、换商品或仓库）→ `409 IDEMPOTENCY_CONFLICT`。这通常意味着客户端把同一个操作号用在了两笔真实业务上，必须拒绝。
- 并发重复提交：先从操作号查一次，锁余额行后再查一次；配合租户行锁，两个并发请求只会有一个 `201`，另一个 `200`，库存只减一次。

---

## 七、权限与商家隔离

| 操作 | 权限 | 角色 |
| --- | --- | --- |
| `POST /inventory/adjustments` | `inventory:write` | OWNER / ADMIN / WAREHOUSE |
| `GET /inventory/adjustments`、`GET /inventory/adjustments/{id}` | `products:read` | 全部角色（含 VIEWER） |

- `inventory:write` 是任务 29 新增的权限，只授予 OWNER / ADMIN / WAREHOUSE；BUYER（采购）与 VIEWER（只读）不能调整库存——采购可以改商品档案和下单，但不该能手改库存。
- 隔离在每个查询上都带 `tenant_id`：仓库与商品都用 `(tenant_id, id)` 复合唯一键查，跨商家的 ID 得到 `404` 而不是 `403`，不暴露"这个 ID 在别家存在"。
- 审计 `STOCK_ADJUSTED` 的 `metadata` 只记结构化事实（单号、仓库、商品、SKU、数量前后、成本前后、原因、`costSource`、操作号、`requestId`），**不写 remark**（可能含客户信息）。

---

## 八、数据库变更

迁移 `20261023150000_stock_adjustment_api`：

```sql
ALTER TABLE "stock_adjustments"
  ADD COLUMN "adjustment_no" VARCHAR(32),
  ADD COLUMN "remark" VARCHAR(500),
  ADD COLUMN "request_hash" VARCHAR(64),
  ADD COLUMN "cost_source" VARCHAR(20);

CREATE UNIQUE INDEX "stock_adjustments_tenant_id_adjustment_no_key"
  ON "stock_adjustments" ("tenant_id", "adjustment_no");
CREATE INDEX "idx_adjustment_tenant_time"
  ON "stock_adjustments" ("tenant_id", "created_at" DESC);

ALTER TABLE "stock_adjustments"
  ADD CONSTRAINT "stock_adjustments_reason_known"
  CHECK ("reason" IN ('STOCKTAKE_GAIN','STOCKTAKE_LOSS','DAMAGED','LOST','OTHER')) NOT VALID;
```

要点：

- 四列**全部可空**，纯增量，不 UPDATE 历史行；历史行 `adjustment_no` 为 `NULL` 时 API 退回 `ADJ-<ID 前 12 位>`，不会返回空字符串。
- `NOT VALID` 让检查只约束新行：历史行即使有自由文本原因也能保留，迁移不会失败。
- 数量非零沿用初始迁移就有的 `ck_stock_adjustments_1`，未重复添加。
- 一条调整对应一条流水，由 `stock_movements.(tenant_id, source_type, source_item_id)` 唯一键保证。

---

## 九、账本核对

一条调整必须同时满足：

1. 调整单、流水、余额三者数量自洽：`quantityAfter = quantityBefore + quantityDelta`；
2. `totalCostAfter = totalCostBefore + costDelta`；
3. 余额等于该仓库+商品全部 `quantity_delta` 之和；
4. 每个 `ADJUSTMENT` 流水都能找到对应调整单，反之亦然。

```sql
-- 余额与流水合计不一致的商品（有差异才会返回行）
SELECT p.sku, b.quantity_on_hand, SUM(m.quantity_delta) AS ledger_qty
FROM stock_balances b
JOIN products p ON p.id = b.product_id
LEFT JOIN stock_movements m
       ON m.tenant_id = b.tenant_id AND m.warehouse_id = b.warehouse_id
      AND m.product_id = b.product_id
WHERE b.tenant_id = '<商家 ID>'
GROUP BY p.sku, b.quantity_on_hand
HAVING b.quantity_on_hand <> COALESCE(SUM(m.quantity_delta), 0);

-- 调整单与流水必须 1:1
SELECT a.id
FROM stock_adjustments a
LEFT JOIN stock_movements m
       ON m.tenant_id = a.tenant_id AND m.source_type = 'ADJUSTMENT' AND m.source_item_id = a.id
WHERE a.tenant_id = '<商家 ID>' AND m.id IS NULL;
```

---

## 十、验收对照

`pnpm test:adjustments`（`scripts/stock-adjustments.test.mjs`，一次性 PostgreSQL + 真实 API，**8 通过 / 0 失败 / 0 跳过**）：

| 验收要求 | 用例 |
| --- | --- |
| 库存 10 件盘点调整为 8 件 → 余额 8、流水 -2 | 入库 10 件 @18.50 → 盘亏 2 → `quantity_on_hand = 8`、`total_cost = 148.0000`、流水 `10 → 8`、`cost_delta = -37.0000`、审计 `STOCK_ADJUSTED` 且不含备注 |
| 重复提交不重复扣减 | 同号同内容重放 `200` 且同一张单、余额仍 8、流水仍 1 条；同号改数量/备注 `409`；并发双发得到 `[200, 201]`，只扣一次 |
| 库存不足失败且数据不变 | 4 件时调整 -6 → `409 OUT_OF_STOCK`，余额仍 4、无新调整单/流水；同一操作号改 -4 后成功 |
| 原因与方向 | 盘盈 -1、盘亏/损坏/丢失 +1 全部 422 `ADJUSTMENT_REASON_MISMATCH`；`OTHER` 正负都行但必须带备注 |
| 成本规则 | 均价盘盈、参考价盘盈、无依据盘盈、减到 0 清池四种场景逐项断言 `costSource` 与金额 |
| 权限与隔离 | OWNER/ADMIN/WAREHOUSE 201；BUYER/VIEWER 403；匿名 401；跨商家仓库/商品/详情 404 |
| 列表与详情 | 原因/仓库/商品/单号/SKU/名称/日期筛选、分页、排序、详情与列表一致、反向区间 422 |
| 数据库兜底 | 绕过接口写未知原因 → `23514`；`quantity_delta = 0` → `23514`；OpenAPI 里调整路径只有 `get`/`post`，余额与流水仍无写动词 |

---

## 十一、已知边界

- **没有审批流**：一次调整即生效。V1 只有单一角色权限，不做双人复核；需要留痕时看 `audit_logs`。
- **不做红冲**：填错了就反向再调整一次（并写清备注），不提供"删除调整单"接口——删除会让账本和历史报表对不上。
- **不支持批次 / 库位**：调整粒度是"仓库 + 商品（SKU）"，没有批次号、货位、有效期。
- **不能调整成本**：调整只影响数量，成本按第四节规则推导。要修正成本只能通过采购入库价或后续的成本调整能力（当前未实现）。
- **方向规则由服务端判断**：数据库只兜住原因枚举，因为方向需要读当前余额；绕过接口的写入由"数量非零 + 原因枚举"两道 CHECK 兜底，但仍然建议所有写入都走 API。
