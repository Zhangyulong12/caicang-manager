# Web 登录与主布局（任务 10）

2026-10-21。沿用 Vue 3.5.44、Element Plus 2.14.7，新增精确锁定 Vue Router 4.6.4、Pinia 3.0.4、@element-plus/icons-vue 2.3.2；依赖树由 pnpm-lock.yaml 固定，API/Prisma/手机端版本不变。

## Windows 启动

启动已有 Docker Desktop，在第一个 PowerShell 终端执行：

```powershell
cd D:\Dev\caicang-manager
pnpm install --frozen-lockfile
pnpm db:up
pnpm prisma:migrate:deploy
pnpm start:api
```

第二个 PowerShell 终端：

```powershell
cd D:\Dev\caicang-manager
pnpm dev:web
```

打开 http://localhost:5173。Vite 严格绑定 5173，端口占用时失败，不静默换端口。开发请求默认 `/api/v1`，Vite 代理 `/api` 到 127.0.0.1:3000，WEB_API_PROXY_TARGET 可指定另一本地 API。VITE_* 不能放服务端密码/密钥。

生产需 HTTPS、反代 `/api` 到 NestJS，SPA 路径回退 index.html；不使用 Vite dev server 对公网部署。当前 Web 要求支持 Web Locks 的新版 Chrome/Edge，localhost 或 HTTPS 安全上下文可用。[Web Locks 官方说明](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API)。

## 用户流程

1. “立即注册”填写邮箱、可选显示名称、密码与确认密码。注册后转登录，使用刚注册的账号登录。密码至少 12 位、含大小写/数字/符号、最多 72 UTF-8 字节，服务端执行最终规则；不保存密码、固定 Token 或假账号。
2. 无商家时可创建商家，已有 POST /tenants 事务自动创建 OWNER、默认仓库和审计；也可联系管理员将已注册邮箱加入团队。
3. 从本人有效成员关系的商家列表选择进入；左侧或底部“切换商家”返回选择页。偏好只存按用户 ID 分键的 UUID，实际权限始终通过 /tenants/current 验证。
4. 主布局提供九个入口：首页、商品管理、采购管理、快递包裹、入库记录、库存管理、出库管理、数据统计、系统设置。未开发业务页面明确待开放，不提供假订单/库存。系统设置只读账号/商家/权限，仅 OWNER/ADMIN 可访问，普通角色为 403。
5. 首页商品/仓库数量读取真实 API total；新商家商品 0、仓库 1。加载、网络/业务错误有界面提示；未知页 404、无权限 403、连接失败可重试。
6. 顶部用户菜单“退出登录”调用真实 /auth/logout，服务端确认后清本地；失败明确提示未完成并允许重试，同源其他标签同步退出。

## 会话实现与边界

client.ts 是统一 HTTP/会话入口，Pinia 管理身份和商家，Vue Router 异步守卫检查登录与当前服务端权限。先安装 Pinia 再安装 Router，守卫中才读取 store。[Pinia 说明](https://pinia.vuejs.org/core-concepts/outside-component-usage.html)、[Vue Router 守卫](https://router.vuejs.org/guide/advanced/navigation-guards.html)。

令牌对、服务端到期时间及随机 sessionKey/revision 存在一个 localStorage JSON，密码/用户资料/角色不持久化；恢复用 /me 校验。到期前 30 秒或受保护请求 401 时，Web Locks 将同源标签的 login/refresh/logout 串行化，等待者复用新 revision。受保护请求最多重试一次，不重放刷新凭据；刷新网络结果不确定时清除对应会话并要求重登。迟到响应不能恢复已退出或替换的账号，商家 generation 拒绝旧列表/选择结果覆盖新上下文。重定向仅接受已知内部路径。

localStorage 不是 HttpOnly 隔离，XSS 可读取凭据；不宣称浏览器加密能防 XSS。不使用 v-html 或外部第三方脚本，Vue 转义文本。生产需要 HTTPS、严格 CSP 与依赖治理；Cookie/BFF 和 CSRF 设计留待独立任务。不支持 Web Locks 时提示使用新版 Chrome/Edge，不降级成并发重放。请在可信设备使用并在离开时退出。

## 补充 API 与测试

GET /api/v1/tenants?page=1&pageSize=20：Bearer，无需商家头，只返回本人 active memberships 对应的 `{tenant,membership}` 标准分页；拒绝 userId/tenantId 注入，账号停用不能访问，pageSize 最大 100，按创建时间/id 稳定排序。RepeatableRead 事务保持分页一致，无新数据库迁移。

```powershell
pnpm test:web
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
```

test:web 构建 API/Web，转译并直接运行生产 client.ts/policy.ts，使用随机隔离 PostgreSQL 和真实 AppModule/HTTP。包含 61 秒等待，确认后端签发的 60 秒 Access Token 真正过期后验证恢复。浏览器操作由 computer-use 单独验收，不把 Node 测试计为浏览器点击。完整结果及文件见 TASK_10_REPORT.md，决策见 ADR-017。
