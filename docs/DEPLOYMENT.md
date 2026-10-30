# Windows 开发、Android APK 与 Linux 正式部署指南

> 任务35最新入口：[生产部署、备份恢复与排障](PRODUCTION_DEPLOYMENT.md)、[安全审计](SECURITY_AUDIT.md)、[实际验收报告](TASK_35_REPORT.md)。已新增独立生产镜像和Compose，默认不开放公网；下文任务01及旧方案为历史记录，不能据此覆盖开发.env或重复导入SQL。

> 当前已有API、Web、手机业务、10个迁移、独立生产配置与备份恢复脚本。任务36复核结果见 [TASK_36_REPORT.md](TASK_36_REPORT.md)。以下按日期保留的早期搭建说明属于历史规划，不能代替最新生产步骤。

## 任务 01 当前可执行范围（2026-10-14）

开发骨架已建立。当前从项目根执行 `pnpm install --frozen-lockfile`、`pnpm db:up`、`pnpm prisma:generate`、`pnpm build:shared`、`pnpm dev`，详情和实际验证记录见 README 与 `TASK_01_REPORT.md`。

任务01时尚未提供的迁移、seed、Android测试包和生产准备现已分别交付，实际范围以任务33—36报告为准。不要将参考SQL导入已经使用迁移的数据库，不需要重新迁移Docker数据。正式公网和正式Android发布仍未执行。

## 1. Windows 准备

推荐 Windows 11 + WSL2 + Docker Desktop + Git + VS Code/Codex + Node.js 当前兼容的 LTS + pnpm + HBuilderX。电脑磁盘空间不足可将工作区放在 D 盘；具体安装路径遵守软件安装器/官方指引，不能擅自移动 App 私有目录。

PowerShell（管理员，首次设置 WSL）：

```powershell
wsl --install
wsl --update
wsl --version
```

重启后安装/启动 Docker Desktop，选择 WSL2 backend，在终端验证：

```powershell
docker version
docker compose version
node -v
corepack enable
pnpm -v
git --version
```

NestJS 当前官方 Node 要求应按安装当日文档核对；Windows 可用 Node 当前 Active LTS 且确保 NestJS CLI 所需最低 patch。参阅：https://docs.nestjs.com/first-steps 。Docker Windows 条件见：https://docs.docker.com/desktop/setup/install/windows-install/ 。

## 2. 初始化项目（Codex Task 01 完成后）

在 `D:\Dev\caicang-manager` （可更换为其他盘）放置生成代码，项目根执行：

```powershell
cd D:\Dev\caicang-manager
pnpm install --frozen-lockfile
Copy-Item .env.example .env
# 编辑 .env 的数据库密码、JWT 密钥；仅用于本地测试
# 以下文件/脚本是目标代码仓应生成的，不是当前资料包已实现的脚本
docker compose -f scripts/compose.dev.yml up -d
pnpm --filter @caicang/api prisma:generate
pnpm --filter @caicang/api prisma:migrate:dev
pnpm --filter @caicang/api db:seed
pnpm --filter @caicang/api dev
```

另开 PowerShell：

```powershell
pnpm --filter @caicang/admin-web dev
```

计划默认地址：API `http://localhost:3000/api/v1`、Swagger `http://localhost:3000/api/docs`、Web `http://localhost:5173`、PostgreSQL `localhost:5432`。这些是**建议配置**，以 Codex 项目生成的实际脚本为准。不要把 `.env` 提交 Git。

如暂时只想验证本资料包数据库 SQL，执行：

```powershell
docker compose --env-file .env -f scripts/compose.dev.yml up -d
# 如果第一次创建空数据库，并且未运行 Prisma migrations:
Get-Content -Raw .\database\schema.sql | docker exec -i caicang-postgres psql -U caicang -d caicang
```

不要在同一个数据库里**既**执行 `schema.sql`，**又**重放同样的 Prisma 初始迁移；两者只选一种。Codex 实际工程应以迁移方案为准。SQL 不提供初始化示例用户，用户数据由注册/seed 管理。

## 3. Android 真机调试

1. Windows 安装官方 HBuilderX，打开 `apps/mobile` 目录，确保包含 `manifest.json`、`pages.json`、`App.vue`。
2. 手机打开开发者选项和 USB 调试，使用 USB 连接；或使用局域网联调（同 Wi-Fi）。
3. HBuilderX 选择运行到 Android 设备/标准基座；验证应用能启动且能登录。
4. 手机上 `localhost` 指向手机自己，**不能**用作电脑 API 地址。开发调试可把 `VITE_API_BASE_URL` 类配置指向 `http://<电脑局域网IPv4>:3000/api/v1`；确认 Windows 防火墙允许开发端口，NestJS 监听局域网需要绑定 `0.0.0.0`；仅在受信任网络临时允许 HTTP 开发请求，必要时配置 Android cleartext 测试许可。
5. 正式 APK 必须指向公网 HTTPS API，不携带测试数据库密码，不应允许任意 HTTP 明文网络。
6. 打开 `manifest.json` 检查相机/扫码模块与应用标识，HBuilderX 发行 → 原生 App 云打包 → Android，按官方流程生成**签名** APK。保护好签名密钥及口令，并保存到安全位置。Windows 上的 uni-app Android 安心打包可参考：https://uniapp.dcloud.net.cn/tutorial/build/SafePack 。
7. 向安卓手机安装测试 APK；测试 CAMERA 授权、扫码、弱网、连续收货、出库、手工输入、退出登录和升级安装。

说明：HBuilderX 具体菜单/签名及发行选项可能随版本变化，Codex 必须以实际安装版本核对；APK 生成不是通过 `npm run build` 自动等价完成。

## 4. 生产 Linux 服务器

建议 Ubuntu LTS + Docker Engine + Docker Compose Plugin + 域名 + TLS（Caddy 或 Nginx+证书），部署为：Caddy/TLS → Web 静态资源与 Nest API → PostgreSQL 私网；不要把 DB 5432 暴露到公网。

正式上线最低 checklist：

1. 域名 DNS 指向服务器，证书有效且自动续期。
2. `NODE_ENV=production`，强随机 JWT 密钥、数据库密码，环境变量只在服务器注入。
3. API 与 Web 镜像以 Git commit/tag 固定；构建时运行 lint/test/build。
4. `prisma migrate deploy` 在生产发布流程执行，事前备份，禁止生产 `prisma migrate dev` 或 `db push`。
5. CORS 只允许 Web 管理端域名；对登录做限流；敏感信息不进入日志。
6. PostgreSQL 定期 `pg_dump` 自动备份，异地保存，加密并每月抽样恢复演练；定义恢复点/恢复时间目标。
7. 监控：健康检查、CPU/内存、磁盘、数据库容量、API 5xx、慢请求、备份失败告警。
8. 移动 App 的生产 API 地址必须 HTTPS，后端经反代映射并可被手机公网访问。
9. 建立回滚方案：旧镜像回滚 + 迁移兼容策略；数据库不可随意做破坏性回滚。

## 5. 不要做的事

- 不要用开发电脑长期承载正式多商家业务。
- 不要将服务端 JWT 秘钥、DB 密码、APK 签名密钥打包进客户端。
- 不要为减少开发时间关闭跨租户权限判断或库存事务检查。
- 不要使用硬编码公网 IP 做正式手机端 API；应该由 HTTPS 域名和应用环境区分。
- 不要把 H5 网页通过一个浏览器窗口当作完成了 Android 扫码 App。

## 6. 官方参考

- Docker Windows 安装：https://docs.docker.com/desktop/setup/install/windows-install/
- NestJS 入门与 Node 前置条件：https://docs.nestjs.com/first-steps
- Prisma 7 PostgreSQL driver adapter：https://www.prisma.io/docs/orm/v7/prisma-client/setup-and-configuration/introduction
- uni-app 扫码平台兼容：https://uniapp.dcloud.net.cn/api/system/barcode
- uni-app HBuilderX App 发行：https://uniapp.dcloud.net.cn/quickstart-hx.html
- uni-app 安心打包：https://uniapp.dcloud.net.cn/tutorial/build/SafePack
