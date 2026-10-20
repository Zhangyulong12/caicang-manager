# 架构决策记录（ADR）

- ADR-001：业务优先“采购到仓库再出库”，不做买家订单自动同步（首版无需电商平台授权）。
- ADR-002：模块化单体 NestJS，而不是微服务；PostgreSQL 事务保障一致性。
- ADR-003：扫码运单仅定位包裹，必须人工核对入库内容；支持无预计装箱明细的包裹验收后手动完结。
- ADR-004：库存使用移动加权平均成本；价格保存 Decimal，保留采购原始成本快照。
- ADR-005：一个商家多成员，所有业务请求校验 membership/role 与 tenant_id。
- ADR-006：移动端优先 uni-app Android 真机；Web 管理端独立 Vue3。

后续 Codex 如需修改任一决策，应写明变更原因、影响表、API、迁移与新验收测试。

## ADR-007：Windows 工作区与工具准备（2026-10-14，任务 00）

- 工作区采用用户指定的 `D:\Dev\caicang-manager`。从原资料包复制并校验 16 个文件；原目录保留，不迁移 C 盘用户数据。
- 保留可用的 Node 22.22.2 LTS 和 Corepack 0.34.6，不重装。通过 Corepack 启用现有 pnpm 11.25.0 对应的系统命令，实测普通 PowerShell 可以执行。此版本作为环境基线；阶段 01 再在 packageManager 与锁文件中固定项目依赖。
- 使用系统 Windows PowerShell 5.1 作为普通终端基线，不要求将 Codex 私有 PowerShell 7 加入系统 PATH。
- 初始化 main 分支并保存设计与环境快照。Docker、WSL2、HBuilderX 的失败项如实记录，不以已安装 CLI 或默认 WSL 版本代替引擎验证。
- Windows 11 22H2 超出支持期，先通过系统更新进入支持期，再修复 WSL2 和安装 Docker Desktop。不安装旧 Docker 绕过操作系统条件。
- 影响范围：开发工作区、工具配置、Git 忽略规则和环境文档；无数据库变更、API 变更或业务实现。验收依据见 `ENV_CHECK.md`。

## ADR-008：任务 01 工程与版本基线（2026-10-14）

- 保留现有 Node 22.22.2 和 pnpm 11.25.0，使用 pnpm workspace、精确直接依赖和锁文件。后端采用 NestJS 12.1.3 + TypeScript 5.9.3，通过 tsc 编译 ESM 与装饰器元数据，不调用需要更高 Node patch 的新 Nest CLI，不重装 Node。
- Prisma 保持 7.10.0（CLI/client/adapter 同版本），采用 `prisma-client`、显式 output、ESM、prisma.config.ts 数据源 URL 和 adapter-pg。任务 01 仅执行真实数据库健康查询，schema 不增加业务模型，不执行参考 SQL 或迁移；业务模型留待任务 02。
- Web 使用 Vue 3.5.44、Vite 8.3.4、Element Plus 2.14.7。手机工程按 DCloud 官方 CLI 模板的稳定版本 3.0.0-5020420260813003，锁定匹配的 Vue 3.4.21、Vite 5.2.8、DCloud types 3.4.31。pnpm 允许两个客户端各自使用适配的 Vite/Vue；不要强行统一导致 uni-app 编译器不兼容。
- uni-app 使用官方 CLI 布局：`apps/mobile/src` 中放置 App.vue、main.ts、pages.json、manifest.json 与页面。后续 HBuilderX 打开 `apps/mobile` 项目根。此布局细化原目录示意，不改变手机端技术选择。本次验证 H5 与 App 编译资源时不把它们称为签名 APK 或真机验收。
- pnpm 11 的配置放入 pnpm-workspace.yaml，使用 allowBuilds 逐包允许 Prisma/esbuild 构建脚本，明确拒绝非必需统计/募捐脚本；保持 strictPeerDependencies。固定 unplugin-auto-import 的可选 @vueuse/core peer 为兼容 Vue 3.4 的 10.11.1，避免自动选择要求 Vue 3.5 的版本。
- Docker 数据位置已由设置、WSL 注册信息和 D 盘 VHDX 文件共同核实。开发 Compose 将 PostgreSQL 16.15 镜像固定到本次真实拉取的 digest，命名卷持久化，数据库端口仅绑定 127.0.0.1。不删除卷、不初始化业务表。
- 公开健康接口返回 `data`/`requestId` 契约，并实际查询 PostgreSQL；Swagger 位于 `/api/docs`。只提供健康路由，不提前开放未经认证的业务接口。
- 来源：[NestJS 入门](https://docs.nestjs.com/first-steps)、[Prisma 7](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7)、[DCloud CLI 模板](https://github.com/dcloudio/uni-preset-vue/tree/vite-ts)、[pnpm 配置](https://pnpm.io/settings)。

## ADR-009：用户任务 02 的数据库环境范围与停启验证

- 最新用户任务 02 限定为本地数据库环境，优先于原阶段清单中的模型/迁移/种子范围。不添加业务模型、不导入参考 schema.sql、不应用空初始迁移。
- 继续使用 PostgreSQL 16.15 固定 digest、既有命名卷与 Prisma 7.10.0；不重建数据库，不改变已有 .env。新增停止脚本使用 compose stop，保留容器和卷。
- 首次生成 .env 使用 CreateNew 避免并发覆盖；已存在的环境配置不修改。数据库检查通过 TCP 与容器内环境变量进行密码认证，SQL 使用标准输入，避免 Windows PowerShell 5.1 的嵌套引号丢失。
- 提供 migrate dev/deploy/status 命令与 PostgreSQL migration_lock.toml；没有迁移历史时 migrate status 的退出码 1 如实报告，模型任务再初始化迁移，不通过重复应用 SQL 制造成功状态。
- 停启测试比较既有 PostgreSQL 集群标识、容器、卷与 .env 哈希，验证运行中的 API 在数据库停止时返回 503、恢复后返回 200，不写入或删除任何业务数据。测试子进程采用异步执行，避免阻塞 HTTP 连接关闭事件；失败时 finally 尝试恢复原本运行的数据库。
- 影响范围：本地脚本、根命令、迁移目录配置、测试与文档；PrismaService、健康接口和业务数据库结构沿用现状。

## ADR-010：用户任务 03 数据模型与初始迁移（2026-10-15）

- 本次用户任务 03 对应原阶段清单的数据库模型范围；不提前开发登录、基础资料或库存接口。17 张表通过 Prisma 7.10.0 migrate dev --create-only 生成追踪迁移，再补齐 CHECK、数据库时间触发器和显式事务。只用 migrate deploy 应用迁移，不执行参考 schema.sql。
- 维持全局 User 和租户根 Tenant，其余表 tenant_id 非空。业务关联使用 tenant_id 复合外键；操作者引用对应租户 membership。采用 Restrict，避免级联删除历史记录。
- 增加 expected/receipt 行 purchase_order_id 与复合候选键，把同商家不同订单串单、收货仓库不一致和商品错配从服务约定提升为数据库约束。成本快照统一 NUMERIC(20,4)，所有表补齐创建/更新时间。
- 普通 nullable UNIQUE 保留 PostgreSQL NULLS DISTINCT，与参考部分唯一索引有相同的非空唯一语义，不增加预览功能依赖。参考 CHECK 保留，另增加非空格 SKU CHECK。触发器不授予历史单据更新权限；多态流水/审计对象及总量限制留给后续事务服务。
- seed 使用固定演示租户/用户 UUID、自然唯一键 upsert、单事务与事务级 advisory lock；update 为空，保留已有数据、密码与角色。随机未公开密码用固定版本 bcryptjs 3.0.3 的 bcrypt cost 12 哈希；测试账号默认停用。允许可选 SEED_PASSWORD（12–72 字节），但不打印或提交密码。seed 拒绝生产模式和非本地/非指定开发测试数据库。
- 约束测试在同一 PostgreSQL 实例创建随机空数据库，只清理本轮拥有的测试数据库，不 reset 开发库、不删除容器/卷。实际执行迁移两次、seed 两次及并发重试、真实 SQL 正反例与并发唯一性校验；结构 diff 外另查系统目录确保 CHECK/触发器存在。
- 来源：[Prisma 7 seed](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/seeding)、[迁移中管理不支持的数据库特性](https://www.prisma.io/docs/orm/v7/prisma-schema/data-model/unsupported-database-features)。

## ADR-011：后端公共规范与安全边界（2026-10-15，任务 04）

- 使用 Nest 全局 APP_* 提供者统一 DTO 校验、成功体、异常、限流，单一 bootstrap 配置 /api/v1、CORS、请求追踪及安全头。健康接口只查询真实 PostgreSQL 并返回 HealthData，不再自行生成 ID 或错误体。列表也强制有 requestId，细化原列表示例。
- 固定 class-validator 0.15.1、class-transformer 0.5.1、@nestjs/throttler 6.7.1（peer 明确兼容 Nest 12）、@types/express 5.0.6。使用项目已锁定 Nest 12.1.3 的原生 useSecurityHeaders，不额外引入 Helmet；生产 HSTS 与本地 HTTP 开发的 CSP 升级指令分开配置。
- 错误码与 JSON 类型在 api-contract 共享，业务消息/状态由后端注册表控制，默认 HTTP 异常文案与未知异常原文不对外返回。DTO 详情只保留字段路径/规则，关闭隐式转换、拒绝多余字段，避免错误中反射敏感输入。
- 日志采用元数据白名单，SafeLogger 丢弃任意文本/异常堆栈，不试图用不完整正则猜测地址文本；请求日志不写 URL、头、正文等敏感来源。可用 requestId/errorCode/状态/耗时定位问题。后续诊断扩展须定义安全字段，不能直接开启原始请求、SQL 或错误日志。
- UUID 请求头只做追踪；不是幂等或信任凭证。配置集中校验，生产不自动加载根 .env，必须由进程注入 DATABASE_URL 和精确 HTTPS WEB_ORIGIN，公共 Swagger 强制关闭；保留当前开发 .env 不覆盖。JWT 仍未启用，本次不伪造认证功能或对未使用密钥施加登录语义。
- 限流选择内存 @nestjs/throttler，默认 120/60 秒、敏感装饰器 5/60 秒，每 IP 每路由；生产横向扩展须换共享存储。默认 trust proxy=false，仅允许明确 IP/CIDR，防止客户端用转发头绕过 IP 限流。账号维度锁定属于后续登录任务。
- Nest 12 的 404 默认限定于全局前缀，前缀外未知路径会回落 Express HTML；在 init 后安装根兜底，调用同一 GlobalExceptionFilter，确保禁用的 Swagger 与其他未匹配路径也返回统一 JSON。DTO/分页/限流测试夹具编译到独立 .test-build，不引入生产路由。
- 来源：[Nest 验证](https://docs.nestjs.com/application/validation)、[安全头与 CORS](https://docs.nestjs.com/techniques/security/cors)、[限流](https://docs.nestjs.com/security/rate-limiting)。

## ADR-012：邮箱认证与短期 Access Token（2026-10-15，任务 05）

- 本次只有 register/login/me，不实现 Refresh Token、logout、商家或角色模块。全局 User 与商家数据保持分离，注册仅建立启用账号，/me 只返回认证主体的安全资料，不接受客户端 userId 作为身份。
- 沿用 bcryptjs 3.0.3、cost 12；注册要求 12 字符与大小写/数字/符号、最多 72 UTF-8 字节，登录也拒绝超长输入，不做静默截断或密码 trim。未知邮箱同样做 bcrypt 比较，失败不区分邮箱不存在、密码错或账号停用。
- 注册/登录各自显式声明密码校验，共享的父 DTO 仅承载邮箱规则，避免 class-validator 在子类同属性自定义验证器覆盖父规则的问题；接口反例测试已验证长度、控制字符和多字节边界。
- 邮箱统一 trim/lower；原用户原文保留，新增追踪 SQL 表达式唯一索引 lower(btrim(email))，配合同表达式参数化登录查询。创建账号的 P2002 统一为 EMAIL_ALREADY_EXISTS，数据库唯一性处理并发，不采用先查再插的竞态策略。
- 固定 @nestjs/jwt 12.0.3（peer 支持 Nest 12），签发 HS256、900 秒（可配 60–900）Access Token，限定 issuer/audience/type/sub/jti/iat/exp；每次请求再次查账号启用状态。公有资料显式 select/map，不把含 passwordHash 的记录展开到响应。
- AuthModule 的 APP_GUARD 默认保护控制器，health/register/login 显式 Public；测试根模块的公共夹具也显式标记。未来商家业务须另外实现 tenant/membership/role 检查，当前只有全局账号身份，不宣称完成授权。
- PrismaService 抽到共享 PrismaModule，避免 Auth 与健康接口产生独立池。复用既有全局验证/响应/错误/日志及敏感接口限流，不另造错误格式或日志输出。
- 开发缺少进程/.env 密钥时以 CreateNew 语义生成忽略的 .env.auth.local（48 随机字节转 hex），只读已有文件，保留 .env；生产必须显式以进程 NODE_ENV=production 启动且注入至少 32 字节非占位密钥，不读取/生成本地密钥。Token 在同一密钥下跨重启仍有效，到期需重新登录。
- 来源：[Nest JWT 实现](https://github.com/nestjs/jwt)、[OWASP 密码存储](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)。

同阶段补充：同源 Swagger POST 可能携带 Origin，不能当未知跨域请求拒绝。CORS 委托按请求协议与 Host 识别同源，其他来源仍须精确匹配 WEB_ORIGIN；默认不信任转发头，受信代理行为沿用部署配置。真实接口测试覆盖同源登录/me 成功及未授权跨域失败，不增加通配符或认证绕过。

## ADR-013：随机刷新凭据、严格轮换与数据库会话撤销（2026-10-17，任务 06）

- 保持 Access HS256 与 60–900 秒配置，默认 15 分钟；新增 sid UUID，每个受保护请求检查对应会话归属、绝对到期和撤销。退出在后续请求中立即阻止该会话的 Access Token；已认证的在途请求不被中断。升级前无 sid 的旧令牌需要重新登录。
- Refresh Token 使用 Node crypto.randomBytes(32) 的规范 base64url（43 字符），数据库仅存 SHA-256 digest，不存原文。随机源具有 256 位熵，区别于需要慢哈希的用户密码，不增加无用途的 JWT_REFRESH_SECRET。沿用锁定依赖，无新增依赖或密钥硬编码。
- auth_sessions/refresh_tokens 是全局账号身份基础设施，无 tenant_id 或商家数据；原 17 张表与租户约束不变。追踪迁移由 Prisma 7.10.0 migrate diff 对比上一提交和当前 schema 生成，再补充 BEGIN/COMMIT、哈希 CHECK 和更新时间触发器；旧迁移与参考 SQL 不改写，不运行 schema.sql。from-migrations 方式缺少专用 shadowDatabaseUrl，未创建或清空影子库，改用两个 schema 的只读差异生成。
- 会话默认绝对有效期 7 天，允许 1 小时–30 天；轮换不延长。每次登录独立会话，退出只影响对应设备。旧凭据记录保留用于重放检测；本次不加入删除/清理定时任务。
- refresh/logout 使用同一会话 SELECT FOR UPDATE 锁，锁后重新读取消费状态；旧 token 消费、新 token 摘要和 Access 签发在同一事务。重放/到期/账号停用时先提交撤销，再在事务外抛统一 401，防止撤销被回滚。跨进程并发同 token 至多一次成功，另一请求会撤销整个会话，成功响应中的令牌也随之失效。
- 不设刷新宽限窗口，客户端需 single-flight 串行刷新、原子替换两个令牌；响应丢失不能盲目重试旧 token，需重新登录。这是严格重放防护与重试便利性之间的明确选择。单纯随机无效凭据找不到会话，不影响合法会话。
- refresh/logout 显式 Public 是为了允许 Access 过期后的操作，必须以 JSON 正文 Refresh Token 证明会话持有权。logout 对格式合法未知/已撤销凭据统一成功，避免枚举且幂等；非法格式 400，数据库故障不能伪报成功。已使用的旧凭据也允许退出所属会话。
- 认证成功体和 /me 设置 Cache-Control:no-store；沿用日志字段白名单与敏感接口 5次/IP/路由/分钟，不打印 Token、哈希、密码、连接串或数据库异常。生产继续强制进程环境密钥；前端存储、Cookie/BFF、分布式限流、商家授权均未纳入本次任务。
- 参考 [RFC 9700 §4.14.2](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.14.2) 的轮换与重放撤销建议，以及 [OWASP 会话管理](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)。本项目是邮箱密码登录 API，不宣称实现完整 OAuth 协议。

## ADR-014：商家上下文、角色边界与成员变更事务（2026-10-17，任务 07）

- 仅实现创建商家、当前商家与成员列举/添加/修改五个接口，不提前实现商品、采购、库存等业务路由。使用现有表，不新增迁移或修改参考 SQL。创建商家事务同时创建 OWNER、DEFAULT 默认仓库及审计记录；新商家名称不作全局唯一标识。
- 身份 Guard 后统一执行 TenantGuard 和 RolesGuard。显式 Public/GlobalAccount 路由可免商家头；其他控制器默认要求唯一合法 X-Tenant-Id、当前启用用户的 active membership，以及显式角色或权限元数据，缺少授权声明默认拒绝。上下文由服务端数据库建立，忽略客户端角色/身份头，拒绝 DTO 多余 tenantId。
- OWNER 可管理 ADMIN/BUYER/WAREHOUSE/VIEWER；ADMIN 只可添加或修改 BUYER/WAREHOUSE/VIEWER，不能编辑 ADMIN/OWNER，也不能提升自身。OWNER 只由创建商家产生；当前不提供 OWNER 转让、降级、停用或额外授予。此选择保留原 OWNER，避免通过通用 PATCH 绕过所有权约束，不自动改写已有 seed 成员。
- 列表只向 OWNER/ADMIN 开放并分页；所有 active 角色可读当前商家。BUYER 与 WAREHOUSE 的采购写入/收货出库权限在集中角色矩阵中区别定义，使用隔离测试路由验证同一生产 Guard；不把测试夹具当作已实现的采购/库存业务。
- 所有成员目标查询/更新必须同时带 tenant_id 与 membership id。无成员身份返回 403，跨商家或未知目标统一 404。添加已注册账号按规范化 email 查询，仅向授权管理者返回安全成员资料；不返回密码/Token，不提供全局账号搜索接口。
- 当前商家/列表读取事务持有租户根行 SHARE 锁；成员写入事务持有同一行 UPDATE 锁，锁后重查操作者 active membership、用户启用状态及权限。防止 Guard 与实际写入之间发生角色撤销竞态，审计与变更同一事务；重复无变化 PATCH 不重复审计，重复添加由唯一键返回冲突。已通过授权的在途读取不被强行中断。
- 审计只写 tenant_id、actor_id、动作、目标及角色/启用状态前后值、requestId，不写邮箱、密码、Token、地址或任意客户端 metadata。注册账号和认证会话仍属全局身份，本任务不改变 /me 与 refresh/logout 的语义。
- OpenAPI 商家安全声明使用同一对象 `{bearer:[],tenant:[]}`，表达两者同时必需，避免两个独立 security 项造成“任选一个”的误读。参考 [PostgreSQL 16 行锁](https://www.postgresql.org/docs/16/explicit-locking.html#LOCKING-ROWS) 与 [OWASP 默认拒绝、逐请求授权](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)。沿用锁定 Nest/Prisma，不新增授权依赖。

## ADR-015：商品主数据、参考进货价与扫码匹配（2026-10-17，任务 08）

- 仅实现商品列表/创建/详情/修改/按码查询。沿用租户复合唯一约束、Guard、TenantContextService 事务与锁后权限复查；增加 products:read（全部五角色）、products:write（OWNER/ADMIN/BUYER）。WAREHOUSE/VIEWER 只读，不开放删除接口。
- 增量迁移只给 products 新增 nullable reference_purchase_price NUMERIC(18,2) 与 remark TEXT，不回填/修改已有商品和订单。参考价未知为 null，免费为 "0.00"；输入仅接受非负十进制字符串、至多两位小数和十六位整数，不接受 JS number/指数/NaN/自动四舍五入。返回统一两位小数字符串，使用 Prisma.Decimal，不影响采购行 unit_price/discount/landed_unit_cost 或库存成本。
- SKU 与条码仅 trim，保持大小写、前导零和内部字符；唯一性与现有 PostgreSQL 文本唯一索引一致，区分大小写。条码 null/空白归 null，允许多个无条码商品；非空条码不可在同一商家重复。规格、备注可清空；PATCH 省略字段不修改，非 nullable 字段不接受 null，空 PATCH 为 400。
- lookup 使用当前商家范围、精确 SKU OR barcode、仅启用商品，返回标准 data 数组，未知为空、同商品匹配两字段只返回一次。不同商品的 SKU 与条码可能同值，返回两个候选而不猜第一个；此决定不增加跨字段唯一限制，不破坏已有编码。列表默认包含启用/停用，可按 isActive、unit、hasBarcode 筛选，并跨 name/sku/barcode/specification 做不区分大小写的字面子串搜索，转义 LIKE 特殊字符。
- 商品停用及编码/名称/参考价修改仅改主数据，不写历史订单或库存；停用后保留详情和关联外键，停用商品的 SKU/条码仍占用唯一键。创建和实际变更写 PRODUCT_CREATED/PRODUCT_UPDATED 审计，与主数据同事务；无变化 PATCH 不改时间、不重复审计。审计只记安全结构化字段与变更字段名，不复制备注等任意文本。
- 对唯一冲突使用数据库 P2002 与具体约束映射为 PRODUCT_SKU_ALREADY_EXISTS / PRODUCT_BARCODE_ALREADY_EXISTS；未知约束保持公共安全错误，不通过先查再插代替数据库约束。延续 SQL 参考稿原件，运行结构以 Prisma 追踪迁移为准。
- 公共分页与数组响应的 OpenAPI 基类只声明 requestId，避免继承 data:object 再用 allOf 声明 data:array 的类型冲突；新增共享 ApiArrayResponse 供 lookup 使用，运行时统一响应结构不变。金额精确性参考 [PostgreSQL 16 NUMERIC](https://www.postgresql.org/docs/16/datatype-numeric.html)，实现沿用本地锁定的 Prisma 7.10.0 API/adapter，不按最新文档升级依赖。

## ADR-016：仓库管理与历史关联保护（2026-10-20，任务 09）

- 只增加仓库列表与创建：全部五角色拥有 warehouses:read，OWNER/ADMIN 拥有 warehouses:write。沿用全局 Guard、TenantContextService 租户行锁及锁后权限复查；分页行和总数均带 tenantId。
- Warehouse 新增 nullable remark TEXT 与 2000 字符 CHECK，通过 Prisma 7 锁定版本的 schema diff 生成第五个追踪迁移，不改旧迁移、参考 SQL、原 address 或任何历史记录。创建输入不接受商家/身份/时间/地址，输出显式选择公开主数据。
- name/code trim，编码保留大小写/前导零；沿用 (tenant_id,code) 唯一键，停用仍占码。数据库唯一冲突返回 WAREHOUSE_CODE_ALREADY_EXISTS，审计与创建同事务，不以预查询代替约束。重复请求返回冲突，不默认为原操作成功。
- 新商家继续由 TenantsService 单事务创建 OWNER 与 DEFAULT 默认仓库；既有 POST /tenants 返回保持兼容。历史采购单的非空仓库和同商家复合外键、库存的商家+仓库+SKU 唯一键与 Restrict 删除策略沿用并测试。不开放 DELETE/PATCH/调拨/库存 CRUD，不提前实现采购或库存业务。
- 真实测试覆盖双商家同码/隔离、五角色、分页、输入、跨进程并发冲突、审计失败回滚、锁后降权/停用及重启。采购/库存关系验证用隔离库 SQL 夹具，不写开发库测试单据。
