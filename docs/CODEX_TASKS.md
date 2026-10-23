# CODEX_TASKS.md — 分阶段执行清单与每阶段验收

**重要原则：一次只给 Codex 一个阶段。** 每完成一个阶段，要让 Codex 运行脚本/测试、检查差异、提交 Git；不能凭“已生成文件”宣布完成。任务不能跨阶段跳过后端业务逻辑直接做页面。

当前用户任务 26：Android 库存查询与扫码出库。手机端新增库存查询（手输名称/SKU、扫条码、按仓库看数量与最近流水）与扫码出库（选仓库、扫码加行、改数量、填客户与快递、建草稿、二次确认发货、展示结果）。重复扫码只累加待发数量、不动数据库；`clientOperationId` 落盘复用，网络失败重试不重复扣库存。验收：扫条码查到库存，创建并确认出库后 Web 与 App 都看到最新数量（实测 10→7，再发 8 被拒，改 2 件后 5，两端一致）。详见 `docs/TASK_26_REPORT.md`、「docs/MOBILE_STOCK_OUTBOUND.md」。

用户任务 25 已完成电脑端出库页面。管理后台「出库管理」上线：出库单列表（状态/仓库/日期/单号搜索）、新建草稿（多 SKU、逐行数量、自动查可用库存、收货信息、快递公司、运单号、备注）、出库详情、确认发货、取消草稿。库存不足时页面禁止完成发货，并把服务端 `409 OUT_OF_STOCK` 的逐 SKU 差额原样显示；发货成功后用服务端返回的单据刷新库存与状态，前端不做任何本地扣减。验收：电脑上建一张发货单选商品与数量，确认后库存从 10 变 7，再发 8 被拒且仍为 7（实测通过）。详见 `docs/TASK_25_REPORT.md`、「docs/WEB_OUTBOUND.md」。

用户任务 24 已完成出库发货系统。实现 `GET/POST /outbound-orders`、`GET/PATCH /outbound-orders/{id}`、`POST /outbound-orders/{id}/ship`、`POST /outbound-orders/{id}/cancel`：草稿填写商品数量与客户地址 → 确认发货扣除库存并写流水。字段含出库单号、仓库、SKU、数量、收件人、电话、地址、快递公司、运单号、备注。要求：库存不足禁止确认、单事务、并发不超卖、重复确认不重复扣减、`clientOperationId` 幂等、移动平均成本快照、不可变流水、审计日志、仅合法角色可确认、已发货不能再次确认、取消不扣库存、任一步失败全部回滚。验收：库存 10 件发 3 件剩 7 件，再发 8 件被拒且仍为 7（实测通过）。详见 `docs/TASK_24_REPORT.md`、「docs/OUTBOUND.md」。

用户任务 23 已完成 Web 库存管理页面。管理后台新增 7 个只读页面（库存总览、商品库存列表、SKU 库存详情、库存变动流水、入库记录列表、入库记录详情、待入库采购商品），列表含商品名称、SKU、仓库、当前数量、平均成本、库存总成本、待入库数量、最近入库时间，支持搜索 / 分页 / 日期筛选。数据全部来自真实 API，不得使用固定演示数字，页面只查询、不得绕过后端改库存。为支撑页面新补 `balances.lastReceivedAt`、`GET /inventory/summary`、`GET /inventory/pending`、`movements.sourceDocumentId` 与入库单 `from`/`to`（全部只读）。验收：手机扫码入库后电脑刷新库存页面即可看到真实记录（测试内以入库 20 件复现）。详见 `docs/TASK_23_REPORT.md`、「`docs/WEB_INVENTORY.md`」。

用户任务 22 已完成库存查询系统：新增只读 `GET /inventory/balances` 与 `GET /inventory/movements`，按商家/仓库/SKU 返回现存数量、采购待入库数量、移动加权平均成本、账面总成本与完整流水；`/inventory/*` 只有 GET。验收：入库 20 → 出库 8 → 剩 12，流水链 0→20→12 闭合。详见 `docs/TASK_22_REPORT.md`。

用户任务 21 已完成手机扫码验收入库全流程。扫码命中包裹后进入收货页，展示采购单、快递与运单号、SKU 与商品名、订购/已入库/剩余数量；输入本次实际到货数量，支持多 SKU 与部分收货、收货备注；提交前二次确认，调 `POST /receipts` 真实事务，展示成功结果与本次入库数量并可继续扫下一包裹；同一次提交重试必须复用原 UUID 与请求内容，改数量则生成新 UUID；断网显示未提交且不提前加库存，超限或已收完给明确错误。验收：真机扫实际快递，确认收 5 件后数据库/Web 库存增加 5 件。详见 `docs/TASK_21_REPORT.md`。

用户任务 20 已完成 Android 手机扫一扫：官方 `uni.scanCode` 支持一维码与二维码，前导零原样保留，唯一命中进详情、多候选人选、未知给异常提示，支持手动输入、重新扫码与相机权限被拒提示；扫码路径不写库存。详见 `docs/TASK_20_REPORT.md`。

用户任务 19 已完成 uni-app 手机应用基础功能：登录页、Token 管理与自动刷新、切换商家、首页四入口、底部导航、我的账户、退出登录、注入式请求封装与统一错误、断网提示、双环境地址。详见 `docs/MOBILE_APP.md`、`docs/TASK_19_REPORT.md`。

用户任务 18 已完成验收入库安全专项测试：12 个破坏性场景在真实 PostgreSQL 上执行，每场景对账收货单/库存余额/库存流水，收货单、明细、流水、余额互相闭合，未发现产品缺陷；详见 `docs/RECEIVING_TEST_REPORT.md`。

用户任务 17 已完成核心验收入库事务：`POST /receipts`（单事务：权限/归属/状态/数量校验 → 收货单与明细 → 库存余额与移动加权平均成本 → 不可变流水 → 采购单与包裹状态 → 审计，任一步失败全回滚；`clientOperationId` 幂等，同 ID 同请求返回原结果、不同请求 409；拒绝客户端提交库存余额/仓库/成本）、`GET /receipts` 与 `GET /receipts/{id}`。详见 RECEIPTS.md、TASK_17_REPORT.md。

用户任务 16 已完成扫码查询与待收数量：`GET /packages/lookup` 候选附带已收进度，新增 `GET /packages/{id}/receivable`（整单累计已收、采购剩余、本包裹剩余、本次最大可收；无预计明细时返回采购单剩余 SKU 供人工选择）与 `POST /packages/{id}/complete-receiving`（仅无预计明细的包裹可人工标记验收完成）。两个新端点只读/只改包裹状态，均不写库存。详见 PACKAGES.md、TASK_16_REPORT.md。

用户任务 15 已完成快递包裹 Web 页面。新增只读 `GET /packages` 分页列表，实现真实列表、搜索/筛选/分页与详情弹窗，展示采购来源、运单、SKU 采购/预计/已收数量、物流状态与收货进度；复用认证、商家上下文、权限与错误处理，无新迁移、无模拟数据。详见 WEB_PACKAGES.md、TASK_15_REPORT.md。

用户任务 14：四个真实采购包裹 API；支持多包裹/多 SKU/空预计明细、运单字符串及不同公司候选、累计预计数量上限、收货后核心字段限制。按商家→采购主单→包裹事务锁校验、角色与租户隔离、原子审计和并发测试。详见 PACKAGES.md、TASK_14_REPORT.md。不实现包裹 Web、收货或库存。

用户任务 13 已完成采购管理 Web 列表、新建、详情、草稿编辑、确认/合法取消、筛选；真实双 SKU 创建及数据库核验、Docker 恢复补验完成，已上传 GitHub。详见 WEB_PURCHASES.md、TASK_13_REPORT.md。

用户任务 12 已完成采购列表、草稿创建/编辑、详情、确认下单、无收货条件取消；真实 Decimal 成本/运费分摊、状态冻结、商家与角色、审计及并发测试。详见 PURCHASE_ORDERS.md、TASK_12_REPORT.md。

用户任务 11 已完成商品仓库页面和个人默认仓库偏好，并按当时追加要求上传 GitHub；启动和验证见 WEB_CATALOG.md、TASK_11_REPORT.md。

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

进度：查询半边已在任务 22 完成（`GET /inventory/balances`、`GET /inventory/movements`，只读、按商家隔离、10 项集成测试通过）；出库草稿/确认出库/运单录入与 Web、App 视图仍待后续任务。任务 22 只交付 API，出库流程尚未实现，不能用它替代本阶段验收。

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
