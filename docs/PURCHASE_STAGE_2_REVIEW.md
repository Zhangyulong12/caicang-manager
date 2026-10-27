# 采购阶段 2：采购账号与采购管理复核交付（2026-10-24）

## 范围与工作区

本次工作从现有采购模块开始：多 SKU、实际采购单价、行优惠、运费分摊、草稿修改、确认与取消已经存在，继续复用，未重写金额计算或仓储流程。

恢复执行时，工作区已新增 `3324b3b`（采购账号）、`6e6c5c6` 和 `ab75053`（商品精简及文档）提交。因此按最新代码补缺和验收，没有回退或重复覆盖这些变更。本轮未执行 commit、merge 或 push。原有启动日志、Vite 注册代理修复及其测试/报告的未提交修改均保留。

## 已实现与实际验证

- 采购账号管理：淘宝、京东、拼多多、其他；别名、备注、查询、新增、编辑、启停用。不同商家同名可用，同商家同平台同别名冲突 409；只允许删除从未关联采购记录的账号，历史账号由接口与数据库外键双重保护。不接收或存储平台密码。
- 采购单关联真实账号，按平台提供账号选项；同商家且平台匹配，停用账号不能用于新建或确认下单。旧单不补造账号。
- 采购列表按账号、平台、采购日期起止筛选，支持货号、SKU、单号、平台订单号搜索；详情保留实际数量、价格、优惠、运费和总额。
- 商品档案的参考价只用于新明细输入建议；已保存采购单按采购明细读取实际价格，下单后价格、数量和账号不可直接改写。
- 下单冻结账号别名和商品货号/颜色/尺码；补齐取消草稿时的账号别名快照，账号随后改名不影响已取消单的显示。采购审计补充商品原额、优惠与运费分解。
- 修复采购日期区间反向时的前端错误反馈，显示具体日期问题，而非通用重试提示。

浏览器使用一次性 `caicang_test_*` 数据库与真实 API、Vite，执行：

1. 登录专用随机密码测试账号，选择独立测试工作空间。
2. 页面创建“淘宝主账号”和“京东采购号”，刷新后仍有两个账号。
3. 新建淘宝采购单，选择淘宝主账号，录入保留前导零的平台订单号和两个 SKU：
   - 充电器：10 × 18.50，行优惠 5.00。
   - 数据线：2 × 8.25，行优惠 1.00。
   - 运费 10.00；商品原额 201.50，优惠 6.00，服务器总成本 **205.50**。
4. 保存、刷新详情、确认下单，核对商品货号/颜色/尺码与分摊成本。
5. 京东账号筛选为 0 张、淘宝为 1 张，货号 B20 可搜索到该单。
6. 将测试商品参考价由 99.00 改为 999.00，重新打开订单，实际采购价仍为 18.50，总成本仍为 205.50。
7. 测试夹具直接查询数据库确认两个账号、一张已确认单、两条明细和 205.50 金额，然后关闭临时服务并清理该测试库。没有往真实开发库添加验收商品或订单。

截图：`test-results/purchase-accounts-browser-detail.png`。这里只是软件采购记录确认，没有访问电商平台或支付。

## 数据库与数据保留

开发库原有 6 个迁移，新增应用：

- `20261023130000_product_attributes`：商品可空货号/颜色/尺码，采购明细对应可空快照，原规格保留。
- `20261023140000_purchase_accounts`：采购账号表、采购单可空账号外键和别名快照、账号/日期查询索引、CHECK 与更新时间触发器。

应用前生成 PostgreSQL 自定义格式备份：`backups/caicang-before-purchase-accounts-566bfc1d-24c7-444c-9588-1a4f56753ee0.dump`（94,023 字节，备份目录被 Git 忽略）。没有执行数据库重置、删除数据卷、`down -v`、覆盖 `.env` 或重复执行 `database/schema.sql`。

迁移后验证：

- 8 个迁移全部应用，`prisma migrate status` 最新。
- `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` 无差异，退出 0。
- 原有 19 张表按迁移前的列逐行计算摘要并对比，原字段值全部一致：商品 12、采购单 2、采购明细 3 等均未变化；新增采购账号表为空，留给用户建立真实账号。
- `.env` 与 `.env.auth.local` 文件摘要一致。验证材料保存在被忽略的 `test-results/purchase-preservation-before.json` 与 `purchase-preservation-after.json`。

迁移只有新增结构，不删除旧列或旧数据。回滚若删掉新增结构会损失后续录入的账号/属性，应优先前向修复，不能在存在新业务记录后直接删表回退。

## 本轮修改文件

| 文件 | 用途 |
|---|---|
| `apps/api/src/modules/purchase-orders/purchase-orders.service.ts` | 草稿取消冻结账号别名；审计成本分解 |
| `apps/admin-web/src/views/PurchasesView.vue` | 日期区间错误显示明确原因 |
| `scripts/purchase-accounts.test.mjs` | 取消快照、审计金额分解；停用/建单与改名/确认并发测试；执行既有浏览器夹具 |
| `scripts/database-models.test.mjs` | 按实际迁移数量核对；覆盖新增账号表、40 个 CHECK、20 个时间触发器及账号/日期索引 |
| `docs/PURCHASE_ACCOUNTS.md`、`docs/TASK_27_REPORT.md` | 同步取消规则与已完成浏览器验收 |
| `docs/DECISIONS.md`、本报告 | ADR-028、迁移兼容与本轮证据 |

完整功能已有实现位置：`apps/api/src/modules/purchase-accounts/`、`apps/api/src/modules/purchase-orders/`、`apps/api/prisma/schema.prisma`、上述两个迁移；`packages/api-contract/src/index.ts`；Web 的 `PurchaseAccountsView.vue`、`PurchasesView.vue`、`PurchaseFormView.vue`、`PurchaseDetailView.vue`、`PurchaseProductPicker.vue`、`api/purchases.ts`、`api/purchase-form.ts`、`api/purchase-account-form.ts` 及导航。未修改手机端任务文件。

## 实际命令与结果

| 命令 | 结果 |
|---|---|
| `pnpm db:up` | Docker Server 29.8.2，原 PostgreSQL 容器 Healthy，沿用原卷 |
| `pnpm prisma:generate`、`pnpm build:shared`、API build | 成功，Prisma 7.10.0 |
| 浏览器夹具：`$env:PURCHASE_ACCOUNTS_BROWSER_CHECK='1'; node --test scripts/purchase-accounts.test.mjs` | 15 通过、0 失败、0 跳过；含本轮取消快照测试及真实浏览器建单数据库核对 |
| `node --test --test-concurrency=1 scripts/purchase-accounts.test.mjs scripts/web-purchases.test.mjs` | 最终 33 通过、0 失败、0 跳过，包含新增两个并发场景 |
| `node --test scripts/database-models.test.mjs` | 65 通过、0 失败、0 跳过，含空库迁移、重复迁移、重复/并发 seed、CHECK、外键及模型漂移 |
| `pnpm typecheck` | 全工作区通过 |
| `pnpm lint` | 通过，0 警告 |
| `pnpm format:check` | 通过 |
| `pnpm test` | 全仓构建成功；615 通过、0 失败、0 跳过（测试部分约 6 分 42 秒），包含采购、包裹、入库事务/安全、库存、出库和客户端回归 |
| `GET http://127.0.0.1:3000/api/v1/health` | HTTP 200，`status=ok`、`database=reachable` |
| `GET http://127.0.0.1:5173/purchase-accounts` | HTTP 200 |

首轮组合测试保留在 `test-results/purchase-stage-current-tests.log`：104 通过、2 失败（同一个 API 30 秒就绪超时造成父子测试计数，无原始异常输出）。未跳过、未放宽超时、未修改断言掩盖；之后独立启动 API 正常，最终专项和浏览器均通过。该次超时的具体系统原因没有足够证据确定。更早的测试夹具字段名和 HTTP 预期错误已修正，原日志仍保留，不把首轮声称为通过。

## 用户浏览器验收

交付时 API 正常进程 PID 16504 监听 3000，Web PID 7448 监听 127.0.0.1:5173；PostgreSQL 容器 Healthy。进程号会随重启改变。打开 `http://127.0.0.1:5173`，使用自己的账号登录并选择自己的商家：

1. 左侧「采购账号」→ 新增淘宝主账号、京东采购号。
2. 「采购管理」→「新建采购单」→ 选择平台与对应账号。
3. 填平台订单号、日期、店铺、收货仓库及收货信息；添加多个 SKU，录入实际数量、实际单价和每行优惠，填写运费。
4. 保存后详情核对服务器金额；需要时修改草稿，确认后即冻结。
5. 返回采购列表按账号、平台、日期或货号/SKU 查询，打开详情并刷新确认数据保留。
6. 历史订单未指定账号会显示“未指定账号”，不代表数据丢失。

Windows 从停止状态启动：先 `pnpm db:up`，再 `pnpm prisma:migrate:deploy`；一个终端运行 `pnpm start:api`，另一个运行 `pnpm dev:web`。本次开发库迁移已完成，不需要初始化或 seed 你的业务库。

## 边界与剩余事项

- 既有结构已支持一采购单多包裹、包裹多预计 SKU、按字符串运单号查询、核对后执行原子入库并更新库存与流水。本轮未改动这条链路；全量回归覆盖相应现有测试，未进行 Android 真机扫码验收。
- 账号列表/采购列表显示逐单成本；**尚未实现跨分页的按账号合计统计**。不能把当前页金额相加当成账号全部采购金额，后续统计以采购记录聚合为准。
- 已确认订单不允许直接改价；本阶段没有实现已入库历史成本修正流程。
- 账号删除确认弹窗未做浏览器点击；API 和数据库保护已测试。真实业务库中的用户账号和记录未用于写入验收。
- 没有提交、合并或推送 GitHub；后续由用户决定。
