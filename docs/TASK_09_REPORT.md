# 任务 09：仓库管理 API 验收

日期：2026-10-20（Asia/Shanghai）。项目 D:\Dev\caicang-manager；基线 b647a38；分支 feat/task-09。

## 已实现

- GET /api/v1/warehouses：真实数据库分页列表，全部五种 active 角色可读；行和总数均按 tenantId 隔离，包含默认与历史停用仓库，按 createdAt DESC/id DESC 稳定排序。
- POST /api/v1/warehouses：仅 OWNER/ADMIN，输入 name、code、remark，返回服务器生成的 UUID、商家 ID、名称、编码、备注、启用状态及创建/更新时间。显式选择输出字段，不读取/返回完整地址。
- 同商家编码唯一，包含 DEFAULT 与停用仓库编码；跨商家可同码。唯一冲突统一 409 WAREHOUSE_CODE_ALREADY_EXISTS。沿用真实数据库唯一约束，不以预查询替代并发保护。
- 沿用全局身份/商家/角色 Guard、Decorator 和服务端 Tenant Context；租户行锁后重新验证成员与角色。创建与 WAREHOUSE_CREATED 审计同事务，失败回滚，审计不复制任意名称/备注/地址。
- 创建商家的既有事务继续自动建立 OWNER 和 DEFAULT/默认仓库。采购单仓库非空及同租户复合外键、商家+仓库+SKU 库存唯一键、历史关联 Restrict 均沿用并实际验证。不开放仓库删除/修改、调拨或库存 CRUD。

## 数据与迁移

Prisma 7.10.0 的 schema diff 生成 `20261020090000_warehouse_remark`，追加事务与 ck_warehouse_remark_length，新增 nullable remark TEXT（2000 字符）。开发库已实际部署第五个迁移，原有仓库备注均 null。旧迁移、参考 database/schema.sql 与依赖锁文件保留；不叠加导入 SQL、不 reset 或删除容器/卷。

部署前后比较全部 19 张原有表的行指纹（仓库排除本次新增列），包括原地址和时间戳；确认完全相同。原 6 用户、2 商家、7 成员关系、4 仓库、6 商品、0 审计保持；其余业务/认证会话表仍为空。.env 与 .env.auth.local 文件哈希未变。五个已应用迁移 checksum 与文件逐一吻合。

## 实际验证

|命令/检查|结果|
|---|---|
|pnpm db:up|既有 Docker Server 29.8.2、PostgreSQL 16.15 容器 healthy，保留命名卷|
|pnpm prisma:validate / prisma:migrate:deploy / prisma:migrate:status|成功，第五个迁移已应用，结构最新|
|pnpm test:warehouses|28 项通过，0 失败/取消/跳过；真实隔离 PostgreSQL、两个生产 AppModule API 进程|
|pnpm test:models|65 项通过，空库五迁移/重复部署/重复与并发 seed/主要约束/无结构漂移|
|pnpm typecheck|API、Web、手机端、共享包与测试代码通过|
|pnpm lint / pnpm format:check|全部通过|
|最终 pnpm test|289 项通过，0 失败/取消/跳过；实际完成 API、Vue Web、uni-app H5、共享包与测试代码构建|
|pnpm start:api / pnpm api:check / 本机 OpenAPI|Windows 脚本启动成功，health 200/database reachable；两个仓库操作、Bearer+tenant 联合安全声明与 SZ-02 示例已核对，未认证 GET/POST 返回标准 401|

专项覆盖默认仓库、创建与字段边界、可空备注、编码大小写/前导零、商家内重复/跨商家同码、五角色、同账号跨商家不同角色、未认证/未加入/停用、稳定分页与 total 隔离、输入身份注入、完整地址不返回、双进程并发唯一冲突、审计原子性、锁后降权/停用、重启持久化、Swagger 与安全日志。

最终回归日志：被 Git 忽略的 `test-results/task-09-final-20261020-f04a8e2b009a4449ad07a6af56457867.log`。289 项包含仓库 28、商品 47、商家权限 65、认证 78、公共基础 65、冒烟 6；专项 28 不重复计数。模型 65 为另外执行的一组测试。全仓测试后重新确认 19 表指纹、本地配置及五个迁移校验和不变，0 个遗留随机测试库。未再次执行 test:db 停启集合，不把旧任务记录冒充本次结果。

采购/库存用例只在本轮拥有的随机隔离库建立 SQL 夹具，验证采购仓库必填、跨商家仓库拒绝、同 SKU 两仓独立余额、库存重复键拒绝和有历史单据/库存的仓库无法物理删除。这些用例不代表采购/入库/出库 API 已开发。自动化清理只删除本轮创建的随机测试库。

处理记录：首轮专项的账号停用用例错误地预期 INVALID_ACCESS_TOKEN；核对现有 AuthService 后修正为标准 401 UNAUTHENTICATED，保持既有认证行为，重跑 28 项全部通过。无业务实现失败遗留。

## 修改文件（26 个）

- 新增仓库模块四文件：apps/api/src/modules/warehouses/warehouse.dto.ts、warehouses.controller.ts、warehouses.service.ts、warehouses.module.ts。
- 数据库两文件：apps/api/prisma/schema.prisma、apps/api/prisma/migrations/20261020090000_warehouse_remark/migration.sql。
- 后端与共享类型四文件：apps/api/src/app.module.ts、apps/api/src/common/errors.ts、apps/api/src/common/tenancy/tenant-policy.ts、packages/api-contract/src/index.ts。
- 测试与命令四文件：package.json、scripts/warehouses.test.mjs、scripts/database-models.test.mjs、scripts/tenancy.test.mjs。
- 文档十二文件：README.md、CHANGELOG.md、docs/API_SPEC.md、ARCHITECTURE.md、BACKEND_FOUNDATION.md、CODEX_TASKS.md、DATABASE_DESIGN.md、DECISIONS.md（ADR-016）、PROJECT_SPEC.md、TENANT_AUTHORIZATION.md、WAREHOUSES.md、本报告。

## Windows 使用与未解决事项

```powershell
cd D:\Dev\caicang-manager
pnpm db:up
pnpm prisma:migrate:deploy
pnpm start:api
```

Swagger：http://localhost:3000/api/docs。登录并创建/选择商家，设置 Bearer 和 X-Tenant-Id，提交 `{"name":"深圳二仓","code":"SZ-02","remark":"小件商品存放区"}`，首次 201、同商家重复 409。完整请求/角色/分页规则见 WAREHOUSES.md。

本任务无已知阻塞或未修复测试失败。交付时 API 与 PostgreSQL 保持运行，代码提交在本地 feat/task-09。采购/库存业务接口、客户端仓库页面和 Android APK 不在本任务范围；未进行生产部署、APK 验收或人工点击 Swagger。未重装任何开发软件、迁移 C 盘用户数据或上传 GitHub。原有限流仍为每进程内存实现。
