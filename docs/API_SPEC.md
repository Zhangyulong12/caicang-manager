# API_SPEC.md — 采仓管家 V1.0 REST API 契约

Base URL：本地 `http://localhost:3000/api/v1`；局域网设备换成电脑 IPv4；正式生产 `https://api.<domain>/api/v1`。

任务 01 实现范围：仅公开 `GET /health`，执行 PostgreSQL `SELECT 1` 后返回 `data: {status:"ok", service:"caicang-api", database:"reachable", timestamp:<ISO8601>}` 与 `requestId`；数据库查询失败返回 503 / `DATABASE_UNAVAILABLE`。Swagger UI 为 `/api/docs`，OpenAPI JSON 为 `/api/docs-json`。下方其余业务接口均为后续阶段契约，当前尚未实现。

所有业务路由（不含 auth/login、health）需要 `Authorization: Bearer <access_token>` 和 `X-Tenant-Id: <tenant UUID>`。服务端验证 JWT userId 在 X-Tenant-Id 指向的商家有 active membership，并针对路由检查角色。禁止直接相信任何请求体的 `tenantId`；tenantId 以服务端已认证上下文为准。

统一成功体：`{"data": { ... }, "requestId": "..."}`；列表：`{"data": [...], "pagination":{"page":1,"pageSize":20,"total":100}}`；失败体：`{"error":{"code":"OUT_OF_STOCK","message":"库存不足","details":{}},"requestId":"..."}`。HTTP: 400 格式错，401 未认证，403 无权，404 对象不存在或跨租户，409 状态/库存/幂等冲突，422 数量业务校验，429 速率限制，500 服务异常。所有金钱数值为字符串。

## 1. 账号/商家

|Method|Endpoint|用途|角色|
|---|---|---|---|
|POST|`/auth/register`|注册账号|公开|
|POST|`/auth/login`|登录，获得 access/refresh token|公开|
|POST|`/auth/refresh`|刷新短期令牌|已登录/有效 refresh|
|POST|`/auth/logout`|注销 refresh token|用户|
|GET|`/me`|当前用户和可选商家列表|全部|
|POST|`/tenants`|创建商家及默认仓库|登录用户|
|GET|`/tenants/current`|当前商家信息|成员|
|GET|`/members`|成员列表|OWNER/ADMIN|
|POST|`/members`|添加现有用户与角色|OWNER/ADMIN|
|PATCH|`/members/{membershipId}`|修改角色/停用|OWNER/ADMIN；OWNER 专有约束|

## 2. 基础资料、采购

|Method|Endpoint|用途|角色|
|---|---|---|---|
|GET|`/warehouses`|仓库列表|所有成员|
|POST|`/warehouses`|创建仓库|OWNER/ADMIN|
|GET|`/products`|分页查询 SKU|所有成员|
|POST|`/products`|创建 SKU|OWNER/ADMIN/BUYER|
|GET|`/products/{id}`|SKU 详情|所有成员|
|PATCH|`/products/{id}`|修改 SKU/禁用|OWNER/ADMIN/BUYER|
|GET|`/products/lookup?code=`|条码或 SKU 查产品|所有成员|
|GET|`/purchase-orders`|采购单搜索/分页|所有成员|
|POST|`/purchase-orders`|新建 DRAFT 主单及 items|OWNER/ADMIN/BUYER|
|GET|`/purchase-orders/{id}`|采购单详情、明细、收货汇总|所有成员|
|PATCH|`/purchase-orders/{id}`|仅修改草稿|OWNER/ADMIN/BUYER|
|POST|`/purchase-orders/{id}/place`|确认下单、冻结价格、分摊运费|OWNER/ADMIN/BUYER|
|POST|`/purchase-orders/{id}/cancel`|取消未收货采购单|OWNER/ADMIN/BUYER|

## 3. 包裹/扫码/入库

|Method|Endpoint|用途|角色|
|---|---|---|---|
|POST|`/purchase-orders/{id}/packages`|为订单创建包裹、填写运单/预计包裹明细|OWNER/ADMIN/BUYER|
|PATCH|`/packages/{id}`|改运单/物流备注（已入库后受限）|OWNER/ADMIN/BUYER|
|GET|`/packages/lookup?trackingNo=`|按码值查包裹候选（可能多个承运商）|OWNER/ADMIN/BUYER/WAREHOUSE|
|GET|`/packages/{id}`|包裹信息和所在采购单|所有成员|
|POST|`/packages/{id}/complete-receiving`|包裹无预计明细时人工标记包裹验收完成；只改包裹状态，不增加库存|OWNER/ADMIN/WAREHOUSE|
|GET|`/packages/{id}/receivable`|当前剩余可验收 SKU 明细|OWNER/ADMIN/WAREHOUSE|
|POST|`/receipts`|确认一次部分/全部验收入库|OWNER/ADMIN/WAREHOUSE|
|GET|`/receipts`|收货单列表|所有成员|
|GET|`/receipts/{id}`|收货单详情|所有成员|

## 4. 库存/出库/报表

|Method|Endpoint|用途|角色|
|---|---|---|---|
|GET|`/inventory/balances`|按仓库、SKU 搜现存和成本|所有成员|
|GET|`/inventory/movements`|库存流水、分页/筛选|所有成员|
|POST|`/inventory/adjustments`|管理员盘点差异调整，审计必需|OWNER/ADMIN|
|GET|`/outbound-orders`|出库单列表|所有成员|
|POST|`/outbound-orders`|创建待发货草稿|OWNER/ADMIN/WAREHOUSE|
|GET|`/outbound-orders/{id}`|出库单详情|所有成员|
|PATCH|`/outbound-orders/{id}`|修改未确认草稿|OWNER/ADMIN/WAREHOUSE|
|POST|`/outbound-orders/{id}/ship`|确认发货并扣库存，幂等|OWNER/ADMIN/WAREHOUSE|
|POST|`/outbound-orders/{id}/cancel`|仅取消未确认草稿|OWNER/ADMIN/WAREHOUSE|
|GET|`/reports/overview?from=&to=&warehouseId=`|采购额、库存价值、已收统计|OWNER/ADMIN/BUYER/VIEWER|
|GET|`/reports/export/stock-movements.csv`|导出库存流水|OWNER/ADMIN|
|GET|`/health`|存活检查，生产避免暴露秘钥|公开|

## 5. 关键请求示例

### 5.1 创建采购单草稿

`POST /purchase-orders`

```json
{
  "warehouseId":"w-uuid",
  "platform":"TAOBAO",
  "platformOrderNo":"T202610140001",
  "supplierName":"示例商家",
  "recipient":{"name":"仓库收货人","phone":"13800000000","address":"测试地址"},
  "freightAmount":"10.00",
  "items":[
    {"productId":"product-a-uuid","quantity":10,"unitPrice":"18.50","discountAmount":"0.00"},
    {"productId":"product-b-uuid","quantity":5,"unitPrice":"9.00","discountAmount":"5.00"}
  ]
}
```

订单一旦 `/place` 成功：不可修改商品/数量/原价格；重新编辑必须取消且无已入库，或以后另做采购更正业务。

### 5.2 创建包裹

`POST /purchase-orders/{id}/packages`

```json
{
  "carrierCode":"ZTO",
  "trackingNo":"783456123000",
  "expectedItems":[
    {"purchaseOrderItemId":"poitem-a-uuid","expectedQuantity":10},
    {"purchaseOrderItemId":"poitem-b-uuid","expectedQuantity":5}
  ]
}
```

可传 `expectedItems: []`，则收货员从本采购单尚未收货的明细中手动选要入库的 SKU。一个包裹多次收货允许；仅有配送信息不等于入库。若该包裹没有预计明细，操作员需在最后一次实际验收后调用“完成包裹收货”，否则仅为部分入库状态。

### 5.3 根据扫描结果查包裹

`GET /packages/lookup?trackingNo=783456123000`

```json
{
  "data": [{
    "packageId":"package-uuid", "trackingNo":"783456123000", "carrierCode":"ZTO",
    "purchaseOrderId":"po-uuid", "purchaseOrderNo":"PO-20261014-0001",
    "packageStatus":"CREATED"
  }]
}
```

空数组＝未知快递；多个结果＝必须由用户选择承运商、包裹归属，不可自动猜第一个。

### 5.4 查询包裹可验收明细

`GET /packages/{id}/receivable`

```json
{
  "data": {
    "packageId":"package-uuid", "purchaseOrderId":"po-uuid",
    "lines":[
      {"purchaseOrderItemId":"poitem-a-uuid","sku":"CHARGER-20W","orderedQty":10,"receivedQty":4,"orderRemainingQty":6,"packageRemainingQty":6},
      {"purchaseOrderItemId":"poitem-b-uuid","sku":"CABLE-1M","orderedQty":5,"receivedQty":0,"orderRemainingQty":5,"packageRemainingQty":5}
    ]
  }
}
```

### 5.5 提交一次验收入库（写操作必须幂等）

`POST /receipts`

```json
{
  "packageId":"package-uuid",
  "clientOperationId":"c0f21ff9-b97c-4cea-b5d5-e99861c08c63",
  "items":[
    {"purchaseOrderItemId":"poitem-a-uuid","receivedQty":6},
    {"purchaseOrderItemId":"poitem-b-uuid","receivedQty":5}
  ],
  "remark":"外箱完好，人工核对无误"
}
```

预期成功 `201` 首次创建，重复完全相同 ID 和请求体返回 `200` 原 receipt；操作 ID 冲突但 payload 不同返回 `409 IDEMPOTENCY_CONFLICT`；已收超过订购数量返回 `409 RECEIPT_QTY_EXCEEDED`；不是本商家的包裹返回 404。

### 5.6 确认出库

`POST /outbound-orders/{id}/ship`

```json
{"clientOperationId":"2d174cc7-75f7-4fc4-893e-5a16909c005b","carrierCode":"YTO","trackingNo":"YT00123456789"}
```

成功后扣库存；重复同样确认 ID 返回原结果，换新的确认 ID 再确认已 SHIPPED 的出库单返回 409；存量不足返回 `409 OUT_OF_STOCK`。

## 6. 验证规则 / 约定

- 码值去首尾空格，不随意删除前导零/改写内部字符；最大长度 128，不能根据扫码文本直接构造 SQL。
- 采购行 SKU 不得重复；接收行 `receivedQty` 整数且 >0；禁止空数组入库。
- 列表 `page >=1` 且 `1<=pageSize<=100`；时间区间用 ISO8601。
- 每个关键写接口（新建采购、确认下单、包裹关联、收货、发货、调整）至少具备 DB 唯一键或明确的幂等策略。重点收货/发货必须实现客户端操作 ID。
- 所有财务和库存的持久化逻辑在服务端，不依赖前端提交的库存余额或成本结果。
- API 更新以 OpenAPI 为契约源；在 CI 校验 DTO 与 API 文档一致。
