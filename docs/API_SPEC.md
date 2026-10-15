# API_SPEC.md — 采仓管家 V1.0 REST API 契约

Base URL：本地 `http://localhost:3000/api/v1`；局域网设备换成电脑 IPv4；正式生产 `https://api.<domain>/api/v1`。

健康接口 `GET /health` 执行 PostgreSQL `SELECT 1` 后返回 `data: {status:"ok", service:"caicang-api", database:"reachable", timestamp:<ISO8601>}` 与 `requestId`；数据库查询失败返回 503 / `DATABASE_UNAVAILABLE`。开发 Swagger UI 为 `/api/docs`，OpenAPI JSON 为 `/api/docs-json`。

任务 04 已统一公共基础模块。任务 05 新增 `POST /auth/register`、`POST /auth/login`、`GET /me`；其余业务、refresh/logout、商家/角色权限仍是后续契约，未实现。Swagger 仅开发/测试模式可启用，生产强制关闭。

`auth/register`、`auth/login`、`health` 公开。`GET /me` 为全局账号接口，只需 `Authorization: Bearer <access_token>`，不要求 X-Tenant-Id；仅返回当前账号资料，不返回商家数据。其他后续商家业务路由必须同时验证 Token、`X-Tenant-Id` 对应 active membership 和角色后才能开放。禁止相信请求体 tenantId；当前 AccessTokenGuard 只实现身份验证，不冒充商家权限检查。

统一成功体：`{"data": { ... }, "requestId": "..."}`；列表：`{"data": [...], "pagination":{"page":1,"pageSize":20,"total":100},"requestId":"..."}`；失败体：`{"error":{"code":"OUT_OF_STOCK","message":"库存不足","details":{}},"requestId":"..."}`。HTTP: 400 格式错，401 未认证，403 无权，404 对象不存在或跨租户，409 状态/库存/幂等冲突，422 数量业务校验，429 速率限制，500 服务异常。所有金钱数值为字符串。

## 公共规范（任务 04）

- JSON 成功和错误体均有 requestId，响应头 `X-Request-Id` 与其一致。客户端可发送合法 UUID 作为关联 ID；缺失、重复头合并值或非法格式会替换为服务器 UUID。此值不作为认证、租户或幂等依据。下文示例省略 requestId 时仍遵循此规则。
- 控制器只返回数据；列表返回 `PageResult(items,pagination)`，全局拦截器负责包装，undefined 返回 data:null，保留原 HTTP 状态。Swagger HTML/OpenAPI 标准文档、OPTIONS 204 和无内容响应不套 JSON 成功体。
- DTO 必须用 class-validator 装饰器定义，嵌套类配 `@Type` 和 `@ValidateNested`。全局启用 transform、whitelist、forbidNonWhitelisted/forbidUnknownValues，关闭隐式转换；数字请求体不得用字符串冒充。分页使用 `PaginationQueryDto` 显式转换，page≥1、pageSize 1–100。
- DTO 错误为 400 `VALIDATION_ERROR`，details.fields 仅含字段路径和验证规则名，不返回 target/value 或带原值的验证消息；未知字段名归一化。畸形 JSON/顶层 null 等在解析阶段返回 400 `BAD_REQUEST`；超限 JSON 返回 413 `PAYLOAD_TOO_LARGE`（默认 64 KiB）。
- 业务异常统一 `BusinessException(code, details)`，HTTP 状态和消息由公共注册表控制，不自行组装 error。内置 HTTP 异常转换为同一结构；未知错误统一 500 `INTERNAL_ERROR`，不返回 SQL、堆栈、连接串或异常原文。
- 通用码：BAD_REQUEST、VALIDATION_ERROR、UNAUTHENTICATED、FORBIDDEN、NOT_FOUND、METHOD_NOT_ALLOWED、RESOURCE_CONFLICT、BUSINESS_VALIDATION_FAILED、RATE_LIMITED、PAYLOAD_TOO_LARGE、UNSUPPORTED_MEDIA_TYPE、INTERNAL_ERROR、SERVICE_UNAVAILABLE、DATABASE_UNAVAILABLE。库存/幂等码按后续章节保留；错误码联合类型位于 `packages/api-contract`。
- 日志只写时间、事件、requestId、方法、状态、耗时与错误码；不记录原始 URL/路径/查询、正文、头、密码、Token、地址、异常原文或堆栈。所有 Nest Logger 调用经 SafeLogger，不能用 console 或 Prisma query logging 绕过。结构化业务错误详情递归遮蔽敏感字段。
- CORS 使用精确 origin 白名单，支持 GET/HEAD/POST/PUT/PATCH/DELETE/OPTIONS 与 Authorization/Content-Type/X-Tenant-Id/X-Request-Id；暴露追踪及限流响应头。API 自身同源请求（例如 Swagger POST）与无 Origin 的原生客户端可请求；其他非白名单 Origin 返回统一 403。CORS 不替代认证与角色检查，当前不启用跨域 cookie credentials。
- 全局限流默认每 IP 每路由 120 次/60 秒；未来敏感接口使用 `@SensitiveRateLimit()` 收紧到 5 次/60 秒，超限统一 429，带 Retry-After。采用单进程内存存储，重启计数清零；多实例部署前需共享存储，当前不宣称分布式限流。
- 默认不信任 X-Forwarded-For。反向代理配置必须明确通过 TRUSTED_PROXIES 指定 IP/CIDR，并由部署限制直连；不接受 true、任意跳数或 0 位前缀范围。基础安全头覆盖成功、错误和预检；生产启用 HSTS，TLS 终止在后续部署阶段配置。
- 新模块沿用 AppModule 导入的 CommonModule，不注册替代异常过滤器，不用 `@Res().json()` 绕过规范。文档成功体使用 `ApiDataResponse`/`ApiPageResponse`，公共 OpenAPI 自动追加错误响应与 requestId 参数。Bearer 认证在任务 05 已实现；商家头方案仅预留，尚未实现商家授权。

## 任务 05：注册、登录与本人资料（已实现）

### POST /auth/register（公开，成功 201）

```json
{"email":"new-user@example.com","password":"CaicangDemo!2026","displayName":"新用户"}
```

- email 去首尾空格并转小写，验证邮箱格式及最长 320 字符。数据库 `lower(btrim(email))` 唯一索引防止大小写/空格差异及并发重复注册；冲突返回 409 `EMAIL_ALREADY_EXISTS`。
- password 至少 12 字符，含大小写字母、数字、符号，最多 72 个 UTF-8 字节，不接受控制字符或无效代理字符；不裁剪、不去空格。使用 bcrypt cost 12 保存哈希。
- displayName 可省略，默认使用邮箱 @ 前部分；若填写则去首尾空格、1–100 字符。禁止提交 role、tenantId、isActive 或 passwordHash 等多余字段。
- 成功：`{"data":{"user":{"id":"<UUID>","email":"new-user@example.com","displayName":"新用户","isActive":true,"createdAt":"<ISO8601>","updatedAt":"<ISO8601>"}},"requestId":"<UUID>"}`。
- 注册只创建全局账号并启用，不创建商家/成员关系、不自动返回 Token；随后调用 login。未实现邮箱验证邮件。

### POST /auth/login（公开，成功 200）

```json
{"email":"new-user@example.com","password":"CaicangDemo!2026"}
```

- 成功 data 为 `{accessToken:"<JWT>",tokenType:"Bearer",expiresIn:900,user:<同上安全用户信息>}`。没有 Refresh Token。
- 密码错误、邮箱不存在或账号停用统一 401 `INVALID_CREDENTIALS`（邮箱或密码不正确），不区分账号是否存在；未知邮箱也执行 bcrypt 比较，减少明显时序差异。
- 注册/登录均按既有敏感限流策略每 IP 每路由 5 次/60 秒，包含失败与无效输入，超限返回 429/Retry-After。

### GET /me（需 Bearer，成功 200）

请求头：`Authorization: Bearer <data.accessToken>`；不传密码、userId 或 X-Tenant-Id。返回 `data:<安全用户信息>`，只包含 id/email/displayName/isActive/createdAt/updatedAt，绝不包含密码哈希。

Access Token 使用 HS256，默认 900 秒，可配置 60–900 秒；校验签名、算法、issuer=caicang-api、audience=caicang-clients、sub UUID、type=access、jti UUID、iat/exp 和最大时长。每次受保护请求查数据库确认账号存在且启用。缺少 Token 返回 401 `UNAUTHENTICATED`，格式错误/伪造/过期返回 401 `INVALID_ACCESS_TOKEN`；停用或已删除用户返回 401。Token 不接受 query 参数或自定义用户身份头。

所有已注册控制器默认需要 Access Token；仅显式 `@Public()` 的端点例外。商家业务仍须在后续阶段加入 tenant/membership/role 检查，不能只靠当前身份守卫开放业务。

Swagger 操作：先执行 register，再执行 login，复制 data.accessToken 到页面 Authorize 的 bearer 输入框（只填 Token 本身），执行 GET /api/v1/me。重复注册示例邮箱会得到 409，可改为新的测试邮箱。完整步骤见 `AUTHENTICATION.md`。

## 1. 账号/商家

|Method|Endpoint|用途|角色|
|---|---|---|---|
|POST|`/auth/register`|注册账号|公开|
|POST|`/auth/login`|登录，获得短期 Access Token（当前无 refresh）|公开|
|POST|`/auth/refresh`|刷新短期令牌|已登录/有效 refresh|
|POST|`/auth/logout`|注销 refresh token|用户|
|GET|`/me`|当前用户资料；商家列表留待后续|已登录|
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
