# 任务 07：多商家与角色权限验收

日期：2026-10-17（Asia/Shanghai）。项目：D:\Dev\caicang-manager；基线：1ffcfb8；分支：feat/task-07。

## 完成范围

|真实 API|权限与行为|
|---|---|
|POST /api/v1/tenants|登录用户创建自己的商家，事务建立 OWNER、DEFAULT 默认仓库及审计；不需要已有商家头|
|GET /api/v1/tenants/current|五种启用角色均可，返回所选商家、本人成员关系与权限|
|GET /api/v1/members|OWNER/ADMIN；分页，只查询当前商家成员，包含启用/停用关系|
|POST /api/v1/members|OWNER/ADMIN 添加已注册且全局启用的账号，按规范化 email 查找；现有关系统一 409|
|PATCH /api/v1/members/{membershipId}|OWNER/ADMIN 修改角色或启停，必须按 tenantId+membershipId 查找；跨商家/未知目标统一 404|

五种角色为 OWNER、ADMIN、BUYER、WAREHOUSE、VIEWER。OWNER 可管理其他非 OWNER；ADMIN 仅管理 BUYER/WAREHOUSE/VIEWER，不能编辑自己或其他 ADMIN，不能授予 ADMIN/OWNER。OWNER 只由创建商家产生，本次不开放所有权转让、降级或停用。没有新增商品、采购、库存、收货或出库业务接口。

同一账号可在多个商家中具有不同角色。BUYER 有 purchase:write 权限且无 receiving:confirm/outbound:write；WAREHOUSE 相反，VIEWER 只有本次矩阵的 tenant:read。此处是授权能力实现，业务流程仍留待后续任务。自动测试使用独立测试根模块验证同一套生产 Guard，不把测试路径编入生产或当作业务功能。

## 安全与事务

- AccessTokenGuard → TenantGuard → RolesGuard 顺序执行。除显式 Public/GlobalAccount 路由外，默认要求唯一 UUID X-Tenant-Id、认证用户的 active membership、启用用户状态和显式角色/权限策略；未声明策略默认 403。
- CurrentTenant 装饰器取得冻结的服务端 TenantContext，不使用客户端 userId/role/tenantId 证明身份；Access JWT 不缓存商家角色。商家成员停用/降级在后续请求中生效，不影响其他商家或全局 /me。
- 当前商家/成员列表事务锁 tenants 根行 FOR SHARE；成员写入 FOR UPDATE，锁后重新检查操作者当前权限。目标查询与 update 使用复合租户条件，跨商家资源不先查询后暴露。
- 创建商家、OWNER、默认仓库、审计同事务；成员添加/权限修改和审计同事务，审计失败全部回滚。并发重复加入只有一个 201，另一个 409；重复相同 PATCH 不产生额外状态修改或成功审计。
- TENANT_CREATED、MEMBER_ADDED、MEMBER_UPDATED 使用服务器 actorId/tenantId、目标 ID、requestId 与必要的角色/启用状态 before/after，不记录邮箱、密码、Token、地址或客户端任意 metadata。成员安全 user 显式 select，无 passwordHash。
- OpenAPI 使用同一 security 对象 `{bearer:[],tenant:[]}` 表示两者同时必需；不错误描述为二选一。接口沿用统一 DTO、响应、错误、日志白名单、CORS 和限流。

## 实际测试结果

|执行项|结果|
|---|---|
|pnpm db:check|真实 PostgreSQL 16.15 可连接；现有数据库容器运行正常|
|pnpm test:tenancy|首轮 65 项全部通过，0 失败/取消/跳过|
|pnpm test|最终 214 项全部通过，0 失败/取消/跳过；包含校正后的 OpenAPI 联合安全声明断言|
|全仓构建（pnpm test 内实际执行）|NestJS API、Vue 管理端、uni-app H5、共享包和独立测试 TypeScript 构建成功|
|pnpm typecheck|最终全仓与 API 测试代码通过|
|pnpm lint / pnpm format:check|最终全部通过|
|pnpm prisma:migrate:status|已有 3 个迁移最新，本任务不新增迁移|
|pnpm start:api / pnpm api:check|Windows 脚本实际成功，本机健康 200、database reachable|
|本机 OpenAPI 与认证反例|确认五个组织操作、Bearer+tenant 联合要求；未认证 current/members 标准 401；生产无测试权限路径|
|数据与配置保留|原 6 用户、2 商家、7 成员关系、4 仓库、6 商品、0 审计；全部 3 个迁移校验和一致，0 遗留随机测试库；.env/.env.auth.local 哈希与任务 06 交付一致|

214 项包含本次多商家 65 项、认证 78 项、公共基础 65 项及原有冒烟 6 项；test:tenancy 的首轮 65 项不重复计入最终总数。本次没有再次运行 test:models/test:db，不将以前任务的结果冒充本轮执行。

多商家集合在随机隔离空 PostgreSQL 上真实部署现有迁移，注册/登录 12 个测试账号，运行两个生产 AppModule API 进程及独立授权测试根模块。重点验证：

- A/B 互访 current/member 列表 403，A 商家头配 B membership id 404，未知与跨商家目标错误完全相同，无对象/邮箱泄露。
- 同账号在 A 为 ADMIN、B 为 VIEWER，切换商家即时改变权限，不能用 A 身份操作 B 资源；成员停用只影响选定商家。
- 五种角色、普通成员自提权、ADMIN 授权边界与 OWNER 保护；旧 Access Token 在角色变更后使用最新数据库权限。
- 非法/缺失/重复商家头、伪造身份/角色头、query/body 租户注入、无效 DTO/UUID、分页和安全响应字段。
- 跨进程重复添加只产生一条 membership 与一条审计，相同并发 PATCH 只产生一次状态变更。
- 隔离测试库临时拒绝 audit INSERT，实际得到标准 500，并核对商家、仓库、成员和角色修改全部回滚；移除本轮触发器后操作可成功。
- 用隔离库事务锁住租户根行，确认真实 API 请求已通过 Guard 并在服务层等待锁，再降级或停用操作者；释放锁后请求返回 403、目标未改、无成功审计，验证事务内权限复查。
- 采购/收货/出库能力及显式 Roles 装饰器通过同一套生产 Guard 在测试专用路由验证；未声明策略的控制器连 OWNER 也不能访问。生产 Swagger 中不存在这些测试路径。
- 审计 actor/tenant/目标/requestId/before/after 正确，日志无真实测试 Token、密码、邮箱、密钥或注入数据库异常；跨 API 重启保留商家、角色与审计。

没有未修复的功能测试失败。复核时校正 OpenAPI 的联合安全声明，并在最终全仓回归验证；未新增/升级依赖或修改数据库结构。测试账号、故障触发器与角色变更均仅在本轮自建隔离库内，测试结束关闭进程并清理该测试库，没有清空开发库或卷。

## 修改文件（34 个）

- 新增 common/tenancy 六个文件：tenancy.module.ts、tenant-context.ts、tenant-policy.ts、tenant.decorators.ts、tenant.guards.ts、tenant.mapping.ts，位于 apps/api/src。
- 新增 apps/api/src/modules/tenants：tenant.dto.ts、tenants.controller.ts、tenants.module.ts、tenants.service.ts。
- 新增 apps/api/src/modules/members：member.dto.ts、members.controller.ts、members.module.ts、members.service.ts。
- 调整 apps/api/src/app.module.ts、apps/api/src/common/errors.ts、apps/api/src/modules/auth/access-token.guard.ts、auth.controller.ts、auth.module.ts。
- 调整 packages/api-contract/src/index.ts、package.json；新增 apps/api/test/tenant-fixture-main.ts、scripts/tenancy.test.mjs。
- 更新 README.md、CHANGELOG.md、docs/API_SPEC.md、ARCHITECTURE.md、AUTHENTICATION.md、BACKEND_FOUNDATION.md、CODEX_TASKS.md、DATABASE_DESIGN.md、DECISIONS.md；新增 docs/TENANT_AUTHORIZATION.md 与本报告。

AGENTS.md、database/schema.sql、Prisma schema/所有迁移、pnpm-lock.yaml、原 .env 与开发签名密钥均保留。未增加/迁移 C 盘用户数据。

## 使用与未解决问题

启动命令及 Swagger 操作见 TENANT_AUTHORIZATION.md；本机 API 与 PostgreSQL 在交付时保持运行。先 register/login，再 POST /tenants 保存 tenant id，以 Bearer+X-Tenant-Id 调用当前商家或成员接口。成员目标 ID 使用返回的 membership id，不能用 user id 替代。

本任务无已知阻塞。OWNER 转让、客户端商家切换界面、成员邀请邮件、商品/采购/库存业务不在本次范围；尚未生成/验证 APK或部署生产环境。限流仍为既有进程内存实现，不宣称分布式限流；Swagger 验收是实际 HTTP/OpenAPI 校验，未宣称人工点击 UI。
