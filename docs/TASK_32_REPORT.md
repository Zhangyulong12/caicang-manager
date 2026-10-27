# 任务 32：采购退货 Web 页面

日期：2026-10-25—26（Asia/Shanghai）。仅供应商采购退货；保留已有任务 30/31 及此前工作区修改，未执行 Git 提交、合并或推送。

## 已交付

- `/purchase-returns`：退货列表、单号/原采购单号/SKU 搜索、退货日期和状态筛选、分页、刷新与错误重试。
- `/purchase-returns/new`：查询并选择真实原采购记录，展示逐 SKU 的实际入库、已退、剩余可退和当前库存，支持部分/多个 SKU 退货，填写日期、原因、实际退款和备注。
- `/purchase-returns/:id`：真实详情、确认退货、取消草稿、原入库来源、原采购链接、退款记录、确认后的真实库存和逐 SKU 流水链接。
- 原采购详情增加创建退货/关联退货入口；PURCHASE_RETURN 库存流水来源可反向跳到退货详情。
- 预计退款与实际退款分别展示。预估来自原采购净商品金额按退货数量比例分摊，不含运费，后端 Decimal 逐行到分，Web BigInt 仅预览。实际 refundAmount 继续使用任务 31 的真实登记，确认后冻结；库存成本不作为退款金额。
- 草稿/取消不扣库存。确认结果由后端决定，只有确认成功或读取到已确认状态后才查真实库存。失败显示标准错误及请求编号，不在前端改余额。
- 按用户/商家/退货单在当前标签页保存确认 UUID，刷新仍复用；存储失败不发请求。创建结果不明时禁用重复保存，提示先核对列表。
- 路由、按钮和 Web 服务层复核权限、拒绝跨商家迟到响应；服务器继续最终授权。OWNER/ADMIN/BUYER 新建和取消，OWNER/ADMIN/WAREHOUSE 确认，VIEWER 只读。

## 修改文件

| 文件 | 目的 |
| --- | --- |
| apps/admin-web/src/views/PurchaseReturnsView.vue | 列表、条件查询、分页和错误重试 |
| apps/admin-web/src/views/PurchaseReturnFormView.vue | 原采购选择、可退数量、退款预览及真实草稿提交 |
| apps/admin-web/src/views/PurchaseReturnDetailView.vue | 确认/取消、退款/来源/库存详情和安全重试 |
| apps/admin-web/src/api/purchase-returns.ts | typed 真实 API 客户端、权限、白名单及范围检查 |
| apps/admin-web/src/api/return-form.ts | 表单验证、整数分预估、状态文字、持久确认号 |
| apps/admin-web/src/composables/purchase-returns.ts | 接入当前登录与商家上下文 |
| apps/admin-web/src/router/index.ts、policy.ts | 导航、路由、权限、登录跳转白名单 |
| apps/admin-web/src/layouts/MainLayout.vue | 新导航的子页面高亮 |
| apps/admin-web/src/views/PurchaseDetailView.vue | 原采购到退货的入口与过滤查询 |
| apps/admin-web/src/api/inventory-format.ts | PURCHASE_RETURN 来源链接 |
| apps/api/src/modules/purchase-returns/purchase-returns.service.ts | 只读退款预估、原采购金额/数量、确认人名称；不改库存事务 |
| apps/api/src/modules/purchase-returns/purchase-return.dto.ts | 同步新增只读字段的 OpenAPI |
| packages/api-contract/src/index.ts | 共享预估、可退来源和确认人类型 |
| scripts/web-purchase-returns.test.mjs | 表单、权限、真实 API、金额及可选浏览器隔离验收 |
| package.json | test:web-purchase-returns 命令及纳入 test/test:web |
| README.md、docs/CODEX_TASKS.md | 当前阶段及入口 |
| docs/DECISIONS.md、API_SPEC.md、PURCHASE_RETURNS.md | ADR-031、响应兼容与金额口径 |
| docs/WEB_PURCHASE_RETURNS.md、TASK_32_REPORT.md | 使用说明与本报告 |

无新依赖、数据库模型/迁移、旧迁移、database/schema.sql 或手机源文件变更。API 复用现有端点，仅扩展只读响应；未新增付款表或重写入库、出库、库存事务。

## 真实浏览器验收

使用随机 caicang_test_* 数据库、独立 NestJS/Vite、专用虚构测试账号；没有往用户开发库写验收采购或退货。

1. 真实 API 预置原采购：10 件×18.50，优惠 5.00、运费 10.00，总成本 190.00，真实收货 10 件。
2. 浏览器登录并选择“Web 退货 A”，点击“采购退货 → 新建”，按 TASK32-BROWSER 搜索原采购并选择，页面显示已入库 10、已退 0、可退 10、当前库存 10。
3. 填退货 2 件、原因/备注和实际退款 35.00；页面预估 36.00。保存后进入真实草稿详情，尚无库存扣减。
4. 二次确认后状态 CONFIRMED，原入库分配 2 件，库存扣减成本 38.0000；实际退款登记 35.00，与预计 36.00 分开；库存余额 8、成本 152.0000。
5. 刷新详情后状态、金额和余额保持。查看库存流水为 10 → −2 → 8，来源退货单号可追溯；原采购仍是数量 10、已收 10、原单价 18.50、总成本 190.00。原采购“关联退货记录”显示对应已确认单及两种金额。
6. 浏览器验收结束标记触发测试程序直接查询数据库：仅一张该原单退货、状态 CONFIRMED、refund_amount=35.00；余额 8/152.0000，恰一条 −2 的 PURCHASE_RETURN 流水。断言通过后关闭临时服务并只清理本次随机测试库。

截图：`test-results/task32-confirmed.png`（退货、退款、余额）、`test-results/task32-ledger.png`（流水）。浏览器日志 `test-results/task32-browser-tests.log`：16 通过、0 失败、0 跳过，包含人工 UI 交互结束后的真实数据库断言。

## 最终命令与结果

| 已执行命令 | 真实结果 |
| --- | --- |
| pnpm test:web-purchase-returns | 共享包、API、Web 构建成功；新专项 16 通过、0 失败、0 跳过 |
| node --test --test-concurrency=1 scripts/purchase-returns.test.mjs scripts/web-inventory.test.mjs scripts/web-purchases.test.mjs | 45 通过、0 失败、0 跳过；含原采购退货事务、入库额度、并发/幂等、金额、采购与库存页面回归 |
| pnpm typecheck | 全 workspace 通过 |
| pnpm --filter @caicang/admin-web build | 最终源代码构建成功，三张退货页面真实打包 |
| pnpm lint | 最终通过，无警告 |
| pnpm format:check | 通过 |
| git diff --check | 通过 |

本次相关自动化共 **61 项通过**；未重新运行整仓 pnpm test，不将任务 31 的 655 项结果冒充本次全仓结果。新脚本已加入根 test/test:web，未来全量会执行。

最终证据：test-results/task32-final-web-tests.log、task32-regression.log、task32-typecheck-final.log、task32-web-build-final.log、task32-lint-final.log、task32-format-check-final.log。

## 发现的问题与修复

- 浏览器首次打开创建页时请求带空 search=，原采购 DTO 正确拒绝 400 VALIDATION_ERROR。已改为省略空参数，补真实空搜索测试；没有放宽后端校验，浏览器重试及最终专项均通过。
- 首次回归中 API 子进程 30 秒等待超时，导致退货事务组未执行；保留 task32-first-tests.log。相同启动/超时设置下重跑，最终 45 项回归全部实际执行通过，没有跳过或延长超时掩盖。该次系统层冷启动超时原因尚未确定，当前测试及本地 API 均正常。
- Lint 发现裸 sessionStorage 不在项目全局声明中，已明确使用 window.sessionStorage。保留失败日志 task32-final-lint.log，最终通过日志为 task32-lint-final.log。

## 本地运行与数据保护

已重启经归属检查的项目 API，PID 198920，端口 3000。GET /api/v1/health 返回 HTTP 200、status=ok、database=reachable；运行时 Swagger 包含新只读字段。原 Web 继续运行，GET http://127.0.0.1:5173/purchase-returns 返回 200。证据 task32-runtime-check.json；启动 stderr 为空。没有停止 Docker 或用户的 Web 服务。

无迁移，数据库仍使用任务 31 的十个迁移。D 盘备份 `backups/caicang-before-task32-647d8961-315f-49f3-90c4-306b5b5e88e2.dump`（123965 字节）；原 23 张表全部原列行数/内容指纹及 .env/.env.auth.local 哈希前后完全一致（task32-data-before.json、task32-data-after.json）。备份、截图和原始日志均被 .gitignore 排除，不提交凭据。

## 使用与剩余边界

刷新现有后台，左侧进入“采购退货”，选择自己已经实际入库的采购单操作；尚未入库时不能退。详细步骤见 [WEB_PURCHASE_RETURNS.md](WEB_PURCHASE_RETURNS.md)。本次功能验收无阻塞。

退款是退货单上的真实业务登记，不代表银行已到账；未实现付款执行或独立到账凭证管理。确认后不能直接改金额/取消，草稿填错可取消另建，本阶段不提供草稿编辑页面。未开发客户退货、手机退货或后续任务。
