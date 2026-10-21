# 任务 10：Web 登录与主布局验收

2026-10-21（Asia/Shanghai），D:\Dev\caicang-manager；基线 bd2a26e；分支 feat/task-10。

## 已完成

- Vue3 + Element Plus 登录/注册页，真实邮箱密码接口、密码确认与基础输入校验、重复提交保护、失败提示；注册后使用同一新账号登录，无假账号或固定 Token。
- Pinia 认证状态、真实 /me 恢复、统一请求客户端、到期前/401 后刷新、Web Locks 同源多标签串行轮换、storage 同步退出/换账号。迟到请求不能恢复旧会话；网络不确定时不重放旧 Refresh Token。
- 真正的服务端退出，失败不虚报成功；同源其他标签同步退出，退出后受保护 URL 重定向登录。
- 本人商家分页选择、首次创建商家与默认仓库引导、切换上下文、按账号保存商家偏好。新增 GET /api/v1/tenants 只返回认证用户本人的有效成员关系，拒绝客户端身份查询注入。
- 深色左侧导航、浅色工作台、顶部账号与角色信息、全局请求加载、错误提示、连接异常重试、403/404 和路由权限。系统设置需 members:read，普通成员不能靠直输路径进入。
- 九个菜单齐全：首页、商品管理、采购管理、快递包裹、入库记录、库存管理、出库管理、数据统计、系统设置。商品/未来业务管理页面明确待开放，没有模拟订单/库存；首页商品、仓库数量使用真实 API total。

## 实际执行结果

|检查|结果|
|---|---|
|依赖安装及 pnpm install --frozen-lockfile|成功；新增 Vue Router 4.6.4、Pinia 3.0.4、icons 2.3.2 精确版本，其他框架沿用|
|pnpm db:up / prisma:migrate:status|Docker Server 29.8.2、PostgreSQL 16.15 healthy；五个迁移最新，无新迁移|
|pnpm test:web|25 项通过，0 失败/取消/跳过；生产客户端 + 真实随机 PostgreSQL/HTTP|
|pnpm typecheck / lint / format:check|全仓及测试代码通过|
|最终 pnpm test|314 项通过，0 失败/取消/跳过；API、Web、uni-app H5、共享包与测试代码实际构建成功|
|pnpm start:api / api:check|Windows 脚本成功启动；health 200，database reachable|
|pnpm dev:web|5173 正常运行，http://localhost:5173 实际 200|
|原数据与配置复核|19 张原表中的既有行逐条 ID/内容指纹不变，本地 .env/JWT 密钥及五个迁移校验和不变；0 遗留随机测试库|

最终回归日志保存在被 Git 忽略的 `test-results/task-10-final-20261021-4ad8b923b4fb4c0d918134ef8d2dc957.log`。314 = 原 289 + Web 25，专项不重复计数。无数据库结构变化，未再次执行独立 test:models 或 test:db 停启集合，不把旧结果作为本次执行。

Web 集成测试直接转译运行生产 client.ts/policy.ts；使用真实注册、登录、刷新、退出、商家创建及发现、当前成员鉴权，不复制客户端实现。锁调度器和网络故障为明确的测试注入，业务数据/认证来自真实 API。覆盖双客户端只刷新一次、退出/换账号迟到响应、刷新响应丢失不重放、退出网络失败可重试、撤销凭据恢复失败、损坏存储、加载计数、跳转白名单及路由权限策略。

实际等待 61 秒，使 API 签发的 60 秒 Access Token 真正过期，先确认原 Token 401 INVALID_ACCESS_TOKEN，再以五个并发请求验证一次刷新后恢复。只修改测试中的本地到期提示以强制走 401 分支，未修改真实 Token 内容或伪造登录。

## 浏览器实际验收

使用 computer-use 在 http://localhost:5173 完成，非 Node 测试计数：

1. 从“立即注册”填写新邮箱、显示名和随机强密码；真实注册成功回到登录页。
2. 使用刚注册的账号登录，进入商家选择，真实商家数为 0；创建“青禾数码 · Web 验收”，进入后台，商品 0、默认仓库 1。
3. 刷新页面成功恢复身份和商家；再创建“青禾数码 · 第二工作空间”，通过商家选择切回首个商家，核对名称和数据范围。
4. OWNER 可打开系统设置，显示服务端实际商家、账号、角色与权限。九个导航均可见，未开发模块明确待开放。
5. 打开第二标签页，首标签通过用户菜单退出，两标签均回到登录。直接访问 /settings 被拦截到 /login?redirect=/settings。
6. 错误密码显示真实“邮箱或密码不正确”及 requestId；随后正确登录回跳设置页。最后返回工作台保存画面，再退出，登录页保持可供用户注册/使用。

本地证明截图（忽略、不提交 Git）：`test-results/task-10-dashboard.png`、`test-results/task-10-login.png`。浏览器保留登录页；API 与 Web 保持运行。

本次浏览器验收只新增一个测试账号（仓储验收员，邮箱前缀 web-acceptance-20261021-）和上述两个测试商家、对应默认仓库，不删除任何项目数据。开发库总计 7 用户、4 商家、6 仓库；原 6 用户/2 商家/4 仓库/6 商品均原样保留。两个真实登录会话均已服务端撤销，随机密码未写入文件或报告，截图中无密码/Token。

## 修改文件（40 个）

- Web 原文件六个：apps/admin-web/.env.example、package.json、src/App.vue、src/main.ts、vite.config.ts，以及根 pnpm-lock.yaml。
- Web 新增十八个：src/api/client.ts；components/BrandMark.vue、UserMenu.vue；layouts/MainLayout.vue；router/index.ts、policy.ts；stores/auth.ts、tenant.ts；style.css；utils/feedback.ts；views/AuthView.vue、TenantView.vue、HomeView.vue、ModuleView.vue、SettingsView.vue、ConnectionView.vue、ForbiddenView.vue、NotFoundView.vue（均在 apps/admin-web）。
- API/共享四个：apps/api/src/modules/tenants/tenant.dto.ts、tenants.controller.ts、tenants.service.ts；packages/api-contract/src/index.ts。
- 根命令/测试两个：package.json、scripts/web-session.test.mjs。
- 文档十个：README.md、CHANGELOG.md、docs/API_SPEC.md、ARCHITECTURE.md、AUTHENTICATION.md、CODEX_TASKS.md、DECISIONS.md（ADR-017）、TENANT_AUTHORIZATION.md、WEB_AUTHENTICATION.md、本报告。

AGENTS.md、database/schema.sql、Prisma schema/旧迁移及本地配置均保留。不重装开发工具、不迁移 C 盘数据、不提前开发采购/库存/出库业务。

## 修复及限制

初次类型检查发现 randomUUID 默认参数推断过窄与 Web Locks Promise 泛型展开问题，已增加显式类型/await；Lint 的浏览器 TextEncoder 全局识别已修复。初次全量 Element Plus 注册产生约 972 kB 入口警告，改为实际使用组件按需注册、路由懒加载，入口降为约 316 kB，最终构建无该警告。发现 Docker 引擎未运行，启动已有 Docker Desktop 恢复，未重装或重建数据卷。

本任务无已知阻塞或未修复测试失败。localStorage 凭据不是 HttpOnly 隔离，生产 HTTPS/CSP 与可选 Cookie/BFF/CSRF 设计边界见 WEB_AUTHENTICATION.md 和 ADR-017；当前要求支持 Web Locks 的可信浏览器安全上下文。后续业务管理页面、生产部署与 Android APK 不在本次范围。本次仅本地 Git 提交，未上传 GitHub。

启动命令与完整使用步骤见 README.md 和 WEB_AUTHENTICATION.md。
