# 库存调整 Web（任务 30）

入口为电脑后台「库存管理 → 库存调整」，路径 `/inventory/adjustments`。界面沿用现有 Vue3、Element Plus、统一请求和错误结构，所有记录来自任务 29 的 PostgreSQL/NestJS API。

## 操作与权限

- 列表：单号/SKU/名称搜索，仓库、原因、日期筛选与分页，显示调整前、带符号的差额、调整后、操作人和时间。较窄窗口可横向滚动表格，详情页也显示全部信息。加载失败可重试。
- 创建：`/inventory/adjustments/new`，选择真实仓库与商品；填写正数增加、负数减少的非零整数、原因和备注。盘盈只能正数，盘亏/损坏/丢失只能负数，其他原因必须填写备注。提交前再次确认，提交后立即生效。
- 商品选择器可搜索货号、SKU、颜色、尺码，含停用商品；停用不代表无需核对实物库存。仓库默认使用已有个人业务仓库偏好，否则选列表首个仓库，用户可更换。
- 详情：`/inventory/adjustments/{id}`，只读显示服务器返回的数量、原因、备注、操作人、时间、单位成本和成本池变化，不提供删除或编辑已生效记录。
- OWNER/ADMIN/WAREHOUSE 需要 `inventory:write` 才能创建。BUYER/VIEWER 具有 `products:read` 时可查询；按钮禁用、创建路由拦截，API 仍独立执行角色与商家检查。

页面只向 `POST /inventory/adjustments` 提交 `warehouseId/productId/quantityDelta/reason/remark/clientOperationId`，不会提交最终余额、成本、操作者或商家 ID，不调用余额写接口。表单显示的当前库存是 GET 查询结果，可能并发变化；不在浏览器计算最终余额，提交后的前后数量以服务端事务结果为准。

## 流水追溯

库存流水和 SKU 详情里的调整来源单号，可打开调整详情；原来的入库来源链接保留。调整详情的「查看该商品调整流水」带 `type=ADJUSTMENT`、`productId`、`warehouseId` 打开现有流水页，该页实际将这些条件发给服务端。

该链接查询同仓库、同商品的全部调整流水，用户可按单号回查具体单据；不会在当前分页里偷偷过滤并声称是全部记录。

## 结果不明时的重试

首次提交前将原始允许字段和随机 UUID 写入 `window.sessionStorage`，键包含当前用户和商家。写入失败则不发 POST。账号 Token、数据库凭据和收货地址不进入该存储。

网络断开、响应丢失、5xx 或幂等冲突时，保留原内容与原操作号，锁定表单，只允许「重试确认原调整」。同一标签页刷新后会恢复，按相同操作号发送，服务端返回原单而不重复改变库存。UI 不自动将新数量套到旧操作号，也不自动生成新操作绕过冲突。

服务端明确拒绝（例如校验不通过、库存不足、无权限或资源不存在）后，允许重新编辑，后续合法提交生成新操作号。成功后跳到服务器返回的详情，当前表单不能再次提交。

未确认操作的恢复限同一浏览器标签页的 sessionStorage；关闭标签页、清除存储或换设备后，先查询调整列表核对上次结果，再决定是否创建新操作。此阶段没有跨设备操作恢复接口或审批流。

导航会重新校验商家，商家上下文可能短暂为空，因此表单使用待提交/恢复时校验存储键的方式，不能在组件初始化时断言 `tenants.current!`。上下文缺失时不给默认商家、不发库存写请求。

## 启动和验收

在 `D:\Dev\caicang-manager`：

```powershell
pnpm db:up
pnpm prisma:migrate:deploy
pnpm start:api
```

另一个终端运行 `pnpm dev:web`，打开 `http://127.0.0.1:5173`，登录并选择商家。

对专门的测试 SKU，先通过正常收货得到 10 件，执行盘亏 -2，详情显示 10/-2/8；再执行盘盈 +3，详情显示 8/+3/11。刷新商品库存列表应为 11，调整列表有两张单，流水中有两条对应调整来源。成本按任务 29 规则由后端推导，不能通过这个页面随意改价。

```powershell
pnpm test:web-adjustments
pnpm test:adjustments
pnpm typecheck
pnpm lint
pnpm format:check
```

可选真实浏览器夹具（只写一次性测试库）：

```powershell
$env:TASK30_BROWSER_CHECK = '1'
node --test scripts/web-adjustments.test.mjs
Remove-Item Env:\TASK30_BROWSER_CHECK
```

夹具就绪后在被忽略的 `test-results/task30-browser.json` 给出临时 URL 和专用测试登录信息，不要提交该文件或公开密码。完成 -2/+3、刷新余额与列表、来源链接验证后创建 `test-results/task30-browser.done`；测试会查询真实数据库核对两张调整单、两条流水、最终 11 件和 203.5000 成本池，再关闭临时服务并清理测试库。未创建完成标记或核对失败均算失败。
