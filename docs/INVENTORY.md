# 库存查询（任务 22）

## 一、定位

库存是**只读视图**，不是可编辑的数据表：

```
业务动作（收货、将来的出库/盘点）
    └─ 一个事务内：INSERT stock_movements（quantity_before/after、cost_before/after）
                   UPDATE stock_balances（quantity_on_hand、total_cost）
                   ↑ 唯一写入口

查询（本文档）
    └─ SELECT ... FROM stock_balances / stock_movements
```

服务端不提供、也不要新增任何"直接改 `stock_balances`"的接口。判断一个改动是否合规的标准只有一句：**这次数量变化有没有对应一条 `stock_movements`**。没有流水的余额变动会让账本对不上，`scripts/inventory.test.mjs` 与任务 18 的专项测试都会因此失败。

## 二、端点

两个端点都要求 Bearer + `X-Tenant-Id`，权限 `products:read`（全部角色，含只读 VIEWER），均返回统一分页结构。

### 2.1 `GET /api/v1/inventory/balances`

查询参数：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `warehouseId` | UUID | 只看某个仓库 |
| `productId` | UUID | 只看某个商品 |
| `sku` | string(1–80) | 精确 SKU，trim 后比较 |
| `barcode` | string(1–128) | 精确条码，**不做数字转换**，前导零与大小写都保留 |
| `search` | string(1–200) | SKU / 商品名称 / 条码的字面子串，不区分大小写；`%`、`_`、`\` 已转义 |
| `updatedFrom` / `updatedTo` | ISO 8601 | 库存行最近变动时间区间（含边界）；只写 `YYYY-MM-DD` 时下界为当天 00:00:00.000Z、上界为 23:59:59.999Z |
| `page` / `pageSize` | int | 统一分页 |

响应 `data[]`：

| 字段 | 含义 |
| --- | --- |
| `warehouseId` / `warehouseName` | 仓库 |
| `productId` / `sku` / `barcode` / `name` / `specification` / `unit` | 商品 |
| `quantityOnHand` | 现存数量，直接读 `stock_balances.quantity_on_hand`，无余额行时为 0 |
| `pendingInboundQuantity` | 采购待入库：`PLACED`/`PARTIAL_RECEIVED` 采购单每行 `quantity - 已入库量` 之和，按商品+仓库聚合 |
| `averageCost` | 移动加权平均成本 = `totalCost / quantityOnHand`，四位小数；数量为 0 时为 `0.0000` |
| `totalCost` | 库存账面总成本，四位小数字符串 |
| `updatedAt` | 库存行最近变动时间，无余额行时为 `null` |

行的来源是 `stock_balances` 与"待入库键"的并集，所以**只有待入库、一件都没到的商品也会出现在列表里**（`quantityOnHand = 0`）。这是"下单了但货还在路上"在仓库视图下的正确表现。

### 2.2 `GET /api/v1/inventory/movements`

查询参数在上表基础上，把 `updatedFrom/updatedTo` 换成：

| 参数 | 说明 |
| --- | --- |
| `from` / `to` | 发生时间区间（`stock_movements.created_at`，含边界）；纯日期按当天首/末处理 |
| `type` | `RECEIPT` / `OUTBOUND` / `ADJUSTMENT` |

默认排序 `created_at DESC, id DESC`（最新在前）。

响应 `data[]`：

| 字段 | 含义 |
| --- | --- |
| `id` | 流水 ID |
| `occurredAt` | 发生时间 |
| `type` / `direction` | 操作类型；方向由数量符号推导（`quantityDelta >= 0` → `IN`） |
| `quantityDelta` | 带符号数量变动（入库为正、出库为负） |
| `quantityBefore` / `quantityAfter` | 操作前后库存，由写入方在同一事务内给出 |
| `costDelta` / `unitCost` | 成本变动；`unitCost = round(|costDelta| / |quantityDelta|, 4)` |
| `totalCostBefore` / `totalCostAfter` | 操作前后账面总成本 |
| `warehouseId` / `warehouseName` | 仓库 |
| `productId` / `sku` / `productName` / `unit` | 商品 |
| `sourceType` | 来源单据类型 |
| `sourceNo` | 来源单号：入库单号 / 出库单号；调整单没有编号时为 `null` |
| `sourceId` | 来源**行** ID，可追到具体凭证 |
| `note` | 入库备注 / 出库备注 / 盘点原因 |
| `operatorId` / `operatorName` | 操作人；`display_name` 为空时回落 `email` |

## 三、错误

| 场景 | 结果 |
| --- | --- |
| 未带 `X-Tenant-Id` / 无 `products:read` | 401 / 403，与其它端点一致 |
| `warehouseId`、`productId` 不是 UUID | 400 `VALIDATION_FAILED` |
| 非 ISO 时间 | 400 `VALIDATION_FAILED` |
| `from > to` 或 `updatedFrom > updatedTo` | 422 `BUSINESS_VALIDATION_FAILED`，`details.field` 指出是哪个字段 |
| `type` 不在枚举内 | 400 `VALIDATION_FAILED` |
| POST/PUT/PATCH/DELETE `/inventory/*` | 404（路由不存在，是设计而不是遗漏） |

## 四、跨商家隔离

每一处查询都带商家条件，且不止在 `/inventory` 上：

- 余额的 `received` / `pending` / `keys` 三个 CTE 都带 `tenant_id`；
- 关联合库（`warehouses`、`products`）一律 `ON w.tenant_id = $tenant AND w.id = ...`，防止用别家的 ID 拼出结果；
- 流水的 `WHERE m.tenant_id = $tenant`，来源单据的 LEFT JOIN 也都带 `tenant_id`。

因此"猜别人的 SKU 或 productId"查不到任何东西——测试里用另一个商家按 SKU 搜、按商家 A 的 `productId` 查，都是空数组。

## 五、账本一致性怎么核对

一条库存的流水应当满足：

1. 第一条流水的 `quantityBefore = 0`；
2. 对任意相邻两条（按时间正序），后一条 `quantityBefore` 等于前一条 `quantityAfter`；
3. 所有 `quantityDelta` 之和等于当前 `quantityOnHand`；
4. 最后一条的 `totalCostAfter` 等于当前 `totalCost`。

`scripts/inventory.test.mjs` 在"入库 20 → 出库 8"之后逐条断言了 1–3；任务 18 的专项测试在 12 个破坏性场景里对每个场景都做了同样的对账。手工核对可以直接查库：

```sql
SELECT p.sku, b.quantity_on_hand, b.total_cost,
       SUM(m.quantity_delta) AS ledger_qty
FROM stock_balances b
JOIN products p ON p.id = b.product_id
LEFT JOIN stock_movements m
       ON m.tenant_id = b.tenant_id AND m.warehouse_id = b.warehouse_id
      AND m.product_id = b.product_id
WHERE b.tenant_id = '<商家 ID>'
GROUP BY p.sku, b.quantity_on_hand, b.total_cost
HAVING b.quantity_on_hand <> SUM(m.quantity_delta);  -- 有差异才会返回行
```

## 六、已知边界

- **出库接口尚未实现**：流水类型 `OUTBOUND` 与来源单据关联已就绪，但没有创建出库单的端点；测试里的出库由一条模拟事务写入。真正实现时务必沿用"写流水 + 改余额"的同一路径。
- **零库存不保留历史均价**：全部出清后 `averageCost` 返回 `0.0000`。若业务需要"参考成本"，要另存一列最近均价。
- **待入库每次实时聚合**：当前规模毫秒级；采购明细量级上来后应改为增量维护。
- **时间筛选按 UTC 比较**：服务端只接受 ISO 8601 或纯日期，页面按本地时区展示时需自行换算边界。
