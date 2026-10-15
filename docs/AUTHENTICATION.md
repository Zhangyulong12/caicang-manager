# 用户注册与登录（任务 05）

## Windows 启动

```powershell
cd D:\Dev\caicang-manager
pnpm install --frozen-lockfile
pnpm db:up
pnpm prisma:migrate:deploy
pnpm start:api
```

开发模式首次启动时，若进程和已有 .env 没有 JWT_ACCESS_SECRET，API 创建被 Git 忽略的 `.env.auth.local`，保存随机签名密钥。文件已存在时只读取，不覆盖；重启沿用密钥。不要上传此文件。已有 .env 中的密钥优先，若是 replace/changeme 等占位值会拒绝启动，须提供真实随机值，不会擅自覆盖它。

生产须显式在进程环境设置 NODE_ENV=production、DATABASE_URL、HTTPS WEB_ORIGIN、至少 32 字节随机 JWT_ACCESS_SECRET；不加载本地 env 文件，Swagger 强制关闭。JWT_ACCESS_TTL_SECONDS 默认 900，可设 60–900 秒。JWT_REFRESH_SECRET 尚未使用。

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

成功 200，从 JSON 的 `data.accessToken` 复制 JWT。`data.expiresIn` 为有效秒数，默认 900；`user` 是安全用户信息。文档中的密码仅为本地演示示例，不自动创建示例账号。

4. 页面顶部 Authorize → bearer，粘贴 Token 本身（不要再加 Bearer 前缀）→ Authorize。
5. 在 account 执行 GET `/api/v1/me`，获得当前账号。无需 X-Tenant-Id，也不能通过 userId 查询参数冒充其他账号。数据不包含 passwordHash。

同源 Swagger 请求即使带 Origin 也可执行；未授权的跨域 Origin 仍返回 403。认证接口测试实际发送了同源 Origin 的登录和 /me 请求，并验证了未知 Origin 被拒绝。

原任务 03 seed 的演示账号仍默认停用，没有在此任务中批量启用。新注册账号 isActive=true，可立即登录。

## 规则与错误

- 邮箱去首尾空格并转小写，格式正确且最多 320 字符。users 的 lower(btrim(email)) 唯一索引处理并发和大小写重复。旧邮箱原文不自动改写，登录按同一规范化表达式查找。
- 注册密码至少 12 字符、包含大小写字母/数字/符号，最多 72 UTF-8 字节；空格不裁剪，控制字符/无效代理字符不允许。登录不追加新的强度要求，但同样限制 72 字节以避免 bcrypt 截断。哈希为 bcrypt cost 12，每个密码有独立 salt。
- 参数无效 400 VALIDATION_ERROR；邮箱重复 409 EMAIL_ALREADY_EXISTS；账号不存在、密码错误或停用统一 401 INVALID_CREDENTIALS。未知邮箱也执行一次 bcrypt 比较。
- 缺少 Token 返回 401 UNAUTHENTICATED；过期、签名错误、非 Access 类型或非法 claims 为 401 INVALID_ACCESS_TOKEN。账号删除或停用后，即使 Token 尚未过期，也无法调用 /me。
- 注册和登录均按每路由/IP 5 次/60 秒限流，错误输入与失败登录也占次数；超限 429 带 Retry-After。当前是内存计数，尚未实现账号锁定或多实例共享存储。
- Access Token 固定 HS256、issuer=caicang-api、audience=caicang-clients，包含 sub/type/jti/iat/exp，不包含密码、邮箱或商家角色。每个已注册控制器默认要求 Token；公开端点显式 Public。商家业务仍须后续实现成员和角色校验。

## 自动化验收

```powershell
pnpm test:auth
pnpm test:models
pnpm test
pnpm test:db
```

认证测试在独立随机空 PostgreSQL 测试库重放真实迁移、通过真实 HTTP 注册/登录/me，验证哈希、错误、输入、并发和令牌；测试结束只清理本轮测试库，不删除开发数据。测试服务器显式信任本机代理，让用例分配不同测试 IP，保持真实限流组件启用，并另验证固定 IP 第六次请求受限；正式默认不信任转发头。

当前只有短期 Access Token，不包含 Refresh Token、logout、找回密码、邮件验证、商家创建或成员/角色管理。这些等待后续任务，不把 JWT 身份认证等同于商家授权。
