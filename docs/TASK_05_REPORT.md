# 任务 05：用户注册与登录验收

日期：2026-10-15（Asia/Shanghai）。基线：任务 04 本地提交 990552b；本次分支 feat/task-05。

## 已实现

| API | 实际行为 |
| --- | --- |
| POST /api/v1/auth/register | 真实 Prisma 创建启用账号；验证邮箱、密码和可选 displayName，返回 201 及安全 user |
| POST /api/v1/auth/login | 查询真实用户、bcrypt 比较，成功返回 200、短期 Access Token、Bearer 类型、expiresIn 与安全 user |
| GET /api/v1/me | 验证 Bearer 签名和 claims、查数据库确认账号存在/启用，仅返回当前用户资料 |

三个接口沿用任务 04 的全局 DTO 验证、data/error/requestId 结构、错误码、日志脱敏与限流。没有 Mock 用户、硬编码登录结果或前端伪造认证。

- 注册邮箱 trim/lower；数据库新增 `uq_users_email_normalized` 表达式唯一索引 lower(btrim(email))，单行创建与唯一约束解决并发，不用先查再插判断唯一性。旧邮箱原文保留。
- 密码 bcryptjs 3.0.3、cost 12；注册至少 12 字符含大小写/数字/符号，注册和登录均限制最多 72 UTF-8 字节，拒绝控制/无效代理字符，不 trim 或静默截断。账号不存在也执行 bcrypt 比较，密码错/不存在/停用统一 INVALID_CREDENTIALS。
- 安全用户字段显式 select/map：id、email、displayName、isActive、createdAt、updatedAt；注册、登录、me 和错误均不返回 passwordHash。
- 固定 @nestjs/jwt 12.0.3，HS256、issuer/audience、sub/type/jti/iat/exp 校验；默认 900 秒、允许 60–900 秒。签名正确但账号删除/停用也拒绝，不接受 query/custom user header 作为身份。
- 全局 AccessTokenGuard 默认要求身份；health/register/login 显式 Public，/me 不要求商家头。新控制器默认受保护的反例已实际运行。PrismaModule 复用唯一 PrismaService/连接池。
- 仅开发/测试模式在缺少显式密钥时 CreateNew 创建忽略的 .env.auth.local；保留既有 .env 和密钥，不输出密钥。生产必须显式进程配置 NODE_ENV=production、至少 32 字节非占位签名密钥，不读取/生成本地密钥。
- 注册、登录均受既有 5 次/60 秒/IP/路由敏感限流，包含失败输入。Swagger POST 的同源 Origin 可用，其他未授权跨域来源仍统一 403。

## 数据库迁移

新增追踪迁移 `20261015090000_unique_normalized_user_email/migration.sql`，只有 CREATE UNIQUE INDEX，不新增表、不改写用户、不重放参考 SQL。表达式索引由 SQL 管理，Prisma schema 不伪造不支持的函数索引声明。

本地应用前实际查询规范化重复邮箱组数为 0；migrate deploy 成功，migrate status 显示 2 个迁移且最新。独立空测试库也实际部署两个迁移、再次 deploy、seed、重复/并发 seed、主要业务约束和无结构漂移检查通过。

若其他环境有规范化重复邮箱，索引创建会失败，不自动合并/删除或改写账户。现有本地环境没有此阻塞。

## 实际检查结果

| 检查 | 结果 |
| --- | --- |
| pnpm install --frozen-lockfile | 成功，直接依赖精确锁定及锁文件一致 |
| pnpm typecheck | API/测试 TypeScript、共享包、Web、手机全通过 |
| pnpm lint / pnpm format:check | 全通过 |
| pnpm test | API/Web/手机 H5/共享包 build 成功；113 项测试通过，0 失败/取消/跳过 |
| 上述认证接口集合 | 44 项真实 PostgreSQL/HTTP 测试通过 |
| 上述公共模块与原有冒烟 | 63 + 6 项通过，含默认保护、配置、原健康契约与 CORS |
| pnpm test:models | 65 项通过，两个迁移、重复部署与 seed、并发、约束及结构 diff |
| pnpm test:db | 4 项通过，真实数据库停启、健康 503→200、自动重连与容器/卷/集群/.env 保留 |
| pnpm prisma:migrate:deploy / status | 本地真实库索引应用成功，2 个迁移最新 |
| pnpm start:api / pnpm api:check | Windows 启动命令成功，localhost:3000 健康返回 200、database reachable |
| 本机 OpenAPI | 读取确认 register 示例邮箱、login 路由和 me Bearer security 已存在 |
| 本地密钥保护 | .env.auth.local 被 Git 忽略；独立 ConfigService 复读前后密钥文件和 .env 哈希一致 |

认证测试包括注册后立即登录及 me、真实 bcrypt 哈希验证、规范化/并发重复邮箱、直接 SQL 唯一性、旧邮箱登录与原文保留、同密钥跨 API 重启、弱/空/非字符串/超长/多字节/控制字符输入、密码首尾空格保留与 72 字节边界、role/tenantId/hash 注入、错误密码/未知邮箱/停用用户、伪造/过期/错误算法/issuer/audience/type/sub/iat/exp、删除用户、身份替换攻击、敏感限流、同源 Swagger 请求和实际 Token/密码不进日志。认证根模块使用实际生产 AppModule，不用 Mock Controller/Service。

认证用例在本地随机独立空 PostgreSQL 数据库运行，结束前关闭 API，再清理本轮自建测试库。开发库和数据卷不清空，不批量启用原 seed 演示账号；没有把测试 Token 或明文密码写入仓库/运行日志。

修复记录：首轮真实反例发现 class-validator 同属性继承规则被子类强度验证覆盖，导致注册缺失 72 字节校验。已把邮箱作为共享基类、注册/登录各自完整声明密码规则，反例重跑通过。修复了 lint 的错误 cause 与控制字符正则检查，补齐显示名 NUL 拒绝，避免无效字符串进入 PostgreSQL。验收还补充同源 Origin 场景，确保 Swagger POST 不被跨域白名单误拒绝；最终全仓重跑 113 项全通过。

## Swagger 验收方法

打开 `http://localhost:3000/api/docs`：

1. auth/register → Try it out，使用示例邮箱 new-user@example.com、示例密码 CaicangDemo!2026、可选 displayName；执行成功 201。
2. auth/login 使用同一邮箱/密码，成功 200 后复制 data.accessToken。
3. Authorize 的 bearer 栏只粘贴 Token 本身，再执行 GET /api/v1/me，得到本人安全资料。

重复注册会返回 409，可改新邮箱。这里提供可执行示例，未在开发库自动创建固定密码演示账号；真实注册/登录/本人查询链路已在接口测试的隔离数据库实际执行。同源 Origin 的 HTTP 认证请求及 OpenAPI 示例已校验，没有宣称人工点击浏览器 Swagger 或生成 APK。

完整配置与 JSON 示例见 `AUTHENTICATION.md`。本机新版本 API 与 PostgreSQL 在交付时保持运行。

最终运行态复核：健康 200；同源 Origin 下非法显示名返回 400 VALIDATION_ERROR；无 Token 的 me 返回 401；三个认证路径均在实时 OpenAPI 中。查询确认两个迁移文件 SHA-256 与数据库记录一致、开发库仍为原 6 个演示用户、没有残留 caicang_test_* 数据库。未在开发库添加固定密码的测试账户。

## 修改文件

- `apps/api/src/modules/auth/`：auth.module.ts、auth.controller.ts、auth.service.ts、auth.dto.ts、access-token.guard.ts、public.decorator.ts。
- `apps/api/src/prisma/prisma.module.ts`、`app.module.ts`、`health.controller.ts`：共享数据库服务和公开/受保护路由接入。
- `apps/api/src/config/env.ts`、`bootstrap.ts`、`common/errors.ts`、`packages/api-contract/src/index.ts`：密钥与有效期、同源 CORS、错误码与安全 JSON 类型。
- `apps/api/prisma/migrations/20261015090000_unique_normalized_user_email/migration.sql`：规范化唯一索引。
- `scripts/auth.test.mjs`、`api-foundation.test.mjs`、`api-test-server.mjs`、`database-models.test.mjs`、`apps/api/test/fixture-main.ts`：认证、守卫、配置、迁移测试与密钥隔离。
- 根/API package.json、pnpm-lock.yaml、.env.example：JWT 锁定依赖、测试入口与环境说明。
- README、CHANGELOG、docs/API_SPEC.md、ARCHITECTURE.md、BACKEND_FOUNDATION.md、CODEX_TASKS.md、DATABASE_DESIGN.md、DECISIONS.md、AUTHENTICATION.md、本报告：契约、操作、ADR-012 与验收。

AGENTS.md、database/schema.sql、原始 Prisma schema 与首版迁移未覆盖；没有安装或重装系统开发工具。

## 未解决问题与范围

本任务验收无阻塞。当前仅短期 Access Token，未实现 refresh/logout、找回密码、邮件验证、账号锁定、商家/成员/角色或库存业务；身份守卫不能替代后续商家授权。内存 IP 限流仍为单进程，多实例上线前需共享存储。未部署公网 HTTPS，也未生成/验证 APK。
