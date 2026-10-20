# 任务 08：商品管理 API 验收

实现始于 2026-10-17；继续验收与交付日期：2026-10-20（Asia/Shanghai）。项目 D:\Dev\caicang-manager；基线 c17a339；分支 feat/task-08。

## 已实现

|真实接口|行为|
|---|---|
|GET /api/v1/products|当前商家商品搜索、分页，按启用状态、单位、有无条码组合筛选|
|POST /api/v1/products|创建真实商品；商家内 SKU/非空条码由数据库保证唯一|
|GET /api/v1/products/{id}|当前商家商品详情，包含停用商品；跨商家/未知 ID 统一 404|
|PATCH /api/v1/products/{id}|修改主数据或启停；省略不改，nullable 字段可清空，不写历史采购或库存|
|GET /api/v1/products/lookup?code=|精确 SKU OR barcode 查启用商品，返回 0–2 个候选，不丢前导零、不猜第一个|

完整支持 name、sku、specification、unit、barcode、referencePurchasePrice、isActive、remark。所有接口经 Bearer、X-Tenant-Id、active membership 和角色权限校验。OWNER/ADMIN/BUYER 可写，WAREHOUSE/VIEWER 只读；服务层在租户行锁后重新检查授权，目标查询与修改均限定 tenantId。

- SKU/条码 trim、区分大小写，保留内部字符和前导零。同商家重复 SKU 返回 409 PRODUCT_SKU_ALREADY_EXISTS；非空条码重复返回 409 PRODUCT_BARCODE_ALREADY_EXISTS。不同商家可用完全相同编码。无条码可省略/null/空白，统一保存 null，多行无条码允许。
- 参考价保存为 NUMERIC(18,2)，API 只接收非负十进制字符串或 null，返回固定两位小数字符串；使用 Prisma.Decimal，不使用 JS float 记账、不自动四舍五入多余小数。未知为 null，免费为 "0.00"。
- 列表默认含启用和停用，使用 createdAt DESC/id DESC 稳定分页。search 对名称/SKU/条码/规格做不区分大小写的字面子串搜索，转义 LIKE 的 %、_、反斜线；筛选布尔值严格解析 true/false。
- lookup 保留静态路由优先于 :id；未知/停用商品为空数组，同商品匹配两字段不重复。不同商品 SKU 与条码同值时返回两个候选供选择，不增加跨字段唯一约束、不破坏已有编码。
- 停用不删除，不释放 SKU/条码唯一性。名称、SKU、参考价修改只作用于 products，不更新历史 purchase_orders/purchase_order_items 的价格、折扣、成本或时间，也不修改库存。
- PRODUCT_CREATED/PRODUCT_UPDATED 审计与变更同事务。记录认证操作者、商家、目标、requestId、安全状态及变更字段名，不复制任意备注文本。相同 PATCH 无额外时间变更/审计；并发重复编码由唯一约束处理，失败更新整体回滚。

## 迁移与数据保留

新增 Prisma 追踪迁移 `20261017093000_product_reference_price_remark`，由锁定 Prisma 7.10.0 migrate diff 对比上一提交与当前 schema 生成，再补充事务及 CHECK：

- products 新增可空 reference_purchase_price NUMERIC(18,2)、remark TEXT。
- ck_product_reference_price 拒绝负值及 NaN 等非有限金额；ck_product_remark_length 限制 2000 字符。
- 新增 idx_product_tenant_active_time(tenant_id,is_active,created_at DESC,id DESC)，保留原 SKU/条码唯一索引。

开发库已应用，4 个迁移最新。旧 SQL 迁移、database/schema.sql 原件不改写、不重复执行。迁移前保存原商品旧字段及时间戳的指纹，10-17 迁移后与 10-20 继续验收均确认完全相同；新增两个字段均为 null。现有 6 用户、2 商家、7 成员关系、4 仓库、6 商品、0 审计保持，.env 与 .env.auth.local 哈希未变。

## 实际执行记录

|检查|日期及结果|
|---|---|
|pnpm test:products|10-17：47 项通过，0 失败/取消/跳过|
|pnpm test:models|10-17：65 项通过，空库重放四迁移、重复部署、seed/重复/并发 seed、主要约束及 Prisma 无结构漂移|
|pnpm prisma:validate / prisma:migrate:deploy|10-17：成功，增量迁移已应用|
|pnpm db:up / prisma:migrate:status|10-20：既有 Docker/PostgreSQL 恢复运行，容器 healthy，4 个迁移最新|
|pnpm typecheck|10-20：全仓与 API 测试代码通过|
|pnpm lint / pnpm format:check|10-20：全部通过|
|最终 pnpm test|10-20：261 项通过，0 失败/取消/跳过；实际完成 NestJS API、Vue Web、uni-app H5、共享包与测试代码构建|
|pnpm start:api / pnpm api:check|10-20：Windows 启动脚本成功，健康 200、database reachable；交付时 API/PostgreSQL 保持运行|
|本机 OpenAPI / 测试库清理|10-20：五个商品操作、Bearer+tenant 联合要求、字符串金额、数组响应及 20W 示例均核对；未认证为标准 401，0 个遗留随机测试库|

最终回归输出保存于被 Git 忽略的 `test-results/task-08-final-20261020-ed40328292964243b0957d7a8e783e7e.log`。专项 47 项属于全仓测试集合，不重复计数；未再次运行 test:db，不将旧任务的停启测试冒充本任务执行。

261 项为商品 47、商家权限 65、认证 78、公共基础 65、原有冒烟 6 项。10-20 没有新增业务代码，仅恢复环境、重跑最终验证、复核数据并补齐交付报告；10-17 已实际执行的模型测试按原日期列示。

商品集合使用真实隔离 PostgreSQL 和两个生产 AppModule API 进程，覆盖创建“20W 充电器”/CHARGER-20W、重复 SKU/条码、跨商家同码、越权 ID/角色、金额精度/类型/边界、无条码、多候选 lookup、搜索特殊字符、组合筛选、稳定分页、nullable 清空、停用/重启、并发唯一冲突、无变化 PATCH、审计失败回滚、锁后权限降级与日志脱敏。

历史记录用例在隔离库创建真实采购单与明细（SQL 夹具，不冒充采购 API）。修改商品名称、SKU、参考价并停用/重新启用后，逐字段比较原采购主单及明细，确认 unit_price、discount_amount、landed_unit_cost、关联 ID、创建和更新时间完全不变。验收创建账号与商品均在隔离库，不向开发库植入固定密码测试账号。

处理记录：复核发现公共数组/分页 OpenAPI 继承 data:object 后再约束 data:array 的冲突，已拆出只含 requestId 的基类并增加共享 ApiArrayResponse，运行时响应结构不变，商品测试增加文档断言。10-20 继续时 Docker 未运行，启动既有安装恢复；旧测试进程输出不可读取，因此重跑最终回归，不虚报旧进程成功。

## 修改文件（27 个）

- 新增商品模块四文件：apps/api/src/modules/products/product.dto.ts、products.controller.ts、products.service.ts、products.module.ts。
- 数据库两文件：apps/api/prisma/schema.prisma、apps/api/prisma/migrations/20261017093000_product_reference_price_remark/migration.sql。
- 后端公共与契约：apps/api/src/app.module.ts、apps/api/src/common/api-docs.ts、apps/api/src/common/errors.ts、apps/api/src/common/tenancy/tenant-policy.ts、packages/api-contract/src/index.ts。
- 测试与命令：package.json、scripts/products.test.mjs、scripts/database-models.test.mjs、scripts/tenancy.test.mjs。
- 文档：README.md、CHANGELOG.md、docs/API_SPEC.md、ARCHITECTURE.md、BACKEND_FOUNDATION.md、CODEX_TASKS.md、DATABASE_DESIGN.md、DECISIONS.md、PROJECT_SPEC.md、TENANT_AUTHORIZATION.md、PRODUCTS.md、本报告。

AGENTS.md、参考 schema.sql、旧迁移和 pnpm-lock.yaml 保留；没有升级依赖、重装软件、迁移 C 盘用户数据或清空开发数据卷。

## 使用与未解决事项

```powershell
cd D:\Dev\caicang-manager
pnpm db:up
pnpm prisma:migrate:deploy
pnpm start:api
```

Swagger 为 http://localhost:3000/api/docs。注册/登录后创建或选定商家，以 Bearer+X-Tenant-Id 提交 `{"name":"20W 充电器","sku":"CHARGER-20W","referencePurchasePrice":"18.50"}`；首次成功 201，再次同商家同 SKU 为标准 409。完整 JSON、查询与停用步骤见 PRODUCTS.md，决策见 DECISIONS.md ADR-015。

本任务无已知阻塞或未修复测试失败。采购/库存业务与客户端商品界面不在本次范围；未生成/验证 APK、未部署生产、未宣称人工点击 Swagger。原有限流仍为每进程内存实现。
