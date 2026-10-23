# 采仓管家 V1.0 | 开发工作区

## 2026-10-23 阶段复核（任务 00—20）

Docker/PostgreSQL 已正常恢复，任务 17 入库事务 22 项、任务 18 安全专项 15 项、手机测试 15 项（含 11 个真实 API 子测试）、扫码专项 10 项均已本轮实际通过，0 跳过。完整结果、失败修复记录与剩余问题见 [阶段复核报告](docs/STAGE_REVIEW_00_20.md)。

本轮两次 `pnpm test` 均为 **528 通过、0 失败、0 跳过**，另有模型/重复 seed 专项 65 项通过；typecheck、lint、format、format:check 均通过。

Android 真机、相机权限与签名 APK **尚未验收**。真机准备使用 `pnpm build:mobile:lan -ApiBaseUrl 'http://<电脑局域网IPv4>:3000/api/v1'`，不会覆盖已有 .env；默认 `build:app` 仍读取 production 示例域名，不能直接用于本地手机联调。HBuilderX 导入与八项实机清单见 [手机说明](docs/MOBILE_APP.md)。

当前基线已经包含任务 21 提交；本次仅复核 00—20、修复验收环境与测试，没有开发任务 21，也没有提交或推送。下方各任务小节保留历史交付状态，当前环境与本轮结果以上述报告为准。

## 任务 22：库存查询系统

新增两个**只读**接口。`GET /api/v1/inventory/balances` 每行给出：现存数量（`stock_balances.quantity_on_hand`）、采购待入库数量（`PLACED`/`PARTIAL_RECEIVED` 采购行减去已收量，按商品+仓库聚合，只有待入库、一件未到的商品也会出现在列表里）、移动加权平均成本（账面总成本 ÷ 现存数量，四位小数）、库存账面总成本；`GET /api/v1/inventory/movements` 给出不可变流水，每笔含时间、类型与方向、数量变动、操作前后库存、成本变动与单位成本、来源单据号与来源行 ID、备注、操作人。两者都按 `X-Tenant-Id` 隔离，支持 `warehouseId`/`productId`/`sku`/`barcode`/`search` 以及时间区间（余额按 `updated_at`，流水按 `created_at`，`type` 可选）筛选与统一分页，`from > to` 返回 422。

库存只能由收货等业务事务写入（`INSERT stock_movements` + `UPDATE stock_balances`），**本模块只有 GET**：POST/PUT/PATCH/DELETE 一律 404，OpenAPI 里这两个路径只有 `get`，测试会在调用前后比对余额确认没被改动。只读角色（VIEWER）凭 `products:read` 即可查询。

`pnpm test:inventory` 在一次性 PostgreSQL 库上跑真实 API：**入库 20 件 → 查询显示 20 件（总成本 370.0000、均价 18.5000）→ 出库 8 件 → 显示 12 件（222.0000）**，流水链 0→20→12 首尾相接、数量合计等于余额；另覆盖待入库、条码前导零、六种筛选、分页、跨商家隔离与"无写接口"。**10 通过 / 0 失败 / 0 跳过**。出库 API 尚未实现（属阶段 06 剩余部分），测试里的出库由同一事务模拟。字段、口径与对账 SQL 见 [库存说明](docs/INVENTORY.md)，结果与未验证项见 [任务 22 报告](docs/TASK_22_REPORT.md)。

## 任务 21：手机扫码验收入库全流程

扫码命中包裹后，详情页「确认收货」进入收货页（`pages/receiving/index`），逐 SKU 展示订购 / 已入库 / 剩余与本次最多可收，默认带出可收数量，可改成实际到货（留空即"这件没到"），支持一个包裹多个 SKU、部分收货、2000 字备注；点确认先弹二次确认框（列出商品 × 数量与总件数），确认后调任务 17 的真实事务 `POST /receipts`，成功页展示服务端返回的入库单号与**本次入库件数**，并可「继续扫下一包裹」。

幂等按内容决定：同样的包裹 + 数量 + 备注重试（断网/5xx/杀进程后重开）复用落盘的 `clientOperationId` 与原样请求体，服务端返回原入库单、库存不重复增加；改了数量或备注则生成新 UUID。断网时页面显示「未提交」并明确"不会提前增加库存"，本地不做任何数量乐观更新；超收（含服务端 409 的剩余可收量）、包裹已关闭、采购单已取消、无权限、操作号冲突都有独立文案并说明"本次未入库"。本机操作日志留最近 50 条（收货页展示 5 条）。

`pnpm test:mobile-receiving` 覆盖数量解析、部分收货、指纹变化、UUID 复用/更换、错误文案与页面接线（10 通过 / 1 跳过），跳过的正是需要 PostgreSQL 的"收 5 件 → 库存 +5"真实验收；本机 Docker 仍被系统策略拦截，需在能启动 PostgreSQL 的环境或真机按 [任务 21 报告](docs/TASK_21_REPORT.md) 第六节验证。设计与幂等规则见 [手机端说明](docs/MOBILE_APP.md)「十、扫码验收入库」。

## 任务 20：Android 手机扫一扫

`apps/mobile` 新增真正的扫码页（`pages/scan/index`）与包裹详情页（`pages/package/index`），调用官方 `uni.scanCode`，同时支持一维条形码与二维码，扫码结果只用于查询包裹、**不写收货单也不动库存**。码值全程按字符串处理（`000783456123` 的前导零不会被吃掉），清洗后调 `GET /packages/lookup`：唯一命中直接进详情，多个候选列出来让用户按采购单/承运商选，查不到给"单号有误 / 未绑定采购单 / 属于其他商家"的异常提示；条码磨损可手动输入或粘贴。`ScanGuard` 做两层防抖（查询未返回时挡并发、同一单号 3 秒内不重复请求），「重新扫码」可清窗口重扫。相机权限被拒时给出说明 +「去设置开启」+「我已开启，重新扫码」，H5 预览不会被当成扫码设备。

`pnpm --filter @caicang/mobile build:app` 产出 `dist/build/app`，HBuilderX 导入后运行到 Android 基座即可对准真实面单验收。扫码逻辑抽在 `services/scan.ts`（框架无关），`pnpm test:scan` 覆盖前导零、输入校验、请求拼装、候选分类、去重闸门与"不写库存"共 10 项；摄像头与授权弹窗只能真机确认。真机步骤见 [手机端说明](docs/MOBILE_APP.md)，结果与未验证项见 [任务 20 报告](docs/TASK_20_REPORT.md)。

## 任务 19：uni-app 手机应用基础功能

`apps/mobile` 现在是可登录、可切换商家、能装到 Android 上的 App：真实调用 `/auth/login`，access token 提前 30 秒自动刷新、refresh token 轮换、401 只重试一次、刷新失败清会话；首页四个大按钮（扫码入库 / 库存查询 / 扫码出库 / 入库记录）按角色权限置灰，底部导航为首页 / 入库记录 / 我的，入库记录已接 `GET /receipts`。请求统一走注入式客户端（`api/client.ts` 不依赖 uni API，`api/index.ts` 才接 `uni.request`），错误统一为 `ApiFailure(status, code, message, requestId)`，断网有顶部红条与 toast。开发 / 正式地址由 `.env.development`、`.env.production` 的 `VITE_API_BASE_URL` 决定，正式兜底域名故意不可解析。

`pnpm --filter @caicang/mobile build:app` 产出 `dist/build/app`，导入 HBuilderX 即可运行到 Android 基座；Android 权限已声明 INTERNET / ACCESS_NETWORK_STATE / CAMERA / VIBRATE。结构、tabBar 一致性、四入口与构建产物地址由 `pnpm test:mobile` 自动校验（本次真实 API 用例因本机 Docker 的 WSL 后端被策略拦截而跳过，需在能启动 Docker 的环境补跑）。设计与真机步骤见 [手机端说明](docs/MOBILE_APP.md)，结果见 [任务 19 报告](docs/TASK_19_REPORT.md)。

## 任务 18：验收入库安全专项测试

不新增页面，只验证任务 17 的入库事务。`scripts/receiving-safety.test.mjs` 在隔离 PostgreSQL 库与真实 API 进程上重放 12 个破坏性场景：首次入库、同一操作 ID 重发 10 次 + 并发重发、同 ID 换请求体、两名仓管同扫一箱、两箱同收一 SKU、两次合计超收、多商品某一行失败、已取消采购单、跨商家包裹、事务中途数据库报错、先收部分再收剩余、三次不同单价的加权平均。

每个场景结束都做账本对账：库存余额等于流水合计、收货明细与流水 1:1、同商品流水链条从 0 起无缺口（可证明没有丢失更新）、单行不超收、采购单状态与累计收货量自洽，并用 `GET /receipts` 的返回值逐单比对数据库。事务失败用数据库触发器在写入中途抛异常真实制造，验证全部回滚且不留下幂等记录。`pnpm test:receiving-safety` 15 通过 / 0 失败，全仓 `pnpm test` 492 通过 / 0 失败；未发现产品缺陷。细节与未覆盖边界见 [专项测试报告](docs/RECEIVING_TEST_REPORT.md)。

## 任务 17：核心验收入库事务

新增 `POST /api/v1/receipts`（首次 201，幂等重放 200）、`GET /api/v1/receipts`、`GET /api/v1/receipts/{id}`。一次确认在单个 PostgreSQL 事务内完成：校验商家与仓管权限、包裹/采购单/采购行归属、采购单可收货状态与包裹关闭状态，按整单剩余和本包裹计划剩余双重限制数量，然后写收货单与明细、按移动加权平均更新库存余额、写不可变流水、更新采购单与包裹状态、写审计；任一步失败全部回滚。

`clientOperationId` 幂等：同 ID 同请求返回原入库单且不重复加库存，同 ID 不同请求返回 409 `IDEMPOTENCY_CONFLICT`。仓库、成本、库存余额均由服务端从采购数据推导，客户端提交 `warehouseId`/`quantityOnHand`/`totalCost` 会被 400 拒绝。无新迁移、无新依赖。使用 Bearer + X-Tenant-Id 在 http://localhost:3000/api/docs 验证；`pnpm test:receipts` 连接真实 PostgreSQL 覆盖首次入库、重发 10 次、并发重试、超收、跨商家、角色、移动加权成本与全链路流水一致性。字段与锁序见 [入库说明](docs/RECEIPTS.md)，结果见 [任务 17 报告](docs/TASK_17_REPORT.md)。

## 任务 16：扫码查询与待收数量

`GET /api/v1/packages/lookup` 按运单号返回全部候选（含本包裹是否已收、已收数量），未知单号返回空数组，多候选不自动选择。新增 `GET /api/v1/packages/{id}/receivable`：返回逐 SKU 的采购数量、**整单**累计已收、采购剩余、本包裹预计与已收、本包裹剩余，以及本次最大可收（= min 全单剩余、本包裹剩余）；无预计明细时列出采购单剩余 SKU 供人工选择。新增 `POST /api/v1/packages/{id}/complete-receiving`：仅无预计明细的包裹可人工标记验收完成。

两个新端点限 OWNER/ADMIN/WAREHOUSE（`receiving:confirm`），只读可收明细不写库存、不写收货单；人工完成只改包裹关闭标记与状态，不增加库存。无新迁移、无新依赖。在 http://localhost:3000/api/docs 使用 Bearer 与 X-Tenant-Id 验证，`pnpm test:receivables` 连接真实 PostgreSQL 覆盖部分收货、跨包裹累计、无计划人工选择、权限与幂等。字段与口径见 [包裹说明](docs/PACKAGES.md)，结果见 [任务 16 报告](docs/TASK_16_REPORT.md)。

## 任务 15：快递包裹 Web 页面

已提供真实包裹列表（搜索运单号/采购单号/商品 SKU、物流状态、有无收货记录筛选、分页）、包裹详情弹窗（采购来源、运单、逐 SKU 采购/预计/已收数量、物流状态与收货进度）。数据来自新增的只读 `GET /api/v1/packages` 与既有 `GET /api/v1/packages/{id}`，无模拟数据；VIEWER 可浏览但服务端隐藏备注，扫码 lookup 仍限 OWNER/ADMIN/BUYER/WAREHOUSE。

在 PowerShell 运行 `cd D:\Dev\caicang-manager`、`pnpm db:up`、`pnpm prisma:migrate:deploy`、`pnpm start:api`，另开终端 `pnpm dev:web`，打开 http://localhost:5173/packages。无新迁移或依赖。`pnpm test:web-packages` 编译生产前端服务并连接真实 PostgreSQL/API 验证；操作与边界见 [包裹页面说明](docs/WEB_PACKAGES.md)，结果见 [任务 15 报告](docs/TASK_15_REPORT.md)。

## 任务 14：采购包裹 API

已提供采购单绑定多个包裹、修改未收货计划/运单/归属、包裹独立详情和按运单精确查询候选四接口。预计明细可空或多 SKU，跨包裹预计总量受采购数量和事务锁约束；运单保留前导零，同公司同号防重复，不同公司同号返回候选。已有收货锁定核心字段，物流到达不会生成收货或库存。

启动现有 Docker Desktop 后，在 PowerShell 运行 `cd D:\Dev\caicang-manager`、`pnpm db:up`、`pnpm prisma:migrate:deploy`、`pnpm start:api`；在 http://localhost:3000/api/docs 使用 Bearer 与 X-Tenant-Id 操作，无新迁移或依赖。`pnpm test:packages` 运行真实 PostgreSQL/双 API 进程测试。100 件拆三个包裹示例见 [包裹说明](docs/PACKAGES.md)，结果见 [任务 14 报告](docs/TASK_14_REPORT.md)。本任务不增加包裹 Web 页面或收货接口。

## 任务 13：采购管理 Web

已提供真实采购列表、新建多 SKU 采购单、详情、草稿编辑、确认下单、合法取消，以及状态/平台/单号筛选。表单实时以整数分预估，最终金额取服务器；确认冻结数量和原价。OWNER/ADMIN/BUYER 可维护，WAREHOUSE/VIEWER 只读。

先启动 Docker Desktop，再在 PowerShell 运行：

```powershell
cd D:\Dev\caicang-manager
pnpm install --frozen-lockfile
pnpm db:up
pnpm prisma:migrate:deploy
pnpm start:api
```

第二个终端运行 `cd D:\Dev\caicang-manager`、`pnpm dev:web`，打开 http://localhost:5173/purchases，登录并选择商家后即可录入平台采购记录。沿用现有数据库卷、迁移和环境文件。

`pnpm test:web-purchases` 运行真实 PostgreSQL/API 与生产采购表单/服务测试；`pnpm test:web` 执行 Web 集成测试；`pnpm test` 包含全项目构建和回归。操作及失败重试见 [采购页面说明](docs/WEB_PURCHASES.md)，实际结果见 [任务 13 报告](docs/TASK_13_REPORT.md)。

## 任务 12：采购订单 API

已实现采购草稿、编辑、下单确认、条件取消、详情与搜索分页。所有接口使用真实数据库、租户角色鉴权、Decimal 金额和事务审计；确认后冻结数量、原价、运费分摊与商品快照。10 个商品 × 18.50 元＋10 元运费，采购总成本为 `195.00` 元。

PowerShell 先 `pnpm db:up`、`pnpm prisma:migrate:deploy`，再 `pnpm start:api`，通过 http://localhost:3000/api/docs 使用采购接口。测试为 `pnpm test:purchases`，示例和状态规则见 [采购 API](docs/PURCHASE_ORDERS.md)，执行结果见 [任务 12 报告](docs/TASK_12_REPORT.md)。本任务仅实现 API，采购 Web 页面及包裹/入库/库存业务留待后续。

## 任务 11：商品与仓库管理页面

启动 API 和 Web 后打开 http://localhost:5173，可注册、创建商家，在“商品管理”搜索分页、添加/编辑、查看详情及启停商品，在“仓库管理”添加仓库、选择当前账号的默认业务仓库。全部资料通过真实 API 保存；写按钮遵守服务端角色权限。

默认业务仓库按账号与商家保存在当前浏览器，刷新恢复时重新验证仓库归属与启用状态，不跨设备同步。运行 `pnpm test:catalog` 检查商品/仓库生产客户端与真实数据库，`pnpm test:web` 覆盖全部 Web 服务层测试，`pnpm test` 完整回归。操作与边界见 [Web 商品仓库说明](docs/WEB_CATALOG.md)，本次结果见 [任务 11 报告](docs/TASK_11_REPORT.md)。

## 任务 10：Web 登录与管理后台

在项目根目录执行 `pnpm install --frozen-lockfile`、`pnpm db:up`、`pnpm prisma:migrate:deploy`，终端一运行 `pnpm start:api`，终端二运行 `pnpm dev:web`。打开 http://localhost:5173，注册账号后登录，选择/创建商家进入后台；创建商家自动建立默认仓库。

已接入真实注册、登录、/me、刷新与退出，提供商家选择、用户信息、加载/错误提示及路由权限。任务 11 新增仓库入口，现为十个导航；采购和出入库等后续页面明确待开放，无模拟业务数据。详见 [Web 使用说明](docs/WEB_AUTHENTICATION.md) 与 [任务 10 历史报告](docs/TASK_10_REPORT.md)。

## 当前工作区与环境

正式工作区为 `D:\Dev\caicang-manager`，原始资料包保留在 `D:\import and export\introduce\caicang-manager`。已建立 pnpm workspace、NestJS API、Vue3 管理后台与 uni-app；已有真实数据库、认证、商家/成员权限、商品/仓库/采购及包裹 API、Web 商品/仓库/采购/包裹页面，以及入库事务、账本、库存余额与流水查询接口和手机扫码查询。出库、盘点、统计页面与库存 Web/App 视图仍属后续任务，Android 真机验收待完成。

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
pnpm test:scan
pnpm test:mobile-receiving
pnpm --filter @caicang/mobile build:app
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/verify-db.ps1
```

`pnpm test` 启动自己的临时 API 进程，测试真实 PostgreSQL 查询、OpenAPI、CORS 和前端构建资源；要求 PostgreSQL 已启动，测试结束后停止临时 API。`pnpm test:scan` 只校验手机扫码逻辑与路由，不需要数据库；`pnpm test:mobile-receiving` 的纯逻辑用例同样不需要数据库，其中的真实验收用例在 PostgreSQL 不可用时显式跳过。`build:app` 只生成 uni-app 的 App 资源，不签名、不生成可安装 APK。实际执行记录和未解决事项见 [docs/TASK_01_REPORT.md](docs/TASK_01_REPORT.md)。

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
