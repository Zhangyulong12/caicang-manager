# 任务 03：完整数据库模型验收（2026-10-15，Asia/Shanghai）

## 交付范围

本次按用户最新任务 03 实现 17 张表的 Prisma 模型、第一版迁移、开发 seed 和真实 PostgreSQL 验证。没有开发登录、商品/仓库 CRUD、采购、收货或出库接口。`AGENTS.md` 和 `database/schema.sql` 原件保留；没有运行参考 SQL、migrate reset、db push、删除开发库或数据卷。

PostgreSQL 16.15、Prisma CLI/Client/adapter-pg 7.10.0 沿用项目版本；增加 bcryptjs 3.0.3 精确依赖及锁文件。Git 基线为任务 02 的 686269c，本次分支 feat/task-03。

## 模型与约束

- 17 张业务表全部有 UUID 主键与 created_at/updated_at（timestamptz）。`tenants` 是商家根，`users` 是跨商家的全局身份；其余 15 张表均有非空 tenant_id 与商家外键。
- 商家内商品 SKU、可选非空条码、仓库 code、订单号、承运商+运单、采购/出库行商品、库存余额、收货/调整操作 UUID、出库确认 UUID、流水来源有唯一约束。
- 业务关联为包含 tenant_id 的复合外键，使用 Restrict。操作者关联当前商家的 membership；预计行和收货行补充 purchase_order_id，数据库拒绝串单、收货仓库不一致或入库产品与采购行不符。
- 金额 NUMERIC(18,2)，成本 NUMERIC(20,4)。迁移保留参考稿全部 31 个 CHECK，增加空格 SKU 检查，共 32 个 CHECK；库存非负、明细数量正数、折扣不超过行金额、库存流水数量/成本等式和合法状态均由数据库拒绝无效值。
- 保留 12 个查询索引，包括订单状态/时间、平台订单号、快递扫描、采购行、库存商品、流水与审计时间。17 个数据库触发器维护 SQL 更新的 updated_at；Prisma 同时声明 @updatedAt。
- `20261015012323_initial_business_models/migration.sql` 由实际 `prisma migrate dev --name initial_business_models --create-only` 生成，补充 CHECK/触发器并包裹事务，然后使用 migrate deploy 应用。迁移文件由 .gitattributes 固定 LF，便于 Windows/Linux 追踪相同文件内容。

字段差异和多态来源/业务事务边界见 `DATABASE_DESIGN.md` 的任务 03 实施补充，重要决策见 ADR-010。

## Seed 结果

本机 caicang 库实际查询结果：

| 商家 | 成员关系 | 仓库 | 商品 |
| --- | ---: | ---: | ---: |
| 测试商家甲 | 5 | 2 | 3 |
| 测试商家乙 | 2 | 2 | 3 |

全局用户 6 人；VIEWER 同时加入两个商家，因此成员关系合计 7。每商家包含 MAIN/BACKUP 仓库和 DEMO-CUP/DEMO-BAG/DEMO-BOX，两个商家允许使用相同 SKU/条码。业务订单和库存不由 seed 伪造。

seed 使用单事务、advisory lock、固定演示租户/账号 UUID 和自然唯一键 upsert，update 为空。真实验证重复及并发执行不新增重复商家/商品，保留用户 ID、密码哈希、商品 ID、用户手工修改的名称及时间字段。演示邮箱发生其他账号碰撞时拒绝并回滚。

演示用户默认停用。密码默认随机生成并以 bcrypt cost 12 保存，不打印或提供固定密码；可选环境变量 SEED_PASSWORD 仅影响首次创建，限制为 12–72 字节，重复 seed 不重置密码。seed 只允许本地 caicang/专用随机测试库，拒绝 production 模式。此阶段没有登录入口，不称这些账号为已验证登录账号。

## 已执行检查

| 命令/检查 | 实际结果 |
| --- | --- |
| pnpm install --frozen-lockfile | 成功，锁文件安装一致 |
| pnpm prisma:validate / prisma:generate | 成功，17 模型与 Prisma Client 生成有效 |
| pnpm lint | 通过 |
| pnpm format:check | 通过 |
| pnpm typecheck | 公共包、API、Web、手机工程全部通过 |
| pnpm test:models | 65 个测试通过，0 失败/取消/跳过 |
| pnpm test | 全仓 build 成功；真实 API/前端资源冒烟测试 6 通过 |
| pnpm test:db | 数据库停启与 API 503→200、自动重连、容器/卷/集群/环境文件保留，4 通过 |
| pnpm --filter @caicang/mobile build:app | App 编译资源成功；未生成或验证 APK |
| pnpm prisma:migrate:deploy（开发库） | 初始迁移实际成功应用 |
| pnpm db:seed 连续两次（开发库） | 都成功；两商家、六用户、四仓库、六商品无重复 |
| pnpm prisma:migrate:status（开发库） | 退出码 0，Database schema is up to date |
| pnpm db:check / SQL 查询 | 真实 PostgreSQL 16.15；17 张业务表与上述测试数据可查询 |

数据库停启完成后再次查询确认测试基础数据仍为 2 商家、6 用户、7 成员、4 仓库、6 商品；迁移文件 SHA-256 与数据库记录的 checksum 一致。

模型测试在随机独立空库运行，实际执行 deploy 两次、status、Prisma db seed 两次及并发 seed。通过系统目录查验 17 张表、UUID/时间类型、32 个 CHECK、17 个触发器与查询索引；插入所有表的有效记录，再验证无效数据返回 PostgreSQL 23503/23505/23514。验证真实 Decimal 值、事务回滚和两连接并发同 SKU 插入只有一个成功。最后 Prisma migrate diff 退出 0，无模型结构漂移；测试库在 finally 清理，开发库/容器/卷保留。

修复记录：首次静态检查发现未使用变量与格式问题，已删除变量并格式化后通过；扩展测试时误把子测试注册到父上下文造成 180 秒超时，已改用当前子测试上下文，完整重跑 65 项全部通过。失败运行及成功重跑均完成测试库清理，系统目录查询没有残留 caicang_test_* 数据库。

## Windows 操作

```powershell
cd D:\Dev\caicang-manager
pnpm install --frozen-lockfile
pnpm db:up
pnpm prisma:migrate:deploy
pnpm db:seed
pnpm prisma:migrate:status
pnpm test:models
pnpm start:api
```

另开 PowerShell：`pnpm api:check`。停止前台 API 用 Ctrl+C，停止数据库用 `pnpm db:stop`；不删除卷。新迁移开发用 `pnpm prisma:migrate:dev --name 描述` 并审阅迁移，然后明确执行 `pnpm prisma:generate`。

## 修改文件

- `.gitattributes`：固定 Prisma 迁移和模型文件 LF。
- `apps/api/prisma/schema.prisma`：17 模型、字段映射、复合关联、索引。
- `apps/api/prisma/migrations/20261015012323_initial_business_models/migration.sql`：初始建表、约束、触发器与事务。
- `apps/api/prisma/migrations/migration_lock.toml`：Prisma 生成的 provider 锁文件。
- `apps/api/src/database/seed.ts` 与 `scripts/seed.mjs`：可重复运行的真实 Prisma seed。
- `apps/api/prisma.config.ts`：显式 Prisma 7 seed 命令。
- `apps/api/package.json`、`package.json`、`pnpm-lock.yaml`：锁定 bcrypt、seed/测试入口。
- `scripts/database-models.test.mjs`：空库迁移、seed、约束和并发测试。
- `README.md`、`docs/LOCAL_DATABASE.md`、`docs/CODEX_TASKS.md`、`docs/DATABASE_DESIGN.md`、`docs/DECISIONS.md`、`CHANGELOG.md`、本报告：当前操作命令、范围、差异与实际验证记录。

## 未解决问题与后续范围

本任务数据库模型与验收没有阻塞。权限角色/激活判断、总量超收限制、状态机、余额与流水原子一致性及多态来源校验需要后续业务服务实现；本阶段的数据库约束测试不冒充这些业务已完成。Android 未生成/安装签名 APK，也未进行真机验收。
