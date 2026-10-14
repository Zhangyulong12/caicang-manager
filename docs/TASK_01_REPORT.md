# 任务 01 验收报告

日期：2026-10-14（Asia/Shanghai）。工作目录：`D:\Dev\caicang-manager`。分支：`feat/task-01`。

结论：环境复查满足本阶段要求；Monorepo、API、管理端、手机端骨架及真实 PostgreSQL 健康接口已完成。实际安装、类型检查、构建与 6 项自动化测试通过。没有提前创建业务模型、迁移、登录、采购、库存或出库功能，没有生成或验证签名 APK。

## 1. 已交付

- pnpm workspace：3 个应用、2 个公共包与根项目；锁定 pnpm 11.25.0、直接依赖精确版本及 pnpm-lock.yaml。
- NestJS 12.1.3 后端：TypeScript strict / ESM、Prisma 7.10.0 driver adapter，公开 `GET /api/v1/health` 执行真实 PostgreSQL `SELECT 1`；Swagger UI 与 OpenAPI JSON。
- 管理端：Vue3 + Vite + Element Plus 欢迎页，连接按钮调用真实健康接口，无业务假数据。
- 手机端：uni-app Vue3 CLI 工程、首页和真实健康接口客户端；H5 与 App 资源实际编译。
- 公共包：不依赖 Nest runtime 的 JSON 健康契约、纯 TS API 地址工具。
- Windows 脚本：首次本地环境配置、非破坏性数据库启动、API/Web 联合启动、只读数据库验证、自动化冒烟测试。脚本在系统 PowerShell 5.1 中实际执行，兼容 ASCII 源码避免 UTF-8 无 BOM 的解析问题。
- 数据库：PostgreSQL 16.15，固定镜像 digest，命名卷持久化，端口仅绑定 127.0.0.1；查询 public 表数量为 0，未运行 schema.sql 或任何迁移。

## 2. 环境复查结果

| 项目 | 实际结果 |
| --- | --- |
| Windows | 11 家庭版 25H2，26200.9457，仍受支持 |
| WSL | 3.0.3.0；内核 6.18.54.1-1；系统 Linux 命令执行成功 |
| Docker Desktop | 4.95.0 (242831) |
| Docker Client / Server | 29.8.2 / 29.8.2，正常运行 |
| Compose | v5.6.0 |
| hello-world | 输出 `Hello from Docker!`，退出码 0 |
| 数据位置 | `D:\docker\DockerDesktopWSL\disk\docker_data.vhdx` |
| 最后检查空闲空间 | C 盘 51.95 GiB；D 盘 356.92 GiB |

版本、存储证据、PATH 修复及非阻塞项详见 ENV_CHECK.md。未重装 Git、Node.js、pnpm 或 VS Code；HBuilderX、Ubuntu、PowerShell 7 按用户要求暂缓。

## 3. 实际验证命令与结果

| 命令 | 实际结果 |
| --- | --- |
| `pnpm install` | 修复配置与 peer 冲突后成功，退出码 0 |
| `pnpm install --frozen-lockfile` | Already up to date，462ms，退出码 0 |
| `pnpm peers check` | No peer dependency issues found |
| `pnpm db:up` | 已有 .env 保留；PostgreSQL Healthy；重复执行成功 |
| `scripts/verify-db.ps1` | pg_isready 接受连接；SQL 返回 PostgreSQL 16.15 |
| `pnpm prisma:generate` | 成功生成 Prisma Client 7.10.0 到 src/generated/prisma |
| `pnpm prisma:validate` | schema valid；没有业务模型或迁移 |
| `pnpm lint` | 0 错误、0 警告，退出码 0 |
| `pnpm format:check` | All matched files use Prettier code style，退出码 0 |
| `pnpm typecheck` | 两个公共包、API、Web、mobile 全部通过 |
| `pnpm build`（由 `pnpm test` 再次执行） | 公共包、API、Web、mobile H5 构建成功 |
| `pnpm test` | 6 tests / 6 pass / 0 fail；最终测试约 1.55 秒 |
| `pnpm --filter @caicang/mobile build:app` | DONE Build complete，退出码 0；仅 App 资源 |
| `pnpm dev` | 实际启动 API 与 Web，健康接口、Swagger UI、Web 首页均 HTTP 200 |
| PowerShell 脚本语法检查 | 所有 .ps1 文件解析错误数为 0 |
| `.gitignore` | 根 .env 与生成的 Prisma Client 被忽略；无凭证提交 |
| `git diff --check` | 通过；既有 autocrlf 换行提示不属于检查失败 |

Web 构建产物：index.html、约 27.21 kB CSS、109.56 kB JS（gzip 42.21 kB）。实际 `/health` 返回 data.status=ok、database=reachable、service=caicang-api、ISO 时间戳及 UUID requestId。

自动化覆盖：真实数据库健康查询、JSON 响应格式、OpenAPI 路由/响应 schema、允许与拒绝的 CORS Origin、未实现业务路由返回 404、两个前端生产资源文件存在。测试使用临时 API 端口，结束后停止测试进程；不修改业务数据、不删除容器卷。没有声称已测试尚未实现的多租户、权限、事务或库存。

验证结束后已停止本次 API/Web 开发进程，3000/5173 未残留监听；PostgreSQL 保持 Healthy，数据卷保留。用户可随时通过 `pnpm dev` 重新启动。

## 4. 本次失败与修复

1. Docker CLI 存在但当前 Codex PATH 尚未刷新，首次 hello-world 找不到 credential helper。补齐当前进程 PATH 后成功；脚本提供同样的目录探测。
2. 中文 UTF-8 无 BOM 的新 PowerShell 脚本在系统 5.1 中解析失败。将脚本提示改为 ASCII，并将 Stop 错误处理放在 dot-source 前；重新执行数据库启动和查询成功。没有把首次退出码 0 当作实际成功。
3. pnpm 11 不使用旧 onlyBuiltDependencies，且 .npmrc 的普通配置不再生效；初次 install 因未审阅构建脚本失败。改用 pnpm-workspace.yaml 的 allowBuilds、storeDir/cacheDir 与严格 peer 配置，重新安装与锁文件复装成功。
4. uni-app 的自动 peer 选择要求 Vue 3.5 的 @vueuse/core 15，与手机端 Vue 3.4 不匹配。仅针对 unplugin-auto-import 固定兼容版本，最终 peers check 无问题。
5. Windows package 脚本中的单引号目录过滤导致 shared build 没匹配项目。改为明确的两个 package 名称，重跑 shared build 与所有 typecheck 通过。
6. 修复测试脚本正则多余转义及 ESLint 与 Prettier 重叠的纯格式规则，最终 lint 与 format:check 通过。
7. uni-app 内置 esbuild 不识别 ES2023。共享 TypeScript target 调整到 ES2022，手机端 ES2020，并禁用当前不使用的 uni statistics；再次构建没有该 target 警告。
8. 首次接口测试的 10 秒启动等待不足，测试实际失败。将临时服务器的就绪等待上限改为 30 秒，仍严格要求真实健康接口 HTTP 200；完整构建与测试再次通过，最终 API 就绪约 1.44 秒。

## 5. 尚未验证与真正阻塞项

任务 01 没有剩余阻塞。依赖下载曾出现超时，但重试成功，锁文件复装与最终构建均完成。DCloud 编译器提示有新版本，本阶段保持已验证的固定版本，不自动升级。

HBuilderX 识别、DCloud 正式 appid、相机权限、扫码、签名 APK 与 Android 真机运行均未验证，且不属于用户本次授权的验收范围。mobile manifest 的 appid 暂为空，后续 Android 阶段需配置实际 DCloud appid 与签名。H5/App 资源编译成功不能替代这些验收。

浏览器交互与欢迎页视觉未做真机/浏览器 UI 自动化验收；已完成 Vue 类型检查、生产构建、生产资源核验和开发服务器 HTTP 检查。核心业务测试待实现对应功能后执行。生产 Docker 镜像、HTTPS、备份恢复与部署仍属于后续阶段。

下一步由用户指定任务 02，建立 PostgreSQL 业务模型、追踪迁移和幂等种子数据。本次停在任务 01。

## 6. 修改文件清单

下列为本次新建或修改的项目文件（共 61 个）；原始资料目录未修改。本地 .env、node_modules、编译产物和生成客户端被忽略，不在提交内。

```text
.env.example
.gitignore
.npmrc
.prettierignore
.prettierrc.json
CHANGELOG.md
README.md
eslint.config.mjs
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
tsconfig.base.json
apps/admin-web/.env.example
apps/admin-web/index.html
apps/admin-web/package.json
apps/admin-web/src/api/health.ts
apps/admin-web/src/App.vue
apps/admin-web/src/main.ts
apps/admin-web/tsconfig.json
apps/admin-web/vite.config.ts
apps/api/package.json
apps/api/prisma.config.ts
apps/api/prisma/schema.prisma
apps/api/src/app.module.ts
apps/api/src/config/env.ts
apps/api/src/health.controller.ts
apps/api/src/main.ts
apps/api/src/prisma/prisma.service.ts
apps/api/tsconfig.build.json
apps/api/tsconfig.json
apps/mobile/.env.example
apps/mobile/index.html
apps/mobile/package.json
apps/mobile/src/App.vue
apps/mobile/src/env.d.ts
apps/mobile/src/main.ts
apps/mobile/src/manifest.json
apps/mobile/src/pages.json
apps/mobile/src/pages/home/index.vue
apps/mobile/src/services/health.ts
apps/mobile/tsconfig.json
apps/mobile/vite.config.ts
packages/api-contract/package.json
packages/api-contract/src/index.ts
packages/api-contract/tsconfig.json
packages/utils/package.json
packages/utils/src/index.ts
packages/utils/tsconfig.json
scripts/common.ps1
scripts/compose.dev.yml
scripts/db-up.ps1
scripts/dev.ps1
scripts/smoke.test.mjs
scripts/verify-db.ps1
scripts/watch-api.mjs
docs/API_SPEC.md
docs/ARCHITECTURE.md
docs/DECISIONS.md
docs/DEPLOYMENT.md
docs/ENV_CHECK.md
docs/TASK_01_REPORT.md
```
