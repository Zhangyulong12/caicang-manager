# API_SPEC.md — 采仓管家 V1.0 REST API 契约

Base URL：本地 `http://localhost:3000/api/v1`；局域网设备换成电脑 IPv4；正式生产 `https://api.<domain>/api/v1`。

健康接口 `GET /health` 执行 PostgreSQL `SELECT 1` 后返回 `data: {status:"ok", service:"caicang-api", database:"reachable", timestamp:<ISO8601>}` 与 `requestId`；数据库查询失败返回 503 / `DATABASE_UNAVAILABLE`。开发 Swagger UI 为 `/api/docs`，OpenAPI JSON 为 `/api/docs-json`。

任务 04 已统一公共基础模块。任务 05–07 提供认证、会话与商家成员权限；任务 08 已实现商品列表/创建/详情/修改/按码查询；任务 09 已实现仓库列表和创建。采购、库存等其余业务接口仍是后续契约。Swagger 仅开发/测试模式可启用，生产强制关闭。

`auth/register`、`auth/login`、`auth/refresh`、`auth/logout`、`health` 不要求 Access Token；refresh/logout 必须在正文提供 Refresh Token 凭据。`GET /me`、`GET /tenants` 与 `POST /tenants` 为全局账号接口，只需 `Authorization: Bearer <access_token>`，不要求 X-Tenant-Id。其他商家路由同时验证 Token、唯一 UUID `X-Tenant-Id`、active membership 与显式角色/权限策略，禁止相信请求体 tenantId。AccessTokenGuard、TenantGuard、RolesGuard 顺序执行；未声明权限的新控制器默认拒绝。

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
- 新模块沿用 AppModule 导入的 CommonModule，不注册替代异常过滤器，不用 `@Res().json()` 绕过规范。文档成功体使用 `ApiDataResponse`/`ApiPageResponse`/`ApiArrayResponse`，公共 OpenAPI 自动追加错误响应与 requestId 参数。数组和分页响应不继承 data:object 约束。任务 07 已实现商家授权：业务控制器必须显式声明 TenantEndpoint/Roles/RequirePermissions，并从 CurrentTenant 获取数据库验证的上下文；商家接口的 OpenAPI 使用同一 security 对象声明 Bearer 和 tenant 两者必需。

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

- 成功 data 为 `{accessToken:"<JWT>",refreshToken:"<43字符随机凭据>",tokenType:"Bearer",expiresIn:900,refreshExpiresIn:<会话剩余秒数>,user:<同上安全用户信息>}`。每次登录建立独立会话，默认绝对有效期 7 天。
- 密码错误、邮箱不存在或账号停用统一 401 `INVALID_CREDENTIALS`（邮箱或密码不正确），不区分账号是否存在；未知邮箱也执行 bcrypt 比较，减少明显时序差异。
- 注册/登录均按既有敏感限流策略每 IP 每路由 5 次/60 秒，包含失败与无效输入，超限返回 429/Retry-After。

### GET /me（需 Bearer，成功 200）

请求头：`Authorization: Bearer <data.accessToken>`；不传密码、userId 或 X-Tenant-Id。返回 `data:<安全用户信息>`，只包含 id/email/displayName/isActive/createdAt/updatedAt，绝不包含密码哈希。

Access Token 使用 HS256，默认 900 秒，可配置 60–900 秒；校验签名、算法、issuer=caicang-api、audience=caicang-clients、sub/sid/jti UUID、type=access、iat/exp 和最大时长。每次受保护请求查数据库确认账号启用，以及 sid 会话属于此账号、未撤销且未到期。缺少 Token 返回 401 `UNAUTHENTICATED`，格式错误/伪造/过期/会话失效返回 401 `INVALID_ACCESS_TOKEN`；停用或已删除用户返回 401。Token 不接受 query 参数或自定义用户身份头。升级前没有 sid 的旧 Access Token 需要重新登录。

所有已注册控制器默认需要 Access Token；仅显式 `@Public()` 的端点例外。任务 07 起，其他默认商家控制器还必须通过 TenantGuard 与 RolesGuard；仅显式 GlobalAccount 的账号级接口免商家上下文，不免身份验证。

Swagger 操作：先执行 register，再执行 login，复制 data.accessToken 到页面 Authorize 的 bearer 输入框（只填 Token 本身），执行 GET /api/v1/me。重复注册示例邮箱会得到 409，可改为新的测试邮箱。完整步骤见 `AUTHENTICATION.md`。

## 任务 06：刷新与安全退出（已实现）

### POST /auth/refresh（Refresh Token 凭据，成功 200）

```json
{"refreshToken":"<粘贴最近一次 login 或 refresh 返回的 data.refreshToken>"}
```

- 不需要 Access Token，过期 Access Token 不阻止刷新。refreshToken 必须是 32 随机字节的规范 base64url 字符串，43 字符，无 padding、空格或 Bearer 前缀。不接收 URL/query、cookie 或隐式身份。
- 成功 data 与 login 相同，返回新的 Access/Refresh Token，user 为最新安全资料。客户端必须原子替换两个令牌，并串行刷新；旧 Refresh Token 一次性使用。会话绝对到期时间不会随刷新延长，refreshExpiresIn 是剩余秒数；REFRESH_TOKEN_TTL_SECONDS 默认 604800，允许 3600–2592000。
- 未知、过期、撤销、已使用凭据或账号停用统一 401 `INVALID_REFRESH_TOKEN`，details 为空。旧凭据被重复使用时撤销整个会话，包括最新子令牌和关联 Access Token。并发刷新同一个凭据：至多一个成功，另一个返回 401 并撤销该会话；客户端须重新登录。网络响应丢失后不可盲目重试旧凭据。
- 使用 PostgreSQL 事务和会话行锁，支持多个 API 进程；写入失败整体回滚，不消费旧凭据。只持久化 SHA-256 哈希，256 位随机源不使用密码式低熵凭据；无额外 JWT_REFRESH_SECRET。

### POST /auth/logout（Refresh Token 凭据，成功 200）

正文同 refresh；成功 `{"data":{"loggedOut":true},"requestId":"<UUID>"}`。

- 凭据持有者撤销其所属整个会话，不信任 userId、tenantId 或另一个 Bearer 身份。已轮换的旧凭据也可退出。退出成功后的后续请求中，此会话 Access Token 返回 401，所有 Refresh Token 无法再刷新；已通过认证的在途请求不会被中断。
- 不要求有效 Access Token。未知、已过期或已撤销的格式合法凭据也返回 200，重复退出幂等，不暴露凭据是否存在；无效格式为 400 `VALIDATION_ERROR`。数据库失败仍返回标准错误，不伪报退出成功。客户端收到成功后清除本地两个令牌。
- 只撤销当前会话，不退出其他设备；撤销跨 API 重启有效。

register/login/refresh/logout 均沿用每 IP 每路由 5 次/60 秒限流。认证成功响应与 /me 使用 `Cache-Control: no-store`。原始 Token、哈希、密钥和密码不进入应用日志。生产仍强制校验 JWT_ACCESS_SECRET，必须通过进程环境注入至少 32 字节非占位密钥并使用 HTTPS。令牌不设置 cookie；客户端存储集成不在本任务范围。

## 任务 07：多商家与角色权限

- POST /tenants：Bearer 登录用户，无需商家头；正文 `{"name":"我的商家"}`，成功 201 返回 `{tenant,membership,defaultWarehouse}`。事务建立商家、当前用户 OWNER、code=DEFAULT/name=默认仓库及审计。名称去首尾空格，1–150 字符；不接受 tenantId/userId/role。创建每次产生独立商家，不做按名称自动合并或重试去重。
- GET /tenants/current：Bearer + 唯一 UUID X-Tenant-Id，所有 active 角色可用；返回 `{tenant,membership,permissions}`，只属于选定商家。permissions 是集中角色矩阵的当前权限说明，不代替服务端鉴权。
- GET /members：仅 OWNER/ADMIN，商家头必需；page 默认 1，pageSize 默认 20、最多 100，返回标准 data 数组/pagination/requestId。成员含 id/tenantId/userId/role/isActive/createdAt/updatedAt 与安全 user(id/email/displayName/isActive)，不返回密码、Token 或其他商家关系。
- POST /members：仅 OWNER/ADMIN，正文 `{"email":"registered@example.com","role":"BUYER"}`；仅加入已注册启用账号，成功 201 返回成员。OWNER 可授予 ADMIN/BUYER/WAREHOUSE/VIEWER，ADMIN 仅能授予 BUYER/WAREHOUSE/VIEWER。同一用户可加入多个商家，已存在（含停用）关系返回 409 MEMBER_ALREADY_EXISTS；停用关系需 PATCH 重新启用，不能重复创建。
- PATCH /members/{membershipId}：仅 OWNER/ADMIN，正文可含 role、isActive，至少一项；成功 200 返回最新成员。OWNER 可修改非 OWNER；ADMIN 只能修改普通三类角色，不能操作 ADMIN/OWNER 或授予更高角色。OWNER 不能通过此接口授予、转让、降级或停用，违规 403；用户无法借自改角色提权。相同请求重复执行无额外变更/审计。
- 缺失/非法/重复商家头为 400 INVALID_TENANT_HEADER；未加入、成员停用或权限不足为 403 FORBIDDEN。会员目标始终按 tenantId+membershipId 查询，跨商家与不存在目标均 404 NOT_FOUND。身份来自 Access Token，不能用请求体 tenantId、X-Role、X-User-Id 或 query 参数替代。
- BUYER 具有采购写入权限且无收货/出库确认权限；WAREHOUSE 具有收货/出库权限且无采购写入权限，VIEWER 只读。集中权限矩阵与 Guard 本次已建立，实际采购/出入库接口仍等待后续任务。
- 创建商家、添加/修改成员均在数据库事务中写审计；成员写入锁租户并重新验证操作者权限，不信任 Guard 的过时快照。审计记录角色/启用状态前后值及 requestId，不记录密码/Token/地址或任意请求正文。

## 任务 08：商品管理 API

所有商品接口同时要求 Bearer 与 X-Tenant-Id，五种 active 角色可读，OWNER/ADMIN/BUYER 可创建/修改；WAREHOUSE/VIEWER 只读。读写均经 Tenant Context 事务重新验证授权，跨商家 ID 与未知 ID 统一 404。

- POST /products：只有 sku 必填；name、articleNo、color、size、specification、unit（默认件）、barcode、referencePurchasePrice、isActive（默认 true）、remark 可选。name 留空时按 `货号 颜色 尺码` 生成，三者都空则用 SKU。参考价只接受非负十进制字符串或 null，最多十六位整数/两位小数，未知为 null；响应为两位小数字符串。例：`{"articleNo":"T20","color":"白色","size":"L","sku":"T20-WHT-L","referencePurchasePrice":"18.50"}`，成功 201。
- GET /products：标准分页 data 数组/pagination/requestId；page/pageSize 默认 1/20，上限 pageSize=100。search 按名称/货号/颜色/尺码/SKU/条码/规格做字面子串搜索、不区分大小写；isActive 与 hasBarcode 只接受 true/false 字符串；unit 精确筛选。默认包含停用商品，按 createdAt DESC/id DESC 稳定排序。
- GET /products/{id}：当前商家内商品详情（含停用）。SKU/name/specification/unit/barcode/referencePurchasePrice/isActive/remark 与 id/tenantId/createdAt/updatedAt 均返回，不包含订单或库存数据。
- PATCH /products/{id}：至少一个合法商品字段，省略不改；nullable 字段可传 null 清空，barcode 空白也归 null；sku/name/unit/isActive 不可 null。name 传空字符串表示改回按货号/颜色/尺码自动生成；未传 name 时，原名是自动生成的就随属性重算，是自定义名称则保持不变。成功 200，重复相同值不重复变更/审计，不修改历史采购行价格、折扣、成本或时间。
- GET /products/lookup?code=：code 去首尾空格、1–128 字符，按精确 SKU OR barcode 查询当前商家的启用商品；保留前导零/大小写/内部字符。data 为 0–2 个商品候选，未知或仅匹配停用商品为空；跨字段匹配不同商品时客户端必须选择，不自动采用第一个。不返回分页。

SKU/条码区分大小写，商家内唯一；SKU 去首尾空格后最长 80，barcode 最长 128 且可为空。停用商品仍占用编码。重复 SKU 为 409 PRODUCT_SKU_ALREADY_EXISTS，重复非空条码为 409 PRODUCT_BARCODE_ALREADY_EXISTS；并发冲突同样由数据库保证。名称最长 200、规格最长 200、单位最长 20、备注最长 2000；不接受 NUL、多余 tenantId/订单价格字段、无效类型或金额格式，返回标准 400。新迁移保留原数据，只新增参考进货价与备注列；参考 SQL 不叠加执行。

## 1. 账号/商家

任务 09 仓库接口：GET /warehouses?page=1&pageSize=20 返回当前商家分页列表（含 DEFAULT/停用），所有 active 角色可读；POST /warehouses 仅 OWNER/ADMIN 可创建，输入 `{"name":"深圳二仓","code":"SZ-02","remark":"小件商品存放区"}`，成功 201。name/code 去首尾空格后 1–100/1–40 字符，code 区分大小写并保留前导零；remark 可省略/null/空白，最多 2000 字符。同商家重复 code 返回 409 WAREHOUSE_CODE_ALREADY_EXISTS，其他商家允许同码。响应字段为 id/tenantId/name/code/remark/isActive/createdAt/updatedAt，不含 address。列表及总数都限定 tenantId、按 createdAt DESC/id DESC 排序；拒绝客户端 tenantId 和未知字段。创建与审计同事务，锁后复查权限；不开放删除、修改或调拨。见 WAREHOUSES.md。

|Method|Endpoint|用途|角色|
|---|---|---|---|
|POST|`/auth/register`|注册账号|公开|
|POST|`/auth/login`|登录，获得短期 Access Token 与独立会话 Refresh Token|公开|
|POST|`/auth/refresh`|刷新短期令牌|已登录/有效 refresh|
|POST|`/auth/logout`|撤销当前登录会话|Refresh Token 凭据|
|GET|`/me`|当前用户资料；商家列表留待后续|已登录|
|POST|`/tenants`|创建商家及默认仓库|登录用户|
|GET|`/tenants?page=1&pageSize=20`|本人 active 成员关系的商家列表，返回 TenantChoiceData 的标准分页；只接受 page/pageSize，不能查询其他 userId/tenantId|登录用户，无需商家头|
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
|GET|`/purchase-accounts`|采购账号分页查询（任务 27）|所有成员|
|POST|`/purchase-accounts`|创建平台采购账号（不存密码）|OWNER/ADMIN/BUYER|
|PATCH|`/purchase-accounts/{id}`|改别名/备注/启停用；有关联后禁改平台|OWNER/ADMIN/BUYER|
|DELETE|`/purchase-accounts/{id}`|仅删从未被采购单引用的账号|OWNER/ADMIN/BUYER|

## 3. 包裹/扫码/入库

任务 14 已实现包裹绑定、修改、详情与运单查询；任务 15 增加只读分页列表 `GET /packages`；任务 16 增加可验收明细与人工完成；任务 17 实现下表后三个入库端点（`POST /receipts` 为唯一增加库存的接口）。完整字段、状态图、并发与示例见 [PACKAGES.md](PACKAGES.md) 与 [RECEIPTS.md](RECEIPTS.md)。

|Method|Endpoint|用途|角色|
|---|---|---|---|
|GET|`/packages`|包裹搜索/分页/筛选，只读|所有成员|
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

任务 24 已实现表中 6 个出库端点（`GET/POST /outbound-orders`、`GET/PATCH /outbound-orders/{id}`、`POST /outbound-orders/{id}/ship`、`POST /outbound-orders/{id}/cancel`），字段、事务顺序、成本口径、错误码与核对 SQL 见 `docs/OUTBOUND.md`。`POST /inventory/adjustments`（盘点差异）仍是计划项。

任务 22 已实现表中两个库存查询端点（`GET /inventory/balances`、`GET /inventory/movements`，权限 `products:read`，字段与口径见 `docs/INVENTORY.md`）。**`/inventory/*` 目前只有 GET，没有任何写动词**——库存数量只能由收货等业务事务在同一个数据库事务里"写 `stock_movements` + 改 `stock_balances`"来改变，不存在直接改余额的 CRUD 接口。`POST /inventory/adjustments`（盘点差异）仍是计划项：将来实现时也必须走同一路径（写一条 `ADJUSTMENT` 流水并同步成本池），并记录审计，而不是 `PATCH stock_balances`。

## 5. 关键请求示例

任务 12 已实现采购表中六个端点。创建成功 201，其余五个操作成功 200；所有端点需 Bearer+X-Tenant-Id。新增 purchase:read 全角色权限，写入限 OWNER/ADMIN/BUYER。输入 purchaseDate 为必填 YYYY-MM-DD，金额为十进制字符串；recipient 须完整对象，items 1–100 行且商品不可重复。PATCH 仅无后续单据的草稿，items 若提供为完整替换；确认/取消正文为空或 `{}`，禁止通过客户端 status/成本字段强改。

详情及分页行使用共享 PurchaseOrderData：recipient/recipientMasked、原始 items、receivedQuantity、freightAmount/goodsAmount/discountAmount/totalCost（两位字符串），确认后明细含 freightAllocated（两位）/landedUnitCost（四位），草稿为 null。VIEWER 收货三字段为 `[已隐藏]`，备注 null；所有响应 no-store。旧记录新增列不回填、不猜测历史日期/快照，缺失值按文档返回 null。

列表支持 page/pageSize、字面 search（单号/平台单号/店铺/商品 SKU 名称快照/货号）、status、platform、warehouseId、`purchaseAccountId`、`dateFrom`/`dateTo`（按采购日期含当日，起止颠倒返回 400），按 createdAt DESC/id DESC 排序并严格隔离总数。重复商家单号 409 PURCHASE_ORDER_NO_ALREADY_EXISTS；折扣大于行金额、金额汇总溢出、停用商品/仓库为 422 BUSINESS_VALIDATION_FAILED；非法状态修改或有收货记录的取消为 409 STATUS_CONFLICT。跨商家引用与未知 ID 均 404。

确认保存运费分摊与商品快照；前 N−1 行按净额比例向下截取到分，最后一行吸收尾差；全部净额为零按件数分配。PLACED 重复确认、CANCELLED 重复取消不重复写审计，其他不合法状态返回 409。条件、完整 Swagger 示例和事务约定见 PURCHASE_ORDERS.md；任务 14 开放包裹绑定、修改、详情和 lookup，收货/出库仍是后续设计。

### 5.1 创建采购单草稿

`POST /purchase-orders`

```json
{
  "warehouseId":"w-uuid",
  "platform":"TAOBAO",
  "platformOrderNo":"T202610140001",
  "supplierName":"示例商家",
  "purchaseDate":"2026-10-21",
  "recipient":{"name":"仓库收货人","phone":"13800000000","address":"测试地址"},
  "freightAmount":"10.00",
  "items":[
    {"productId":"product-a-uuid","quantity":10,"unitPrice":"18.50","discountAmount":"0.00"},
    {"productId":"product-b-uuid","quantity":5,"unitPrice":"9.00","discountAmount":"5.00"}
  ]
}
```

订单一旦 `/place` 成功：不可修改商品/数量/原价格；重新编辑必须取消且无已入库，或以后另做采购更正业务。

### 5.1.1 包裹列表（任务 15）

`GET /packages?page=1&pageSize=20&search=000PACKAGE-01&status=CREATED&hasReceipts=false`

- 权限 `packages:read`，五角色可读；响应为 `PackageData` 的标准分页数组，字段与 `GET /packages/{id}` 完全一致，包含采购单号/状态、运单、预估与实际收货、预计明细。
- `search` 为字面子串（`%`/`_` 不生效），匹配运单号、快递公司编码、采购单号，以及**本包裹预计明细**中的 SKU/名称；不会因为同采购单的其他包裹含该 SKU 而误命中。
- `purchaseOrderId`、`carrierCode`（转大写后精确匹配）、`status`（物流状态）、`hasReceipts`（true=已有收货记录）为可选筛选；`receivingStatus` 由真实收货推导，不提供检索以避免与存储状态混淆。
- 按 `createdAt DESC, id DESC` 稳定排序；总数与列表均限定 `tenant_id`。非法分页/枚举/UUID 返回 400，跨商家 ID 不会泄漏数据。

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

当前创建要求订单 PLACED/PARTIAL_RECEIVED；expectedItems 可省略或为空数组，同一采购行不能重复，全部包裹预计总量不得超过采购行数量。carrierCode 转大写，trackingNo 必须为字符串并保留前导零。同商家+公司+运单重复为 409 PACKAGE_TRACKING_ALREADY_EXISTS，超预计总量为 409 PACKAGE_EXPECTED_QTY_EXCEEDED。PackageData 显式区分包裹 status 与依据真实收货计算的 receivingStatus，不记录库存。

PATCH `/packages/{id}` 支持快递公司/运单/备注、完整替换预计明细、未收货改绑 purchaseOrderId 与物流 status；改绑须同时传目标单 expectedItems（可空）。已有任意收货记录/明确关闭标记/收货状态，或采购单终态，只允许补充备注；相同 PATCH 不改变时间和审计。输入禁止手动设置 PARTIAL_RECEIVED/RECEIVED、receivedQuantity、receivingClosedAt。只允许文档状态转换，错误统一返回公共结构。

未来收货时，预计为空的包裹由收货员手动选择实际 SKU，并在最后一次实际验收后明确完成包裹收货；本任务不开放这些后续接口。

### 5.3 根据扫描结果查包裹

`GET /packages/lookup?trackingNo=783456123000`
```json
{
  "data": [{
    "packageId":"package-uuid", "trackingNo":"783456123000", "carrierCode":"ZTO",
    "purchaseOrderId":"po-uuid", "purchaseOrderNo":"PO-20261014-0001",
    "packageStatus":"CREATED", "receivingStatus":"NOT_RECEIVED",
    "hasReceipts":false, "receivedQuantity":0
  }],
  "requestId":"request-uuid"
}
```

空数组＝未知快递；多个结果＝必须由用户选择承运商、包裹归属，不可自动猜第一个。候选附带本包裹是否已有收货与已收数量，便于多候选页面直接显示进度；查询不创建包裹、不写收货、不动库存。

### 5.4 查询包裹可验收明细（任务 16）

`GET /packages/{id}/receivable`（OWNER/ADMIN/WAREHOUSE，`receiving:confirm`）

```json
{
  "data": {
    "packageId":"package-uuid", "purchaseOrderId":"po-uuid", "purchaseOrderNo":"PO-20261014-0001",
    "purchaseStatus":"PLACED", "packageStatus":"CREATED",
    "receivingStatus":"NOT_RECEIVED", "hasPlan":true, "receivingClosed":false,
    "receivedQuantity":0,
    "lines":[
      {"purchaseOrderItemId":"poitem-a-uuid","productId":"product-uuid","sku":"CHARGER-20W",
       "name":"20W 充电器","unit":"件","orderedQuantity":10,"receivedQuantity":4,
       "orderRemainingQuantity":6,"inPackagePlan":true,"expectedQuantity":6,
       "packageReceivedQuantity":0,"packageRemainingQuantity":6,"maxReceivableQuantity":6},
      {"purchaseOrderItemId":"poitem-b-uuid","productId":"product-uuid","sku":"CABLE-1M",
       "name":"1 米数据线","unit":"条","orderedQuantity":5,"receivedQuantity":0,
       "orderRemainingQuantity":5,"inPackagePlan":false,"expectedQuantity":null,
       "packageReceivedQuantity":0,"packageRemainingQuantity":null,"maxReceivableQuantity":5}
    ]
  }
}
```

- `receivedQuantity` 与 `orderRemainingQuantity` 按**整张采购单**统计，包含其他包裹的收货，避免同单两个包裹各收一次满量。
- 有预计明细时 `hasPlan=true`，`lines` 只含本包裹计划行；`maxReceivableQuantity = min(全单剩余, 本包裹剩余)`。
- 无预计明细时 `hasPlan=false`，`lines` 为采购单仍有剩余的 SKU（`inPackagePlan=false`、`expectedQuantity=null`），供人工选择实际到货商品。
- 包裹已人工关闭时 `receivingClosed=true`，全部 `maxReceivableQuantity=0`；历史超收数据向下夹到 0，不返回负数。
- 只读接口，不写收货单、不改库存；跨商家包裹 404，角色不符 403。

### 5.5 人工标记包裹验收完成（任务 16）

`POST /packages/{id}/complete-receiving`（OWNER/ADMIN/WAREHOUSE，`receiving:confirm`，正文为空）

用于**没有预计明细**的包裹：验收员人工核对后显式结束本包裹，返回 PackageData。

- 成功 200，写入 `receivingClosedAt` 与 `status=RECEIVED`，`receivingStatus` 变为 `RECEIVED`；不创建收货单、不增加库存、不改采购单状态。
- 有预计明细的包裹返回 409 `STATUS_CONFLICT`（应按预计数量自动完成，不能手工绕过数量校验）。
- 采购单已取消返回 409 `STATUS_CONFLICT`；已经关闭的包裹重复调用返回 200 且不改变时间、不重复审计。

### 5.6 提交一次验收入库（写操作必须幂等）

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

预期成功 `201` 首次创建，重复完全相同 ID 和请求体返回 `200` 原 receipt；操作 ID 冲突但 payload 不同返回 `409 IDEMPOTENCY_CONFLICT`；已收超过订购数量或本包裹计划剩余返回 `409 RECEIPT_QTY_EXCEEDED`；不是本商家的包裹返回 404；采购单非可收货状态或包裹已关闭返回 `409 STATUS_CONFLICT`。

- 服务端从包裹推导采购单与仓库，忽略并拒绝客户端提交的 `warehouseId`、库存余额、单位成本等字段（400 `VALIDATION_ERROR`）。
- 单一事务内按 商家 → 采购单 → 包裹 → 库存余额（按 product_id 排序）加锁；写收货单、收货明细、库存余额、移动加权成本、不可变流水、采购单/包裹状态与审计，任一步失败全部回滚。
- 客户端只需提交验收事实，库存与成本不退让给前端计算；字段、幂等、锁序与成本公式见 [RECEIPTS.md](RECEIPTS.md)。

### 5.7 入库单列表与详情（任务 17）

`GET /receipts?page=1&pageSize=20&packageId=&purchaseOrderId=&search=`（全角色，`packages:read`）

返回 `ReceiptData` 分页，按 `receivedAt DESC, id DESC` 排序；`search` 命中入库单号、采购单号、运单号的字面子串。`GET /receipts/{id}` 返回逐行 SKU/名称/单位/数量/到岸成本快照。查询强制商家隔离，VIEWER 的 `remark` 固定为 `null`。

### 5.8 确认出库（任务 24 已实现）

`POST /outbound-orders/{id}/ship`

```json
{"clientOperationId":"2d174cc7-75f7-4fc4-893e-5a16909c005b","carrierCode":"YTO","trackingNo":"YT00123456789"}
```

成功后扣库存并写 `OUTBOUND` 流水与审计；重复同样确认 ID 返回原结果（200）、不再扣减，换新的确认 ID 再确认已 SHIPPED 的出库单返回 `409 STATUS_CONFLICT`；存量不足返回 `409 OUT_OF_STOCK`，`details.shortages` 逐 SKU 给出 `requestedQuantity` 与 `availableQuantity`。`carrierCode` / `trackingNo` / `remark` 可选，给了就覆盖草稿里的值，并计入 `confirm_request_hash`。

### 5.9 采购账号（任务 27 已实现）

`GET/POST /purchase-accounts`、`PATCH/DELETE /purchase-accounts/{id}`，完整字段、错误码与核对 SQL 见 [PURCHASE_ACCOUNTS.md](PURCHASE_ACCOUNTS.md)。

```json
{"platform":"JD","alias":"京东采购号","remark":"3C 类目"}
```

只存平台、别名、备注、启停用；平台限 `TAOBAO/JD/PDD/OTHER`，同商家同平台别名唯一。请求体里的未知字段（例如 `password`）被白名单拒绝为 400。采购单可选 `purchaseAccountId`，草稿显示账号当前别名，确认下单时冻结 `purchaseAccountAliasSnapshot`；已有采购记录的账号不能改平台、不能删除（409），停用后不能用于新采购或确认下单，但历史仍可查询。

## 6. 验证规则 / 约定

- 码值去首尾空格，不随意删除前导零/改写内部字符；最大长度 128，不能根据扫码文本直接构造 SQL。
- 采购行 SKU 不得重复；接收行 `receivedQty` 整数且 >0；禁止空数组入库。
- 列表 `page >=1` 且 `1<=pageSize<=100`；时间区间用 ISO8601。
- 每个关键写接口（新建采购、确认下单、包裹关联、收货、发货、调整）至少具备 DB 唯一键或明确的幂等策略。重点收货/发货必须实现客户端操作 ID。
- 所有财务和库存的持久化逻辑在服务端，不依赖前端提交的库存余额或成本结果。
- API 更新以 OpenAPI 为契约源；在 CI 校验 DTO 与 API 文档一致。
