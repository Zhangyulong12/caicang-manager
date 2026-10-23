# 出库发货（任务 24）

## 一、定位

出库是库存的**扣减方**，与收货对称：一次发货就是一个数据库事务，把"单据状态、库存余额、成本池、不可变流水、审计"一起改掉，或者一起不改。

```
POST /outbound-orders            创建草稿（不碰库存）
PATCH /outbound-orders/{id}      改草稿（不碰库存）
POST /outbound-orders/{id}/ship  一个事务：锁单 → 锁余额 → 校验 → 扣减 + 快照 + 流水 + 审计 → SHIPPED
POST /outbound-orders/{id}/cancel 只改状态，不碰库存
```

判断一次改动是否合规的标准仍然只有一句：**库存数量变了，就必须有一条对应的 `stock_movements`**。出库流水的 `source_type = 'OUTBOUND'`，`source_item_id` 指向 `outbound_order_items.id`。数据库层面还有三道兜底：`stock_balances.quantity_on_hand >= 0`、`stock_movements.quantity_before + quantity_delta = quantity_after`、`total_cost_before + cost_delta = total_cost_after`——写错了直接报错回滚，不会静默留下坏账。

## 二、端点

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| POST | `/api/v1/outbound-orders` | `outbound:write`（OWNER/ADMIN/WAREHOUSE） | 创建草稿，成功 201 |
| GET | `/api/v1/outbound-orders` | `products:read`（全部角色） | 分页列表 |
| GET | `/api/v1/outbound-orders/{id}` | `products:read` | 详情 |
| PATCH | `/api/v1/outbound-orders/{id}` | `outbound:write` | 修改草稿 |
| POST | `/api/v1/outbound-orders/{id}/ship` | `outbound:write` | 确认发货；首次 201，幂等重放 200 |
| POST | `/api/v1/outbound-orders/{id}/cancel` | `outbound:write` | 取消草稿，200 |

所有端点都要 Bearer + `X-Tenant-Id`，且严格按商家隔离：用别家的单号只会得到 404。

### 2.1 创建草稿

```json
{
  "warehouseId": "…",
  "items": [{ "productId": "…", "quantity": 3 }],
  "customerName": "张三",
  "customerPhone": "13800000001",
  "customerAddress": "上海市浦东新区虚构路 88 号",
  "carrierCode": "SF",
  "trackingNo": "000000000123",
  "remark": "到货请电联"
}
```

- 仓库与商品必须属于当前商家；每个商品只能出现一行；`quantity` 是 1..2147483647 的整数。
- **草稿不校验库存**：草稿是计划，"能不能发"在确认发货时才由数据库说了算。响应里的 `items[].availableQuantity` 是实时可出库量，页面据此提前提示。
- 收件人、电话、地址可以留空（先把货备好再填收件人很常见），但**确认发货前必须补齐**。
- 客户端提交 `totalCost` / `quantityOnHand` / `status` 等派生字段会被全局 whitelist 管道拒绝（400）。
- 不检查商品 `isActive`：停售商品可能仍有存货需要清出去。

### 2.2 修改草稿

`PATCH` 是**整单替换**语义：传了 `items` 就用新明细替换全部旧行（不是叠加），没传就保留。可以换仓库。所有字段可选，但至少传一个，否则 422。

只允许改 `DRAFT`。已发货、已取消的单返回 `409 STATUS_CONFLICT` —— 已发货的单是账本事实，明细与收件人不能被事后改写。

### 2.3 确认发货

```json
{
  "clientOperationId": "2d174cc7-75f7-4fc4-893e-5a16909c005b",
  "carrierCode": "SF",
  "trackingNo": "000000000123",
  "remark": "已交给快递"
}
```

事务内的顺序是固定的：

1. **按 `confirm_operation_id` 查重**（幂等快路径）。
2. `SELECT … FOR UPDATE` 锁出库单行 —— 同一张单的并发请求在这里排队。
3. 拿到锁后**再查一次**操作号 —— 排队期间别人可能已经提交。
4. 校验状态必须是 `DRAFT`、至少要有一行明细、收件人/电话/地址齐全。
5. 按 `product_id` 升序逐个锁库存行（`INSERT … ON CONFLICT DO NOTHING` + `SELECT … FOR UPDATE`），并收集不足的 SKU。
6. **先把所有行都校验完再写**：不够就一次性返回全部缺货明细，而不是写到一半才发现。
7. 逐行：按移动加权平均算单价快照 → 更新余额与成本池 → 回写 `outbound_order_items.shipped_unit_cost` → 写 `stock_movements`。
8. 更新单据为 `SHIPPED`（`shipped_by`、`shipped_at`、`confirm_operation_id`、`confirm_request_hash`，以及本次请求带来的物流信息）。
9. 写 `OUTBOUND_SHIPPED` 审计（含逐行成本快照与合计）。

第 5 步按 `product_id` 排序很关键：两张单如果都发 A、B 两个商品，加锁顺序一致才不会互相死锁。

### 2.4 取消

只允许取消 `DRAFT`。取消**只改状态**，不写流水、不动余额、不动成本池（审计里明确记 `stockTouched: false`）。

- 重复取消返回 200，`cancelled: false`（响应里同时带回单据，状态仍是 `CANCELLED`）——网络重试不应该报错。
- 取消已发货的单返回 `409 STATUS_CONFLICT`：货已经出去了，要纠错得走退货/盘点（尚未实现），不能靠取消。

## 三、响应字段

```json
{
  "id": "…", "outboundNo": "OUT-20261023-3F7A2C91B4", "status": "SHIPPED",
  "warehouseId": "…", "warehouseName": "主仓",
  "customerName": "张三", "customerPhone": "13800000001", "customerAddress": "…",
  "carrierCode": "SF", "trackingNo": "000000000123", "remark": "已交给快递",
  "createdBy": "…", "createdByName": "老板",
  "shippedBy": "…", "shippedByName": "仓管小李",
  "confirmOperationId": "…", "shippedAt": "2026-10-23T09:12:33.000Z",
  "createdAt": "…", "updatedAt": "…",
  "totalQuantity": 3, "totalCost": "55.5000",
  "items": [
    { "id": "…", "productId": "…", "sku": "CHARGER-20W", "name": "20W 充电器", "unit": "件",
      "quantity": 3, "shippedUnitCost": "18.5000", "lineCost": "55.5000", "availableQuantity": 7 }
  ]
}
```

- `shippedUnitCost` / `lineCost` 是**发货那一刻的成本快照**，草稿阶段为 `null`；之后库存均价再变也不会回溯修改它。
- `availableQuantity` 是**当前**可出库量（实时读 `stock_balances`），用于页面提示，不是下结论的依据。
- `totalCost` 草稿为 `0.0000`，发货后是各行 `lineCost` 之和，四位小数字符串。
- VIEWER 能看到单据，但 `remark` 由服务端置为 `null`（与入库单、包裹一致）。

## 四、成本口径：移动加权平均快照

出库单价 = 发货前该仓库该商品的 `total_cost / quantity_on_hand`，四舍五入到四位小数，写进 `outbound_order_items.shipped_unit_cost` 和 `stock_movements`。

```
发货前：10 件 / 160.0000 → 均价 16.0000
发 3 件：costDelta = -(16.0000 × 3) = -48.0000
发货后：7 件 / 112.0000 → 均价仍是 16.0000
```

两个细节：

- **发完整批时直接清空成本池**（`costDelta = -total_cost`），避免"数量 0 但还剩 0.0001 成本"的尾差。
- 如果四舍五入让 `-单价 × 数量` 略微超过成本池，成本池夹到 0，保证 `total_cost >= 0` 的数据库约束不被打破。

## 五、幂等与并发

| 场景 | 结果 |
| --- | --- |
| 同 `clientOperationId` + 同内容重试 | 200，返回原单据，**不再扣库存**，不新增流水/审计 |
| 同 `clientOperationId` + 不同内容 | `409 IDEMPOTENCY_CONFLICT` |
| 同 `clientOperationId` 用在另一张单上 | `409 IDEMPOTENCY_CONFLICT`（不能拿 A 单的结果冒充 B 单） |
| 换新 `clientOperationId` 再发已 SHIPPED 的单 | `409 STATUS_CONFLICT` |
| 两张单并发发同一商品，库存只够一张 | 一张 201、一张 `409 OUT_OF_STOCK`，库存不为负 |
| 同一张单并发重试（同一个操作号） | 一个 201、一个 200，库存只扣一次 |

并发不靠乐观重试，靠**行锁 + 锁后复查**：库存行的 `unique (tenant_id, warehouse_id, product_id)` 是并发闸门，拿到锁之后读到的 `quantity_on_hand` 一定是当前值。

## 六、错误码

| 场景 | 状态码 | code | details |
| --- | --- | --- | --- |
| 参数格式/未知字段 | 400 | `VALIDATION_ERROR` | 字段列表 |
| 无 `outbound:write`（BUYER、VIEWER） | 403 | `FORBIDDEN` | — |
| 单号/仓库/商品不存在，或属于别家 | 404 | `NOT_FOUND` | — |
| 库存不足 | 409 | `OUT_OF_STOCK` | `warehouseId`、`shortages[{productId, sku, requestedQuantity, availableQuantity}]` |
| 状态不允许（已发货再发、非草稿修改/取消） | 409 | `STATUS_CONFLICT` | `status` |
| 幂等冲突 | 409 | `IDEMPOTENCY_CONFLICT` | `clientOperationId`（+ `outboundOrderId`） |
| 草稿缺收件信息、空 PATCH、商品不属于本商家 | 422 | `BUSINESS_VALIDATION_FAILED` | `field` |
| 任一步骤数据库异常 | 500 | `INTERNAL_ERROR` | — （整个事务已回滚） |

## 七、核对 SQL

发货后可以这样自查（把 `$1` 换成商家 ID）：

```sql
-- 1) 余额 = 流水合计（数量与成本都要对）
SELECT b.warehouse_id, b.product_id,
       b.quantity_on_hand,
       COALESCE(SUM(m.quantity_delta), 0) AS movement_qty,
       b.total_cost::text AS balance_cost,
       COALESCE(SUM(m.cost_delta), 0)::text AS movement_cost
FROM stock_balances b
LEFT JOIN stock_movements m
  ON m.tenant_id = b.tenant_id AND m.warehouse_id = b.warehouse_id AND m.product_id = b.product_id
WHERE b.tenant_id = $1
GROUP BY b.warehouse_id, b.product_id, b.quantity_on_hand, b.total_cost
HAVING b.quantity_on_hand <> COALESCE(SUM(m.quantity_delta), 0)
    OR b.total_cost <> COALESCE(SUM(m.cost_delta), 0);   -- 有差异才返回行

-- 2) 每张已发货单的明细都有流水，且成本快照非空
SELECT o.outbound_no, i.product_id, i.quantity, i.shipped_unit_cost
FROM outbound_orders o
JOIN outbound_order_items i ON i.tenant_id = o.tenant_id AND i.outbound_order_id = o.id
LEFT JOIN stock_movements m
  ON m.tenant_id = o.tenant_id AND m.source_type = 'OUTBOUND' AND m.source_item_id = i.id
WHERE o.tenant_id = $1 AND o.status = 'SHIPPED'
  AND (m.id IS NULL OR i.shipped_unit_cost IS NULL);

-- 3) 已发货单一定带齐确认字段（数据库也有 ck_outbound_orders_2 兜底）
SELECT id, outbound_no FROM outbound_orders
WHERE tenant_id = $1 AND status = 'SHIPPED'
  AND (shipped_at IS NULL OR confirm_operation_id IS NULL OR confirm_request_hash IS NULL);
```

## 八、页面入口（任务 25）

Web 端「出库管理」（`/outbound`）已经建在这些端点上：列表、新建/修改草稿、详情、确认发货、取消草稿。页面只负责收集输入与展示服务端结果，成本与库存一律不本地计算；库存不足时把这里返回的 `409 OUT_OF_STOCK` 逐 SKU 差额原样显示。操作方法与手工验收步骤见 `docs/WEB_OUTBOUND.md`。

## 九、已知边界

- **没有退货/逆向出库**：发错货只能先做盘点调整（`POST /inventory/adjustments` 也还没实现）。当前唯一能纠正库存的是再收一次货或后续盘点。
- **不支持拆包/部分发货**：一张出库单要么全发，要么不发。需要分批发货就拆成多张单。
- **取消后不能复用到新单**：单号作废，重建一张新草稿（草稿创建没有成本）。
- **明细一行一个商品**（`unique (tenant_id, outbound_order_id, product_id)`），同一商品要分两行（例如两个批次）不支持。
- **没有 Web / App 页面**：本任务只交付 API，管理后台与手机端的出库页面属于后续任务。
- **`PUT` 未实现**：修改走 `PATCH` 的整单替换语义。
