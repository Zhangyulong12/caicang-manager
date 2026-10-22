# Web 采购管理（任务 13）

## Windows 启动

先启动 Docker Desktop，在第一个 PowerShell 终端执行：

```powershell
cd D:\Dev\caicang-manager
pnpm install --frozen-lockfile
pnpm db:up
pnpm prisma:migrate:deploy
pnpm start:api
```

第二个终端运行：

```powershell
cd D:\Dev\caicang-manager
pnpm dev:web
```

打开 http://localhost:5173/purchases，登录并选择商家。沿用现有六个迁移，不执行参考 SQL、不清空容器/数据卷、不覆盖环境文件。

## 页面与流程

- 列表 `/purchases`：采购单号、平台订单号搜索，状态与平台组合筛选，10/20/50/100 条分页；金额来自服务器。加载失败清空旧结果，显示错误及 requestId，可重试。
- 新建 `/purchases/new`：采购平台、平台订单号、店铺、日期、目标仓库、完整收货信息、运费及备注。仓库取真实分页接口，默认采用当前账号/商家的个人默认业务仓库偏好。
- 添加 SKU：真实启用商品搜索/分页，不能重复添加同一个商品，每单 1–100 行。单价只在新增行时建议使用参考价，可自行填写实际采购价；重新编辑原单不会套用最新参考价。
- 行数量为正整数；单价、整行优惠和整单运费为非负金额字符串，最多两位小数。行优惠不能超过行原额；缺失或非法金额显示待完善及字段错误，禁止保存。
- 预估采用整数分计算：商品原额 − 行优惠 + 运费。比如 10×18.50 + 5×9.00 − 5.00 + 10.00 = 235.00。最终金额、运费分摊与单位到仓成本均以服务器结果为准。
- 保存先建立 DRAFT，详情 `/purchases/:id` 展示服务器原始明细；可进入 `/purchases/:id/edit` 修改草稿。确认下单有提示，成功后价格/数量冻结、编辑按钮禁用，显示服务器分摊。
- DRAFT/PLACED 且没有已收数量时显示取消能力；服务端还会检查任何收货记录等条件，拒绝时显示标准错误和刷新提示。取消保留主单和明细，不删除历史。其他状态仅展示。
- 未保存离开有确认；保存中阻止离开和重复提交。收货信息不写 localStorage，刷新未保存页面会丢失输入；已保存记录可随时重新查询。

## 权限与重试

OWNER/ADMIN/BUYER 可新建、编辑、确认及取消，WAREHOUSE/VIEWER 只读。路由、按钮及采购服务检查 purchase:read/write，服务端 Guard 与租户事务最终判定。VIEWER 的收货信息由服务器隐藏；前端直接展示脱敏结果。账号、会话或商家变化后拒绝旧响应，避免旧数据进入新工作空间。

新建表单生成稳定采购单号，网络失败后保留该号码。若提交结果不确定，先用“按当前采购单号查询已保存订单”确认；不要换新号重复创建。409 重码显示错误，不自动覆盖或确认已有订单。对于敏感收货数据，表单仅保留在页面内存。

## 验证

```powershell
pnpm test:web-purchases
pnpm test:web
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
```

自动化测试编译生产表单、请求客户端与采购服务，连接同一 PostgreSQL 实例的随机隔离数据库并执行完整迁移；只清理本轮拥有的测试库，不修改日常开发库。浏览器另行验证真实 Vue 页面，结果见 TASK_13_REPORT.md。
