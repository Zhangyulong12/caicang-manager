# 多商家与角色权限（任务 07）

## 启动与 Swagger

```powershell
cd D:\Dev\caicang-manager
pnpm db:up
pnpm prisma:migrate:deploy
pnpm start:api
```

本任务复用现有表，没有新迁移或依赖。不要执行 database/schema.sql，不清空数据库或卷。Swagger 为 `http://localhost:3000/api/docs`，OpenAPI JSON 为 `/api/docs-json`。原 seed 用户仍停用，请使用自己注册的账号。

1. 使用 auth/register 注册 OWNER A 与一个将被加入的同事账号；密码规则见 AUTHENTICATION.md。
2. OWNER A 调用 auth/login，在 Authorize 的 bearer 栏粘贴 data.accessToken。
3. POST /api/v1/tenants，正文 `{"name":"商家 A"}`。不需要 X-Tenant-Id。返回 data.tenant.id、data.membership、data.defaultWarehouse，保存新商家 ID。
4. GET /api/v1/tenants/current，在 X-Tenant-Id 参数填该 ID。返回当前商家、本人成员关系和权限列表。
5. POST /api/v1/members，商家头同上，正文 `{"email":"registered@example.com","role":"BUYER"}`。email 必须是第 1 步已注册且启用的同事账号；返回 membership id，供 PATCH 使用。
6. GET /api/v1/members?page=1&pageSize=20，查看当前商家成员。PATCH /api/v1/members/{membershipId} 可提交 `{"role":"WAREHOUSE"}` 或 `{"isActive":false}`，也可同时提交两个字段。
7. 用另一账号登录并创建商家 B。把 OWNER A 的 Bearer 与 B 的商家 ID 组合访问 current/members，应为 403；用 A 商家头修改 B 的 membership id，应为 404，响应无 B 的资料。

Swagger 商家接口同时要求 Bearer 与 tenant 安全凭据；可在 Authorize 中设置 tenant，并按操作的必填 X-Tenant-Id 参数填写相同 UUID。切换账号后须替换 Bearer，切换商家须替换商家头。创建商家与 /me 不读取此头，不会因此冒用其他商家。客户端不提交 role/tenantId/userId 来证明身份。

## 角色边界

|行为|OWNER|ADMIN|BUYER|WAREHOUSE|VIEWER|
|---|---|---|---|---|---|
|创建自己的新商家|允许|允许|允许|允许|允许|
|当前商家资料|允许|允许|允许|允许|允许|
|商品列表/详情/lookup（任务 08）|允许|允许|允许|允许|允许|
|商品创建/修改（任务 08）|允许|允许|允许|拒绝|拒绝|
|成员列表|允许|允许|拒绝|拒绝|拒绝|
|添加或管理普通三类成员|允许|允许|拒绝|拒绝|拒绝|
|添加或管理 ADMIN|允许|拒绝|拒绝|拒绝|拒绝|
|授予、转让、降级、停用 OWNER|拒绝|拒绝|拒绝|拒绝|拒绝|
|purchase:write 权限|允许|允许|允许|拒绝|拒绝|
|receiving:confirm / outbound:write 权限|允许|允许|拒绝|允许|拒绝|

已登录用户创建新商家时自动成为新商家 OWNER，不取决于其在其他商家的角色。本任务没有采购/收货/出库业务路由。最后两行是生产角色矩阵的能力定义，自动测试通过独立测试根模块上的路径验证同一套 Guard；测试路径不会编入生产 API。后续业务实现仍需服务层对象范围与事务权限检查，不能只靠前端隐藏按钮或 permissions 数组。

OWNER 只能由创建商家产生，本任务不开放所有权转让。ADMIN 不能编辑自己或其他 ADMIN，不能授予 ADMIN/OWNER。一个账号在不同商家可有不同角色，当前商家权限每次从数据库读取；Access Token 不缓存商家角色。用户在 A 被停用，不影响其全局登录或 B 的独立成员身份。

任务 08 已增加 products:read/products:write 能力及真实商品 API，VIEWER 的当前权限为 tenant:read、products:read；上文采购/收货/出库仍只是权限能力，未开放业务接口。

## 请求与错误

- POST /tenants：name trim 后 1–150 字符，拒绝 NUL、多余字段；成功 201 返回 tenant/membership/defaultWarehouse。默认仓库 code=DEFAULT、name=默认仓库、启用且属于新商家。商家名不要求全局唯一，每次调用创建独立商家，无按名称去重的幂等承诺。
- GET /tenants/current：成功 data={tenant,membership,permissions}；无密码、Token 或其他商家关系。
- GET /members：成功为标准 data 数组/pagination/requestId，page≥1，pageSize 1–100；超过 PostgreSQL 安全 offset 范围返回 400。包含停用关系，列表 user 仅有 id/email/displayName/isActive。
- POST /members：email trim/lower 后查已注册启用用户，role 必填。未知或停用全局账号统一 404；已有关系（包括停用）409 MEMBER_ALREADY_EXISTS。重新启用应 PATCH，不能重复添加。
- PATCH：role 与 isActive 至少填写一项；空正文 400 BAD_REQUEST，非法字段/类型/UUID 为 400 VALIDATION_ERROR。尝试启用全局已停用账号的成员关系返回 409 RESOURCE_CONFLICT。
- 缺少/错误/重复 X-Tenant-Id 为 400 INVALID_TENANT_HEADER；合法 UUID 但不存在或无启用成员身份为 403 FORBIDDEN；其他商家或未知 membership id 统一 404 NOT_FOUND。普通成员的成员管理请求在读取目标前就返回 403。
- role/isActive 无变化的重复 PATCH 返回当前成员，不改更新时间、不重复写审计。并发重复添加仅一个 201，另一个 409；并发相同 PATCH 只有一次状态变更与审计。

所有接口遵循 data/error/requestId 规范和全局限流；创建商家另用 5 次/IP/路由/分钟敏感限流。此阶段仅管理现有注册用户，不发送邀请邮件、创建他人密码或提供用户全局搜索。

## Guard 与服务端上下文

1. AuthModule 按固定顺序注册 AccessTokenGuard → TenantGuard → RolesGuard。Public 只用于公开端点；GlobalAccount 只用于 /me、创建商家等明确账号级操作，仍需 Access Token。
2. TenantGuard 校验唯一 UUID 头，以认证 user.id 与 tenant_id 查询 active membership，检查用户启用，建立冻结的 TenantContext；CurrentTenant 装饰器取得服务端上下文。
3. TenantEndpoint 组合角色声明与 OpenAPI 安全要求；Roles、RequirePermissions 支持显式策略，无策略默认 403。不能把通配角色作为 OWNER 绕过，测试中的 buyer-only 规则也会拒绝 OWNER。
4. MembersService 通过 TenantContextService.run 使用租户根行锁，读取 SHARE、写入 UPDATE。取得锁后重新查询操作者启用状态与权限；成员目标查询与 update 始终使用 tenantId+membershipId。当前商家、列表与成员变更均走同一边界。
5. 身份、商家成员关系及角色分别校验。未来业务服务必须复用 TenantContextService 的事务入口并在租户内查对象，不接受客户端租户上下文，不在事务中调用外部网络。

## 审计与并发

TENANT_CREATED、MEMBER_ADDED、MEMBER_UPDATED 与实际变更同事务。审计使用服务端 actorId/tenantId、目标 id、requestId，以及必要的角色/启用状态 before/after；无邮箱、收货地址、密码、Token 或任意客户端 metadata。失败或无变化操作不生成成功审计。

租户根锁使同商家成员写入跨 API 进程串行化；已经通过 Guard 但在等锁时被降级或停用的操作者，会在锁后复查时被拒绝。不同商家使用不同根行，不使用进程内锁或缓存授权。数据库审计失败会回滚创建商家、默认仓库或成员修改。

```powershell
pnpm test:tenancy
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
```

测试使用随机隔离 PostgreSQL 数据库和真实 HTTP，保留开发库及原数据。结果与文件清单见 TASK_07_REPORT.md，技术决策见 DECISIONS.md ADR-014。
