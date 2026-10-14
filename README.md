# 采仓管家 V1.0 | Codex 开发资料包

## 当前工作区与环境（任务 00）

正式工作区为 `D:\Dev\caicang-manager`，原始资料包保留在 `D:\import and export\introduce\caicang-manager`。Git 已初始化；当前尚未生成业务应用。

2026-10-14 实测 Git 2.56.0.windows.2、Node 22.22.2 LTS、pnpm 11.25.0、Corepack 0.34.6、VS Code 1.141.0、Windows PowerShell 5.1 可执行。普通 PowerShell 已可调用 pnpm；Codex 内置 PowerShell 为 7.6.5。

Windows 11 22H2 需要更新；WSL2 缺少内核；未发现 Docker Desktop 和 HBuilderX。完整实测输出、官方下载与安装步骤见 [docs/ENV_CHECK.md](docs/ENV_CHECK.md)。环境复查通过后，由用户明确指定阶段 01，再执行后续初始化命令。

定位：自有仓库电商采购 → 运单关联 → 手机扫码验收 → 库存管理 → 出库发货。多商家 SaaS 数据隔离预留，V1 不提供平台个人买家订单自动同步或在线订阅收费。

> **注意：这是项目完整设计/执行包，不是已经实现的应用源代码，也不是可直接安装的 APK。** `database/schema.sql` 是用于 PostgreSQL 的可执行数据库结构初稿，需要 Codex 创建对应 ORM 模型、迁移与测试。

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
