# 验收入库（任务 17）

扫码验收的写入口。`POST /api/v1/receipts` 是系统唯一增加库存的接口：库存在同一个 PostgreSQL 事务中由服务端计算，客户端只能提交"这个包裹这次实际收到哪些采购行、各多少件"。

| 方法与路径（统一前缀 /api/v1） | 成功 | 权限 |
| --- | --- | --- |
| POST /receipts | 201 首次创建；200 幂等重放 | OWNER/ADMIN/WAREHOUSE，`receiving:confirm` |
| GET /receipts | 200，ReceiptData 分页 | 全角色，`packages:read` |
| GET /receipts/{id} | 200，ReceiptData | 全角色，`packages:read` |

## 1. 请求

```json
{
  "packageId": "8f0d0e0a-5b2f-4a71-9a4a-9f2b2f6b9a10",
  "clientOperationId": "c0f21ff9-b97c-4cea-b5d5-e99861c08c63",
  "items": [
    { "purchaseOrderItemId": "0b6a1e58-2a1c-4d0a-9d3e-1a2b3c4d5e6f", "receivedQty": 6 },
    { "purchaseOrderItemId": "7c9f2b44-9a11-4c33-8c22-5d6e7f809a1b", "receivedQty": 2 }
  ],
  "remark": "外箱完好，人工核对无误"
}
```

- `packageId` 必须是当前商家、可收货包裹；采购单、仓库、成本都由服务端从包裹推导。
- `clientOperationId` 是客户端生成的 UUID，用于安全重试，见第 3 节。
- `items` 至少 1 行、最多 100 行，同一 `purchaseOrderItemId` 不可重复，`receivedQty` 为 `>= 1` 的整数。
- `remark` 可选，最长 2000 字符，首尾去空格，空串按 `null` 保存。
- **不接受** `warehouseId`、`quantityOnHand`、`totalCost`、`unitCost` 等字段：全局 `forbidNonWhitelisted` 会直接返回 400 `VALIDATION_ERROR`，库存与成本只能由服务端计算。

成功响应（`data`，201 首次 / 200 重放）：

```json
{
  "data": {
    "id": "3c1f7a52-1f3a-4a8e-9d5f-6f4b2c9d0e11",
    "tenantId": "6a3d0c1e-...",
    "receiptNo": "RCV-20261022-8A3F1C09D2",
    "purchaseOrderId": "b7c2...",
    "purchaseOrderNo": "PO-20261022-0001",
    "packageId": "8f0d0e0a-...",
    "trackingNo": "783456123000",
    "carrierCode": "ZTO",
    "warehouseId": "0f1e...",
    "warehouseName": "默认仓库",
    "status": "CONFIRMED",
    "clientOperationId": "c0f21ff9-...",
    "receivedBy": "5d2c...",
    "receivedByName": "张仓管",
    "remark": "外箱完好，人工核对无误",
    "receivedAt": "2026-10-22T14:03:11.512Z",
    "createdAt": "2026-10-22T14:03:11.512Z",
    "totalQuantity": 8,
    "totalCost": "129.6000",
    "items": [
      {
        "id": "e1...",
        "purchaseOrderItemId": "0b6a...",
        "productId": "aa...",
        "sku": "CHARGER-20W",
        "name": "20W 充电器",
        "unit": "件",
        "quantity": 6,
        "landedUnitCost": "18.5000",
        "lineCost": "111.0000"
      }
    ]
  },
  "requestId": "..."
}
```

## 2. 服务端校验

按顺序执行，任一失败整笔回滚：

1. 认证、`X-Tenant-Id` 成员身份与 `receiving:confirm` 权限（GUARD + 事务内复查）。
2. 包裹按 `(tenant_id, id)` 查找，跨商家返回 404，不泄露存在性。
3. 采购单状态必须是 `PLACED` 或 `PARTIAL_RECEIVED`；`DRAFT`/`CANCELLED`/`RECEIVED` 返回 409 `STATUS_CONFLICT`。
4. 包裹未写 `receivingClosedAt`；已关闭返回 409（详情含 `receivingClosed: true`）。
5. 每个 `purchaseOrderItemId` 必须属于该包裹的采购单，否则 422 `BUSINESS_VALIDATION_FAILED`。
6. 逐行校验两个上限：整单剩余 `purchase_order_items.quantity - SUM(receipt_items.quantity)`，以及（有预计明细时）本包裹剩余 `expected_quantity - 本包裹已收`。超出返回 409 `RECEIPT_QTY_EXCEEDED`，`details.maxReceivableQuantity` 给出当前实际可收量，`scope: "PACKAGE"` 表示受包裹计划限制。
7. 采购行必须有 `landed_unit_cost`（下单时计算），否则 422，不猜成本。

## 3. 幂等

`receipts.(tenant_id, client_operation_id)` 唯一，`receipts.request_hash` 保存规范化请求摘要（`packageId` + 按采购行 ID 排序的 `items` + 去空格 `remark`）。

| 情况 | 结果 |
| --- | --- |
| 操作 ID 首次出现 | 201，创建收货单、明细、库存与流水 |
| 同 ID，请求摘要相同 | 200，原样返回第一次的 ReceiptData，不再写任何行 |
| 同 ID，请求摘要不同（含只改备注） | 409 `IDEMPOTENCY_CONFLICT` |

因此"同一请求重发 10 次"只会产生 1 张入库单、1 条流水，库存只增加一次。事务内先按操作 ID 查一次，拿到采购单锁后再查一次，最后还有唯一键兜底：并发重试即使绕过前两次检查，也会被唯一索引拦下并转为幂等返回。

## 4. 事务与锁

单个 `prisma.$transaction`，锁顺序与既有包裹写入一致：

```
tenants FOR UPDATE
  → purchase_orders FOR UPDATE（同一采购单串行化）
    → packages FOR UPDATE
      → stock_balances（按 product_id 排序，INSERT ... ON CONFLICT DO NOTHING 后 FOR UPDATE）
        → 写 receipts / receipt_items / stock_movements / 状态 / 审计
```

- 同一商家的写事务先争用 `tenants` 行锁，跨订单也不会丢失更新。
- 余额行按 `product_id` 字典序加锁，避免两笔不同订单的多商品入库互相死锁。
- 余额唯一键 `(tenant_id, warehouse_id, product_id)` 是最终一致性保障；不存在时先插入 0 行再锁定，消除并发首次入库的插入竞争。

## 5. 库存与成本

移动加权平均成本，全部使用 Decimal（精度 60，四舍五入 4 位），不经过 JS 浮点：

```
new_qty  = old_qty + received_qty
cost_delta = received_qty × landed_unit_cost
new_cost = old_cost + cost_delta          -- NUMERIC(20,4)
平均成本 = new_cost / new_qty             -- 查询时推导，不落库
```

- `stock_movements` 每行记录 `quantity_before/after`、`total_cost_before/after`、`cost_delta`、`source_type='RECEIPT'`、`source_item_id=receipt_items.id`。
- 数据库 CHECK 约束保证 `before + delta = after`（数量与金额各一条），`quantity_delta <> 0`；`(tenant_id, source_type, source_item_id)` 唯一，同一入库行不可能产生两条流水。
- 流水没有更新/删除接口，历史不可变。
- 成本超过 `NUMERIC(20,4)` 上限时整笔失败，不做静默截断。

## 6. 单据状态

- 采购单：本次入库后若所有采购行累计实收 >= 采购数量 → `RECEIVED`，否则 `PARTIAL_RECEIVED`。
- 包裹：有预计明细且全部计划行已收满 → `status=RECEIVED` 且写 `receivingClosedAt`（按预计数量自动完成）；未收满 → `status=PARTIAL_RECEIVED`。无预计明细的包裹不会自动关闭，仍需任务 16 的 `POST /packages/{id}/complete-receiving` 人工确认，再次入库由 `receivingClosedAt` 拦截。
- 审计：`action='RECEIPT_CONFIRMED'`、`object_type='receipt'`、`object_id=receipt.id`，metadata 记录单号、包裹、采购单、状态、逐行数量与成本；不写运单、地址、备注原文。

## 7. 查询

`GET /receipts?page=1&pageSize=20&packageId=&purchaseOrderId=&search=`：按 `receivedAt DESC, id DESC` 排序，`search` 为字面子串（转义 `%`/`_`），命中入库单号、采购单号、运单号。所有查询强制 `tenant_id`；VIEWER 可读，但 `remark` 返回 `null`。

`GET /receipts/{id}`：含逐行 SKU/名称/单位/数量/到岸成本快照，跨商家 404。

## 8. 错误码

| HTTP | code | 场景 |
| --- | --- | --- |
| 400 | VALIDATION_ERROR | 空 items、重复采购行、数量 < 1、未知字段（如库存余额） |
| 403 | FORBIDDEN | BUYER/VIEWER 或非本商家成员 |
| 404 | NOT_FOUND | 包裹/入库单不存在或属于其他商家 |
| 409 | STATUS_CONFLICT | 采购单非可收货状态、包裹已关闭 |
| 409 | RECEIPT_QTY_EXCEEDED | 超过整单剩余或本包裹计划剩余 |
| 409 | IDEMPOTENCY_CONFLICT | 同操作 ID、不同请求 |
| 422 | BUSINESS_VALIDATION_FAILED | 采购行不属于该单、缺少到岸成本 |

## 9. 未实现

出库扣减、库存调整、报表、手机端扫码页面与本任务无关，仍未实现。本任务不新增表、迁移或依赖。

## 10. 验证

```powershell
pnpm test:receipts     # 22 项，真实 PostgreSQL 隔离库 + 真实 API 进程
pnpm test              # 全仓回归
```
