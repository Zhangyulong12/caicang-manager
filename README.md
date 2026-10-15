# 采仓管家 V1.0 | 开发工作区

## 当前工作区与环境（任务 01）

正式工作区为 `D:\Dev\caicang-manager`，原始资料包保留在 `D:\import and export\introduce\caicang-manager`。当前已建立 pnpm workspace、NestJS 健康接口、Vue3 管理端欢迎页和 uni-app 手机端首页；未开发登录、采购、库存或出库业务。

2026-10-14 实测 Git 2.56.0.windows.2、Node 22.22.2 LTS、pnpm 11.25.0、Corepack 0.34.6、VS Code 1.141.0、Windows PowerShell 5.1 可执行。普通 PowerShell 已可调用 pnpm；Codex 内置 PowerShell 为 7.6.5。

复查已确认 Windows 11 25H2、WSL2、Docker Server 和 hello-world 正常；Docker 数据磁盘位于 D 盘。详见 [docs/ENV_CHECK.md](docs/ENV_CHECK.md)。HBuilderX、Ubuntu 和 PowerShell 7 暂不处理；本阶段的手机 H5/App 编译资源不等于签名 APK 或 Android 真机验收。

## 本地安装与运行（PowerShell）

```powershell
cd D:\Dev\caicang-manager
pnpm install --frozen-lockfile
pnpm db:up
pnpm prisma:generate
pnpm build:shared
pnpm dev
```

`pnpm db:up` 仅在 `.env` 不存在时创建随机本地数据库密码，已有配置会保留。Compose 使用持久化命名卷和固定镜像 digest；不要执行 `down -v` 或重放 `database/schema.sql`。本阶段数据库没有业务表，也不提供 migrate/seed 命令。

`pnpm dev` 在当前终端启动 API 和管理后台，Ctrl+C 停止开发进程，PostgreSQL 数据和容器保留。API TypeScript 改动由 tsc 监听并触发 Node 重启。也可在独立终端执行 `pnpm dev:api` 和 `pnpm dev:web`。手机 H5 预览使用 `pnpm dev:mobile`。

| 地址 | 用途 |
| --- | --- |
| `http://localhost:3000/api/v1/health` | 查询真实 PostgreSQL 的健康接口 |
| `http://localhost:3000/api/docs` | Swagger UI |
| `http://localhost:3000/api/docs-json` | OpenAPI JSON |
| `http://localhost:5173` | 管理后台欢迎页与真实连接检查 |
| `http://localhost:5174` | 手机 H5 首页预览 |
| `127.0.0.1:5432` | 仅本机可访问的 PostgreSQL |

前端 `.env.example` 分别位于 `apps/admin-web` 和 `apps/mobile`。需要修改时复制为同目录 `.env.local`，使用 `VITE_API_BASE_URL`；前端配置不可含数据库密码。Android 设备使用电脑局域网地址，不能使用手机自身的 localhost。后续 HBuilderX 打开 `apps/mobile` 根目录，CLI 工程的 manifest/pages/App 位于 `src`。

## 检查与构建

```powershell
pnpm prisma:validate
pnpm lint
pnpm format:check
pnpm typecheck
pnpm build
pnpm test
pnpm --filter @caicang/mobile build:app
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/verify-db.ps1
```

`pnpm test` 启动自己的临时 API 进程，测试真实 PostgreSQL 查询、OpenAPI、CORS 和前端构建资源；要求 PostgreSQL 已启动，测试结束后停止临时 API。`build:app` 只生成 uni-app 的 App 资源，不签名、不生成可安装 APK。实际执行记录和未解决事项见 [docs/TASK_01_REPORT.md](docs/TASK_01_REPORT.md)。

定位：自有仓库电商采购 → 运单关联 → 手机扫码验收 → 库存管理 → 出库发货。多商家 SaaS 数据隔离预留，V1 不提供平台个人买家订单自动同步或在线订阅收费。

> 下方保留 V1 设计说明。工程骨架和任务 03 数据模型、迁移、seed 已实现；业务接口尚未实现，也没有可安装 APK。`database/schema.sql` 是结构参考稿，不作为初始化脚本执行。

## 使用顺序

1. 阅读 `docs/PROJECT_SPEC.md`（业务、验收与角色）。
2. 阅读 `docs/ARCHITECTURE.md`（技术方案、目录布局、状态、重要决策）。
3. 阅读 `docs/DATABASE_DESIGN.md`，查看 `database/schema.sql`（真实表定义）。
4. 阅读 `docs/API_SPEC.md`（接口、请求响应与错误码）。
5. 阅读 `docs/SCAN_FLOW.md`（扫码逻辑、事务、去重与异常）。
6. 阅读 `docs/DEPLOYMENT.md`（Windows + Android + 服务器操作说明）。
7. 按 `docs/CODEX_TASKS.md` 向 Codex 分阶段提交 `prompts/START_CODEX.md`，执行时依照 `AGENTS.md`。

## 推荐技术

- 管理端：Vue 3 + TypeScript + Vite + Element Plus
- 手机端：uni-app Vue 3 + TypeScript，重点 Android 真机扫码
- 服务端：NestJS + TypeScript + Prisma 7 + @prisma/adapter-pg
- 数据：PostgreSQL 16+；Redis 非必需，按负载决定
- 包管理：pnpm workspace，固定依赖 lockfile；API 契约：OpenAPI
- Windows：PowerShell、VS Code/Codex、Docker Desktop (WSL2)、HBuilderX
- 正式部署：Linux + Docker Compose + TLS 反向代理 + 备份

## V1 里程碑与最小演示

同一商家账号在 Web 创建 SKU/采购单/快递包裹并录入运单号；Android 真机扫快递条码，核对商品及数量，提交收货；Web 实时反映可用库存、成本与流水；创建出库单、扣减库存，重复扫码/重复提交不重复增减库存。详细验收见 `docs/PROJECT_SPEC.md`。

## 文件说明

- `AGENTS.md`：Codex 项目级约束与工作方式
- `docs/*.md`：详细规格、设计、API、流程、部署、任务
- `database/schema.sql`：PostgreSQL 基础模型与核心约束（不包含全部上层业务校验）
- `examples/scan-receive.json`：扫码入库调用示例
- `prompts/START_CODEX.md`：首次交给 Codex 的指令
- `scripts/verify-db.ps1` 与 `scripts/compose.dev.yml`：启动并确认本地 PostgreSQL 的示例

## 实施前必须明确的边界

- 快递运单码 ≠ 商品码；扫运单仅识别包裹及采购来源，不代表自动识别箱内货品。
- 支持“一采购单多包裹”与“一包裹多 SKU”；未分配包裹明细时由验收员选择并核实到货明细。
- 采购订单状态、物流签收状态、仓库实际验收状态分开管理。
- 多租户隔离（tenant_id）、数据库一致性和库存幂等是第一版的强制要求。
- 演示金额和示例运单号均为测试数据；不可用于真实物流查询。

## 任务 01：infra 配置入口补充

`infra/compose.dev.yml` 引用已有开发数据库配置，复用相同的 Compose 项目名和数据卷。完整说明见 [infra/README.md](infra/README.md)。在新的 PowerShell 中可执行：

```powershell
cd D:\Dev\caicang-manager
pnpm install --frozen-lockfile
pnpm db:up
docker compose --env-file .env -f infra/compose.dev.yml config --quiet
pnpm dev
```

单独启动命令：后端 `pnpm dev:api`，Web `pnpm dev:web`，手机 H5 `pnpm dev:mobile`；手机 App 资源编译为 `pnpm --filter @caicang/mobile build:app`，此命令不生成签名 APK。三端和公共包统一检查使用 `pnpm typecheck`、`pnpm build`。

## 任务 02：本地数据库与后端启动

本次任务 02 按用户指令限定为数据库环境准备，业务模型和初始迁移另行执行。完整步骤见 [docs/LOCAL_DATABASE.md](docs/LOCAL_DATABASE.md)。

```powershell
cd D:\Dev\caicang-manager
pnpm install --frozen-lockfile
pnpm db:up
pnpm db:check
pnpm start:api
```

另开终端执行 `pnpm api:check`，或访问 `http://localhost:3000/api/v1/health`。停止 API 用当前终端的 Ctrl+C；数据库停止用 `pnpm db:stop`，容器和数据卷保留。再次启动用 `pnpm db:up`。

任务 02 时仅提供迁移命令入口，尚未建立业务迁移；任务 03 的当前初始化步骤见下节。数据库停启与接口恢复验证使用 `pnpm test:db`，任务 02 的历史实测记录见 [任务 02 报告](docs/TASK_02_REPORT.md)。

## 任务 03：数据库迁移、seed 与约束验证

新环境使用已提交的迁移初始化，不执行 `database/schema.sql`：

```powershell
cd D:\Dev\caicang-manager
pnpm install --frozen-lockfile
pnpm db:up
pnpm prisma:migrate:deploy
pnpm prisma:migrate:status
pnpm db:seed
pnpm db:seed
pnpm test:models
pnpm start:api
```

17 张表由 Prisma Migrate 管理。seed 建立 2 个商家、6 个用户、7 个成员关系、4 个仓库、6 个商品；重复执行保留已有记录与用户修改。测试账号默认停用，密码仅保存 bcrypt 哈希，暂不提供登录功能。`pnpm test:models` 使用本机 PostgreSQL 中独立随机空测试库，验证迁移、重复/并发 seed 与约束后仅清理本次创建的测试库，不清空开发库或数据卷。

后续更改模型时执行 `pnpm prisma:migrate:dev --name 描述`，审阅迁移，再明确执行 `pnpm prisma:generate`；Prisma 7 的 generate/seed 不随迁移自动运行。字段差异、约束边界和实际检查结果见 [任务 03 报告](docs/TASK_03_REPORT.md) 与 [数据库设计](docs/DATABASE_DESIGN.md)。
