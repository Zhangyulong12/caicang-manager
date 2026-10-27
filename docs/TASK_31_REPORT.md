# 任务 31：采购退货 API

日期：2026-10-25（Asia/Shanghai）。范围为实际入库后退给供应商；未开发客户退货、退货页面或退款支付。本轮不提交、不合并、不推送 GitHub，保留原工作区已有任务 30 和此前修复。

## 实现

- 七个 API 操作：采购单可退来源查询；退货单列表、详情、创建草稿、编辑草稿、取消、确认。统一 `/api/v1`、DTO、Swagger、响应和错误码。
- 新增退货主单、退货明细、原入库分配三表；强制同商家、同原采购、同商品的复合外键，UUID、NUMERIC、时间、CHECK、唯一键及索引。
- 实际入库减已确认退货构成可退上限；可指定入库明细，也可由服务器按入库时间及 ID 分配，支持部分、分批与多 SKU。
- 草稿和取消不预留、不动库存。确认锁定商家、原采购单、退货单及有序余额；检查全部 SKU 后同事务扣库存、保存成本及来源、写独立 PURCHASE_RETURN 流水、审计和幂等确认号。
- 原号原单重复确认返回 200，不重复扣库存或记审计；异单复用操作号、已确认改单、超退、缺货分别拒绝。失败回滚后原号仍可重试。
- 库存移动加权成本、原入库追溯成本、实际退款分开；清零正确处理尾差。原采购单价、数量、费用、累计入库、采购与包裹状态不修改。
- 全角色授权读取；OWNER/ADMIN/BUYER 草稿写；OWNER/ADMIN/WAREHOUSE 确认。跨商家资源 404，无成员 403。Guard 与事务内均复核授权，VIEWER 隐藏原因和备注。

## 修改文件

| 文件 | 原因 |
| --- | --- |
| apps/api/prisma/schema.prisma | 三个新模型、反向关联与入库来源复合唯一键 |
| apps/api/prisma/migrations/20261025090000_purchase_returns/migration.sql | Prisma diff 生成的第十个增量迁移及 CHECK/触发器 |
| apps/api/src/modules/purchase-returns/purchase-return.dto.ts | 输入白名单、严格日期/金额/数量校验和响应 Swagger |
| apps/api/src/modules/purchase-returns/purchase-returns.controller.ts | 七个操作、角色/权限及确认重放 HTTP 状态 |
| apps/api/src/modules/purchase-returns/purchase-returns.service.ts | 实际来源、额度、状态、成本、库存事务、幂等、审计 |
| apps/api/src/modules/purchase-returns/purchase-returns.module.ts | 注册新业务模块 |
| apps/api/src/app.module.ts | 导入退货模块 |
| apps/api/src/common/errors.ts | 超可退量标准业务错误 |
| packages/api-contract/src/index.ts | 共享退货类型、状态、错误和独立流水类型 |
| apps/api/src/modules/inventory/inventory.service.ts | 查询流水时关联退货来源单号、明细/单据 ID |
| apps/admin-web/src/api/inventory-format.ts | 给新流水类型显示“采购退货”，保留任务 30 已有改动 |
| scripts/purchase-returns.test.mjs | 真实 PostgreSQL / 双 API 进程业务、权限和故障测试 |
| scripts/purchase-returns-migration.test.mjs | 九迁移旧库含入库/余额/流水的升级及旧行保留验证 |
| scripts/database-models.test.mjs | 新表、约束、触发器和结构一致性验证 |
| package.json | 专项测试命令及纳入完整回归，保留已有命令 |
| AGENTS.md | 将供应商退货纳入受控库存事务和幂等规则 |
| README.md、docs/CODEX_TASKS.md | 任务范围和启动/测试入口 |
| docs/API_SPEC.md、docs/DATABASE_DESIGN.md、docs/DECISIONS.md | API、增量结构、ADR-030 |
| docs/PURCHASE_RETURNS.md、docs/TASK_31_REPORT.md | 操作示例、成本、兼容风险和实际验证记录 |

没有修改手机端源文件、依赖版本、旧迁移或 database/schema.sql。main.ts、logging.ts、采购账号及任务 30 页面等原有未提交修改保持，本任务不将它们误列为新增修复。

## 已实际验证

真实 API 与 PostgreSQL，全部业务验收只在随机 caicang_test_* 隔离数据库执行：

1. 真实采购并入库 10×18.50；建退货草稿 2 件后仍 10 件，无退货流水。确认后余额 8、成本 148.0000，一条退货流水；stockCost/receivedCost 各 37.0000，退款独立 29.99。
2. 同操作号重复确认返回原确认单，余额仍 8，分配/流水/审计数量和确认时间不变。异单复用操作号冲突。
3. 多 SKU 草稿编辑与取消不动库存；确认多 SKU 正确生成多行流水。已确认和已取消单不能非法改单。
4. 无实际入库时拒绝退货；分两次入库 6+4，退 7 自动分配 6+1；指定已用完来源拒绝，余 3 可全退至 0。
5. 草稿不占用额度；其他退货先确认后，原草稿超过新可退额度被拒且保持原状。
6. 已入库 10，出库 9 后退 2，返回 OUT_OF_STOCK；余额仍 1，确认号、来源分配、流水及审计均不新增。
7. 两个真实 API 进程同时退同原单各 6，即使另一次采购使当前库存达到 20，也只允许一个成功；另一个超原单可退量拒绝，库存 14。
8. 两进程同号同时确认只成功扣一次；退货与真实出库竞争库存，只允许一个成功，余量 4，无负库存。
9. 原单 10×18.50 加同 SKU 10×30.00 后退原单 2：stockCost=48.5000、receivedCost=37.0000、退款 35.00；修改参考价并停用商品后历史退货和采购原价保持。
10. 成本池 0.0400 的三件商品分两单退完，实际扣减 0.0133 与 0.0267，最终数量/成本均为 0。
11. 审计触发器故障注入使创建、编辑、取消和确认均失败并整体回滚；恢复后原操作号可成功确认。日志不含故障私密文本、Token 或备注。
12. 跨商家采购/退货/采购行/入库来源返回 403/404；五角色差异、输入白名单、重复行、非法金额/日期/数量、过滤分页、Swagger 和数据库 FK/CHECK 均验证。
13. 所有余额与库存流水数量/成本汇总一致；每条已确认退货恰有对应流水和等量原入库分配，草稿/取消无流水和分配。
14. 空库迁移和重复 deploy 成功；旧九迁移库预置采购、入库、余额和流水，升级第十迁移后全部原行逐字段不变，三张新表为空。

## 命令与日志

- `pnpm prisma:validate`、`pnpm prisma:generate`、`pnpm build:shared`、`pnpm --filter @caicang/api build` 已成功。
- `node --test --test-concurrency=1 scripts/purchase-returns.test.mjs scripts/database-models.test.mjs` 中模型组 66 项通过；该次退货组暴露测试夹具字段名问题，已修正并由后续专项/全量重新验证。原日志 test-results/task31-returns-models.log 保留。
- `node --test --test-concurrency=1 scripts/purchase-returns.test.mjs scripts/purchase-returns-migration.test.mjs` 在加入最终对账断言前 16 通过、0 失败、0 跳过（test-results/task31-returns-verified.log）。新增的总账对账断言已在本轮全量中执行通过。
- `pnpm typecheck`、`pnpm lint`、`pnpm format:check` 已通过；日志分别为 test-results/task31-typecheck.log、task31-lint.log、task31-format.log。
- 全量 `pnpm test`：**655 通过、0 失败、0 跳过、0 取消**，454.25 秒；包含共享包、NestJS、Web、手机 H5 的真实构建、原入库/安全/出库/调整回归及采购退货专项。退货专项在此次全量中共 **17 项通过**（含最终对账及旧库升级）。日志 test-results/task31-full-test.log。
- `pnpm prisma:migrate:deploy`：开发库成功应用第十迁移；`pnpm prisma:migrate:status` 显示 10 个迁移、结构最新。`pnpm --filter @caicang/api exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` 返回 No difference detected。日志 task31-migrate-main.log、task31-migrate-status.log、task31-main-schema-diff.log。
- `git diff --check`：通过。没有执行 git add/commit/push、数据库 reset 或 Docker 卷删除。

构建的手机产物为 H5，并未验证 Android APK；本任务没有手机功能变更，不将 H5 构建视为真机通过。

初次专项出现一次 API 30 秒启动等待超时；未忽略该失败，后续重新执行与独立启动诊断均可启动，未修改安全检查或启动超时来掩盖。初版测试还误用已有接口字段 sourceType/referenceCost/receivedQty 和错误码名称，以及旧库夹具不存在的 received_qty 列；已对照真实 DTO/响应/表结构更正，HTTP 状态、数量、金额、幂等与回滚断言保持。没有跳过失败用例或改业务结果断言来制造通过。

## 数据保护

开发库迁移前已完成 D 盘备份 `backups/caicang-before-task31-babed0d6-76b5-4f66-ac8b-45988854e90b.dump`（101251 字节），PGDMP 格式及 pg_restore 目录读取成功。保存了原 20 张表全部列的行数/内容指纹和 .env/.env.auth.local 哈希。备份与原始日志由 .gitignore 排除，不进入提交。

迁移只新增三表、相关索引/外键/CHECK/触发器，给原入库明细增加复合索引，扩展原流水 CHECK 类型。不重置数据库、不清卷、不导入参考 SQL、不覆盖 .env。迁移后及 API 重启后均核对：原 20 张表的行数、全部旧列内容指纹及两份环境文件哈希全部不变。三张新退货表均为 0 行，没有向开发库写测试退货。核对记录 test-results/task31-data-before.json、task31-data-after.json、task31-preserve-after.log。

## 本地 API 启动验证

仅替换了已确认属于项目的旧 node API 进程，未停止 Web、Docker 或其他服务。新进程 PID 175356，实际监听 0.0.0.0:3000。

- `GET http://127.0.0.1:3000/api/v1/health`：HTTP 200，status=ok、service=caicang-api、database=reachable。
- `GET http://127.0.0.1:3000/api/docs-json`：五个退货相关路径、七个 HTTP 操作存在。
- 未登录 `GET /api/v1/purchase-returns`：HTTP 401，认证保持有效。
- 启动 stderr 为空。证据 test-results/task31-runtime-check.json、task31-api-runtime.log、task31-api-runtime-error.log。

## 使用与边界

参见 [采购退货操作说明](PURCHASE_RETURNS.md)。本阶段通过 Swagger/API 操作；没有退货 Web 页面、Android 真机验收或退款支付能力，也不声称这些已完成。已确认退货不能直接撤销或改金额；后续修正流程需要另行设计可追踪单据，不应修改原采购单价。

本次范围内无未解决的验收阻塞。可以在 Swagger 登录并设置当前商家，先用 returnable 查询真实已入库来源，再建草稿、确认、同号重试，并用库存余额及 PURCHASE_RETURN 流水查询核对。当前开发库没有入库记录，人工验收需使用自己的真实采购入库记录或另设专门测试工作空间；本轮的 10→8 及拒绝用例已在隔离库通过，不冒充开发库现存业务。
