# 任务 15：快递包裹 Web 页面

2026-10-22（Asia/Shanghai），`D:\Dev\caicang-manager`，基线 `1b99f47`，分支 `feat/task-14`（沿用现有工作分支，未新建或切换）。

## 交付

新增 `/packages` 管理页面与只读 `GET /api/v1/packages` 分页接口：

- 列表：真实包裹分页，展示运单号、快递公司、采购单号/采购状态、预计商品摘要、预计件数、实际已收件数、物流状态、收货进度与创建时间。
- 查询/筛选：关键词搜索（运单号、快递公司、采购单号、**本包裹预计明细**的 SKU/名称）、物流状态、有无收货记录；可清除筛选。
- 详情弹窗：运单、快递公司、采购单跳转、采购状态、物流状态、收货进度、备注、创建/更新时间，以及逐 SKU 的采购数量、预计数量、本包已收数量。
- 状态处理：骨架屏加载、错误提示 + 重试、区分“筛选无结果”与“尚未登记包裹”、无权限由服务端 403 兜底。
- 数据全部来自数据库与真实 API，无任何写死的包裹、SKU 或库存数据；页面不提供创建/修改/收货入口。

`GET /packages` 是本次为页面新增的只读接口：`page`、`pageSize`、`search`、`purchaseOrderId`、`carrierCode`、`status`、`hasReceipts`，返回与详情一致的 `PackageData`（含预计明细），按 `createdAt DESC, id DESC` 稳定排序，总数与列表均强制 `tenant_id`。任务 14 的四个端点未重写。

## 修改文件

新增：

- `apps/api/src/modules/packages/package.dto.ts` 内 `PackageListQueryDto`：分页、字面搜索、采购单、承运商、物流状态、有无收货筛选；`%`/`_` 由服务端转义。
- `apps/api/src/modules/packages/packages.service.ts` 的 `list()`：租户范围查询、关系筛选、稳定排序、`PageResult`。
- `apps/admin-web/src/api/packages.ts`：生产前端服务，`list`/`detail`/`lookup`，权限前置检查与迟到响应拒绝。
- `apps/admin-web/src/api/package-status.ts`：状态文案、标签色调、预计合计、收货百分比、明细摘要、时间格式化。
- `apps/admin-web/src/composables/packages.ts`：注入认证与商家上下文。
- `apps/admin-web/src/views/PackagesView.vue`：列表、筛选、分页与详情弹窗。
- `apps/admin-web/src/packages.css`：页面样式并在 `main.ts` 引入。
- `scripts/web-packages.test.mjs`、根 `package.json` 的 `test:web-packages` 与 `pnpm test` 入口。
- `docs/WEB_PACKAGES.md`、本报告。

修改：

- `apps/api/src/modules/packages/packages.controller.ts`：新增 `GET /packages`，`@RequirePermissions('packages:read')`、`@ApiPageResponse`。
- `apps/api/src/modules/packages/packages.service.ts`：预计明细排序由 `purchaseOrderItemId` 改为采购行号 `lineNo` + ID，输出可复现（详见“测试过程修正”）。
- `apps/admin-web/src/router/policy.ts`：`/packages` 权限改为 `packages:read`，移除“待开放”；
  `router/index.ts`：映射 `/packages` 到新页面；`main.ts`：引入 `packages.css`。
- `README.md`、`CHANGELOG.md`、`docs/API_SPEC.md`、`docs/PACKAGES.md`、`docs/ARCHITECTURE.md`、`docs/CODEX_TASKS.md`、`docs/DECISIONS.md`（ADR-022）。

未新增数据库迁移、依赖或锁文件变更，未导入参考 SQL。

## 页面与 API 调用关系

| 页面动作 | 前端 | 后端 |
| --- | --- | --- |
| 进入页面 / 翻页 / 搜索 / 筛选 / 重试 | `api.list(query)` | `GET /api/v1/packages` |
| 点击“详情” | `api.detail(id)` | `GET /api/v1/packages/{id}` |
| 点击采购单号 | Vue Router | `GET /api/v1/purchase-orders/{id}`（既有页面） |

统一客户端负责 Bearer、`X-Tenant-Id`、过期自动刷新、15 秒超时与标准错误；服务层在请求前检查 `packages:read`，响应后核对 `userId`/`sessionKey`/`tenantId`，变化则以 `SCOPE_CHANGED` 丢弃迟到结果，并校验返回行 `tenantId` 与当前商家一致。服务端 Guard 与租户事务仍是最终授权依据。

## 实际测试

| 执行 | 结果 |
| --- | --- |
| 首轮 `pnpm test:web-packages` | 11 通过 / 5 失败（见“测试过程修正”） |
| 修正后 `pnpm test:web-packages` | **16 通过，0 失败** |
| 再复跑 `pnpm test:web-packages` | **16 通过，0 失败**（确认排序稳定） |
| `pnpm test:packages`（任务 14 回归） | **32 通过，0 失败** |
| `pnpm typecheck` | API、Web、uni-app、共享包全部通过 |
| `pnpm lint` | 通过，0 警告 |
| `pnpm format:check` | 通过 |
| `pnpm test`（全仓） | **438 通过，0 失败/取消/跳过**，构建 API/Web/uni-app H5/共享包成功，耗时约 5 分 18 秒 |
| 真实构建探针（`API_PORT=3100 node apps/api/dist/main.js`） | health 200；`/api/docs-json` 中 `/api/v1/packages` 仅有 `get`，参数含 `X-Tenant-Id,page,pageSize,search,purchaseOrderId,carrierCode,status,hasReceipts`，security 为 `bearer+tenant`；未携带令牌请求返回 401 |

专项测试在真实本机 PostgreSQL 创建随机空隔离库、执行全部六个迁移、启动真实 Nest API，并直接把生产前端 `api/packages.ts`、`api/package-status.ts` 编译后运行。覆盖：

- **真实数据**：两包裹（ZTO `000PACKAGE-01` 计划 A=6/B=5，SF `000PACKAGE-02` 计划 A=4），断言列表字段、采购单号/状态、仓库、`receivingStatus=NOT_RECEIVED`、预计明细 SKU/名称/单位，并用 SQL 统计确认库中确实 2 行，非 Mock。
- **搜索**：运单号子串、SKU 大小写不敏感、采购单号、`%` 通配符按字面处理、无匹配返回空。
- **筛选**：采购单、承运商（小写输入转大写后匹配）、物流状态、有无收货记录、组合筛选。
- **分页**：`pageSize=1` 两页各 1 条、总数稳定、越界页为空。
- **详情**：与列表同一真实对象、备注可见、预计合计与收货比例（0%）。
- **角色**：VIEWER 可列表/详情但备注为 `null`、lookup 被服务层与 API 双重拒绝（403）、跨商家头 403；WAREHOUSE/BUYER lookup 正常且未知运单返回空数组。
- **租户隔离**：另一商家列表为 0（含按本单 ID 过滤）、跨商家详情 404。
- **迟到响应**：商家、账号、会话任一变化均以 `SCOPE_CHANGED` 丢弃，列表与详情都覆盖。
- **错误处理**：网络失败抛出可识别错误后重试成功；无商家上下文返回 403；非法 `page/pageSize/status/hasReceipts/purchaseOrderId/carrierCode` 返回 400 `VALIDATION_ERROR`。
- **收货联动**：隔离库 SQL 夹具写入 1 张收货单（A=3），`hasReceipts` 双向筛选正确，详情变为 `PARTIAL_RECEIVED`、已收 3、本行已收 3、进度 27%。
- **OpenAPI**：`/api/v1/packages` 仅有 `get`，`/api/v1/packages/{id}`、`/api/v1/packages/lookup` 仍存在。
- **展示辅助函数**：合计、百分比边界（无计划 0、超收上限 100）、摘要、时间格式化与状态文案。

### 测试过程修正

1. **搜索范围错误**：首版按整张采购单的 SKU 匹配，导致不含该商品的同单包裹也命中（预期 1 实得 2）。改为只匹配本包裹预计明细后通过。
2. **明细顺序不可复现**：`packageExpectedItems` 原按 `purchaseOrderItemId`（UUID）排序，UUID 顺序随数据变化，首轮与复跑结果不一致。改为按采购行号 `lineNo` 再按 ID 排序；这是真实缺陷，已同步写入 ADR-022，并用任务 14 的 32 项测试回归确认未破坏既有行为。
3. **测试自身隔离缺陷**：迟到响应用例中，第一次调用把 `scope` 改成新商家后未复位，第二次调用从已变更的 `scope` 开始，使“变更”幂等而不再触发 `SCOPE_CHANGED`。改为每次断言前重建 `scope` 与客户端。

日志保存在被忽略的 `test-results/task-15-web-packages-initial.log`（首轮失败）、`-final.log`、`-rerun.log`、`task-15-packages-regression.log`、`task-15-full-tests.log`。

### 数据与环境保护

- 测试前后开发库计数一致：6 商家、10 用户、9 商品、9 仓库、2 采购单、0 包裹、0 收货单；未在开发库注入测试数据。
- 测试结束 `SELECT count(*) FROM pg_database WHERE datname LIKE 'caicang_test_%'` 为 0，无残留测试库。
- 未执行 `down -v`、未重放 `database/schema.sql`、未修改 `.env`、未变更迁移。

## 未完成与未验证

- **端口 3000 存在任务开始前启动的旧 API 进程**：其 OpenAPI 不含 `GET /api/v1/packages`，说明进程仍在运行旧构建。使用新列表接口前需在该终端停止并重新执行 `pnpm start:api`。本次没有终止该进程，而是在 3100 端口用本次构建独立验证了端点。
- **未做浏览器点击验收**：本轮通过生产前端服务 + 真实 API + 真实 PostgreSQL 验证了数据与交互逻辑，并用 `vue-tsc`、生产构建和全仓测试验证页面可编译；但没有在浏览器中登录后逐项点击该页面。原因是开发库当前没有包裹数据，若要点击验收需向开发库创建测试商家与数据，故未擅自写入。
- 包裹创建/修改的 Web 表单、页面内扫码查询入口未实现；本页面只读。
- 正式收货入库、库存余额/流水、出库与报表仍为后续任务；页面不展示任何模拟库存。
- Android 真机扫码不在本任务范围。
- 未执行 `git commit` / `git push`，等待确认。

## Git 状态

分支 `feat/task-14`，基线提交 `1b99f47`，改动尚未提交。

```text
 M CHANGELOG.md
 M README.md
 M apps/admin-web/src/main.ts
 M apps/admin-web/src/router/index.ts
 M apps/admin-web/src/router/policy.ts
 M apps/api/src/modules/packages/package.dto.ts
 M apps/api/src/modules/packages/packages.controller.ts
 M apps/api/src/modules/packages/packages.service.ts
 M docs/API_SPEC.md
 M docs/ARCHITECTURE.md
 M docs/CODEX_TASKS.md
 M docs/DECISIONS.md
 M docs/PACKAGES.md
 M package.json
?? apps/admin-web/src/api/package-status.ts
?? apps/admin-web/src/api/packages.ts
?? apps/admin-web/src/composables/packages.ts
?? apps/admin-web/src/packages.css
?? apps/admin-web/src/views/PackagesView.vue
?? docs/WEB_PACKAGES.md
?? docs/TASK_15_REPORT.md
?? scripts/web-packages.test.mjs
```
