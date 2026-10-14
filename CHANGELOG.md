# 更新记录

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
