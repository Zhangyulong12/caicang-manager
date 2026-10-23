# 任务 27 报告 — 采购账号管理与采购单关联

## 一、结论

采购账号成为独立档案，采购单可以引用它，列表能按账号对账。验收路径在真实 PostgreSQL + 真实 API 上跑通：

**建「淘宝主账号」（TAOBAO）与「京东采购号」（JD）→ 各建一笔采购单（淘宝单 2 个 SKU：10 × 18.50 + 2 × 8.25，优惠 6.00，运费 10.00）→ 保存后重新打开，金额 205.50 与逐行单价、优惠、运费、平台订单号都还在 → 按淘宝账号筛出 1 笔、按京东账号筛出 0 笔 → 确认下单后改名账号，单据仍显示旧别名快照**。

## 二、要求对照

| # | 要求 | 实现 | 对应测试 |
|---|---|---|---|
| 1 | 支持淘宝、京东、拼多多及其他平台 | 平台取 `PURCHASE_PLATFORMS = TAOBAO/JD/PDD/OTHER`，DTO `@IsIn` + 数据库 CHECK 双重约束 | `create two accounts…`（TAOBAO、JD）、`BAD` 平台 400 |
| 2 | 账号别名、平台、备注、启用/停用 | `purchase_accounts` 四列 + `is_active`；别名同平台唯一，服务端 trim 并拒绝控制字符 | 重复创建 409、空白别名 400、停用/启用往返 |
| 3 | 采购单可选择采购账号，并保留原有平台订单号、商品明细、实际采购单价、优惠、运费 | 采购单新增可空 `purchaseAccountId`；表单下拉按平台过滤；原有字段与成本分摊逻辑一行未改 | `multi SKU actual costs…`：201.50 − 6.00 + 10.00 = 205.50，逐行单价 18.50 / 8.25 落库 |
| 4 | 采购列表可按采购账号筛选 | `GET /purchase-orders?purchaseAccountId=`；列表页账号下拉 + 采购日期区间，账号页「采购记录」直接带参跳转 | `account/platform/article/SKU/… filtering`（淘宝命中 1 笔、京东 0 笔） |
| 5 | 历史采购记录必须兼容，不得丢失或覆盖 | 迁移只增列且全部可空；老单据账号字段为 null，明细无快照时回落商品主数据 | `the account migration only adds…`、`pre-migration rows stay readable…`（200 天前的手插老单据仍可读、金额 50.50） |
| 6 | 不保存第三方平台登录密码；不允许删除仍有关联历史记录的账号 | 表里没有任何凭据列；请求体未知字段（含 `password`）被白名单拒绝为 400；`DELETE` 仅对无引用账号生效，有历史返回 409 且外键 `ON DELETE RESTRICT` 兜底 | 列名静态断言、`password` → 400、一次性账号删除成功、已下单账号删除 409 + 直接 SQL 删除 `23503` |
| 7 | 商家数据隔离与权限校验 | 所有查询带 `tenantId`，`(tenant_id, id)` 复合定位；跨商家 404；写限 `purchase:write` + OWNER/ADMIN/BUYER | 五个角色矩阵：WAREHOUSE/VIEWER 写 403；outsider 读 403、PATCH 404；跨商家账号引用 404、平台不符 422 |

补充的行为约束：

- **停用不等于删除**：停用后不能新建采购、不能确认下单（`409 PURCHASE_ACCOUNT_INACTIVE`），历史仍可查询；草稿保留原有的停用关联可以继续编辑，`place` 会再校验。
- **平台锁定**：账号一旦被采购单引用，改平台返回 `409 PURCHASE_ACCOUNT_PLATFORM_LOCKED`，避免历史记录换了归属。
- **别名快照**：草稿读实时别名，`place` 时写 `purchase_account_alias_snapshot`；之后改名不影响已下单单据。
- **审计**：创建/更新/删除都写 `audit_logs`（`PURCHASE_ACCOUNT_CREATED/UPDATED/DELETED`），更新带前后状态，删除带删除前快照。

## 三、新增与修改文件

新增：

- `apps/api/src/modules/purchase-accounts/`（DTO、控制器、服务、模块）
- `apps/api/prisma/migrations/20261023140000_purchase_accounts/migration.sql`（账号表与采购单账号列）
- `apps/api/prisma/migrations/20261023130000_product_attributes/migration.sql`（商品货号/颜色/尺码与采购明细快照；见下方说明）
- `apps/admin-web/src/api/purchase-account-form.ts`、`apps/admin-web/src/views/PurchaseAccountsView.vue`
- `scripts/purchase-accounts.test.mjs`
- `docs/PURCHASE_ACCOUNTS.md`、`docs/TASK_27_REPORT.md`

修改（增量，不重写采购主流程）：

- `apps/api/prisma/schema.prisma`：`PurchaseAccount` 模型；`PurchaseOrder` 增加账号列、快照列、复合外键与两个索引
- `apps/api/src/modules/purchase-orders/`：`create/update/place` 校验账号并写快照；`list` 增加 `purchaseAccountId`、`dateFrom/dateTo`
- `packages/api-contract`：`PurchaseAccountData`、四个错误码、`PurchaseOrderData.purchaseAccountId/Alias`
- `apps/api/src/common/errors.ts`、`apps/api/src/app.module.ts`
- `apps/admin-web`：采购列表账号与日期筛选、采购表单账号下拉、详情显示账号；新增「采购账号」导航与路由；`ApiFailure` 之外无共享层改动
- `scripts/web-session.test.mjs`：导航项 10 → 11，补 `/purchase-accounts` 权限断言
- `package.json`：`test:purchase-accounts`，并纳入 `pnpm test`

## 四、关键设计

**为什么存别名快照。** 账号是可改名的业务档案，采购单是已发生的账。只存外键的话，改名会让历史单据显示新名字，对账时"这笔到底是不是那个号买的"就说不清。所以草稿显示实时别名（还没发生），确认下单才冻结快照（已发生）。

**为什么平台锁定。** 账号的平台决定它属于哪个平台的对账口径。允许改平台等于把历史采购单搬到另一个平台名下，比改名更危险，因此有引用后直接拒绝。

**为什么删除要有 409。** 账号被引用时物理删除只有两条路：级联删单（丢失历史）或把外键置空（历史失去归属）。两者都违反"历史不得丢失或覆盖"，所以只允许删从未使用的账号，有历史就提示停用。数据库的复合外键是最后一道闸，接口与 SQL 都绕不过。

**关于商品属性。** 工作区里原本还有一批未提交的"货号/颜色/尺码"改动（商品列、采购明细快照列、商品编辑表单与采购行展示）。它们与采购单的"商品明细"直接相关，也共用同一批测试，因此本次一并整理提交，但拆成独立迁移 `20261023130000_product_attributes`，不混进账号迁移。三个属性全部可空，老商品与老明细保持 NULL，采购明细在下单时冻结快照，商品后续改款不影响历史单据。

**迁移为什么只增。** 老采购单没有账号概念，任何回填都只能靠猜。新增列全部可空，历史行保持 NULL；读取时 `purchaseAccountId` 为 null、`purchaseAccountAlias` 为 null，明细缺快照则回落商品主数据。测试里既做迁移文件的静态断言（无 DROP/UPDATE/DELETE/TRUNCATE、列可空），也手插一条迁移前形状的老单据读一遍。

**并发创建。** 同平台同名账号由 `(tenant_id, platform, alias)` 唯一键兜底，服务层把 `P2002` 翻成 `409 PURCHASE_ACCOUNT_ALREADY_EXISTS`；测试同时发两个相同请求，断言结果是 `[201, 409]` 且只落一行。

## 五、实测

- `pnpm test:purchase-accounts`：**14 通过 / 0 失败 / 0 跳过**
- `pnpm test` 全仓：**605 通过 / 0 失败 / 0 跳过（7 分 59 秒）**
- `pnpm typecheck` / `pnpm lint` / `pnpm format:check`：全部通过（`typecheck` 覆盖 api / admin-web / mobile；`lint` 0 警告；`format:check` 全通过）
- 迁移检查：全量 `prisma migrate deploy` 在空库成功应用 8 个迁移（含新增的 `20261023130000_product_attributes` 与 `20261023140000_purchase_accounts`），随后 `prisma migrate diff --from-config-datasource --to-schema` 返回 **No difference detected**（数据库与 schema 无漂移，退出码 0）。

测试库是一次性 PostgreSQL 数据库，跑完即删；测试进程用真实 HTTP 调 API，不 mock 数据库。

## 六、未验证与风险

1. **没有浏览器端到端点击测试。** `PurchaseAccountsView.vue` 与采购表单的交互（下拉过滤、删除确认弹窗）靠类型检查、生产构建与客户端模块测试覆盖，仍需人工点一遍。测试文件里保留了 `PURCHASE_ACCOUNTS_BROWSER_CHECK=1` 的浏览器夹具分支，但默认不跑。
2. **账号不绑定店铺 ID 或平台账号 ID。** 只按"平台 + 别名"识别，平台侧改名或换号无法自动发现，属于人工维护。
3. **列表金额是逐单 `totalCost`，没有按账号的合计汇总。** 需要总额时可加 `GET /purchase-orders/summary`（服务端聚合）；当前分页列表相加只覆盖当前页，不能当合计用。
4. **`purchaseAccountId` 允许为空。** 这是为兼容历史单据，不是鼓励不填；如果以后要强制，需要先回填历史，属于独立的迁移决策。
