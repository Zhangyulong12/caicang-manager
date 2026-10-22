# 任务 13：采购管理 Web 页面验收

2026-10-22（Asia/Shanghai），项目 `D:\Dev\caicang-manager`；基线 `f7372c1`，分支 `feat/task-13`。

## 交付

采购列表、新建多 SKU 采购单、详情、草稿编辑、确认下单、合法取消、状态/平台筛选、采购单号及平台订单号搜索、分页。全部接现有采购 API 和真实 PostgreSQL，不使用固定商品或模拟订单。

表单包含平台、平台订单号、店铺、采购日期、目标仓库、收货信息、多行商品的数量/单价/整行优惠、整单运费和备注。商品选择器查询真实启用商品；默认仓库沿用账号/商家的个人偏好；旧单编辑保留原始采购价。整数分预估准确汇总，保存/确认展示服务器结果和分摊。字段错误随修正更新，未保存离开提醒，保存时禁止重复点击；网络结果不确定保留稳定单号并提供查询入口。

路由、按钮、前端请求服务执行 purchase:read/write，服务端继续检查租户、角色、状态和关联记录。确认后的编辑/再次确认按钮禁用；取消需要提示并保留历史。VIEWER 展示服务端脱敏结果。工作空间/账号/会话变更后拒绝迟到响应，收货资料不写本地持久化存储。

## 修改文件

- `apps/admin-web/src/views/PurchasesView.vue`、`PurchaseFormView.vue`、`PurchaseDetailView.vue`：三个真实页面。
- `apps/admin-web/src/components/PurchaseProductPicker.vue`：真实商品搜索、分页、重复 SKU 禁用。
- `apps/admin-web/src/api/purchase-form.ts`、`purchases.ts` 和 `src/composables/purchases.ts`：表单、精确预估、白名单序列化与范围校验服务。
- `apps/admin-web/src/purchases.css`：电子账单表单、明细、成本区与窄屏布局。
- Web `src/router/index.ts`、`router/policy.ts`、`layouts/MainLayout.vue`、`main.ts`、`views/HomeView.vue`：路由权限、安全跳转、导航、样式入口与首页说明。
- `scripts/web-purchases.test.mjs`、`scripts/web-session.test.mjs`、根 `package.json`：采购集成与路由用例、统一测试命令。
- `eslint.config.mjs`：为 Vue 页面声明 beforeunload 所需浏览器全局类型/对象，保留 lint 规则。
- `README.md`、`CHANGELOG.md`、`docs/WEB_PURCHASES.md`、`ARCHITECTURE.md`、`CODEX_TASKS.md`、`DECISIONS.md`、本报告：启动、使用、范围与 ADR-020。

无新依赖、锁文件变化、后端业务变更或迁移；原 `AGENTS.md`、参考 `database/schema.sql` 和已有文档内容保留。

## 实际自动化验证

| 命令 | 实际结果 |
| --- | --- |
| `node --test scripts/web-purchases.test.mjs` | 17 项通过，0 失败/取消/跳过 |
| `pnpm test` | 390 项通过，0 失败/取消/跳过；API、Web、uni-app H5、共享包实际构建成功 |
| 最新 `pnpm test:web` | 66 项通过，0 失败/取消/跳过，包含最新页面构建及生产路由权限用例 |
| `pnpm typecheck` | API、Web、uni-app、共享包全部通过 |
| `pnpm lint` | 通过，0 警告 |
| `pnpm format:check` | 通过 |
| 最新 Web 单独构建 | `vue-tsc --noEmit` 和 Vite 生产构建通过 |

390 = 原 373 + 采购前端 17。新增测试编译生产表单/服务/HTTP 客户端，真实启动 Nest API，并在随机隔离 PostgreSQL 库执行六个迁移；覆盖双 SKU 精确金额、大金额精度、非法输入/日期/优惠/重复行、序列化白名单、真实保存/SQL 核对、重复重试、草稿价格与明细 ID 保留、分页/组合筛选、确认分摊/冻结、合法取消/非法转换、买家写入/仓库和只读角色拒绝、外租户资源、迟到响应、读取失败重试和并发同号去重。已有 Web 会话用例补充采购路由权限与安全跳转。

首轮 lint 发现 Vue 浏览器全局未声明，补充后通过；首轮 SQL 测试错误地查询不存在的订单总成本列，改为按真实明细和运费计算后 17 项全部通过；一次格式检查失败修正后复核通过。未将失败运行算作成功。

日志位于忽略的 `test-results/task-13-full-tests.log`、`task-13-web-tests.log`、`task-13-purchases-tests.log`、`task-13-typecheck.log`、`task-13-web-build.log`。Web 66 为全仓 390 的子集，不累加。不把浏览器人工操作计入自动化测试数；没有 APK 或 Android 真机验收。

## 真实浏览器与数据库验收

验收时主 Web 在 5173，最新 API 在 3000，health 返回 `status=ok`、`database=reachable`。原有 3001 服务未变动。为保留 5173 原账号会话，浏览器验收在同源码独立端口 5174 创建本地测试账号与商家“任务13 · 采购页面验收”，通过现有 Web 页面创建两个商品。

采购单 `PO-WEB-T13-20261022`，ID `1f0b7b40-4e5a-4a75-8b63-d00dac2af184`，商家 ID `e9bf0385-d040-44a4-93ac-06b348d8c048`，仓库为该商家的 DEFAULT。通过新页面实际录入、保存、修改备注并再次保存、确认下单，刷新后数据仍存在，状态 PLACED。

| SKU | 数量 | 原单价 | 行优惠 | 运费分摊 | 单位到仓成本 |
| --- | --- | --- | --- | --- | --- |
| CHARGER-20W / 20W 充电器 | 10 | 18.50 | 0.00 | 8.22 | 19.3220 |
| CABLE-USB-C / USB-C 数据线 | 5 | 9.00 | 5.00 | 1.78 | 8.3560 |

商品原额 **230.00**，优惠 **5.00**，运费 **10.00**，服务器总成本 **235.00**。SQL 实际 JOIN purchase_orders 与 purchase_order_items，核对主单/租户/仓库、两条明细、数量/价格/优惠、快照/分摊与四位成本；总成本按明细及运费精确复算为 235.00。数据库当前没有持久化采购主单总成本列，页面金额由服务器根据真实明细计算。

另通过浏览器创建 `PO-WEB-T13-CANCEL`（ID `8ea07884-7e8a-42c8-8824-a7c53c3999dc`）并合法取消，数据库为 CANCELLED，原一条明细保留。上述两单审计为创建 2、修改 1、确认 1、取消 1。

还实际验证：空表单必填错误、填写后对应字段错误消失、重复 SKU 按钮禁用、未保存离开选择继续/放弃、平台单号搜索、草稿/已下单筛选、京东筛选排除淘宝单、确认后编辑与下单按钮禁用、取消后的操作禁用、刷新持久化。返回 5173 的原商家列表为 0 单，不能看到独立验收商家的两单。

证据为忽略的 `test-results/task-13-purchase-detail.png`、`task-13-purchase-list.png`、`task-13-database-verification.json`；测试密码与 Token 不写报告或仓库。验收账号已正常退出，浏览器恢复 5173 原工作空间采购入口。

## 数据保留与限制

原有业务行内容、环境文件摘要和六个迁移校验和保持一致；首次打开原会话时发生正常刷新，原 refresh_tokens 的使用/更新时间元数据有变化，不声称所有认证行完全未变。新增的本地验收账号、商家、默认仓库、两个商品、两张采购单和明细保留；没有删除用户数据或清空数据卷。

代码无未解决的测试失败。界面只能根据状态/已收数量提示取消能力，空收货记录或关联包裹等隐藏条件仍由服务器最终判定；并发变更失败时提示刷新。默认仓库偏好仅本浏览器保存。包裹、收货、库存及出库仍待后续任务；移动端本次只验证已有 H5 构建，不涉及 APK。

用户稍后继续任务时（同日约 16:06）再次检查，原开发服务及 Docker 已停止。启动已有 Docker Desktop 后，后端日志报 Secrets Engine 的 `engine.sock` 重命名为 `.stale` 时“文件无法访问”，Docker Engine 未就绪，5432 连接拒绝；这属于当前运行阻塞。因此没有声称这一轮末尾数据库复核成功，也没有重新运行依赖数据库的测试。上述 390/66 项测试、浏览器订单与 SQL 核验均在此前服务正常时实际完成。没有删除 socket、用户数据、数据库卷或重装软件。Web 5173 已重新启动；需先通过 Docker Desktop 正常退出/重新启动（若仍有文件占用可重启 Windows）恢复 Engine，再按 WEB_PURCHASES.md 运行 `pnpm db:up`、`pnpm start:api`。启动恢复后的数据复核仍应再执行。

启动及测试命令见 WEB_PURCHASES.md。本次为本地任务提交，未推送 GitHub。
