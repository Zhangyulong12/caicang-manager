# 任务 33：数据统计与采购对账

任务36复核补充：保留本文2026-10-28的原始验收及已完成状态，本轮统计API、真实客户端、CSV和数据库对账再次纳入全仓回归，最新执行结果见 [TASK_36_REPORT.md](TASK_36_REPORT.md)。本轮不提交或推送。

检查日期：2026-10-28，Asia/Shanghai。状态：**已完成真实 API、Web、数据库对账和自动化验收**；专项22项及全量696项通过，均无失败/跳过。按用户最新授权提交并上传 GitHub。

## 检查与实施范围

开工读取 AGENTS、README、CODEX_TASKS、PROJECT_SPEC、任务34及相关采购/库存/退货说明。工作区原有 `?? test/` 保留不动。统计草稿未注册；复用其租户 Guard、SQL 分组、DTO、CSV 和共享类型，修正并补齐后才注册模块，没有直接上线原草稿。

文件级改动：

- `apps/api/src/modules/reports/{report-sql,report.dto,reports.service,report-csv}.ts`：真实聚合、筛选、近期记录、分摊缺失提示、平均成本、包裹数量、CSV 安全；沿用 Controller 和 Module，`apps/api/src/app.module.ts` 注册已补齐模块。
- `packages/api-contract/src/index.ts`：报表类型、11 种 dataset、可空不确定金额和新增概览字段；Swagger DTO 与真实 `/api/docs-json` 同步验证。
- `apps/admin-web/src/api/reports.ts`、`composables/reports.ts`、`views/ReportsView.vue`：真实 API、筛选/分页/卡片/导出/追溯/状态处理、切换工作空间时丢弃过期响应；`router/index.ts`、`router/policy.ts` 接入真实页面与 reports:read 权限。
- `scripts/report-fixture.mjs`、`reports.test.mjs`、`web-reports.test.mjs`、`verify-reports-local.mjs`：独立数据库、真实接口/前端客户端、只读与安全验收；`package.json` 增加 test:reports 并纳入 test/test:web。
- README、CODEX_TASKS、API_SPEC、DECISIONS、任务34状态说明、REPORTS 和本报告：使用及统计口径与真实执行结果。

实施顺序：核对模型和成本来源 → 修正草稿与契约 → 完成 Web → 独立库真实单据测试 → 主开发库独立验收空间与浏览器 → 全量检查 → 更新最终结果。无依赖升级、无数据迁移、无重置、无 .env 改动、无手机代码改动。

## 已实际验证

专项脚本（API + Web 客户端 + CSV）22 项全部通过、无跳过：两账号/平台/日期、多 SKU 优惠运费、部分/完整入库、已确认退货不倒改采购额、出库成本对实际流水、原单价不受商品参考进价修改影响、空库/未知SKU零金额、上海跨日边界、分页、五角色及跨租户隔离、旧行分摊缺失、整单退款不随多 SKU 倍增、空货号快照、实际调整流水、10000 行导出上限、OpenAPI、CSV BOM/转义/公式防护、报表不改余额与流水。

Web 客户端使用真实 API 验证查询、刷新后重新读取、账号切换、导出、403/404、权限及工作空间变化后拒收旧响应；不是用 Mock 金额断言。浏览器真实页面已切换淘宝/京东账号，显示 210.00 / 40.00，点导出显示成功 1 行，按充电器 SKU 查询显示数量12、单价18.7500、金额229.00、已收7、待收5。

主开发数据库中仅新增专用商家 `任务33采购对账验收-deed1ee3`（当前用户为其管理员）与独立测试单据，现有真实业务未修改。真实 API 返回：采购250.00、待收105.0000、已收成本145.0000、库存87.3571、出库38.4286、退款17.00、退货库存成本19.2143。凭据不写报告、不进 Git。

初次数据库测试 ECONNREFUSED：Docker Desktop 当时未运行。启动已安装 Docker 后，原 `caicang-postgres` Healthy，未删卷或重建数据。开发中测试暴露统计 SQL 误引用不存在的原单总额列，改为窗口汇总原始明细净额加原运费；测试夹具发货预期状态码和 SQL 负号类型转换错误也已按现有接口契约修正。Vue 导出最初 Lint 提示浏览器全局未声明，改为 window.Blob/window.document；复跑专项与 Lint 通过。保留真实失败经过，没有删除断言、跳过用例或改变已有业务规则。

## 最终命令结果

| 实际执行命令                                                                                                           | 最终结果                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `pnpm db:up`                                                                                                           | 原 caicang-postgres Healthy，保留原 volume 与 .env                                                                   |
| `pnpm prisma:migrate:status`                                                                                           | 10个既有迁移，结构最新，无新增/重置                                                                                  |
| `pnpm test:reports`、最终独立 `node --test --test-concurrency=1 scripts/reports.test.mjs scripts/web-reports.test.mjs` | 最终22通过、0失败、0跳过                                                                                             |
| `pnpm test`                                                                                                            | 首轮695项，689通过、6失败（包含两处叶子断言及父级失败）；修正契约断言后完整重跑696项全部通过、0失败、0跳过，492.97秒 |
| `pnpm build`（由完整 pnpm test 执行）                                                                                  | 共享包、NestJS、Web 与 mobile H5 全部构建通过；不是本轮 APK 重新验收                                                 |
| `pnpm typecheck`                                                                                                       | 全仓通过                                                                                                             |
| `pnpm lint`                                                                                                            | 通过，0 warnings                                                                                                     |
| `pnpm format:check`                                                                                                    | 通过；新增/修改代码和文档另用 Prettier 格式化核验                                                                    |
| `pnpm start:api`，重启至最新构建，`GET /api/v1/health`                                                                 | API真实监听3000，健康检查HTTP200                                                                                     |
| `pnpm dev:web`                                                                                                         | 127.0.0.1:5173真实启动；浏览器核对账号、SKU、导出、原始采购详情和刷新                                                |
| 专用商家原始 SQL 核对                                                                                                  | 采购250.00、入库145.0000、库存87.3571、出库38.4286、退款17.00、退货库存成本19.2143，与 API 一致                      |

完整回归的两处旧断言为：只读权限数组未含已存在的 reports:read；菜单数量仍为11（采购退货菜单加入后实际为12）。同步精确权限数组及完整12个路径清单，增加统计权限允许/拒绝与只读不可导出断言；没有移除断言、跳过失败或改业务权限来凑通过。后续增加1项历史空货号及真实调整流水测试，故最终总数从695增至696。完整原始日志保留于被忽略的 `test-results/task33/full-test.log`、`full-test-rerun.log`、专项 `reports-final.log`。

## 边界与剩余问题

统计口径与逐步操作见 `docs/REPORTS.md`。库存是当前混合余额，不按采购账号或平台追认来源、不能任意回溯日期；整单退款不虚构 SKU 分摊；旧行分摊缺失返回空值并提示；四位单位成本的尾差不回写原单。CSV 最大10000行，大商家需按日期缩小范围；本轮验证不等于10万采购单的压力测试。未做 Excel 桌面手工打开，已实测导出字节、BOM、结构与危险输入处理。

任务34保留用户接受的核心完成状态及未执行异常清单，本次未重做手机验收、未修改入出库等事务模块。Git 提交与上传按用户最新授权，在所有检查完成后进行。
