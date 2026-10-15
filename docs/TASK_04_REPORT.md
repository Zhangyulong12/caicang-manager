# 任务 04：后端公共基础模块验收

日期：2026-10-15（Asia/Shanghai）。基线：任务 03 提交 786be7e；本次本地分支 feat/task-04。

## 完成范围

| 要求 | 实现 |
| --- | --- |
| 全局前缀 | 单一 bootstrap 配置 /api/v1 |
| Swagger/OpenAPI | 开发 /api/docs、/api/docs-json；公共错误、追踪参数、未来 Bearer/商家头方案，生产强制关闭 |
| 全局 DTO | APP_PIPE 注册严格 ValidationPipe，白名单、多余字段拒绝、嵌套验证、关闭隐式转换 |
| 成功体 | APP_INTERCEPTOR 统一 data/requestId；PageResult 提供 pagination；保留原状态 |
| 错误与业务码 | api-contract 共享联合类型，BusinessException 与 ERRORS 控制消息/状态 |
| requestId | 请求中间件校验 UUID/生成 UUID，贯穿响应头、成功体、错误体、日志 |
| 全局异常 | 单个过滤器归一化业务、HTTP、部分已知 Prisma、解析与未知异常；前缀外根兜底也调用同一过滤器 |
| 日志脱敏 | SafeLogger 元数据白名单，丢弃自由文本/堆栈，禁止打印正文、头、URL/查询、密码、Token、完整地址 |
| 配置校验 | 集中 ConfigService，开发读取现有根 .env，生产仅进程环境；非法值只输出变量名 |
| CORS | 精确 origin，允许认证/商家/追踪/JSON 写预检，不明来源统一 403；无 Origin 原生请求可用 |
| 安全头 | Nest 12 原生 useSecurityHeaders，nosniff、DENY、CSP、Referrer Policy、移除 X-Powered-By，生产 HSTS |
| 限流组件 | 全局 120/60 秒；SensitiveRateLimit 5/60 秒；每 IP/路由，统一 429 和 Retry-After |

健康接口继续执行真实 PostgreSQL SELECT 1，控制器不再独自拼响应或 requestId。新增控制器自动继承公共模块；本次没有实现登录、JWT 验证、角色检查或任何数据库业务写接口，也没有修改 schema、迁移或参考 SQL。

## 实际验证

| 检查 | 实际结果 |
| --- | --- |
| pnpm install --frozen-lockfile | 成功，所有工作区依赖与锁文件一致 |
| pnpm typecheck | API（含测试 TypeScript）、公共包、Web、手机全部通过 |
| pnpm lint / pnpm format:check | 全部通过 |
| pnpm test | API、Web、手机 H5 和公共包构建成功；65 个测试通过，0 失败/取消/跳过 |
| 公共模块测试（包含在 pnpm test 中） | 59 项，通过真实 HTTP 验证公共组件；另含配置/日志单元检查 |
| 原有冒烟测试（包含在 pnpm test 中） | 6 项，真实 PostgreSQL 健康、OpenAPI、CORS 与前端构建资源通过 |
| pnpm test:db | 4 项通过，真实数据库停止时 503 DATABASE_UNAVAILABLE、恢复后同一 API 进程自动重连 200；容器/卷/集群/.env 保留 |
| pnpm prisma:migrate:status | 退出码 0，已有初始迁移为最新状态；本任务没有新迁移 |
| pnpm start:api / pnpm api:check | Windows 启动脚本实际成功运行，localhost:3000 健康接口返回 200，OpenAPI 可读取 |
| Git diff 检查 | 无空白错误；AGENTS.md、database/schema.sql、Prisma schema/迁移保持不变 |

公共测试覆盖成功/分页/空数据/金额字符串、全局及嵌套 DTO、未知字段与错误原值不反射、400/401/403/404/405/409/413/415/422/429/500/503 归一化、业务错误详情脱敏、未知错误/已知 Prisma 错误、畸形 JSON、64 KiB 上限、并发 requestId、CORS 预检、安全头、并发限流/重置/伪造转发头、敏感装饰器、开发 OpenAPI、生产 Swagger/夹具/登录路由不公开、非法生产配置退出与日志无敏感内容。

测试用已知 Prisma 异常是合成对象，仅用于检验错误映射；健康检查和数据库停启使用实际 PostgreSQL，不用合成异常冒充数据库验证。测试夹具只导入独立根模块，编译到被忽略的 .test-build，正式 main/AppModule 不引用它们。

最后手动检查在 16:32（Asia/Shanghai）完成：发送 X-Request-Id=04000000-0000-4000-8000-000000000004，健康 JSON 与响应头均返回同一值，状态 200、database=reachable、X-Content-Type-Options=nosniff；/api/docs-json 标题为采仓管家 API。后端与 PostgreSQL 在交付时保持运行。

修复记录：初次 lint 扫到了测试编译产物，已将 .test-build 加入 ESLint/Prettier/Git 忽略；首轮公共测试对顶层 JSON null 错误码预期不准确，改为解析阶段 BAD_REQUEST；生产测试发现前缀外 404 返回 HTML，新增同一过滤器的根兜底。修复后完整重跑通过，并扩展到最终 59 项公共测试。

## 配置与接入文档

- `BACKEND_FOUNDATION.md`：Windows 命令、完整配置表、新模块写法与限流边界。
- `API_SPEC.md`：当前 JSON/分页/错误/追踪/日志/CORS/限流规范。
- `.env.example`：新增环境模式、监听地址、Swagger、限流、JSON 上限、可信代理示例；已有私密 .env 未覆盖。
- ADR-011：集中记录全局组件、原生安全头、元数据日志与单进程限流决策。

```powershell
cd D:\Dev\caicang-manager
pnpm install --frozen-lockfile
pnpm db:up
pnpm prisma:migrate:deploy
pnpm start:api
```

另开终端 `pnpm api:check`；开发文档 `http://localhost:3000/api/docs`。公共模块测试用 `pnpm test:api`，全仓构建与测试用 `pnpm test`。

## 修改文件

- 后端入口：`apps/api/src/main.ts`、`bootstrap.ts`、`app.module.ts`、`health.controller.ts`、`config/env.ts`、`prisma/prisma.service.ts`。
- 公共模块：`apps/api/src/common/common.module.ts`、`errors.ts`、`exception.filter.ts`、`logging.ts`、`request-context.ts`、`response.ts`、`validation.ts`、`pagination.dto.ts`、`rate-limit.ts`、`api-docs.ts`。
- 测试：`apps/api/test/fixture-main.ts`、`apps/api/tsconfig.test.json`、`apps/api/tsconfig.json`、`scripts/api-foundation.test.mjs`、`scripts/api-test-server.mjs`。
- 共享与工具：`packages/api-contract/src/index.ts`、根/API package.json、`pnpm-lock.yaml`、`.env.example`、`.gitignore`、`.prettierignore`、`eslint.config.mjs`。
- 文档：`README.md`、`CHANGELOG.md`、`docs/API_SPEC.md`、`ARCHITECTURE.md`、`CODEX_TASKS.md`、`DECISIONS.md`、`BACKEND_FOUNDATION.md` 和本报告。

新增运行依赖精确锁定 class-validator 0.15.1、class-transformer 0.5.1、@nestjs/throttler 6.7.1；类型依赖 @types/express 5.0.6。Nest/Prisma/Node/pnpm 版本沿用项目基线，没有重装工具。

## 完成边界

本任务无阻塞。全栈工程、真实 PostgreSQL 数据模型与可启动的 API 基础服务已经具备，后续可按用户新任务进入业务功能。

当前限流为单进程内存，重启清零；多实例部署需要共享存储。登录/账号锁定、JWT/租户/角色校验、业务事务仍未实现，CORS/限流不是其替代品。生产模式测试使用本机临时 HTTP 端口验证配置和响应头，未部署 HTTPS 服务；TLS 属后续部署范围。此次没有生成或验证 APK。
