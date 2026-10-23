# 更新记录

## 2026-10-23 — 用户任务 23：Web 库存管理页面

- 管理后台新增 7 个只读库存页面：库存总览 `/inventory`、商品库存列表 `/inventory/balances`、SKU 库存详情 `/inventory/sku/:productId`、库存变动流水 `/inventory/movements`、入库记录列表 `/receipts`、入库记录详情 `/receipts/:id`、待入库采购商品 `/inventory/pending`；导航「库存管理」「入库记录」去掉待开放标记，按 `products:read` / `packages:read` 判定访问。
- 库存列表按需求给出 8 列（商品名称、SKU、仓库、当前数量、平均成本、库存总成本、待入库数量、最近入库时间），支持搜索 / 仓库 / 日期区间 / 分页 10–100；数量为 0 灰色、待入库大于 0 琥珀色，行可进 SKU 详情。
- 后端补齐页面需要但原来没有的只读能力：`balances.lastReceivedAt`（`last_receipt` CTE 取最近一次入库时间，与 `updatedAt` 语义区分）、`GET /inventory/summary`（现存件数 / 覆盖商品数与仓库数 / 账面总成本 / 均价 / 待入库 / `generatedAt`，由数据库聚合，分页列表算不出全量合计）、`GET /inventory/pending`（采购行粒度：单号、平台、采购日期、仓库、订购 / 已入库 / 待入库 / 单价 / 待入库金额，只列 `PLACED`/`PARTIAL_RECEIVED` 且剩余 > 0 的行）、`movements.sourceDocumentId`（`sourceId` 是来源行 ID，直接查入库单会 404）。入库单列表增加 `from`/`to` 按收货时间筛选，反向区间 422。
- `/inventory/*` 仍然只有 GET：新增的 summary / pending 也纳入"四写方法 404 + OpenAPI 只有 get + 调用前后余额不变"的检查。页面客户端（`api/inventory.ts`、`api/receipts.ts`）只发 GET，模板里不出现 `stock_balances` / `stock_movements`，也没有内联数组、随机数或 mock/demo 数据 —— 这些都用测试正则守着。
- 新增 `scripts/web-inventory.test.mjs` 与 `pnpm test:web-inventory`（纳入 `test` 与 `test:web`）：把页面真正使用的客户端模块编译出来，配一次性 PostgreSQL 与真实 API 跑一遍页面会发出的请求，**12 通过 / 0 失败 / 0 跳过**；`scripts/inventory.test.mjs` 同步扩到 **13 通过**，全仓 `pnpm test` **553 通过 / 0 失败 / 0 跳过**（6 分 03 秒）。
- 验收（测试内复现）：`POST /receipts` 入库 20 件 → 库存列表显示 20 件、账面 930.0000、均价 46.5000、`lastReceivedAt` 等于入库单 `receivedAt` → 总览、流水（`0 → 20`）、入库记录、SKU 详情读到同一笔数据；VIEWER 可读但入库单备注被隐藏；跨商家 balances / summary / pending 全空。
- 无新依赖、无新表、无迁移。页面没有浏览器端 E2E（无 Playwright），交互靠人工验收；日期筛选按 UTC 边界，北京时区 08:00 前查"今天"会少几小时数据，需商家时区配置才能彻底解决。详见 `docs/WEB_INVENTORY.md`、`docs/TASK_23_REPORT.md`。

## 2026-10-23 — 用户任务 22：库存查询系统

- 新增 `GET /api/v1/inventory/balances`：按商家隔离，每行返回现存数量（读 `stock_balances`）、采购待入库数量（`PLACED`/`PARTIAL_RECEIVED` 采购行减去已入库量，按商品+仓库聚合）、移动加权平均成本（账面总成本 ÷ 现存数量，四位小数）、库存账面总成本；只有待入库、一件未到的商品也会出现在列表（`quantityOnHand = 0`），待入库用 `GREATEST(... , 0)` 夹到非负，部分收货不会重复计算。
- 新增 `GET /api/v1/inventory/movements`：读不可变的 `stock_movements`，按时间倒序分页，每笔含发生时间、类型（`RECEIPT`/`OUTBOUND`/`ADJUSTMENT`）与方向、数量变动、操作前后库存与成本、单位成本、来源单据号（入库单号/出库单号）、来源行 ID、备注（入库备注/出库备注/盘点原因）、操作人。
- 筛选与分页：`warehouseId`、`productId`、`sku`、`barcode`（精确，保留前导零）、`search`（SKU/名称/条码字面子串，`%`/`_` 已转义）；余额按 `updatedFrom`/`updatedTo`，流水按 `from`/`to` 与 `type`；只写日期时上界补到当天 23:59:59.999Z，反向区间返回 422 并带 `details.field`。金额统一走 `Prisma.Decimal`（precision 60、HALF_UP）以四位小数字符串返回。
- **库存仍是只读模块**：`/inventory/*` 只有 GET，没有 POST/PUT/PATCH/DELETE；数量只能由收货等业务事务经"写流水 + 改余额"改变。测试断言四个写方法全部 404、OpenAPI 中这两个 path 只有 `get`，且调用前后 `stock_balances.quantity_on_hand` 不变。
- 新增 `scripts/inventory.test.mjs` 与 `pnpm test:inventory`，在一次性 PostgreSQL 库 + 真实 API 进程上执行，**10 通过 / 0 失败 / 0 跳过**：入库 20 件 → 显示 20 件（总成本 370.0000、均价 18.5000、条码前导零保留）→ 出库 8 件 → 显示 12 件（222.0000），流水链 0→20→12 首尾相接、数量合计等于当前余额；另覆盖待入库 6/4、六种筛选与分页、跨商家隔离（另一商家按 SKU、按别人 productId 查都为空）、只读角色可读、时间/类型筛选与反向区间 422。
- 契约新增 `STOCK_MOVEMENT_TYPES`、`InventoryBalanceData`、`InventoryMovementData` 等类型；无新依赖、无新表、无迁移。
- 详见 `docs/TASK_22_REPORT.md`（含数据口径、接口契约与"为什么没有写接口"）。

## 2026-10-23 — 用户任务 21：手机扫码验收入库全流程

- 新增收货页 `pages/receiving/index`：展示采购单/采购状态、承运商与完整运单号、每个 SKU 的名称与编码，以及订购、已入库、剩余（有包裹计划时另示本包裹待收）；每行输入本次实际到货数量，支持一个包裹多 SKU、部分收货（留空即未到）与 2000 字收货备注。
- 提交前 `uni.showModal` 二次确认，列出「商品 × 数量」、总件数与备注；确认后调用任务 17 的真实事务 `POST /receipts`，成功页展示入库单号、本次入库件数、逐商品数量与时间，并可「继续扫下一包裹」或查看入库记录。
- 新增 `services/receiving.ts`：数量只收非负整数；草稿按行 ID 稳定排序；内容指纹与服务端 `requestHash` 同口径（小写 ID、排序、备注 trim）；`ReceiptSubmitting` 先把待提交记录落盘再发请求，**同内容重试复用原 UUID**（含 App 重启），**改数量/备注换新 UUID**，被 4xx 拒绝则丢弃操作号。
- 断网提交显示「未提交」并说明 App 不会提前增加库存，页面不做任何数量乐观更新；网络恢复后「重试本次提交」走同一幂等路径，若上次已写入则返回原入库单并标注"未重复加库存"。
- 错误文案分级：超收（带本包裹/整单剩余可收量）、包裹已验收完成、采购单状态不允许（如已取消）、无收货权限、操作号冲突、网络中断，均说明"本次是否入库"。
- 新增 `services/operation-log.ts`：本机环形缓冲保留最近 50 条提交/成功/失败记录，收货页底部展示最近 5 条。
- 包裹详情页新增「确认收货」入口（有 `receiving:confirm` 且未收完时显示），从收货页返回会刷新详情；`ApiFailure` 增加 `details`，用于展示超收剩余量等结构化原因。
- 新增 `scripts/mobile-receiving.test.mjs` 与 `pnpm test:mobile-receiving`：10 通过 / 1 跳过。跳过项是真实 PostgreSQL 验收（收 5 件→库存 5，响应丢失重试仍为 5，改数量后为 7，再收 5 件被 409 拒绝且库存仍为 7），本机 Docker 被系统策略拦截无法执行，未用 mock 冒充。
- 详见 `docs/MOBILE_APP.md`（新增「十、扫码验收入库」）、`docs/TASK_21_REPORT.md`（含 Android 真机测试与库存核对 SQL）。

## 2026-10-23 — 用户任务 20：Android 手机扫一扫

- 新增扫码页 `pages/scan/index`：官方 `uni.scanCode`，`scanType: ['barCode','qrCode']`，`onlyFromCamera: true`，320rpx 大按钮，适配仓库单手操作。
- 新增框架无关的 `services/scan.ts`：`normalizeTrackingNo` 只 trim、限长 128、拒绝控制字符，**前导零原样保留**（绝不做数字转换）；`lookupPackages` 走 `GET /packages/lookup?trackingNo=` 并对码值 `encodeURIComponent`；`classifyLookup` 区分单候选/多候选/无结果；`ScanGuard` 两层防抖（查询未返回挡并发 + 同码 3 秒窗口）。
- 命中唯一包裹进新增的 `pages/package/index` 详情页（采购单、承运商、物流/收货状态、预计明细、该包裹入库单，全部只读）；多候选列采购单号与承运商让用户手选，不自动取第一条；未知单号给"单号有误 / 未绑定采购单 / 属于其他商家"提示与补录建议。
- 支持手动输入运单号与剪贴板粘贴，条码磨损时可用；「重新扫码」清空去重窗口后可立刻重扫同一个箱子。
- 相机权限被拒时显示说明面板：`openAppAuthorizeSetting` 跳系统设置 + 「我已开启，重新扫码」；`uni.scanCode` fail 回调按 `auth|permission|denied|权限` 关键字兜底。H5 预览不伪装扫码，直接提示需在 App 中使用。
- 首页「扫码入库」入口改为跳转扫码页；扫码页额外校验 `packages:lookup` 权限。
- **扫码路径不写库存**：页面与服务无任何 POST/PATCH/DELETE，详情页无验收按钮，并有静态断言守住这条线。
- 新增 `scripts/scan.test.mjs` 与 `pnpm test:scan`：10/10 通过（前导零、输入校验、请求拼装、候选分类、防抖窗口、路由与授权 API、"不写库存"静态校验），已纳入全仓 `test`；`scripts/mobile.test.mjs` 页面清单同步更新为 7 个页面。摄像头与授权弹窗需真机验收，真实 lookup 端到端因本机 Docker 的 WSL 后端被策略拦截未复跑。
- 详见 `docs/MOBILE_APP.md`（新增「九、扫码查包裹」）、`docs/TASK_20_REPORT.md`（含 HBuilderX 真机调试步骤）。

## 2026-10-23 — 用户任务 19：uni-app 手机应用基础功能

- 新增登录页：真实 `POST /auth/login`，大号输入框与按钮，错误内联展示 + toast，支持回车提交；启动时若已有有效会话自动进首页。
- 新增框架无关的会话客户端 `api/client.ts`：access token 提前 30 秒刷新、refresh token 轮换、401 只重试一次、刷新失败清空本地会话；`api/index.ts` 用 `uni.request` 与 uni storage 注入，逻辑可在 Node 中直接测试。
- 新增会话状态模块：用户、商家列表、当前商家、按权限判断入口，并把商家与当前商家做本地快照，断网启动仍可进首页。
- 首页重写为四个大入口（扫码入库 / 库存查询 / 扫码出库 / 入库记录），无权限置灰；底部导航为首页 / 入库记录 / 我的。
- 新增入库记录页，接 `GET /receipts`，支持分页、下拉刷新、空态与错误重试。
- 新增切换商家页与我的账户页：显示角色、服务环境与地址、版本，退出登录先调 `/auth/logout` 吊销再清本地。
- 新增断网提示：`onLaunch` 监听网络状态，顶部红条与断开/恢复 toast。
- 新增开发 / 正式地址配置（`.env.development`、`.env.production`），正式兜底域名故意不可解析；Android 清单补 INTERNET / ACCESS_NETWORK_STATE / CAMERA / VIBRATE 与明文调试开关。
- 新增 `scripts/mobile.test.mjs` 与 `pnpm test:mobile`：校验页面与 tabBar 一致、四入口、适配层使用 `uni.request`、构建产物使用正式地址，并覆盖真实 API 的登录、刷新、重试、切换商家、退出与错误文案。本次真实 API 用例因本机 Docker 的 WSL 后端被安全策略拦截而跳过，其余 3 项通过。
- 详见 `docs/MOBILE_APP.md`、`docs/TASK_19_REPORT.md`。

## 2026-10-22 — 用户任务 18：验收入库安全专项测试

- 新增 `scripts/receiving-safety.test.mjs`：在隔离 PostgreSQL 库 + 真实 API 进程上重放 12 个破坏性场景（首次入库、同 ID 重发、同 ID 换请求体、两人同扫一箱、两箱同收一 SKU、合计超收、多行其中一行失败、采购单已取消、跨商家包裹、事务中途失败、先部分后剩余、多次入库加权平均），共 13 个子测试。
- 每个场景结束执行账本对账：余额 = 流水合计、收货明细 ↔ 流水 1:1、同商品流水链条 0 起无缺口、单行不超收、采购单状态与累计收货量自洽；同时用 `GET /receipts` 返回值逐单比对数据库。
- 事务失败用数据库触发器在写入中途抛异常真实制造，验证收货单/明细/余额/流水/采购单/包裹状态/审计全部回滚，且失败不留下幂等记录、同一操作 ID 可立即重试。
- 新增 `pnpm test:receiving-safety`，并纳入全仓 `test`；专项 15 通过（13 场景 + 包裹层），全仓 492 通过 / 0 失败。
- 唯一一次失败为测试夹具违反包裹计划约束（两箱预计合计超过采购数量，接口按设计返回 `PACKAGE_EXPECTED_QTY_EXCEEDED`），已修正夹具，非产品缺陷。
- 详见 `docs/RECEIVING_TEST_REPORT.md`。

## 2026-10-22 — 用户任务 17：核心验收入库事务

- 新增 `POST /receipts`：单事务完成归属/状态/数量校验、收货单与明细、库存余额与移动加权平均成本、不可变库存流水、采购单与包裹状态、审计；任一步失败全部回滚。
- `clientOperationId` + `request_hash` 幂等：同 ID 同请求返回 200 原入库结果且不重复加库存，同 ID 不同请求返回 409 `IDEMPOTENCY_CONFLICT`；并发重试由唯一键兜底。
- 锁序统一为商家 → 采购单 → 包裹 → 库存余额（按商品排序）；余额行先 `ON CONFLICT DO NOTHING` 再 `FOR UPDATE`，消除首次入库插入竞争。
- 数量同时受整单剩余与包裹计划剩余限制，超收返回 409 `RECEIPT_QTY_EXCEEDED` 并给出实际可收量；采购单非可收货状态或包裹已关闭返回 409。
- 新增 `GET /receipts` 分页列表与 `GET /receipts/{id}` 详情，支持包裹/采购单/单号运单搜索，VIEWER 隐藏备注。
- 客户端无法提交仓库、单位成本或库存余额：白名单之外的字段直接 400，库存与成本只由服务端计算。
- 新增真实 PostgreSQL 专项测试（22 项），覆盖首次 6 件入库、同一请求重发 10 次库存不变、并发重试、幂等冲突、超收与多行失败回滚、跨商家 404、角色 403、并发抢量、移动加权成本与流水/余额一致性。

## 2026-10-22 — 用户任务 16：扫码查询与待收数量计算

- 新增 `GET /packages/{id}/receivable`：按整张采购单聚合 `receipt_items` 计算累计已收与采购剩余，再与本包裹预计明细求交，返回本次最大可收；无预计明细时返回采购单剩余 SKU 供人工选择，超收数据向下夹到 0。
- 新增 `POST /packages/{id}/complete-receiving`：仅无预计明细的包裹可人工标记验收完成，写关闭标记与 `RECEIVED` 状态并原子审计；重复调用幂等，不创建收货单、不写库存。
- `GET /packages/lookup` 候选补充 `hasReceipts`/`receivedQuantity`，未知单号仍返回空数组、多候选不自动选择。
- `receivingStatus` 改为关闭标记优先，零收货的显式关闭也算验收完成；两个新端点限 OWNER/ADMIN/WAREHOUSE（`receiving:confirm`）。
- 新增真实 PostgreSQL 专项测试（17 项）：部分收货口径「购买 10、已入库 4、还可入库 6」、跨包裹累计、无计划回退、跨商家 404、角色 403、并发关闭只留一条审计，并验证全程不产生库存行或收货单。

## 2026-10-22 — 用户任务 15：快递包裹 Web 页面

- 新增只读分页接口 `GET /packages`，支持运单号/采购单号/本包裹 SKU 字面搜索、采购单、快递公司、物流状态与有无收货记录筛选。
- 新增 `/packages` 管理页面：真实列表、筛选、分页、详情弹窗（采购来源、预计与已收数量、状态与收货进度），复用统一认证、商家上下文、权限与错误提示。
- 预计明细改为按采购行号稳定排序，列表/详情输出可复现；未新增迁移、依赖或库存写入。
- 增加生产前端服务 + 真实 PostgreSQL/双进程 API 的专项测试（16 项），覆盖筛选、分页、角色、租户隔离、迟到响应与 OpenAPI。

## 2026-10-22 — 用户任务 14：采购单绑定快递包裹

- 新增包裹绑定、PATCH、独立详情与运单候选四接口，沿用 Guard、TenantContext、统一响应和 Swagger。
- 允许空计划、多 SKU、同商品分包；按商家/采购主单/包裹顺序锁定并校验累计预计量，支持未收货改绑及计划替换、原子审计。
- 运单保留前导零，公司编码标准化；同公司重码冲突，不同公司同号返回数组；新增包裹读/写/查询权限。
- 有任意收货记录锁定核心字段，物流状态与实际收货分开展示；无库存操作、依赖或迁移。增加真实并发、回滚、状态和隔离测试。

## 2026-10-22 — 用户任务 13：采购管理 Web 页面

- 接入真实采购列表、详情、草稿创建/编辑、确认及合法取消；支持状态/平台/单号筛选和分页。
- 多 SKU 电子账单表单，真实商品/仓库选择、个人默认仓库、整数分预估与服务器成本对照。
- 增加写权限/状态限制、字段校验、失败重试、稳定单号及范围切换保护；未保存离开提醒，收货信息不存本地持久化。
- 新增生产前端与真实 PostgreSQL/API 集成测试，以及浏览器双 SKU 创建、编辑、确认、筛选、取消和数据库验收。

## 2026-10-22 — 用户任务 12：采购订单业务

- 新增真实采购列表/草稿/详情/编辑/确认/取消六接口，集中角色及商家隔离、行锁、状态检查与事务审计。
- Decimal 计算原价/优惠/总成本、按净额或件数分摊运费并保留尾差；确认冻结价格/数量/商品快照，VIEWER 隐藏收货资料。
- 增量迁移添加采购日期、明细顺序、商品快照和分摊额，保留旧记录，不修改原迁移或参考 SQL。
- 增加金额、旧库升级、非法输入、跨租户/角色、两个 API 实例并发和审计回滚测试；不实现采购 Web 页面或收货库存操作。

## 2026-10-21 — 用户任务 11：Web 商品与仓库管理

- 商品真实列表、搜索/状态筛选/分页、创建/编辑/详情/启停，共用表单校验与精确金额字符串。
- 仓库真实列表/创建、按账号与商家隔离的本浏览器默认业务仓库偏好，选择和恢复均查询服务端验证。
- 增加角色禁用按钮、错误重试、重复编码字段提示和切换商家迟到响应保护；无新依赖、接口或数据库迁移。
- 新增生产客户端与真实 PostgreSQL 集成测试，实际浏览器注册到商品建档验收；启动、使用和测试记录见任务报告。

## 2026-10-21 — 用户任务 10：Web 登录与主布局

- 接入真实注册/登录/me/刷新/退出，新增 Pinia 状态与 Web Locks 多标签轮换协调。
- 新增商家选择/创建、仓储 SaaS 主布局、九个导航、顶部用户信息、加载/错误提示和路由权限。
- 新 GET /tenants 只发现本人有效成员商家；首页读取真实商品/仓库数量，未来业务页面明确待开放。
- 增加真实 PostgreSQL/HTTP 的生产客户端测试及浏览器注册/登录/切换/退出验收；无新业务迁移或库存操作。

## 2026-10-20 — 用户任务 09：仓库管理 API

- 新增租户隔离的仓库分页列表、OWNER/ADMIN 创建接口及原子审计，五角色权限集中定义。
- 仓库新增 nullable 备注及长度约束，保留默认仓库、原数据及旧迁移；同商家编码唯一、不同商家可同码。
- 增加真实隔离数据库、两个 API 进程的并发/权限/回滚/历史仓库关系测试；不开放删除、调拨或库存修改。

## 2026-10-17 — 用户任务 08：商品管理 API

- 新增真实商品列表/创建/详情/修改/按码查询，支持搜索分页筛选、可空条码、租户内唯一编码及五角色读写边界。
- 增量迁移新增 nullable 参考进货价/备注、金额/备注 CHECK 与筛选索引；金额使用 Decimal 与字符串，商品停用和修改不写历史采购价格或库存。
- 增加商品变更原子审计、并发/隔离/历史价格保护及 Swagger 集成测试，保留旧迁移、参考 SQL、开发数据和本地密钥。

## 2026-10-17 — 用户任务 07：多商家与角色权限

- 新增商家创建/当前商家、成员列表/添加/修改五个真实接口；自动建立 OWNER 与默认仓库，支持账号跨商家不同角色。
- 加入默认拒绝的 TenantGuard/RolesGuard、角色/权限装饰器与服务端 TenantContext；租户根行锁及事务内复查解决成员授权竞态，审计失败整体回滚。
- 集中区分 BUYER/WAREHOUSE 能力，保护 OWNER 与 ADMIN 边界，补充 Swagger、隔离/越权/并发/审计真实数据库测试；不新增迁移或未来业务路由。

## 2026-10-17 — 用户任务 06：Token 刷新与安全退出

- 新增 refresh/logout，登录同时签发 256 位随机 Refresh Token，数据库只保存 SHA-256 哈希。
- 新增追踪会话/凭据迁移；会话行锁保障跨 API 实例的轮换、重复刷新撤销及退出事务安全，Access JWT sid 支持服务端撤销。
- 保留生产签名密钥强制校验；补充刷新寿命校验、敏感限流、禁止缓存、Swagger/API 契约与真实数据库测试。

## 2026-10-15 — 用户任务 05：注册与登录

- 新增真实邮箱注册、bcrypt 密码验证、短期 JWT 登录和受保护 /me，默认身份守卫及共享 PrismaModule。
- 增加规范化邮箱表达式唯一索引，防止大小写/空格和并发重复；保留已有邮箱原文与用户数据。
- 增加开发签名密钥安全初始化与生产校验、Swagger 示例及真实 PostgreSQL 认证/输入/并发/Token 测试；不提前实现商家权限或 refresh/logout。

## 2026-10-15 — 用户任务 04：后端公共基础模块

- 集中 bootstrap 与全局 CommonModule，统一 DTO、成功/分页响应、错误码、异常和请求追踪；健康路由改为只返回真实数据库检查数据。
- 新增配置校验、精确 CORS、Nest 12 原生安全头、元数据日志白名单与默认/敏感接口限流组件；生产禁用公共 Swagger。
- 补充共享 JSON 契约、OpenAPI 公共规范、独立 HTTP 测试夹具与配置/日志/并发限流测试，不增加业务路由或数据库迁移。

## 2026-10-15 — 用户任务 03：完整数据库模型

- 建立 17 个 Prisma 模型与第一版追踪迁移，采用 UUID、NUMERIC、复合外键和唯一索引，保留参考 SQL。
- 将包裹/收货同订单、同商品、同仓库约束写入数据库；补齐全部表时间字段与 SQL 更新时间触发器。
- 增加本地幂等 seed：两商家、六用户、七成员关系、四仓库、六商品，重复与并发运行保留已有数据。
- 增加独立空库迁移/seed/约束测试与 Windows 操作说明，记录 ADR-010；未开发登录或库存业务接口。

## 2026-10-14～2026-10-15 — 用户任务 02：本地数据库环境

- 保留 PostgreSQL 16.15 命名卷和 Prisma 7.10.0，提供迁移命令入口与 provider 锁文件，不创建业务模型或应用初始 SQL。
- 补充 PowerShell 数据库停止、密码认证检查、API 启动与健康检查脚本，首次 .env 创建采用不覆盖模式。
- 增加真实数据库停启与健康接口恢复测试，共用临时 API 测试启动器；修复 PowerShell SQL 参数传递和测试子进程阻塞问题。
- 追加 Windows 启动说明、任务范围覆盖记录、ADR-009 与任务验收报告。

## 2026-10-14 — 任务 01 清单复核与补齐

- 补充 infra/compose.dev.yml 与说明，引用已有开发数据库定义；验证两套入口解析后的配置相同，并保持同一个持久化数据卷。
- README 保留原内容并追加 infra 与统一启动命令；现有 docs、AGENTS.md、database/schema.sql 保持不变。
- 浏览器验收发现管理端缺少 Element Plus 基础样式，补齐 theme-chalk/base.css；欢迎页和真实连接检查完成复核。
- 重新执行锁文件安装、lint、类型检查、三端构建与已有自动化测试，实际结果见 infra/README.md。

## 2026-10-14 — 环境复查与任务 01

- 确认 Windows 25H2、WSL2、Docker Server 和 hello-world 正常，核实 Docker 数据 VHDX 位于 D 盘。
- 建立精确版本的 pnpm workspace、ESLint/Prettier/TypeScript strict 配置、共享 JSON 契约和纯 TS 工具包。
- 建立 NestJS ESM + Prisma 7 adapter-pg 健康接口与 Swagger，查询真实 PostgreSQL。
- 建立 Vue3/Element Plus 欢迎页和 DCloud uni-app CLI 首页，提供真实服务连接检查。
- 增加 Windows 开发、数据库启动和只读验证脚本；Compose 固定 PostgreSQL 镜像 digest，保留命名卷数据。
- 补充阶段验收脚本和文档。业务数据库模型、登录、多租户和库存功能留待后续任务；Android 工具安装与真机 APK 按用户指令暂缓。

## 2026-10-14 — 任务 00：Windows 开发环境

- 将设计资料复制到 `D:\Dev\caicang-manager`，保留原件，初始化 main 分支。
- 增加 `.gitignore`，验证环境私密配置、依赖、构建缓存和 Android 签名文件被忽略。
- 使用现有 Corepack 提供普通终端可执行的 pnpm 11.25.0，保留现有 Node 和工具安装。
- 增加 `docs/ENV_CHECK.md`，更新 README 和 ADR-007，记录工具实测、缺失项和官方安装步骤。
- Windows 22H2、WSL2 内核、Docker 和 HBuilderX 尚需处理；没有开发业务功能、迁移数据库或验证 APK。
