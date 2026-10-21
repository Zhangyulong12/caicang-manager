# Web 商品与仓库管理（任务 11）

## Windows 启动

启动现有 Docker Desktop，在第一个 PowerShell 终端执行：

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

打开 http://localhost:5173，注册后登录、创建或选择商家。创建商家自动建立 DEFAULT 仓库。已有配置和数据库保留，不执行参考 SQL 或清空数据卷。

## 页面使用

- `/products`：按名称、SKU、条码、规格搜索，按启用状态筛选，10/20/50/100 条分页。输入后点击搜索或回车；失败显示标准错误与 requestId，可重试加载。
- 添加/编辑：名称、SKU、单位必填；规格、条码、参考进货价、备注选填。SKU 最多 80 字，条码最多 128 字，保留大小写和前导零，不限定为纯数字。空条码保存 null；非空 SKU/条码须商家内唯一，服务端 409 显示对应字段错误并保留表单。
- 参考进货价使用非负金额字符串，最多 16 位整数、2 位小数，不进行浮点金额运算。名称 200、规格 200、单位 20、备注 2000 字；最终规则仍以真实 API 为准。
- `/products/{id}`：真实详情与刷新，可打开编辑。编辑参考价不修改历史订单价格；停用保留资料和历史记录。列表停用操作需要确认，可再次启用；停用商品不被扫码 lookup 匹配。
- `/warehouses`：分页显示名称、编码、备注、状态、创建时间；添加仓库名称 100、编码 40、备注 2000 字，重复编码显示字段提示。当前不提供修改、物理删除或调拨入口。

| 角色               | 商品查看 | 商品维护 | 仓库查看/选择个人默认 | 创建仓库 |
| ------------------ | -------- | -------- | --------------------- | -------- |
| OWNER / ADMIN      | 是       | 是       | 是                    | 是       |
| BUYER              | 是       | 是       | 是                    | 否       |
| WAREHOUSE / VIEWER | 是       | 否       | 是                    | 否       |

无权限按钮禁用，catalog 服务拒绝未授权调用，后端独立验证有效账号、商家成员和角色。所有业务请求带当前 X-Tenant-Id；切换账号或商家后，旧响应不能覆盖当前页面。

## 默认业务仓库边界

“设为默认”保存当前账号在当前商家的本浏览器偏好，键为 `caicang.warehouse.<userId>.<tenantId>`，值仅仓库 UUID。所有拥有 warehouses:read 的成员都可以选择自己的偏好。

选择/恢复前通过真实 GET /warehouses 遍历分页，只选择当前商家启用仓库。偏好失效时回退启用的 DEFAULT，再到其他启用仓库；没有可用仓库则为空。不同商家/账号独立，刷新恢复；不跨浏览器或设备同步，不是全商家默认字段，不修改仓库编码、历史订单或库存。未来采购表单需复用并再次验证该偏好。

## 验证命令

```powershell
pnpm test:catalog
pnpm test:web
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
```

test:catalog 转译并运行生产 client.ts、catalog-form.ts、catalog.ts，使用随机隔离的真实 PostgreSQL、迁移和 NestJS HTTP；覆盖表单、保存/重复/并发、搜索分页、持久化、跨商家及角色、默认仓库和失败重试。网络故障与响应延迟是明确注入，其余业务来自真实接口。仅清理该测试创建的随机数据库，不修改开发资料。

Node 测试不是浏览器点击测试；实际浏览器验收和本次构建/回归结果单独记录于 TASK_11_REPORT.md。依赖、API、Prisma schema、五个旧迁移均沿用现有版本。Android APK/真机及采购出入库不属于本任务。
