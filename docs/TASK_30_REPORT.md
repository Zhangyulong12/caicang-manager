# 任务 30：库存调整 Web 页面

日期：2026-10-24—25（Asia/Shanghai）。基于本地 `d7caca7`（任务 29 API）增量实现；本轮未提交、合并或推送 GitHub。

## 交付

电脑后台「库存管理 → 库存调整」上线真实列表、创建表单与详情。支持仓库、商品、带符号数量差、五种原因和备注；显示服务端调整前后数量、操作人、时间及成本变化；列表支持搜索、筛选、分页与错误重试。

复用任务 29 的 `GET/POST /api/v1/inventory/adjustments` 和 `GET /api/v1/inventory/adjustments/{id}`，没有新建库存 API、模型或迁移，没有本地修改库存余额。角色沿用 `inventory:write`（OWNER/ADMIN/WAREHOUSE），读取沿用 `products:read`；BUYER/VIEWER 不能执行调整。跨商家详情 404、非成员访问 403；前端拦截不代替服务端检查。

流水与 SKU 详情的调整来源单号可跳到详情；详情带仓库/商品/ADJUSTMENT 条件跳回流水。所有前后数量和成本均取服务器，商品参考价不会被前端用来覆盖现有库存成本。

安全重试：发送前持久化操作号和原始允许字段；响应丢失后锁定表单，刷新恢复原操作，同号同内容重放不重复调整。存储不可写时不提交，商家上下文为空时不生成存储键或发写请求。详见 [使用说明](WEB_ADJUSTMENTS.md)。

## 浏览器与数据库实测

使用独立随机 `caicang_test_*` PostgreSQL 数据库，真实 NestJS、Vite 和专用测试账号，未在用户业务库创建测试调整。

1. 通过真实采购 → 下单 → 包裹 → 收货，准备充电器 10 件，实际单价 18.50，成本池 185.0000；商品参考价为 99.00，用于验证成本不会误用参考价。
2. 浏览器选择「任务30浏览器验收」工作空间，从库存管理进入新建调整，选择仓库、商品、盘亏，填 -2 和备注，确认后详情 **10/-2/8**，成本池 **148.0000**。
3. 创建盘盈 +3，详情 **8/+3/11**，单位成本仍 18.5000，成本池 **203.5000**。
4. 从详情打开筛选后的调整流水，显示两条记录；点击盘亏单号成功回到对应详情。
5. 刷新库存列表，SKU 为 **11 件 / 203.50 元**；刷新调整列表保留两张单，含单号、原因、数量、操作人与时间。
6. 最终浏览器 warn/error 日志为空。数据库夹具随后直接核对 `stock_balances`、`stock_adjustments`、`stock_movements`：11 件、203.5000 成本池、数量差 -2/+3、流水 10→8→11。全部通过后关闭临时 API/Web 并清理测试库。

截图保存在被忽略的：

- `test-results/task30-browser-adjustments.png`
- `test-results/task30-browser-balance.png`
- `test-results/task30-browser-ledger.png`

## 验证命令

| 命令 / 检查 | 实际结果 |
| --- | --- |
| `pnpm prisma:generate`、`pnpm build:shared`、API build | 成功 |
| `pnpm --filter @caicang/admin-web build` | 成功，含三张调整页面 |
| `node --test --test-concurrency=1 scripts/web-adjustments.test.mjs scripts/stock-adjustments.test.mjs scripts/web-inventory.test.mjs` | 首轮 34 通过、0 失败、0 跳过 |
| 修复后 `node --test --test-concurrency=1 scripts/web-adjustments.test.mjs scripts/web-inventory.test.mjs` | 24 通过、0 失败、0 跳过 |
| `$env:TASK30_BROWSER_CHECK='1'; node --test scripts/web-adjustments.test.mjs` | 最终 12 通过、0 失败、0 跳过，含浏览器数据库核对 |
| `pnpm typecheck` | 最终复查通过，覆盖 Web、API、mobile 与共享包 |
| `pnpm lint`、`pnpm format:check` | 最终复查通过，Lint 0 错误/0 警告 |
| `pnpm test` | 全仓构建成功，638 通过、0 失败、0 跳过；测试部分约 6 分 56 秒 |
| Prisma migration status / migrate diff | 9 个迁移已应用；开发库与 Prisma schema 无差异，退出 0 |
| 开发 API `/api/v1/health` | HTTP 200，数据库 reachable |
| Web `/inventory/adjustments` | HTTP 200 |

专项包括非零整数/范围/方向/备注校验、请求白名单、路由读写权限、真实 API 的只读写入 403、跨商家 403/404、分页筛选、库存不足整体不变、响应在事务提交后丢失、刷新复用操作号、并发重试只扣一次、来源链接和生产产物。浏览器真实负数/正数提交覆盖了表单及导航运行时行为。

## 发现并修复的问题

- Lint 首轮发现裸 `sessionStorage` 未声明，改为 `window.sessionStorage`，未扩大 ESLint 全局配置。
- 浏览器首轮提交虽然正确写入库存，但导航校验商家时 `tenants.current` 短暂为空，组件初始化非空断言引发页面异常。改为使用时校验用户/商家键，未绕过路由、认证或成员校验；增加缺失上下文用例，最终完整负数/正数浏览器重跑无告警。
- 首轮浏览器夹具的数据库核对误把接口时间名写为 `occurred_at`，实际表列为 `created_at`；改正 SQL 列名，保持 -2/+3、前后余额、最终成本等断言不变，重新建隔离库并完整操作验证。首轮为 10 通过/2 失败（父子计数，同一个 SQL 错误），保留 `test-results/task30-browser-first-run.log`，不当作通过。

## 数据保护与迁移

任务 30 没有新增迁移。开发库原有 8 个迁移，任务 29 的既有 `20261023150000_stock_adjustment_api` 尚未应用，因此本轮先备份，再部署这一条已有迁移。该迁移仅给 `stock_adjustments` 增四个可空列、两个索引和原因 CHECK，不改写历史行。

备份：`backups/caicang-before-task30-26fa3dc0-c6d7-46c6-a0e8-d35833278ed9.dump`（99,654 字节，自定义 PGDMP 格式，Git 忽略）。迁移前后对原有 **20 张表的所有原字段**计算行数及内容摘要，完全一致；原 12 个商品、2 张采购单、3 条明细保留，开发库调整单、流水和余额没有测试写入。`.env` 与 `.env.auth.local` SHA-256 保持一致；材料见 `test-results/task30-data-before.json`、`task30-data-after.json`。

没有 reset、删除数据库卷、`down -v`、重放 `database/schema.sql`，没有覆盖环境文件。原工作区中的 API 启动诊断、注册代理、采购审计/报告及其测试等未提交修改保留。

## 本轮文件清单

新增：

- `apps/admin-web/src/api/adjustments.ts`：真实 API 客户端、白名单、角色与工作空间变化检查。
- `apps/admin-web/src/api/adjustment-form.ts`：表单校验、持久化幂等操作与重试规则。
- `apps/admin-web/src/composables/adjustments.ts`。
- `apps/admin-web/src/components/AdjustmentProductPicker.vue`：真实商品查询/分页选择。
- `apps/admin-web/src/views/AdjustmentsView.vue`、`AdjustmentFormView.vue`、`AdjustmentDetailView.vue`。
- `scripts/web-adjustments.test.mjs`：前端模块 + 真实 PostgreSQL/API + 可选浏览器夹具。
- `docs/WEB_ADJUSTMENTS.md`、本报告。

修改：

- `apps/admin-web/src/router/index.ts`、`router/policy.ts`：三条页面路由及创建权限。
- `apps/admin-web/src/components/InventoryTabs.vue`：库存调整入口与子页选中态。
- `apps/admin-web/src/api/inventory-format.ts`：来源详情链接映射，校验 UUID。
- `apps/admin-web/src/views/InventoryMovementsView.vue`、`InventorySkuView.vue`：调整来源跳转及流水 query 初始化。
- `package.json`：新增 `test:web-adjustments`，加入全仓及 Web 测试。
- `README.md`、`docs/CODEX_TASKS.md`、`docs/DECISIONS.md`：入口、命令、阶段状态与重试决策。

没有修改任务 29 后端业务逻辑、数据库模型、手机端或无关业务模块。

## 用户操作验收与边界

交付时 API PID 28032 监听 3000、Web PID 25848 监听 127.0.0.1:5173，PostgreSQL Healthy（重启后 PID 会变化）。打开 `http://127.0.0.1:5173`，登录并选商家 →「库存管理」→「库存调整」→「新建库存调整」。选择仓库和商品，先按实物情况填写盘亏负数，再按真实盘盈填写正数，逐次确认并核对详情。刷新「商品库存」和「变动流水」，点击来源单号追溯。

较窄窗口的调整列表可横向滚动查看操作人与时间；详情也完整显示。已生效调整只读，输入错误需要另做反向调整并说明原因，不可删除原流水。本阶段没有审批流、批次/库位、成本修正或跨设备待确认操作恢复。Android 真机不属于本次验收。
