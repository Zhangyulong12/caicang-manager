# 用户任务 02：本地数据库环境验收报告

执行区间：2026-10-14～2026-10-15（Asia/Shanghai）。工作目录：`D:\Dev\caicang-manager`。分支：`feat/task-02`。

结论：PostgreSQL 开发数据库与 NestJS/Prisma 真实连接正常，健康接口实际返回 HTTP 200。本任务限定为本地数据库环境，不执行原阶段清单中的业务模型、初始迁移或种子数据。

## 1. 已完成与沿用内容

| 用户要求 | 实际交付 |
| --- | --- |
| 兼容的 PostgreSQL | 沿用已固定 digest 的 PostgreSQL 16.15，满足文档的 16+ |
| 持久化 | 命名卷 caicang-manager-dev_caicang_pgdata；Docker 数据 VHDX 在 D 盘 |
| 环境变量示例 | 保留并补充根 .env.example；既有 .env 未覆盖 |
| 密码来自环境变量 | Compose 强制提供 POSTGRES_PASSWORD；API 使用 DATABASE_URL |
| 不靠删除容器清空 | 停止脚本只执行 compose stop，保留容器及卷；没有清空数据命令 |
| 数据库健康检查 | Compose pg_isready；脚本检查 Healthy 并执行密码认证 TCP SQL |
| PrismaService | 沿用已验证的生命周期连接/断开与 PrismaPg adapter |
| Prisma 版本与迁移配置 | CLI/Client/adapter 7.10.0；显式 generator output、ESM、prisma.config.ts URL/migrations.path；补充 provider 锁文件与迁移命令 |
| GET /api/v1/health | 沿用真实 SELECT 1 查询；停库返回 503，恢复后返回 200 |
| PowerShell 操作 | 启动、停止、数据库检查、API 启动与检查脚本；系统 PowerShell 5.1 实测 |

`database/schema.sql`、AGENTS.md、PrismaService 和健康接口源代码没有修改；它们已满足当前要求。没有重新安装或升级已锁定的软件依赖。

## 2. 实际命令与结果

| 命令 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 已运行，通过；lockfile 未改变 |
| `pnpm --filter @caicang/api exec prisma --version` | Prisma 与 Client 7.10.0，Node 22.22.2，TypeScript 5.9.3 |
| `pnpm prisma:validate` | schema valid |
| `pnpm prisma:generate` | 生成 7.10.0 ESM Client 成功 |
| `pnpm lint` / `pnpm format:check` | 已运行，通过 |
| `pnpm typecheck` | API、Web、mobile、两个公共包通过 |
| `pnpm test` | 包含完整 build；公共包、API、Web、mobile H5 构建通过；6 tests / 6 pass / 0 fail |
| `pnpm test:db` | API 真实运行；4 tests / 4 pass / 0 fail，约 17 秒 |
| `pnpm start:api` | PowerShell 脚本实际启动数据库并生成/构建后端，在 3000 启动成功 |
| `pnpm api:check` | 实际 HTTP 200；status=ok，database=reachable，service=caicang-api |
| `pnpm db:check` | pg_isready 接受连接；TCP 密码认证后返回 caicang/caicang/PostgreSQL 16.15 |
| `pnpm db:stop` 与 `pnpm db:up` | 在实际生命周期测试中运行成功，停止后 exited，恢复后 healthy |
| `.ps1` 解析检查 | 0 错误 |
| public 表数量查询 | 0；没有业务表或 _prisma_migrations |
| `pnpm prisma:migrate:status` | 实际退出码 1：No migration found / database is not managed by Prisma Migrate；未标记成功 |

本次健康接口实测示例：

```json
{
  "data": {
    "status": "ok",
    "service": "caicang-api",
    "database": "reachable",
    "timestamp": "2026-10-14T16:00:57.519Z"
  },
  "requestId": "89f11204-8521-4052-b865-a331630ec53e"
}
```

timestamp 是 UTC，对应上海时间 2026-10-15 00:00:57。

## 3. 停启与恢复验证

自动化测试对比重启前后的容器 ID、卷名、PostgreSQL pg_control_system 集群标识与 .env SHA-256：全部一致。容器 ID 仍为 `32b20e6f317b624987d8451a6987a46a09e39bb22021ea8fbc6e5f6371a624a1`，卷保持 `caicang-manager-dev_caicang_pgdata`。

同一 API 进程在数据库停止时返回 503 / DATABASE_UNAVAILABLE，不泄漏连接 URL；数据库恢复 Healthy 后，同一进程再次查询返回 200，无需重启 API。测试不建立探针业务表，不插入或删除业务记录；finally 尝试恢复原本运行的数据库。该测试短暂停止本地数据库，需要与其它依赖此库的测试顺序执行。

## 4. 失败与修复记录

1. 初版密码认证脚本的 SQL 放在多层引号中，系统 PowerShell 5.1 丢失参数内容，虽然退出码 0，但结果没有期望列。改为通过标准输入传入 SQL，重新查询实际返回数据库名、用户和版本，不以初次退出码 0 冒充验收。
2. 初版生命周期测试同步运行耗时的 PowerShell 子进程，阻塞 Node 处理已关闭的 HTTP keep-alive 连接，恢复检查发生 fetch failed。改用异步 execFile，保留原 HTTP 状态/数据断言并重新运行：4 项通过，0 失败。没有以跳过断言或重启 API 掩盖问题。
3. migrate status 报告无迁移历史。已核对空 schema、provider 锁文件与 CLI 配置，当前连接正常且 public 表数量为 0；因用户明确限定环境范围，不执行空初始迁移或参考 SQL 来人为消除状态提示。

## 5. 当前限制

本次数据库/API 验收没有剩余阻塞。迁移历史、业务模型与 seed 尚未建立，需后续明确任务；因此不能声称“初始业务迁移成功”或“业务表已完成”。没有运行 APK 或业务权限、库存并发测试，因为对应功能未实现。

完整 Windows 命令见 `LOCAL_DATABASE.md`。新增迁移命令仅配置入口，未运行 migrate dev/deploy、db push/reset 或 schema.sql。重要范围与持久化决策记录为 ADR-009。

## 6. 修改文件清单（20 个）

```text
.env.example
package.json
apps/api/package.json
apps/api/prisma/schema.prisma
apps/api/prisma/migrations/migration_lock.toml
scripts/db-up.ps1
scripts/db-stop.ps1
scripts/verify-db.ps1
scripts/start-api.ps1
scripts/check-api.ps1
scripts/api-test-server.mjs
scripts/database-lifecycle.test.mjs
scripts/smoke.test.mjs
README.md
infra/README.md
docs/LOCAL_DATABASE.md
docs/TASK_02_REPORT.md
docs/CODEX_TASKS.md
docs/DECISIONS.md
CHANGELOG.md
```

本地 .env、依赖和构建产物不会提交到 Git。
