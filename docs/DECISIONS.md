# 架构决策记录（ADR）

- ADR-001：业务优先“采购到仓库再出库”，不做买家订单自动同步（首版无需电商平台授权）。
- ADR-002：模块化单体 NestJS，而不是微服务；PostgreSQL 事务保障一致性。
- ADR-003：扫码运单仅定位包裹，必须人工核对入库内容；支持无预计装箱明细的包裹验收后手动完结。
- ADR-004：库存使用移动加权平均成本；价格保存 Decimal，保留采购原始成本快照。
- ADR-005：一个商家多成员，所有业务请求校验 membership/role 与 tenant_id。
- ADR-006：移动端优先 uni-app Android 真机；Web 管理端独立 Vue3。

后续 Codex 如需修改任一决策，应写明变更原因、影响表、API、迁移与新验收测试。

## ADR-007：Windows 工作区与工具准备（2026-10-14，任务 00）

- 工作区采用用户指定的 `D:\Dev\caicang-manager`。从原资料包复制并校验 16 个文件；原目录保留，不迁移 C 盘用户数据。
- 保留可用的 Node 22.22.2 LTS 和 Corepack 0.34.6，不重装。通过 Corepack 启用现有 pnpm 11.25.0 对应的系统命令，实测普通 PowerShell 可以执行。此版本作为环境基线；阶段 01 再在 packageManager 与锁文件中固定项目依赖。
- 使用系统 Windows PowerShell 5.1 作为普通终端基线，不要求将 Codex 私有 PowerShell 7 加入系统 PATH。
- 初始化 main 分支并保存设计与环境快照。Docker、WSL2、HBuilderX 的失败项如实记录，不以已安装 CLI 或默认 WSL 版本代替引擎验证。
- Windows 11 22H2 超出支持期，先通过系统更新进入支持期，再修复 WSL2 和安装 Docker Desktop。不安装旧 Docker 绕过操作系统条件。
- 影响范围：开发工作区、工具配置、Git 忽略规则和环境文档；无数据库变更、API 变更或业务实现。验收依据见 `ENV_CHECK.md`。

## ADR-008：任务 01 工程与版本基线（2026-10-14）

- 保留现有 Node 22.22.2 和 pnpm 11.25.0，使用 pnpm workspace、精确直接依赖和锁文件。后端采用 NestJS 12.1.3 + TypeScript 5.9.3，通过 tsc 编译 ESM 与装饰器元数据，不调用需要更高 Node patch 的新 Nest CLI，不重装 Node。
- Prisma 保持 7.10.0（CLI/client/adapter 同版本），采用 `prisma-client`、显式 output、ESM、prisma.config.ts 数据源 URL 和 adapter-pg。任务 01 仅执行真实数据库健康查询，schema 不增加业务模型，不执行参考 SQL 或迁移；业务模型留待任务 02。
- Web 使用 Vue 3.5.44、Vite 8.3.4、Element Plus 2.14.7。手机工程按 DCloud 官方 CLI 模板的稳定版本 3.0.0-5020420260813003，锁定匹配的 Vue 3.4.21、Vite 5.2.8、DCloud types 3.4.31。pnpm 允许两个客户端各自使用适配的 Vite/Vue；不要强行统一导致 uni-app 编译器不兼容。
- uni-app 使用官方 CLI 布局：`apps/mobile/src` 中放置 App.vue、main.ts、pages.json、manifest.json 与页面。后续 HBuilderX 打开 `apps/mobile` 项目根。此布局细化原目录示意，不改变手机端技术选择。本次验证 H5 与 App 编译资源时不把它们称为签名 APK 或真机验收。
- pnpm 11 的配置放入 pnpm-workspace.yaml，使用 allowBuilds 逐包允许 Prisma/esbuild 构建脚本，明确拒绝非必需统计/募捐脚本；保持 strictPeerDependencies。固定 unplugin-auto-import 的可选 @vueuse/core peer 为兼容 Vue 3.4 的 10.11.1，避免自动选择要求 Vue 3.5 的版本。
- Docker 数据位置已由设置、WSL 注册信息和 D 盘 VHDX 文件共同核实。开发 Compose 将 PostgreSQL 16.15 镜像固定到本次真实拉取的 digest，命名卷持久化，数据库端口仅绑定 127.0.0.1。不删除卷、不初始化业务表。
- 公开健康接口返回 `data`/`requestId` 契约，并实际查询 PostgreSQL；Swagger 位于 `/api/docs`。只提供健康路由，不提前开放未经认证的业务接口。
- 来源：[NestJS 入门](https://docs.nestjs.com/first-steps)、[Prisma 7](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7)、[DCloud CLI 模板](https://github.com/dcloudio/uni-preset-vue/tree/vite-ts)、[pnpm 配置](https://pnpm.io/settings)。

## ADR-009：用户任务 02 的数据库环境范围与停启验证

- 最新用户任务 02 限定为本地数据库环境，优先于原阶段清单中的模型/迁移/种子范围。不添加业务模型、不导入参考 schema.sql、不应用空初始迁移。
- 继续使用 PostgreSQL 16.15 固定 digest、既有命名卷与 Prisma 7.10.0；不重建数据库，不改变已有 .env。新增停止脚本使用 compose stop，保留容器和卷。
- 首次生成 .env 使用 CreateNew 避免并发覆盖；已存在的环境配置不修改。数据库检查通过 TCP 与容器内环境变量进行密码认证，SQL 使用标准输入，避免 Windows PowerShell 5.1 的嵌套引号丢失。
- 提供 migrate dev/deploy/status 命令与 PostgreSQL migration_lock.toml；没有迁移历史时 migrate status 的退出码 1 如实报告，模型任务再初始化迁移，不通过重复应用 SQL 制造成功状态。
- 停启测试比较既有 PostgreSQL 集群标识、容器、卷与 .env 哈希，验证运行中的 API 在数据库停止时返回 503、恢复后返回 200，不写入或删除任何业务数据。测试子进程采用异步执行，避免阻塞 HTTP 连接关闭事件；失败时 finally 尝试恢复原本运行的数据库。
- 影响范围：本地脚本、根命令、迁移目录配置、测试与文档；PrismaService、健康接口和业务数据库结构沿用现状。

## ADR-010：用户任务 03 数据模型与初始迁移（2026-10-15）

- 本次用户任务 03 对应原阶段清单的数据库模型范围；不提前开发登录、基础资料或库存接口。17 张表通过 Prisma 7.10.0 migrate dev --create-only 生成追踪迁移，再补齐 CHECK、数据库时间触发器和显式事务。只用 migrate deploy 应用迁移，不执行参考 schema.sql。
- 维持全局 User 和租户根 Tenant，其余表 tenant_id 非空。业务关联使用 tenant_id 复合外键；操作者引用对应租户 membership。采用 Restrict，避免级联删除历史记录。
- 增加 expected/receipt 行 purchase_order_id 与复合候选键，把同商家不同订单串单、收货仓库不一致和商品错配从服务约定提升为数据库约束。成本快照统一 NUMERIC(20,4)，所有表补齐创建/更新时间。
- 普通 nullable UNIQUE 保留 PostgreSQL NULLS DISTINCT，与参考部分唯一索引有相同的非空唯一语义，不增加预览功能依赖。参考 CHECK 保留，另增加非空格 SKU CHECK。触发器不授予历史单据更新权限；多态流水/审计对象及总量限制留给后续事务服务。
- seed 使用固定演示租户/用户 UUID、自然唯一键 upsert、单事务与事务级 advisory lock；update 为空，保留已有数据、密码与角色。随机未公开密码用固定版本 bcryptjs 3.0.3 的 bcrypt cost 12 哈希；测试账号默认停用。允许可选 SEED_PASSWORD（12–72 字节），但不打印或提交密码。seed 拒绝生产模式和非本地/非指定开发测试数据库。
- 约束测试在同一 PostgreSQL 实例创建随机空数据库，只清理本轮拥有的测试数据库，不 reset 开发库、不删除容器/卷。实际执行迁移两次、seed 两次及并发重试、真实 SQL 正反例与并发唯一性校验；结构 diff 外另查系统目录确保 CHECK/触发器存在。
- 来源：[Prisma 7 seed](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/seeding)、[迁移中管理不支持的数据库特性](https://www.prisma.io/docs/orm/v7/prisma-schema/data-model/unsupported-database-features)。
