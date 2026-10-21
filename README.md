# 采仓管家 V1.0 | 开发工作区

## 任务 11：商品与仓库管理页面

启动 API 和 Web 后打开 http://localhost:5173，可注册、创建商家，在“商品管理”搜索分页、添加/编辑、查看详情及启停商品，在“仓库管理”添加仓库、选择当前账号的默认业务仓库。全部资料通过真实 API 保存；写按钮遵守服务端角色权限。

默认业务仓库按账号与商家保存在当前浏览器，刷新恢复时重新验证仓库归属与启用状态，不跨设备同步。运行 `pnpm test:catalog` 检查商品/仓库生产客户端与真实数据库，`pnpm test:web` 覆盖全部 Web 服务层测试，`pnpm test` 完整回归。操作与边界见 [Web 商品仓库说明](docs/WEB_CATALOG.md)，本次结果见 [任务 11 报告](docs/TASK_11_REPORT.md)。

## 任务 10：Web 登录与管理后台

在项目根目录执行 `pnpm install --frozen-lockfile`、`pnpm db:up`、`pnpm prisma:migrate:deploy`，终端一运行 `pnpm start:api`，终端二运行 `pnpm dev:web`。打开 http://localhost:5173，注册账号后登录，选择/创建商家进入后台；创建商家自动建立默认仓库。

已接入真实注册、登录、/me、刷新与退出，提供商家选择、用户信息、加载/错误提示及路由权限。任务 11 新增仓库入口，现为十个导航；采购和出入库等后续页面明确待开放，无模拟业务数据。详见 [Web 使用说明](docs/WEB_AUTHENTICATION.md) 与 [任务 10 历史报告](docs/TASK_10_REPORT.md)。

## 当前工作区与环境（任务 01）

正式工作区为 `D:\Dev\caicang-manager`，原始资料包保留在 `D:\import and export\introduce\caicang-manager`。已建立 pnpm workspace、NestJS API、Vue3 管理后台与 uni-app 首页；现已完成真实数据库、认证、商家/成员权限、商品/仓库 API、Web 登录及商品仓库页面。采购、库存、出库业务与对应管理页面仍待后续任务。

2026-10-14 实测 Git 2.56.0.windows.2、Node 22.22.2 LTS、pnpm 11.25.0、Corepack 0.34.6、VS Code 1.141.0、Windows PowerShell 5.1 可执行。普通 PowerShell 已可调用 pnpm；Codex 内置 PowerShell 为 7.6.5。

复查已确认 Windows 11 25H2、WSL2、Docker Server 和 hello-world 正常；Docker 数据磁盘位于 D 盘。详见 [docs/ENV_CHECK.md](docs/ENV_CHECK.md)。HBuilderX、Ubuntu 和 PowerShell 7 暂不处理；本阶段的手机 H5/App 编译资源不等于签名 APK 或 Android 真机验收。

## 本地安装与运行（PowerShell）

```powershell
cd D:\Dev\caicang-manager
pnpm install --frozen-lockfile
pnpm db:up
pnpm prisma:migrate:deploy
pnpm prisma:generate
pnpm build:shared
pnpm dev
```

`pnpm db:up` 仅在 `.env` 不存在时创建随机本地数据库密码，已有配置会保留。Compose 使用持久化命名卷和固定镜像 digest；不要执行 `down -v` 或重放 `database/schema.sql`。首次启动 API 前执行 `pnpm prisma:migrate:deploy` 应用追踪迁移；已有 seed 命令为 `pnpm db:seed`，不会启用原演示账号。

`pnpm dev` 在当前终端启动 API 和管理后台，Ctrl+C 停止开发进程，PostgreSQL 数据和容器保留。API TypeScript 改动由 tsc 监听并触发 Node 重启。也可在独立终端执行 `pnpm dev:api` 和 `pnpm dev:web`。手机 H5 预览使用 `pnpm dev:mobile`。

| 地址                                  | 用途                           |
| ------------------------------------- | ------------------------------ |
| `http://localhost:3000/api/v1/health` | 查询真实 PostgreSQL 的健康接口 |
| `http://localhost:3000/api/docs`      | Swagger UI                     |
| `http://localhost:3000/api/docs-json` | OpenAPI JSON                   |
| `http://localhost:5173`               | 管理后台欢迎页与真实连接检查   |
| `http://localhost:5174`               | 手机 H5 首页预览               |
| `127.0.0.1:5432`                      | 仅本机可访问的 PostgreSQL      |

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

> 下方保留 V1 设计说明。工程骨架、数据模型、迁移、seed、认证、商家成员权限和商品 API 已实现；采购/库存等业务接口尚未实现，也没有可安装 APK。`database/schema.sql` 是结构参考稿，不作为初始化脚本执行。

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

## 任务 04：后端公共基础模块

已接入全局 DTO 验证、成功/错误包装、业务错误码、requestId、日志脱敏、配置验证、CORS、安全头与限流。开发运行命令仍为 `pnpm db:up`、`pnpm start:api`；健康接口 `/api/v1/health`，开发文档 `/api/docs`。生产必须显式提供 HTTPS WEB_ORIGIN，Swagger 强制关闭；详细变量和新模块用法见 [后端基础说明](docs/BACKEND_FOUNDATION.md)。

`pnpm test:api` 运行公共模块 HTTP/配置/日志测试；`pnpm test` 构建全仓并执行公共、认证、商家权限和原有冒烟测试；`pnpm test:db` 验证真实数据库停启与 API 恢复。限流目前为每进程内存。任务 07 已提供商家角色权限，库存业务接口仍未实现；任务 04 历史结果见 [任务 04 报告](docs/TASK_04_REPORT.md)。

## 任务 05：注册、登录与本人资料

运行 `pnpm prisma:migrate:deploy` 应用邮箱规范化唯一索引，再用 `pnpm start:api` 启动。开发缺少 JWT_ACCESS_SECRET 时会创建被忽略的 `.env.auth.local`，保留现有 .env 和密钥文件；生产必须通过进程环境提供签名密钥。Access Token 默认 15 分钟。

在 [Swagger](http://localhost:3000/api/docs) 执行 `POST /api/v1/auth/register` 和 `POST /api/v1/auth/login`，将登录返回的 data.accessToken 填入 Authorize 的 bearer 栏，再执行 `GET /api/v1/me`。详细 JSON 示例、密码规则和错误见 [认证说明](docs/AUTHENTICATION.md)，历史结果见 [任务 05 报告](docs/TASK_05_REPORT.md)。认证测试 `pnpm test:auth` 使用真实 PostgreSQL 独立测试库；商家/角色现由任务 07 实现，库存业务尚未实现。

## 任务 06：令牌刷新与安全退出

```powershell
cd D:\Dev\caicang-manager
pnpm install --frozen-lockfile
pnpm db:up
pnpm prisma:migrate:deploy
pnpm start:api
```

登录现在同时返回随机 Refresh Token。调用 `POST /api/v1/auth/refresh` 或 `/api/v1/auth/logout`，JSON 正文均为 `{"refreshToken":"<最近一次返回的 data.refreshToken>"}`；这两个端点无需有效 Access Token。刷新后必须保存新值，旧值重复刷新会撤销整个会话。退出后此会话的 Access Token 和 Refresh Token 均失效，其他设备登录不受影响。

新增迁移只建立 auth_sessions/refresh_tokens，不清空原有数据。Access 默认 15 分钟，会话绝对有效期默认 7 天；生产强制校验进程 JWT_ACCESS_SECRET。客户端存储集成留待前端任务。详见 [认证操作说明](docs/AUTHENTICATION.md)、[API 契约](docs/API_SPEC.md) 和 [任务 06 报告](docs/TASK_06_REPORT.md)。

## 任务 07：商家、成员与角色

登录后 POST `/api/v1/tenants`，正文 `{"name":"我的商家"}`，即可事务创建商家、OWNER 和默认仓库。保存 data.tenant.id，之后 GET `/api/v1/tenants/current`、GET/POST `/api/v1/members`、PATCH `/api/v1/members/{membershipId}` 同时传 Bearer 和 `X-Tenant-Id`。

成员管理只开放给 OWNER/ADMIN；ADMIN 只能管理 BUYER/WAREHOUSE/VIEWER，OWNER 不可通过通用成员接口转让、降级或停用。跨商家或未知 membershipId 为统一 404；没有启用成员身份为 403。权限修改和审计同事务，不依赖客户端角色。

`pnpm test:tenancy` 运行真实 PostgreSQL/HTTP 隔离、角色、审计、并发测试；启动仍使用 `pnpm db:up`、`pnpm prisma:migrate:deploy`、`pnpm start:api`。本次无需新迁移。Swagger 操作与完整角色矩阵见 [商家权限说明](docs/TENANT_AUTHORIZATION.md)，修改与实际测试结果见 [任务 07 报告](docs/TASK_07_REPORT.md)。

## 任务 08：商品 API

先执行 `pnpm prisma:migrate:deploy` 应用商品参考价/备注增量迁移，再 `pnpm start:api`。所有商品接口需要 Bearer+X-Tenant-Id，OWNER/ADMIN/BUYER 可写，WAREHOUSE/VIEWER 只读。

POST `/api/v1/products` 最小示例：`{"name":"20W 充电器","sku":"CHARGER-20W","referencePurchasePrice":"18.50"}`。同商家再次提交返回 409 PRODUCT_SKU_ALREADY_EXISTS。GET `/products` 支持搜索、分页与启用状态/单位/有无条码筛选；GET `/products/{id}` 和 PATCH `/products/{id}` 读取/修改当前商家商品；GET `/products/lookup?code=` 返回启用商品的精确 SKU/条码候选。停用保留历史记录，参考价修改不更新历史订单价格。

运行 `pnpm test:products` 验证商品集成测试，`pnpm test:models` 验证迁移/seed/约束，`pnpm test` 构建全仓并回归。完整 JSON、字段/金额规则与 Swagger 流程见 [商品 API 说明](docs/PRODUCTS.md)，修改及实际结果见 [任务 08 报告](docs/TASK_08_REPORT.md)。

## 任务 09：仓库管理 API

GET /api/v1/warehouses 分页列出当前商家仓库，POST /api/v1/warehouses 供 OWNER/ADMIN 创建；所有成员可查看，编码商家内唯一，支持 nullable 备注。创建商家自动拥有 DEFAULT 默认仓库。无仓库删除或调拨接口。

Windows 终端运行 `cd D:\Dev\caicang-manager`、`pnpm db:up`、`pnpm prisma:migrate:deploy`、`pnpm start:api`；在 http://localhost:3000/api/docs 使用 Bearer 与 X-Tenant-Id，创建示例 `{"name":"深圳二仓","code":"SZ-02","remark":"小件商品存放区"}`。

`pnpm test:warehouses` 运行真实数据库接口测试；`pnpm test:models` 检查迁移和历史约束；`pnpm test` 完整构建与回归。详见 [仓库 API 说明](docs/WAREHOUSES.md) 和 [任务 09 报告](docs/TASK_09_REPORT.md)。
