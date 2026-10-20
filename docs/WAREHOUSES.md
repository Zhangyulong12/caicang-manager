# 仓库 API（任务 09）

日期：2026-10-20。接口前缀 `/api/v1`。使用已有 Bearer Token、唯一 UUID `X-Tenant-Id` 和启用成员关系。

|接口|角色|结果|
|---|---|---|
|GET /warehouses?page=1&pageSize=20|全部五角色|当前商家仓库分页，包含 DEFAULT 默认仓库与历史停用仓库|
|POST /warehouses|OWNER、ADMIN|创建启用仓库，成功 201|

```json
{"name":"深圳二仓","code":"SZ-02","remark":"小件商品存放区"}
```

创建输入只接受 name、code、remark；拒绝 tenantId、id、address、isActive、时间及任意多余字段。name 为 1–100 字符，code 为 1–40 字符，首尾空白去除后不能为空且不允许控制字符；code 保持大小写和前导零，与 PostgreSQL 唯一索引语义一致。remark 可省略、null 或空白（存 null），最多 2000 字符，不允许 NUL。默认启用。

输出字段：id、tenantId、name、code、remark、isActive、createdAt、updatedAt。时间由服务端生成，ISO 字符串；不读取或返回原有完整 address。单个成功响应使用 `{data,requestId}`，列表使用 `{data:[],pagination:{page,pageSize,total},requestId}`。page 默认 1，pageSize 默认 20、最大 100；按 createdAt DESC/id DESC 稳定排序，total 同样限定当前商家。未知 query 字段拒绝。

同商家编码冲突（包括 DEFAULT 及停用仓库占用编码）返回标准 `409 WAREHOUSE_CODE_ALREADY_EXISTS`，不同商家可用同码。重复创建不是更新或幂等成功；数据库唯一键确保并发仅一个成功。创建与 WAREHOUSE_CREATED 审计同事务，记录商家、认证操作者、目标、requestId 和编码，不复制任意名称/备注/地址。服务事务取得租户锁后再次验证成员与权限。

新建商家的现有事务继续自动创建 DEFAULT/默认仓库和 OWNER；GET 仓库接口可以看到它。POST /tenants 的既有 defaultWarehouse 精简响应保持兼容，GET 仓库响应另含 nullable remark。

采购单已有非空 warehouse_id 与 tenant_id 复合外键，库存余额已有 `(tenant_id,warehouse_id,product_id)` 唯一键，历史关联使用 Restrict。当前不开放仓库修改、物理删除、调拨和库存 CRUD；采购/出入库业务接口仍由后续任务实现。

## Windows 启动与验收

```powershell
cd D:\Dev\caicang-manager
pnpm db:up
pnpm prisma:migrate:deploy
pnpm start:api
```

新终端可运行 `pnpm api:check`。打开 http://localhost:3000/api/docs，先注册/登录并 POST /tenants 或选已有商家；Authorize 填 Bearer 与该商家 UUID，再执行上述仓库 POST/GET。再次用同商家 SZ-02 创建应为 409；在第二个有权商家可同码创建，列表只含当前商家。BUYER/WAREHOUSE/VIEWER 创建为 403。

```powershell
pnpm test:warehouses
pnpm test:models
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
```

自动化测试创建随机隔离 PostgreSQL 数据库及真实生产 AppModule API 进程，只清理本轮创建的测试库。采购与库存约束用例使用隔离库 SQL 夹具，不能理解为这些业务 API 已实现。迁移仅通过 Prisma Migrate 部署，不执行参考 database/schema.sql，不 reset 或删除容器/卷。
