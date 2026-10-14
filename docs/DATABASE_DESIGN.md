# 数据库设计（PostgreSQL）

可执行建表参考：`../database/schema.sql`。本文件解释表之间的关系、业务约束、成本计算和事务实现要求。schema 是初稿，编码时以 Prisma Migrate 产生可追踪 migration；不能在已有真实数据库直接重放 SQL。

## 1. 核心实体及关联

```mermaid
 erDiagram
   TENANTS ||--o{ TENANT_MEMBERSHIPS : has
   USERS ||--o{ TENANT_MEMBERSHIPS : joins
   TENANTS ||--o{ WAREHOUSES : owns
   TENANTS ||--o{ PRODUCTS : owns
   WAREHOUSES ||--o{ PURCHASE_ORDERS : destination
   PURCHASE_ORDERS ||--|{ PURCHASE_ORDER_ITEMS : lines
   PRODUCTS ||--o{ PURCHASE_ORDER_ITEMS : purchased
   PURCHASE_ORDERS ||--o{ PACKAGES : shipments
   PACKAGES ||--o{ PACKAGE_EXPECTED_ITEMS : planned
   PURCHASE_ORDER_ITEMS ||--o{ PACKAGE_EXPECTED_ITEMS : planned_item
   PACKAGES ||--o{ RECEIPTS : received
   RECEIPTS ||--|{ RECEIPT_ITEMS : lines
   PURCHASE_ORDER_ITEMS ||--o{ RECEIPT_ITEMS : fulfilled
   WAREHOUSES ||--o{ STOCK_BALANCES : stores
   PRODUCTS ||--o{ STOCK_BALANCES : has
   WAREHOUSES ||--o{ OUTBOUND_ORDERS : ships
   OUTBOUND_ORDERS ||--|{ OUTBOUND_ORDER_ITEMS : lines
   PRODUCTS ||--o{ OUTBOUND_ORDER_ITEMS : shipped
   PRODUCTS ||--o{ STOCK_MOVEMENTS : trace
```

## 2. 表清单（17 张业务表）

|表|主要用途|关键约束|
|---|---|---|
|tenants|商家/租户|tenant UUID|
|users|平台登录用户|email 全局唯一、密码只存哈希|
|tenant_memberships|用户归属与角色|tenant_id+user_id 唯一|
|warehouses|仓库|tenant_id+code 唯一|
|products|SKU 主数据|tenant_id+sku 唯一，非空条码商家内唯一|
|purchase_orders|采购主单|tenant_id+order_no 唯一，状态机|
|purchase_order_items|采购行|qty>0，不能重复 SKU|
|packages|包裹与运单|tenant+carrier+tracking 唯一，按 tracking 索引|
|package_expected_items|包裹预计 SKU 数量|同包裹同采购行唯一|
|receipts|验收入库单|tenant+client_operation_id 唯一，支持部分收货|
|receipt_items|验收入库行|实际验收数量、成本快照|
|stock_balances|仓库/SKU 现存数量成本|tenant+warehouse+SKU 唯一，非负|
|outbound_orders|发货出库主单|唯一单号、确认操作 UUID|
|outbound_order_items|出库 SKU 明细|数量>0、成本快照|
|stock_adjustments|经授权的库存调整|原因、数量增减、操作 UUID|
|stock_movements|不可变库存流水|来源类型+来源明细唯一、前后数量校验|
|audit_logs|重要业务行为审计|按租户与时间索引|



## 3. 字段/类型共识

- PK 使用 UUID；记录应带 `tenant_id`，跨表访问校验当前商家归属。
- 所有数量使用 INTEGER 正数；V1 SKU 以整件计，不支持公斤/散装小数库存。
- 价格、折扣、运费使用 `NUMERIC(18,2)`；库存成本使用 `NUMERIC(20,4)`；API 金额 JSON 用字符串，例如 `"18.50"`。
- `created_at`/`updated_at` 用 UTC 存储，前端按用户时区展示。
- 地址与手机号码为个人信息，访问权限和日志脱敏；不在业务日志中打印完整内容。
- 商品停用保留历史单据，不级联删除历史流水。

## 4. 防止脏数据的规则

1. 所有数据列表查询强制 `tenant_id` 过滤；具体对象读取要同时按 `id + tenant_id` 过滤，外键也尽量采用 `(tenant_id,id)` 复合约束。
2. `purchase_order_items.product_id` 所属租户必须等于采购单租户。
3. `package_expected_items.purchase_order_item_id` 必须属于 `packages.purchase_order_id`；多包裹预计 SKU 总量不得高于采购行订购量。
4. `receipt_items.purchase_order_item_id` 必须来自对应收货单所属采购单，产品必须与采购行一致。
5. 同一采购行全部 `receipt_items.quantity` 累计不得高于 `purchase_order_items.quantity`；在事务中锁定采购主单再检查，严禁先查后写导致竞态。
6. 无预计包裹行的包裹需要显式完成收货，不可根据订单剩余数量猜测包裹已完结。同一包裹的包裹行若已指定预计数量，原则上限制该包裹该 SKU 入库累计不超过预计数量；若需改动包裹装箱清单，要求 Buyer/Admin 先审批修正计划，不能悄悄放开。
7. 重复 `clientOperationId` 对同一租户返回原收货单；相同 ID 不同请求体通过 `request_hash` 必须拒绝。
8. 发货用库存余额行锁/条件更新确保 `quantity_on_hand >= need`；无余额行视作零。
9. 所有入库、出库与库存调整都必须在**同一数据库事务**中生成业务单据、库存余额变更、库存流水与审计日志；失败整体回滚。

## 5. 成本核算口径

V1 币种人民币。确认采购时计算：

`line_net = quantity × unit_price - discount_amount`

`order_payable = Σ line_net + freight_amount`

按各采购行 `line_net / Σline_net` 的占比分配整单运费，最后一行吸收尾差；若全部行净价为 0，则按件数比例分配。每行 `landed_unit_cost = (line_net + freight_allocated) / quantity`（存四位小数，保留原订单分摊来源避免汇总偏差）。

库存采用**移动加权平均成本法**：

- 入库：`new_qty = old_qty + qty_in`；`new_cost = old_cost + qty_in × landed_unit_cost`。
- 出库：`avg = old_total_cost / old_qty`；`out_cost = qty_out × avg`；`new_cost = old_cost - out_cost`；若数量清零，成本归零并把极小尾差归入最后一笔出库。
- 库存总额与账面平均成本均以后端数据库 `Decimal` 精确计算，禁止 JS Number 浮点直接记账。
- 采购订单金额与“当前库存价值”是不同指标：售出/出库后库存价值下降，原采购支出不会下降。

## 6. 并发实现建议

入库：`BEGIN` → 按 `(tenant,id)` 锁采购主单（同一采购单收货串行化）→ 按 `(tenant,id)` 锁包裹 → 查询历史已收/验证剩余 → 创建 receipts 和 items（幂等唯一键）→ 对 `stock_balances` 按 warehouseId+productId 排序加锁并 upsert → 写 stock_movements → 更新单据状态 → 审计 → COMMIT。使用 `SELECT ... FOR UPDATE` 原生 SQL 或等价事务锁，确保同一订单全渠道并发受控。

出库：`BEGIN` → 锁出库单 → 验证 status=DRAFT → 以 SKU 稳定排序锁余额行 → 校验/扣减库存 → 保存 outbound_item unit cost → 写流水 → 标记 SHIPPED 和 confirm_operation_id → 审计 → COMMIT。

库存余额的 `(tenant_id, warehouse_id, product_id)` 唯一索引与事务是最终正确性的关键。所有重试行为严格限定为可识别的幂等操作，不可盲目重复扣增。

## 7. 索引与历史数据

已有联合索引：采购状态时间、包裹运单、库存 SKU、流水 SKU/时间、出库状态、审计时间。未来可扩充分区/归档，但 V1 不需要。禁止物理删除有采购/库存流水的商品和订单；取消单据用状态机表示。
