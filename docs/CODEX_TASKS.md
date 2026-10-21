# CODEX_TASKS.md — 分阶段执行清单与每阶段验收

**重要原则：一次只给 Codex 一个阶段。** 每完成一个阶段，要让 Codex 运行脚本/测试、检查差异、提交 Git；不能凭“已生成文件”宣布完成。任务不能跨阶段跳过后端业务逻辑直接做页面。

当前用户任务 11：在任务 10 布局内接入已有商品/仓库真实 API，完成列表、表单、详情、启停、搜索分页、默认业务仓库偏好、权限和失败重试。启动和验证见 WEB_CATALOG.md、TASK_11_REPORT.md；不实施采购、库存或出库后续业务。用户追加要求完成后上传 GitHub。

用户任务 10 是 Web 后台登录及主布局：接入真实认证/刷新/退出，补充本人商家发现，完成商家选择、导航、用户信息、加载/错误/路由权限与浏览器验收。不提前开发商品/采购/出入库业务页面；详见 WEB_AUTHENTICATION.md、TASK_10_REPORT.md。

用户任务编号覆盖说明：用户任务 02 是“建立本地数据库环境”，实际交付见 `LOCAL_DATABASE.md` 与 `TASK_02_REPORT.md`。用户最新任务 03 是“实现完整数据库模型”，对应下文原阶段 02 的模型、迁移、seed 验收，交付见 `TASK_03_REPORT.md`。本次不实施下文原阶段 03 的登录、权限或基础资料接口；后续任务仍以用户明确指令为准。

用户任务 04 是“后端公共基础模块”，交付统一验证、响应、异常、追踪、配置、日志与安全组件及自动化测试，见 `BACKEND_FOUNDATION.md` 和 `TASK_04_REPORT.md`。原阶段 03 的登录/商家/权限仍等待后续明确指令；阶段编号不能代替用户当前任务范围。

用户任务 05 仅实现用户邮箱密码注册、登录短期 Access Token、GET /me 和真实数据库接口测试，见 `AUTHENTICATION.md` 与 `TASK_05_REPORT.md`。原清单中的 refresh/logout、商家、成员、角色与商品仓库 CRUD 均未包含在本次任务。

用户任务 06 仅增加 Refresh Token、轮换、服务端会话撤销、安全退出与真实数据库并发/重启测试；见 `AUTHENTICATION.md`、`TASK_06_REPORT.md`。不提前实现商家/角色、前端登录页或库存功能。

用户任务 07 增加商家创建/当前商家、成员列表/添加/修改与五角色授权，通过 Guard、Decorator、数据库 Tenant Context 和审计事务实现；见 TENANT_AUTHORIZATION.md 与 TASK_07_REPORT.md。采购、库存及界面仍不在本任务范围。

用户任务 08 实现商品 CRUD（无 DELETE）、SKU/条码 lookup、搜索分页筛选、参考进货价/备注增量迁移与集成测试；详见 PRODUCTS.md、TASK_08_REPORT.md。历史采购/成本保持独立，采购、库存、扫码界面仍不在本次范围。

用户任务 09 实现仓库列表/创建、备注增量迁移与真实数据库测试，复用默认仓库事务、tenant_id 隔离和五角色权限，验证既有采购目标仓库、分仓 SKU 库存与历史 Restrict 外键；详见 WAREHOUSES.md、TASK_09_REPORT.md。不开放删除、调拨或采购/库存业务接口。

## 阶段 00 — 确认环境与初始化 Git

目标：验证 Windows 工具；确定 D: 或其他工作区目录；确认 Node、pnpm、Docker Desktop、HBuilderX 版本；准备 Git 分支与 .gitignore。

交付：`README.md` 环境说明、`.gitignore`、`docs/DECISIONS.md`、已执行的命令输出概要。不得自动移动 Windows/开发工具的缓存、用户历史数据，也不得删除现有文件。

验收：`git status` 正常，`docker compose version`、`node -v`、`pnpm -v` 输出可用；工作区目录无敏感凭证。

## 阶段 01 — Monorepo + 数据库启动 + API 骨架

目标：建立 pnpm workspace，创建 `apps/api` NestJS，`apps/admin-web` Vue3，`apps/mobile` uni-app Vue3 HBuilderX 可识别骨架，公共契约包。建立本地 compose PostgreSQL 与 `.env.example`、启动脚本。锁定依赖版本（不使用 `latest` 作为结果）。

交付：根目录、可调用 `/api/v1/health` 的 API、管理员 Web 欢迎页、手机端首页骨架。Prisma 7 的配置必须符合 generator output、adapter-pg、ESM 的版本要求。

验收：安装、API 构建、Web 构建、`/health` 返回正常；Docker DB ready；所有命令在 README 中真实可复现。

## 阶段 02 — PostgreSQL 模型 + 迁移 + 种子数据

目标：根据 `database/schema.sql` 建立 Prisma models 与追踪迁移，补齐外键约束；创建两个商家、两用户、两个仓库、3 个 SKU 的演示数据。

交付：Prisma migrations、schema、seed、测试用实体关系检查，不能运行 schema.sql 和 Prisma 初始迁移重复建表。

验收：空库迁移与 seed 成功；二次 seed 幂等；不允许跨租户建立关系；迁移重建 DB 测试通过。

## 阶段 03 — 登录、商家、权限、基础资料

目标：注册/登录/refresh/logout；JWT + tenant context + role guard；商品仓库 CRUD；API 文档。

交付：`/auth` `/me` `/members` `/products` `/warehouses`；密码哈希、限流/校验、错误处理；API 集成测试。

验收：普通仓管不能更改采购单价格；租户 A token + 租户 B 的资源 ID 返回 404/403；校验空 SKU、同商家 SKU 重复、跨商家同 SKU 允许。

## 阶段 04 — 采购单及包裹

目标：DRAFT → PLACED 状态机、采购费用/运费分摊、多个包裹与同包裹多个 SKU、可编辑范围检查、运单查找。

交付：采购和包裹 API、Web 采购单页面、包裹录入页面、单号搜索接口。

验收：10 件 A+5 件 B 的订单金额精确；同单 2 包裹；条形码仅用于查包裹而非自动给 SKU 加库存；冻结后不可无审计地修改已确认价格。

## 阶段 05 — **扫码验收入库（核心阶段）**

目标：Android `uni.scanCode` + 手工输入兜底；扫码查包裹→剩余 SKU→确认部分收货；后台按采购单锁并做 `clientOperationId` 幂等，事务写入库存余额、移动流水、账面成本。

交付：`/packages/lookup` `/packages/:id/receivable` `POST /receipts` 等 API；Android 页面；可重复回放的并发验收测试。

验收：真实 Android 扫条形码后库存+3；重试同一操作 ID 库存不变；两并发请求无法合计超收；未知运单不修改库存；单包裹分次验收、无预计包裹行手动完结、状态正确。

## 阶段 06 — 库存查询、出库发货

目标：库存余额与流水查询、SKU 商品码查询、创建出库草稿、确认出库及扣库存/成本、运单录入。

交付：`/inventory/*` `/outbound-orders/*` API，Web 视图及 App 出库/库存页面。

验收：库存不足返回 409 并无部分扣减；出库重复确认不重复扣库存；移动平均成本一致；跨租户隔离生效。

## 阶段 07 — Web 后台完成 + 报表

目标：菜单/路由/商家选择，商品/采购/包裹/入库/库存/出库所有页面可操作；仪表盘真实指标；CSV 安全导出。

交付：响应式管理后台、分页筛选、准确金额展示、表单错误提示、审计查询（按权限）。

验收：从空账号注册到出库全链路 Web 可完成；没有 Mock 值冒充真实库存；CSV 含 UTF-8 BOM，防止 Excel 公式注入。

## 阶段 08 — Android 真机 APK 与回归

目标：使用 HBuilderX 在 Windows 上真机测试并打包签名 Android APK 测试版。完成相机权限、弱网重试、手动输入、同 Wi-Fi 调试地址与生产 HTTPS 地址切换。

交付：运行/打包操作记录、Android 测试日志、截图、APK 的生成方法与版本号（APK 由本机 HBuilderX 构建，不要求 Codex 猜一个附件）。

验收：至少一台实际 Android 手机扫码成功，包含重复扫码和断网；能连接 API；扫码后 Web 可查询同笔库存。

## 阶段 09 — 生产化、备份、最终测试

目标：Dockerfile、Compose、反向代理 HTTPS、最小权限、备份恢复、监控、OpenAPI、自动化测试、上线检查单。不要没有 TLS 就公开服务。

交付：`infra/compose.prod.yml`、Dockerfiles、Caddy/Nginx 配置、数据库备份/恢复脚本、验收报告及用户操作手册。

验收：独立空机按文档部署可用；重新部署不丢数据；在隔离环境完成备份恢复；执行 `PROJECT_SPEC.md` 的 AT-01～AT-14 全部通过。

---

# 每次交给 Codex 的任务格式（可复制）

```text
你正在开发“采仓管家 V1.0”，业务模式是电商采购到自有仓库，再出库发货。
先完整阅读 AGENTS.md、docs/PROJECT_SPEC.md、docs/ARCHITECTURE.md、
docs/DATABASE_DESIGN.md、docs/API_SPEC.md、docs/SCAN_FLOW.md、
docs/DEPLOYMENT.md、docs/CODEX_TASKS.md。
当前只执行【阶段 XX：填写阶段名称】，不要提前开发其它阶段。

工作方式：
1. 先检查当前项目状态、依赖、未提交变更。不要覆盖用户已有文件。
2. 输出本阶段简短实施计划；然后创建或修改真实源代码。
3. 运行 lint、typecheck、build、相关自动化测试和迁移检查。
4. 输出变更文件列表、验证命令和实际结果，列出未解决的阻塞。
5. 更新相应文档与 README 启动命令，建议一个 Git commit message。
6. 若命令失败，继续修复再测试；没有实际运行过的测试不能写“通过”。
7. 不准用 Mock 数据假装已完成核心入库、库存、出库功能。
8. 不可为完成阶段破坏权限隔离、幂等和事务性。遇到重要架构冲突需写入 DECISIONS.md。

本阶段验收要求：严格执行 docs/CODEX_TASKS.md 阶段 XX 的验收条款。
```

# 安全回退机制

每阶段执行前保留 Git 快照，生产数据库操作先备份。若 Codex 因 Android 真机/签名/官方授权等需人工操作，应明确列出所需 UI 步骤及当前可证明结果，不能虚构 APK 测试通过。
