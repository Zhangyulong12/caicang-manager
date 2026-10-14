# 采仓管家部署配置

任务 01 的本地部署入口是 `compose.dev.yml`，通过 Compose include 引用已有 `scripts/compose.dev.yml`。两者使用相同的项目名 `caicang-manager-dev`、服务与持久化命名卷；数据库镜像版本和 digest 在原定义中统一维护。

任务 02 已补充 `pnpm db:stop`、`pnpm db:check`、`pnpm start:api` 和 `pnpm api:check`。最新环境操作与迁移边界见 [本地数据库指南](../docs/LOCAL_DATABASE.md)。

从项目根目录执行：

```powershell
pnpm db:up
docker compose --env-file .env -f infra/compose.dev.yml config --quiet
docker compose --env-file .env -f infra/compose.dev.yml up -d --wait
docker compose --env-file .env -f infra/compose.dev.yml ps
```

`pnpm db:up` 负责首次生成本地 `.env`。不要输出或提交该文件。`config --quiet` 检查配置而不打印展开后的数据库密码。不要执行 `down -v`，已有数据库卷应保留。

Compose include 需要 2.20.3 或以上版本，本机已有 5.6.0。[Docker 官方说明](https://docs.docker.com/compose/how-tos/multiple-compose-files/include/)。

API 和 Web 的统一启动命令仍为 `pnpm dev`，手机 H5 首页预览使用 `pnpm dev:mobile`。生产镜像、HTTPS 和备份恢复属于后续任务，当前配置仅用于本机开发。

## 任务 01 本次复核结果（2026-10-14）

| 检查 | 实际结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 成功，锁文件没有变化 |
| `pnpm lint` / `pnpm format:check` | 通过 |
| `pnpm typecheck` | 三端和两个公共包通过 |
| `pnpm test` | 包含统一 build；API、Web、mobile H5 构建成功，6 项测试通过、0 失败 |
| `pnpm --filter @caicang/mobile build:app` | App 编译资源成功，没有生成或验证签名 APK |
| `infra/compose.dev.yml` | 配置校验与实际启动成功，PostgreSQL Healthy |
| 新旧 Compose 配置比较 | 展开后的 JSON 模型完全相同，未打印凭证，复用既有数据卷 |
| 欢迎页浏览器检查 | 正常显示；点击检查连接后显示“服务与数据库连接正常” |
| Element Plus 样式修复后复查 | Web 类型检查、构建、lint 和 6 项回归测试通过 |
| 文件保护检查 | 现有 docs、AGENTS.md、database/schema.sql 无修改；README 仅追加说明 |

本次修改文件：`infra/compose.dev.yml`、`infra/README.md`、`README.md`、`apps/admin-web/src/main.ts`、`CHANGELOG.md`。管理端增加 Element Plus 基础主题样式导入，修复浏览器验收发现的卡片、按钮和状态标签样式缺失。

欢迎页截图仅保存在本机 `.cache/task-01-welcome.png`，不提交构建产物或缓存。当前没有任务 01 阻塞项；DCloud appid、HBuilderX 识别、签名和 Android 真机仍待后续阶段验证。原 `docs/TASK_01_REPORT.md` 保留为上次执行记录。
