# 更新记录

## 2026-10-17 — 用户任务 06：Token 刷新与安全退出

- 新增 refresh/logout，登录同时签发 256 位随机 Refresh Token，数据库只保存 SHA-256 哈希。
- 新增追踪会话/凭据迁移；会话行锁保障跨 API 实例的轮换、重复刷新撤销及退出事务安全，Access JWT sid 支持服务端撤销。
- 保留生产签名密钥强制校验；补充刷新寿命校验、敏感限流、禁止缓存、Swagger/API 契约与真实数据库测试。

## 2026-10-15 — 用户任务 05：注册与登录

- 新增真实邮箱注册、bcrypt 密码验证、短期 JWT 登录和受保护 /me，默认身份守卫及共享 PrismaModule。
- 增加规范化邮箱表达式唯一索引，防止大小写/空格和并发重复；保留已有邮箱原文与用户数据。
- 增加开发签名密钥安全初始化与生产校验、Swagger 示例及真实 PostgreSQL 认证/输入/并发/Token 测试；不提前实现商家权限或 refresh/logout。

## 2026-10-15 — 用户任务 04：后端公共基础模块

- 集中 bootstrap 与全局 CommonModule，统一 DTO、成功/分页响应、错误码、异常和请求追踪；健康路由改为只返回真实数据库检查数据。
- 新增配置校验、精确 CORS、Nest 12 原生安全头、元数据日志白名单与默认/敏感接口限流组件；生产禁用公共 Swagger。
- 补充共享 JSON 契约、OpenAPI 公共规范、独立 HTTP 测试夹具与配置/日志/并发限流测试，不增加业务路由或数据库迁移。

## 2026-10-15 — 用户任务 03：完整数据库模型

- 建立 17 个 Prisma 模型与第一版追踪迁移，采用 UUID、NUMERIC、复合外键和唯一索引，保留参考 SQL。
- 将包裹/收货同订单、同商品、同仓库约束写入数据库；补齐全部表时间字段与 SQL 更新时间触发器。
- 增加本地幂等 seed：两商家、六用户、七成员关系、四仓库、六商品，重复与并发运行保留已有数据。
- 增加独立空库迁移/seed/约束测试与 Windows 操作说明，记录 ADR-010；未开发登录或库存业务接口。

## 2026-10-14～2026-10-15 — 用户任务 02：本地数据库环境

- 保留 PostgreSQL 16.15 命名卷和 Prisma 7.10.0，提供迁移命令入口与 provider 锁文件，不创建业务模型或应用初始 SQL。
- 补充 PowerShell 数据库停止、密码认证检查、API 启动与健康检查脚本，首次 .env 创建采用不覆盖模式。
- 增加真实数据库停启与健康接口恢复测试，共用临时 API 测试启动器；修复 PowerShell SQL 参数传递和测试子进程阻塞问题。
- 追加 Windows 启动说明、任务范围覆盖记录、ADR-009 与任务验收报告。

## 2026-10-14 — 任务 01 清单复核与补齐

- 补充 infra/compose.dev.yml 与说明，引用已有开发数据库定义；验证两套入口解析后的配置相同，并保持同一个持久化数据卷。
- README 保留原内容并追加 infra 与统一启动命令；现有 docs、AGENTS.md、database/schema.sql 保持不变。
- 浏览器验收发现管理端缺少 Element Plus 基础样式，补齐 theme-chalk/base.css；欢迎页和真实连接检查完成复核。
- 重新执行锁文件安装、lint、类型检查、三端构建与已有自动化测试，实际结果见 infra/README.md。

## 2026-10-14 — 环境复查与任务 01

- 确认 Windows 25H2、WSL2、Docker Server 和 hello-world 正常，核实 Docker 数据 VHDX 位于 D 盘。
- 建立精确版本的 pnpm workspace、ESLint/Prettier/TypeScript strict 配置、共享 JSON 契约和纯 TS 工具包。
- 建立 NestJS ESM + Prisma 7 adapter-pg 健康接口与 Swagger，查询真实 PostgreSQL。
- 建立 Vue3/Element Plus 欢迎页和 DCloud uni-app CLI 首页，提供真实服务连接检查。
- 增加 Windows 开发、数据库启动和只读验证脚本；Compose 固定 PostgreSQL 镜像 digest，保留命名卷数据。
- 补充阶段验收脚本和文档。业务数据库模型、登录、多租户和库存功能留待后续任务；Android 工具安装与真机 APK 按用户指令暂缓。

## 2026-10-14 — 任务 00：Windows 开发环境

- 将设计资料复制到 `D:\Dev\caicang-manager`，保留原件，初始化 main 分支。
- 增加 `.gitignore`，验证环境私密配置、依赖、构建缓存和 Android 签名文件被忽略。
- 使用现有 Corepack 提供普通终端可执行的 pnpm 11.25.0，保留现有 Node 和工具安装。
- 增加 `docs/ENV_CHECK.md`，更新 README 和 ADR-007，记录工具实测、缺失项和官方安装步骤。
- Windows 22H2、WSL2 内核、Docker 和 HBuilderX 尚需处理；没有开发业务功能、迁移数据库或验证 APK。
