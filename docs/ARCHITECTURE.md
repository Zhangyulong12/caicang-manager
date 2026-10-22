# 技术架构与项目目录结构

## 1. 取舍

任务 09 增加 WarehousesModule，沿用 Guard/Decorator/TenantContextService，GET/POST 仓库分别要求 warehouses:read/write。服务显式选择公开字段、分页与总数限定 tenantId，写事务锁后复查权限并原子审计。仅新增 nullable 仓库备注迁移，继续复用创建商家时的默认仓库与既有采购/分仓库存约束；不实现调拨、删除和库存 CRUD。详见 WAREHOUSES.md 与 ADR-016。

首版采用“模块化单体后端 + 两个客户端”：避免微服务过度设计。电脑后台用 Vue 3/Vite/Element Plus；手机使用 uni-app Vue 3，安卓原生打包优先；后端使用 NestJS TypeScript；PostgreSQL 作为单一事务真相来源。Redis、RabbitMQ、K8s、AI/OCR 不做首版硬性依赖。

Prisma 版本建议选择已明确兼容的 V7（整仓版本锁定，不用 `latest` 浮动）。**V7 关键差异**：`prisma-client` generator 显式输出目录；`prisma.config.ts` 配数据源 URL；PostgreSQL 运行时必须配 `@prisma/adapter-pg` + `new PrismaClient({ adapter })`；Node.js ESM/CLI 版本要求依真实创建时间的官方文档核查。

## 2. Monorepo 计划目录

```text
caicang-manager/
├─ AGENTS.md                         # Codex 必须遵守的开发规则
├─ README.md
├─ package.json                      # pnpm workspace 根命令
├─ pnpm-workspace.yaml
├─ pnpm-lock.yaml
├─ .env.example
├─ .gitignore
├─ apps/
│  ├─ api/                           # NestJS
│  │  ├─ package.json
│  │  ├─ prisma/
│  │  │  ├─ schema.prisma             # Prisma schema
│  │  │  └─ migrations/              # 版本化数据库迁移
│  │  ├─ prisma.config.ts
│  │  ├─ src/
│  │  │  ├─ main.ts                  # /api/v1 / OpenAPI / CORS
│  │  │  ├─ app.module.ts
│  │  │  ├─ config/
│  │  │  ├─ common/                  # DTO、guards、filters、decorators
│  │  │  ├─ prisma/                  # @prisma/adapter-pg 初始化
│  │  │  ├─ modules/
│  │  │  │  ├─ auth/
│  │  │  │  ├─ tenants/
│  │  │  │  ├─ members/
│  │  │  │  ├─ warehouses/
│  │  │  │  ├─ products/
│  │  │  │  ├─ purchasing/
│  │  │  │  ├─ packages/
│  │  │  │  ├─ receiving/
│  │  │  │  ├─ inventory/
│  │  │  │  ├─ outbound/
│  │  │  │  ├─ reports/
│  │  │  │  └─ audit/
│  │  │  └─ generated/prisma/
│  │  └─ test/                       # e2e/integration/concurrency
│  ├─ admin-web/                     # Vue 3 + Element Plus
│  │  ├─ package.json
│  │  ├─ src/
│  │  │  ├─ api/                    # typed client
│  │  │  ├─ router/
│  │  │  ├─ stores/                 # Pinia auth/tenant
│  │  │  ├─ layouts/
│  │  │  ├─ components/
│  │  │  ├─ views/
│  │  │  │  ├─ dashboard/
│  │  │  │  ├─ products/
│  │  │  │  ├─ purchases/
│  │  │  │  ├─ packages/
│  │  │  │  ├─ receipts/
│  │  │  │  ├─ inventory/
│  │  │  │  ├─ outbound/
│  │  │  │  └─ settings/
│  │  │  └─ main.ts
│  └─ mobile/                         # uni-app Vue 3 + TS，HBuilderX 打开
│     ├─ manifest.json
│     ├─ pages.json
│     ├─ App.vue
│     ├─ main.ts
│     ├─ pages/
│     │  ├─ login/
│     │  ├─ home/
│     │  ├─ scan-package/
│     │  ├─ receive-check/
│     │  ├─ receive-result/
│     │  ├─ inventory/
│     │  ├─ outbound/
│     │  └─ me/
│     ├─ components/
│     ├─ services/                   # 与后台共用 API 语义
│     ├─ stores/
│     └─ utils/
├─ packages/
│  ├─ api-contract/                   # OpenAPI 生成或可跨端安全复用 DTO
│  └─ utils/                          # 仅纯 TS 辅助工具，不依赖浏览器 API
├─ infra/
│  ├─ compose.dev.yml                 # 本地 PostgreSQL
│  ├─ compose.prod.yml                # 正式 API、PostgreSQL、反代
│  ├─ Dockerfile.api
│  ├─ Dockerfile.web
│  ├─ Caddyfile
│  └─ backup/
├─ docs/
│  ├─ PROJECT_SPEC.md
│  ├─ ARCHITECTURE.md
│  ├─ DATABASE_DESIGN.md
│  ├─ API_SPEC.md
│  ├─ SCAN_FLOW.md
│  ├─ DEPLOYMENT.md
│  └─ CODEX_TASKS.md
└─ scripts/
   ├─ dev.ps1
   ├─ seed.ts
   └─ smoke-test.ps1
```

以上是**目标代码仓结构**。任务 01 已建立 API、管理端、手机端和两个公共包的骨架；业务 modules、迁移和生产 infra 按后续任务建立。手机工程采用 DCloud CLI 标准布局，App.vue、main.ts、manifest.json、pages.json 和页面实际位于 `apps/mobile/src`，HBuilderX 后续打开 `apps/mobile` 根目录。开发 Compose 统一位于 `scripts/compose.dev.yml`；具体版本与取舍见 ADR-008。

## 3. 关键职责边界

任务 04：`apps/api/src/bootstrap.ts` 是唯一启动配置入口；CommonModule 使用 APP_PIPE/APP_FILTER/APP_INTERCEPTOR/APP_GUARD 将公共规范应用到全部业务控制器，PrismaService 通过 ConfigService 读取经过校验的配置。测试夹具仅存在于独立 test 根模块及忽略的 .test-build 中，正式 AppModule 不引用它们。新增模块规范见 `BACKEND_FOUNDATION.md`。

任务 05：AuthModule 提供邮箱认证与全局 AccessTokenGuard，控制器默认需要身份；health/register/login 显式 Public，GET /me 从 CurrentUser 读取守卫已验证的安全账号信息。PrismaModule 导出唯一共享 PrismaService，避免每个业务模块建立独立连接池。全局账号认证与商家权限分开；任务 07 已在身份之后加入 tenant/membership/role 守卫，详见下方实现说明。

- 前端只负责表单、扫码、扫码候选展示和请求发出；**不得在前端计算最终库存或写入成本**。
- API guard 负责认证、商家成员身份和角色；DTO 负责输入验证；业务 service 负责状态机及权限细节；数据库负责最终事务/约束。
- `receiving`、`outbound`、`inventory` 必须共同约定库存写入服务，不允许三套独立库存算法。
- 共享 `api-contract` 只放 JSON schema/OpenAPI 生成类型，不要跨端引用 NestJS runtime。

## 4. 工程质量

- 分支：`main` 稳定，按任务提交 `feat/task-xx`。每个阶段前 Git commit，Codex 要展示文件变更和测试结果。
- 规范：ESLint + Prettier + TypeScript strict + Zod/class-validator DTO + 自动测试；API Swagger/OpenAPI。
- CI：安装锁文件、静态检查、构建 API/Web、测试、数据库 schema/migration 校验；Android 手工真机验收另列。
- 配置：三个客户端使用不同的环境变量；任何私钥、签名文件、服务端数据库密码不得进 Git。
- 部署：生产 API 无状态，可横向扩；DB/存储仅后端可达；HTTPS 与 CORS 只允许明确域名。

## 5. 安全与多租户

数据库行采用 `tenant_id`，所有业务查询显式应用租户范围，API 每请求检查当前用户归属。关键读写禁止 `findUnique({where:{id}})` 后无租户验证；跨商家资源返回 404，避免枚举。成员权限变更需审计。收货人、手机号、地址为敏感资料：导出前做角色授权、日志不记录原文、最小化展示/脱敏。

## 6. 成本与商品码

商品条码仅用于映射 SKU；扫码入库运单匹配包裹。一个 SKU 可以有多次不同采购价，账面库存成本按移动加权平均。采购信息必须保留原始单价与费用，不能因为库存平均成本变化覆盖采购历史。

## 7. 文档更新规则

任务 10：Vue Router/Pinia、统一 api/client.ts、认证与商家 store 管理主布局。localStorage 原子令牌对和 Web Locks 协调同源多标签刷新/退出，storage 事件同步账号变化，sessionKey/generation 拒绝迟到响应。路由通过 /tenants/current 验证当前权限。新增 GET /tenants 只查认证用户本人 active memberships，无数据库迁移。详见 WEB_AUTHENTICATION.md 与 ADR-017。

任务 11：api/catalog-form.ts 集中表单校验及白名单载荷，api/catalog.ts 复用统一客户端，捕获账号会话/商家和权限并拒绝迟到响应；Vue 页面只处理展示与交互。商品/仓库写权限最终由原 API Guard 与事务保证。默认业务仓库偏好以 userId+tenantId 分键存本机，恢复时分页查询真实仓库验证，业务资料仍保存在 PostgreSQL。金额全程字符串，不新增 API、模型或库存操作。详见 WEB_CATALOG.md 与 ADR-018。

任务 12：PurchaseOrdersModule 复用公共 DTO/响应/异常/日志与 TenantContextService，成本集中于 purchase-cost.ts；单价与优惠来自订单，不读取商品参考价计算采购。采购写入按租户根、采购主单的顺序持锁，锁后重读状态与权限，状态和明细/审计原子提交。Prisma 显式创建主单和明细，避免共享复合外键嵌套写入歧义。新增六个 API 与可追踪增量迁移；VIEWER 在服务端映射时隐藏收货信息。详见 PURCHASE_ORDERS.md 与 ADR-019。

任何业务流程改变必须先更新 spec/API/DB 决策，再改实现，最后加测试。`schema.sql` 和 Prisma schema 要一致；后续以 Prisma 迁移为最终运行源，SQL 参考稿需标示是否仍同步。分阶段由 Codex 更新 CHANGELOG。

## 任务 06：可撤销认证会话

AuthModule 继续复用统一 DTO/响应/错误/日志/限流。每次登录创建 PostgreSQL auth_sessions 与 refresh_tokens；Refresh Token 为 256 位随机值，只存 SHA-256 哈希。refresh/logout 不依赖有效 Access Token，以正文中的随机凭据证明会话持有权。会话行锁将轮换、重放撤销与退出串行化，可跨 API 实例共享数据库状态。Access JWT 新增 sid，每次受保护请求检查账号、会话归属、到期和撤销；旧版无 sid 的 Token 需要重新登录。

严格轮换不提供旧凭据宽限重试：重放撤销该登录会话的整条凭据链。正常刷新不立即废除同会话尚未到期的旧 Access Token；退出、重放撤销与会话到期会在后续认证请求中拒绝全部关联 Access Token。已经通过认证的在途请求不被强行中断。其他设备会话互相独立。

会话是全局账号身份设施，无商家数据或权限；商家路由独立检查 tenant/membership/role。API 限流仍是进程内存计数，分布式限流及前端安全存储不在本任务范围。

## 任务 07：默认拒绝的商家授权

AuthModule 顺序注册身份、租户与角色三个全局 Guard。TenantGuard 根据 Access Token 认证的 user.id 与唯一 UUID X-Tenant-Id 查询数据库启用成员，生成冻结 TenantContext；RolesGuard 校验显式角色/权限策略，无声明默认拒绝。/me 与 POST /tenants 显式 GlobalAccount，公开认证路由仍显式 Public。该例外不适用于商家业务。

TenantsModule 创建商家时事务写 OWNER、默认仓库及审计；MembersModule 提供分页列表、按已注册邮箱加入、角色/启停修改。TenantContextService 为读操作持有租户 SHARE 锁、写操作持有 UPDATE 锁，取得锁后重新检查授权，再执行 tenantId+目标 id 查询与审计。权限不会写进 Access Token，成员降级/停用无需等待 Token 到期。

集中角色矩阵区分 BUYER 的采购写入与 WAREHOUSE 的收货/出库权限。本任务仅建立授权能力和五个组织接口，采购、库存与出库业务仍未实现。详见 TENANT_AUTHORIZATION.md 与 ADR-014；后续模块必须沿用这一边界，不能只根据资源 UUID 或客户端角色判断。

## 任务 13：采购 Web

/purchases 列表与 /purchases/new、/purchases/:id、/purchases/:id/edit 接入既有采购 API；共享响应、认证刷新和 X-Tenant-Id，前端路由/按钮/服务执行 purchase:read/write，服务端事务仍最终授权。purchase-form.ts 集中表单校验、序列化及 BigInt 整数分预估；purchases.ts 捕获会话/租户，拒绝迟到响应，分页查询仓库。商品选择器查询真实启用商品；旧单沿用保存的原始价格。收货信息仅保留当前页面内存，离开有未保存提醒；无新表或依赖。ADR-020 记录金额与写入重试决策。

## 任务 16：扫码查询与待收数量

`GET /packages/lookup` 保持精确匹配与候选数组语义，只补充 `hasReceipts`/`receivedQuantity`，多候选仍由人工选择。新增 `GET /packages/{id}/receivable`：以 `receipt_items` 按 `purchase_order_id` 聚合出全单累计实收（跨包裹），再与本包裹计划对比，输出 ordered/received/orderRemaining/expected/packageReceived/packageRemaining/maxReceivable。有预计明细只列计划行，无预计明细列采购单剩余 SKU 供人工选择；超收向下夹到 0，接口只读不写库存。

`POST /packages/{id}/complete-receiving` 只接受无预计明细的包裹，沿用商家行锁 → 采购单锁 → 包裹锁的顺序，写 `receivingClosedAt` 与 `status=RECEIVED` 并原子审计，不创建收货单、不改库存或采购单状态；重复调用返回 200 且无副作用。`receivingStatus` 改为关闭标记优先，零收货的显式关闭也算验收完成。两个端点统一使用 `receiving:confirm`（OWNER/ADMIN/WAREHOUSE）。无新迁移、无新依赖。详见 PACKAGES.md、ADR-023。

## 任务 15：包裹 Web 页面

新增只读 `GET /packages` 分页接口，复用 PackagesModule、DTO、共用响应与 `packages:read` 权限，不新增表、迁移或依赖。列表返回与详情一致的 PackageData，搜索命中运单号、快递公司、采购单号及本包裹预计明细的 SKU/名称；筛选限采购单、快递公司、物流状态与有无收货记录，收货进度仍按真实明细推导，不提供检索以免与存储状态混淆。

前端 `api/packages.ts` 复用统一客户端与商家范围校验，拒绝迟到响应；`package-status.ts` 集中状态文案、比例与时间格式化。`/packages` 导航改为 `packages:read`，页面只读，不提供创建/修改/收货入口。预计明细由 UUID 排序改为按采购行号排序，保证列表与详情稳定可复现。详见 WEB_PACKAGES.md 与 ADR-022。

## 任务 14：采购包裹模块

PackagesModule 使用现有 packages、package_expected_items 及复合外键，不新增表或迁移；提供包裹绑定、修改、独立详情及精确运单查询。DTO、公共响应/错误、Guard 和 TenantContext 共享，packages:read/write/lookup 按角色授权。静态 lookup 路由先于 :id。

写事务锁商家并复查权限，再按 UUID 顺序锁相关采购主单、最后锁包裹并重读。改绑显式替换新单计划；删除明确移除的未收货计划行、更新归属、upsert 其余行和审计同事务。SUM(expected_quantity) 用整数文本/BigInt 对比采购数量，跨进程不能超分配。同值 PATCH 无时间/审计副作用。任意收货记录、关闭标记、收货状态或采购终态都会限制核心字段修改；物流不触发库存。receivingStatus 独立来自实际收货，VIEWER 隐藏备注，审计不存运单或备注原文。见 PACKAGES.md、ADR-021。

## 任务 08：商品主数据模块

ProductsModule 提供列表、创建、详情、修改和精确按码查询，统一通过 TenantContextService 事务访问；增加 products:read（全部角色）、products:write（OWNER/ADMIN/BUYER）。数据对象访问始终用 tenantId+id，金额使用 Decimal/字符串，停用不删除。新增参考价/备注的增量迁移保留旧数据，商品变更不触碰历史采购价或库存。SKU/条码跨字段重码时 lookup 返回候选数组，不猜第一项；默认只查启用商品。详见 PRODUCTS.md、API_SPEC.md、ADR-015 与 TASK_08_REPORT.md。
