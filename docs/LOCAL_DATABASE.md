# Windows 本地数据库与 API 操作指南

本页对应用户当前定义的“任务 02：建立本地数据库环境”。PostgreSQL 16.15、Prisma 7.10.0 已固定；不创建业务模型、不导入 `database/schema.sql`、不自动执行初始迁移。

## 1. 首次启动

先启动 Docker Desktop，确认 Linux Engine Ready。打开 Windows PowerShell：

```powershell
cd D:\Dev\caicang-manager
pnpm install --frozen-lockfile
pnpm db:up
pnpm db:check
pnpm start:api
```

`pnpm start:api` 会检查并启动数据库、生成 Prisma Client、构建公共包和 API，然后在当前终端启动 API。该终端需要保持运行；Ctrl+C 停止 API。无需再手动生成客户端或建立空目录。

数据库端口是 `127.0.0.1:5432`，API 地址是 `http://localhost:3000/api/v1`，Swagger 是 `http://localhost:3000/api/docs`。

## 2. 检查与停止

在另一个 PowerShell 终端检查：

```powershell
cd D:\Dev\caicang-manager
pnpm db:check
pnpm api:check
Invoke-RestMethod http://localhost:3000/api/v1/health
```

正常结果：`data.status=ok`、`data.database=reachable`、`data.service=caicang-api`，包含 ISO 时间戳和 requestId。健康接口执行真实 PostgreSQL 查询；运行中的 API 在数据库停止后返回 503 / `DATABASE_UNAVAILABLE`，数据库恢复后可以重新查询成功。

停止 API：在运行 `pnpm start:api` 的终端按 Ctrl+C。停止数据库：

```powershell
pnpm db:stop
```

停止脚本使用 `docker compose stop`，保留容器和命名卷。再次启动使用 `pnpm db:up`。没有数据清空脚本，不使用删除容器或 `down -v` 清空数据库。

## 3. PowerShell 脚本直接调用

所有脚本兼容系统 Windows PowerShell 5.1，无需安装 PowerShell 7：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/db-up.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/db-stop.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/verify-db.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/start-api.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/check-api.ps1
```

自定义 API 端口时，根 `.env` 设置 `API_PORT`；检查脚本明确传入地址，例如：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/check-api.ps1 -ApiBaseUrl http://localhost:3001/api/v1
```

脚本从自身路径定位项目，不要求通过管理员终端运行。Docker CLI 未被当前进程 PATH 识别时，会尝试本机已有 Docker Desktop 安装目录。不会重装软件或修改系统 PATH。

## 4. 环境配置与持久化

- `.env.example` 是可提交的模板，数据库密码和 URL 均为占位符。
- `pnpm db:up` 仅在 `.env` 不存在时生成随机密码与 DATABASE_URL，使用 CreateNew 防止并发首次启动覆盖已有文件。已有 `.env` 保留，不打印或提交密码。
- Compose 的 `POSTGRES_PASSWORD` 必须由环境变量提供，没有默认弱密码；API/Prisma 从根 `.env` 或当前进程环境读取 DATABASE_URL。
- 对已有数据卷修改 `.env` 的密码不会自动修改 PostgreSQL 的角色密码，不能通过删卷解决认证错误。
- 命名卷是 `caicang-manager-dev_caicang_pgdata`，挂载在容器的 `/var/lib/postgresql/data`。Docker 数据虚拟磁盘在 `D:\docker\DockerDesktopWSL\disk\docker_data.vhdx`。
- `infra/compose.dev.yml` 与 `scripts/compose.dev.yml` 使用同一个项目和命名卷，前者引用后者，无重复数据库定义。
- 检查脚本同时验证容器 Healthy、pg_isready 与带密码的 TCP SQL 查询；不是仅根据“容器存在”判定数据库正常。

## 5. Prisma 配置与迁移边界

CLI、Client、adapter-pg 都是 7.10.0。generator 使用 `prisma-client`、显式输出目录、ESM 与 `.js` 导入后缀；URL 和 migrations.path 放在 `apps/api/prisma.config.ts`，该文件明确加载根 `.env`。PrismaService 使用 `PrismaPg` 驱动适配器，随 Nest 生命周期连接和断开。

可实际执行的无业务写入检查：

```powershell
pnpm prisma:generate
pnpm prisma:validate
pnpm prisma:migrate:status
```

任务 02 时没有业务模型、迁移 SQL 或 `_prisma_migrations` 表，`migrate status` 当时实测退出码 1。**任务 03 已建立并应用初始迁移，当前 migrate status 应成功报告最新状态**；历史结果保留在 TASK_02_REPORT.md，不代表当前状态。

新环境应用已提交迁移并创建测试基础数据：

```powershell
pnpm prisma:migrate:deploy
pnpm db:seed
pnpm prisma:migrate:status
```

`prisma migrate dev` 用于开发新的迁移；`prisma migrate deploy` 用于应用已评审提交的迁移。任务 03 已实际生成并部署业务迁移。不要在同一数据库中重放参考 `schema.sql` 和 Prisma 初始迁移。

Prisma 7 不再由 migrate dev 自动执行 generate/seed，客户端生成须明确执行。依据：[Prisma 7 官方指南](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7)、[Prisma CLI 文档](https://www.prisma.io/docs/orm/v7/reference/prisma-cli-reference)。

## 6. 自动化验证

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm test:db
```

`pnpm test` 构建三端并运行现有冒烟测试。`pnpm test:db` 构建 API，在临时端口启动真实 API，短暂停止和启动本地 PostgreSQL，验证健康接口 503→200、容器 ID/卷名/数据库集群标识一致、`.env` 内容不变。测试有 finally 恢复数据库，不写入或删除业务数据；不要与其它依赖此数据库的测试同时运行。

实际结果和修改清单见 `TASK_02_REPORT.md`。
