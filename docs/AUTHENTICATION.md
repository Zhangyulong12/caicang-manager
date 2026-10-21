# 用户认证、令牌刷新与安全退出（任务 05–06）

任务 10 已接入 Web 注册/登录/刷新/退出及主布局，详见 WEB_AUTHENTICATION.md。localStorage 令牌对与 Web Locks 串行轮换，恢复通过 /me 验证，退出需服务端撤销成功；尚未实现生产 HttpOnly Cookie/BFF，不宣称 localStorage 能防 XSS。无认证 API 行为或数据库迁移变更。

## Windows 启动

```powershell
cd D:\Dev\caicang-manager
pnpm install --frozen-lockfile
pnpm db:up
pnpm prisma:migrate:deploy
pnpm start:api
```

开发模式首次启动时，若进程和已有 .env 没有 JWT_ACCESS_SECRET，API 创建被 Git 忽略的 `.env.auth.local`，保存随机签名密钥。文件已存在时只读取，不覆盖；重启沿用密钥。不要上传此文件。已有 .env 中的密钥优先，若是 replace/changeme 等占位值会拒绝启动，须提供真实随机值，不会擅自覆盖它。

生产须显式在进程环境设置 NODE_ENV=production、DATABASE_URL、HTTPS WEB_ORIGIN、至少 32 字节随机 JWT_ACCESS_SECRET；不加载本地 env 文件，Swagger 强制关闭。JWT_ACCESS_TTL_SECONDS 默认 900，可设 60–900 秒。REFRESH_TOKEN_TTL_SECONDS 为独立登录会话的绝对有效秒数，默认 604800（7 天），范围 3600–2592000。Refresh Token 为随机值，数据库仅存 SHA-256 哈希，不需要 JWT_REFRESH_SECRET。

## Swagger 完整操作

1. 打开 `http://localhost:3000/api/docs`，找到 auth。
2. POST `/api/v1/auth/register` → Try it out，输入：

```json
{
  "email": "new-user@example.com",
  "password": "CaicangDemo!2026",
  "displayName": "新用户"
}
```

执行成功为 201。若邮箱已注册，使用新的测试邮箱；重复请求不会重置现有用户密码。displayName 可省略。

3. POST `/api/v1/auth/login`，使用同一邮箱与密码：

```json
{
  "email": "new-user@example.com",
  "password": "CaicangDemo!2026"
}
```

成功 200，从 JSON 的 `data.accessToken` 复制 JWT，同时保留 `data.refreshToken`。`data.expiresIn` 为 Access Token 有效秒数，默认 900；`data.refreshExpiresIn` 是会话剩余秒数；`user` 是安全用户信息。文档中的密码仅为本地演示示例，不自动创建示例账号。

4. 页面顶部 Authorize → bearer，粘贴 Token 本身（不要再加 Bearer 前缀）→ Authorize。
5. 在 account 执行 GET `/api/v1/me`，获得当前账号。无需 X-Tenant-Id，也不能通过 userId 查询参数冒充其他账号。数据不包含 passwordHash。

6. 执行 POST `/api/v1/auth/refresh`，正文填写 `{"refreshToken":"<第 3 步返回的 data.refreshToken>"}`。无需 Authorize；返回新的两个令牌，立即替换保存值，再将新 Access Token 填入 Authorize 后执行 /me。
7. 执行 POST `/api/v1/auth/logout`，正文使用第 6 步最新的 refreshToken。返回 data.loggedOut=true；再执行 /me 得到 401 INVALID_ACCESS_TOKEN，尝试刷新得到 401 INVALID_REFRESH_TOKEN。再次 logout 返回 200。

刷新测试时不要为了“验证旧值失效”在正常使用的会话上重放旧值：此行为会撤销最新令牌所属会话，须重新 login。多个请求收到 401 时客户端只应发起一次刷新，其他请求等待结果；网络响应丢失后重新登录。会话到期不会滑动延长。只退出此设备登录，其他独立登录不受影响。

同源 Swagger 请求即使带 Origin 也可执行；未授权的跨域 Origin 仍返回 403。认证接口测试实际发送了同源 Origin 的登录和 /me 请求，并验证了未知 Origin 被拒绝。

原任务 03 seed 的演示账号仍默认停用，没有在此任务中批量启用。新注册账号 isActive=true，可立即登录。

## 规则与错误

- 邮箱去首尾空格并转小写，格式正确且最多 320 字符。users 的 lower(btrim(email)) 唯一索引处理并发和大小写重复。旧邮箱原文不自动改写，登录按同一规范化表达式查找。
- 注册密码至少 12 字符、包含大小写字母/数字/符号，最多 72 UTF-8 字节；空格不裁剪，控制字符/无效代理字符不允许。登录不追加新的强度要求，但同样限制 72 字节以避免 bcrypt 截断。哈希为 bcrypt cost 12，每个密码有独立 salt。
- 参数无效 400 VALIDATION_ERROR；邮箱重复 409 EMAIL_ALREADY_EXISTS；账号不存在、密码错误或停用统一 401 INVALID_CREDENTIALS。未知邮箱也执行一次 bcrypt 比较。
- 缺少 Token 返回 401 UNAUTHENTICATED；过期、签名错误、非 Access 类型或非法 claims 为 401 INVALID_ACCESS_TOKEN。账号删除或停用后，即使 Token 尚未过期，也无法调用 /me。
- 注册和登录均按每路由/IP 5 次/60 秒限流，错误输入与失败登录也占次数；超限 429 带 Retry-After。当前是内存计数，尚未实现账号锁定或多实例共享存储。
- Access Token 固定 HS256、issuer=caicang-api、audience=caicang-clients，包含 sub/sid/type/jti/iat/exp，不包含密码、邮箱或商家角色。sid 绑定数据库登录会话，每个受保护请求检查用户及会话状态。任务 05 旧 Token 不包含 sid，升级后需重新登录。每个已注册控制器默认要求 Token；公开端点显式 Public，账号级接口显式 GlobalAccount。商家接口再由任务 07 TenantGuard/RolesGuard 验证当前商家成员和角色。
- refresh/logout 也使用每 IP 每路由 5 次/60 秒敏感限流；正文凭据严格校验，非法格式 400，刷新凭据无效统一 401 INVALID_REFRESH_TOKEN。退出对格式合法的未知或已撤销值返回相同 200，防止枚举。退出后清除客户端保存的两个令牌。

## 自动化验收

```powershell
pnpm test:auth
pnpm test:models
pnpm test
pnpm test:db
```

认证测试在独立随机空 PostgreSQL 测试库重放真实迁移、通过真实 HTTP 注册/登录/me，验证哈希、错误、输入、并发和令牌；测试结束只清理本轮测试库，不删除开发数据。测试服务器显式信任本机代理，让用例分配不同测试 IP，保持真实限流组件启用，并另验证固定 IP 第六次请求受限；正式默认不信任转发头。

任务 06 已完成 Refresh Token、轮换和 logout；测试包含两个真实 API 进程、事务回滚、重放、过期、停用、并发、隔离、重启、日志与 Swagger。任务 07 已另行实现商家创建与成员/角色管理，见 TENANT_AUTHORIZATION.md；商家角色每次查数据库，不写入 JWT。任务 10 已实现 Web 令牌状态及刷新协调；找回密码和邮件验证尚未实现。
