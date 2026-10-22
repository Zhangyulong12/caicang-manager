# 快递包裹管理页面（任务 15）

## 启动

启动 Docker Desktop 后，在 PowerShell 中执行：

```powershell
cd D:\Dev\caicang-manager
pnpm db:up
pnpm prisma:migrate:deploy
pnpm start:api
```

第二个终端执行 `pnpm dev:web`，打开 http://localhost:5173/packages，登录并选择商家。

本任务不新增迁移、不新增依赖、不改变数据卷；包裹数据来自任务 14 已建立的 `packages` 与 `package_expected_items`。

## 页面能力

- **列表**：按创建时间倒序分页展示当前商家的包裹，默认每页 20 条。
- **筛选**：关键词搜索（运单号、快递公司、采购单号、本包裹预计商品的 SKU/名称）、物流状态、有无收货记录。
- **摘要列**：采购单号与采购状态、商品与预计数量摘要、实际已收数量、物流状态、收货进度、创建时间。
- **详情**：点击“详情”打开弹窗，展示运单、快递公司、采购单跳转、采购状态、物流状态、收货进度、备注、创建/更新时间，以及逐 SKU 的采购数量、预计数量、本包已收数量。
- **跳转**：采购单号可直接进入采购单详情页（`/purchases/{id}`）。
- **状态提示**：加载中显示骨架屏；接口失败显示错误提示与“重试加载”；无数据显示区分“筛选无结果”和“尚未登记包裹”。

页面只读取真实数据，不提供创建、修改包裹或收货入库按钮；这些写操作仍通过 API 或后续任务开放。

## 数据来源与 API 调用

| 页面动作 | 前端调用 | 后端接口 |
| --- | --- | --- |
| 打开页面 / 翻页 / 搜索 / 筛选 / 重试 | `api.list()` | `GET /api/v1/packages` |
| 点击详情 | `api.detail(id)` | `GET /api/v1/packages/{id}` |

`GET /packages` 是本任务新增的只读分页接口：`page`、`pageSize`、`search`、`purchaseOrderId`、`carrierCode`、`status`、`hasReceipts`，返回与详情一致的 `PackageData` 结构，含预计明细。所有查询强制 `tenant_id`，总数与列表同时受限。

前端通过 `apps/admin-web/src/api/packages.ts` 复用统一客户端（Bearer + `X-Tenant-Id`、自动刷新、超时、统一错误）。请求前检查 `packages:read`，响应后核对账号、会话与商家未变化，否则以 `SCOPE_CHANGED` 丢弃迟到结果；列表还会校验返回行的 `tenantId`，异常时按响应异常处理。

## 角色与权限

| 角色 | 列表 | 详情 | 备注 | 运单精确查询（lookup） |
| --- | --- | --- | --- | --- |
| OWNER / ADMIN / BUYER | 可 | 可 | 可见 | 可 |
| WAREHOUSE | 可 | 可 | 可见 | 可 |
| VIEWER | 可 | 可 | 服务端返回 null | 不可（403） |

`packages:read` 是页面权限，导航项同步改为该权限；`packages:lookup` 本页面未使用，扫码流程留待 Android 任务。VIEWER 可浏览列表与详情，但服务端会隐藏自由文本备注。

## 状态语义

- **物流状态**（`status`）：`CREATED` 待发货、`IN_TRANSIT` 运输中、`ARRIVED` 已到达、`EXCEPTION` 物流异常，以及兼容历史数据的 `PARTIAL_RECEIVED` / `RECEIVED`。
- **收货进度**（`receivingStatus`）：`NOT_RECEIVED`、`PARTIAL_RECEIVED`、`RECEIVED`，由真实收货明细与明确完成标记推导。物流 `ARRIVED` 不会自动变成已收货，也不会改变库存。
- 预计数量是采购计划，不是到货承诺；“% 计划到货”仅在没有实际收货时按已收 ÷ 预计展示，无预计明细时显示“无预计明细”。

## 测试

```powershell
pnpm test:web-packages
pnpm typecheck
pnpm lint
pnpm format:check
```

`pnpm test:web-packages` 使用本机 PostgreSQL 创建随机隔离库、执行全部迁移、启动真实 API，并直接编译生产前端 `api/packages.ts` 与 `api/package-status.ts` 后运行。覆盖列表字段与真实性、搜索/筛选/分页、详情、角色差异、跨商家隔离、迟到响应、错误重试、非法参数与 OpenAPI。测试结束只清理本轮创建的库，不影响开发库。

实际执行结果见 [任务 15 报告](TASK_15_REPORT.md)。

## 未完成

- 包裹创建/修改的 Web 表单、Web 扫码查询入口尚未提供。
- 正式收货、库存、出库与报表页面仍为后续任务；页面不展示任何模拟库存或收货数据。
- Android 真机扫码不在本任务范围。
