# 任务 06：Token 刷新与安全退出验收

日期：2026-10-17（Asia/Shanghai）。基线提交：2acc888；分支：feat/task-06。

## 实现结果

- POST /api/v1/auth/login 在验证真实账号和密码后建立独立数据库会话，返回短期 Access Token、随机 Refresh Token、安全 user、expiresIn 与 refreshExpiresIn。注册和 GET /me 保持可用，不返回密码哈希。
- POST /api/v1/auth/refresh 以正文 Refresh Token 认证，不依赖尚未过期的 Access Token。每次成功原子消费旧凭据、存储新摘要并返回新令牌对。
- POST /api/v1/auth/logout 撤销凭据所属整个登录会话；格式合法的未知、已过期或已撤销值均返回 data.loggedOut=true，重复退出幂等。其他设备登录不受影响。
- Access 默认 900 秒，可配置 60–900 秒。会话默认绝对有效期 604800 秒（7 天），可配置 3600–2592000 秒，轮换不延长。256 位随机 Refresh Token 使用规范 base64url，数据库只存 SHA-256 摘要，不存原文；不使用硬编码密钥或 JWT_REFRESH_SECRET。
- PostgreSQL 会话行锁串行化多个 API 实例的刷新与退出。旧值重放先提交撤销，再返回统一 401 INVALID_REFRESH_TOKEN；其全部子令牌与关联 Access Token 随会话失效。并发重复刷新至多一个成功，另一请求会撤销整个会话，因此客户端必须串行刷新，不能盲目重试旧值。
- Access JWT 新增 sid；每个受保护请求查数据库检查用户启用、会话归属、到期及撤销。退出后后续请求返回标准 401；已经通过认证的在途请求不被中断。升级前没有 sid 的旧 Access Token 需重新登录。
- 复用统一 DTO、响应、错误、requestId、日志白名单与敏感接口限流。refresh/logout 为每 IP 每路由 5 次/60 秒；认证成功体与 /me 设置 Cache-Control:no-store。日志不输出 Token、摘要、密码、密钥或原始数据库异常。
- 生产继续强制进程环境 JWT_ACCESS_SECRET（至少 32 字节且非占位值），不读取/生成开发密钥。Swagger 与 API 文档已加入请求、响应、错误、轮换与退出步骤。

## 数据库与数据保留

新增追踪迁移 `20261017090000_auth_refresh_sessions/migration.sql`，建立 auth_sessions 与 refresh_tokens 两张全局账号认证表，以及外键、唯一索引、摘要格式 CHECK 和更新时间触发器。它们不含商家业务数据，不带 tenant_id；原 17 张表与 15 张租户表约束保持不变。

Prisma 7.10.0 migrate diff 从上一提交和当前 schema 生成增量 SQL，再补充事务与数据库约束；未改写旧迁移或 database/schema.sql，未重复执行参考 SQL。本地 migrate deploy 已应用，status 显示 3 个迁移且数据库最新。独立空测试库重放全部迁移、再次部署、seed、重复/并发 seed 和结构 diff 均成功。

开发库保留 6 个用户、2 个商家和 6 个商品；测试注册与所有故障注入仅发生在本轮随机隔离测试库。测试结束关闭 API 并清理本轮自建测试库，不清空开发库、容器或命名卷，不启用原停用 seed 账号。原 .env 与 .env.auth.local 不覆盖，也不提交 Git。

## 实际执行结果

|命令/检查|实际结果|
|---|---|
|pnpm db:up|成功启动既有 Docker Desktop/PostgreSQL；容器 healthy，保留原 volume|
|pnpm prisma:generate / prisma:validate|成功，使用锁定 Prisma 7.10.0|
|pnpm prisma:migrate:deploy / prisma:migrate:status|成功，3 个追踪迁移最新|
|pnpm typecheck|API/测试 TypeScript、Web、mobile 与共享包全部通过|
|pnpm lint / pnpm format:check|全部通过|
|pnpm test:auth|78 项通过，0 失败、取消或跳过|
|pnpm test|149 项通过，0 失败、取消或跳过；同时完成 API、Web、uni-app H5 与共享包 build|
|pnpm test:models|65 项通过，空库/重复部署、seed/重复/并发 seed、业务约束和无结构漂移|
|pnpm test:db|4 项通过，真实数据库停启、健康 503→200、API 重连及容器/卷/集群/.env 保留|
|生产实际启动反例|缺失、过短和占位 JWT 密钥均退出码 1，报告 JWT_ACCESS_SECRET 配置错误，没有读取本地密钥兜底|
|pnpm start:api / pnpm api:check|Windows 脚本实际成功；localhost:3000 健康 200、database reachable，交付时 API/PostgreSQL 保持运行|
|本机最终复核|OpenAPI 包含 register/login/refresh/logout/me，未认证 /me 标准 401；3 个迁移文件校验和与数据库一致，0 个遗留测试库|

149 项包括 78 项认证、65 项公共基础与 6 项原有冒烟；不把 test:auth 再重复计入总数。

新增认证集合启动两个使用同一隔离 PostgreSQL 的真实生产 AppModule API 进程，验证随机凭据及仅存摘要、轮换、绝对到期、旧值重放撤销提交、跨进程并发、退出与刷新竞态、Access 过期后刷新、会话过期、重复退出、旧凭据退出、同用户不同设备及不同用户隔离、无效/伪造/类型错误/注入输入、凭据不可互换、sid 归属、账号停用/删除、真实唯一/CHECK/外键/级联约束、限流、OpenAPI 和日志。

事务失败用例只在隔离测试库临时设置 INSERT 拒绝触发器，实际返回标准 500，确认旧 token used_at 仍为 null 且会话未撤销；移除本轮触发器后同一凭据可以成功刷新。重启用例先用新 API 刷新持久化凭据、执行退出，再启动另一进程，确认旧凭据与 Access Token 均不能恢复。过期用例使用有效签名但已过期的 JWT 和隔离库已到期会话，未等待 15 分钟或伪称自然等待。

处理记录：首次检查 Docker Server 未运行，启动已安装 Docker Desktop 后恢复，未重装软件。首次尝试 from-migrations diff 因未配置专用 shadowDatabaseUrl 被 Prisma 拒绝；未创建/清空影子数据库，改为比较两份 schema 成功生成迁移。功能测试没有未修复失败。

## 修改文件

- 认证：apps/api/src/modules/auth/auth.service.ts、auth.controller.ts、auth.dto.ts。
- 数据库：apps/api/prisma/schema.prisma、apps/api/prisma/migrations/20261017090000_auth_refresh_sessions/migration.sql。
- 公共配置与契约：apps/api/src/config/env.ts、apps/api/src/common/errors.ts、packages/api-contract/src/index.ts、.env.example。
- 测试入口与用例：package.json、scripts/auth-sessions.test.mjs、scripts/auth.test.mjs、scripts/api-foundation.test.mjs、scripts/database-models.test.mjs。
- 文档：README.md、CHANGELOG.md、docs/API_SPEC.md、docs/AUTHENTICATION.md、docs/ARCHITECTURE.md、docs/DATABASE_DESIGN.md、docs/BACKEND_FOUNDATION.md、docs/CODEX_TASKS.md、docs/DECISIONS.md、本报告。

AGENTS.md、database/schema.sql、之前两个迁移及 pnpm-lock.yaml 未修改；未新增或升级依赖。

## Windows 使用

```powershell
cd D:\Dev\caicang-manager
pnpm install --frozen-lockfile
pnpm db:up
pnpm prisma:migrate:deploy
pnpm start:api
```

另一终端可执行 `pnpm api:check`。Swagger：`http://localhost:3000/api/docs`，操作步骤与请求示例见 AUTHENTICATION.md。先 register → login → Authorize → me；保存 data.refreshToken 调用 refresh，替换两个值后再 logout。无需手动写入用户或将测试密码保存到开发库。

## 未解决问题与范围

本任务无已知阻塞。前端安全存储/自动刷新、账号找回、邮件验证、商家与角色授权、分布式限流和过期会话清理未纳入本任务；已用摘要保留用于重放检测，本次不自动删数据。未生成/验证 APK，未执行生产部署或人工点击 Swagger，实际验收为真实 HTTP/OpenAPI 与 PostgreSQL 测试。
