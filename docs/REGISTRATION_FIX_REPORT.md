# 注册页面“没有操作权限”排查与修复（2026-10-23）

项目：D:\Dev\caicang-manager。本次不开发新业务、不重置开发库、不覆盖 .env、不提交或推送。

## 根因与失败请求

失败的是 **POST http://127.0.0.1:5173/api/v1/auth/register，HTTP 403 / FORBIDDEN**，响应消息“没有操作权限”。Vite 把请求代理到 127.0.0.1:3000 时设置了 changeOrigin=true：

```text
浏览器 Origin = http://127.0.0.1:5173
代理后 Host  = 127.0.0.1:3000
```

后端 bootstrap.ts 的 CORS 中间件先比较 Origin 与 request.protocol + Host；此时不相等。开发默认/现用白名单包含 localhost:5173、localhost:5174，未包含 127.0.0.1:5173，遂在 DTO/注册业务之前返回 FORBIDDEN。前端按标准错误体显示中文消息和 requestId，因此外观看似商家权限错误。

主环境只用空请求体 `{}` 复现，保证即使请求通过 CORS 也不可能创建有效用户：

| 来源 | 修改前状态 | requestId |
| --- | --- | --- |
| http://127.0.0.1:5173 | 403 FORBIDDEN | f736b11a-eacb-4d75-bab0-6e4b4bd93b81 |
| http://localhost:5173 | 400 VALIDATION_ERROR | 6fd939ee-add0-4ea7-9ca2-5a9e1fc14774 |
| https://untrusted.example | 403 FORBIDDEN | 44f5c31e-e14e-472b-8166-0a04fdcede2b |

这些编号与 `test-results/api-startup-final-server.log` 的 POST/statusCode/errorCode 逐一匹配。用户未提供原始截图中的具体编号，因此没有把某条历史 403 武断认定为原始请求；以上是可定位 URL 的受控复现与实际后端关联。

修复后，同一 127.0.0.1 主环境空请求返回 **400 VALIDATION_ERROR**，requestId=`7caf0fa4-8bc8-4995-be83-b649558ae667`，说明已经到达公开注册 DTO，且没有绕过参数校验。有效注册的 201 使用隔离数据库和真实浏览器另行验证。

## 注册与商家的正确顺序

- 注册页是公开路由。无会话时 auth.initialize 不发 /me，注册页没有 onMounted 商家请求；AuthView 只在提交时调用 client.register。已有会话恢复才会请求 /me，不应以删除认证来处理此情况。
- AuthController 已正确声明 POST /auth/register、@Public 和敏感接口限流；AccessTokenGuard、TenantGuard、RolesGuard 均识别公开声明。注册请求只包含 email/password/可选 displayName，前后端 DTO 匹配。
- 注册创建全局 users 记录，不发 Token、不创建商家、不虚构成员关系。浏览器成功后跳转 /login 并保留安全 redirect。
- 登录后，无商家则进入 /select-tenant。创建商家 POST /tenants 在事务中建立 tenant、OWNER membership、DEFAULT warehouse 和审计；或由已有商家管理员把注册邮箱加入团队。
- 注册不要求先加入商家，亦不应该在未认证时直接创建或访问其他商家。上述业务没有修改。

## 修改文件

| 文件 | 修改原因 |
| --- | --- |
| apps/admin-web/vite.config.ts | changeOrigin 改为 false，保留浏览器同源 Host/Origin 配对，避免开发请求被误判为跨源 |
| scripts/registration.test.mjs | 新增真实 Vite/NestJS/随机隔离 PostgreSQL 注册回归，以及显式开启的浏览器验收等待与数据库核对 |
| package.json | 增加 pnpm test:registration，并纳入既有 pnpm test；未新增或升级依赖 |
| docs/WEB_AUTHENTICATION.md | 补充 127.0.0.1 注册入口、刷新/重启步骤与顺序 |
| docs/DECISIONS.md | ADR-027，记录保持安全边界的代理修复 |
| docs/REGISTRATION_FIX_REPORT.md | 本报告 |

没有修改 auth Controller/Service、注册 DTO、Guard、后端 CORS 白名单、错误码映射或登录/商家流程。前次启动修复的未提交文件保持原状，不混记为本次改动。未知来源仍 403，未登录受保护接口仍 401，跨商家仍 403/404；没有把错误改成成功。

## 实际测试与结果

| 命令/验证 | 实际结果 |
| --- | --- |
| 修复前 node --test scripts/registration.test.mjs | 2 通过/6 失败/0 跳过；包含父节点，4 个子用例因代理 403 失败，不能解读为 6 个独立业务缺陷 |
| 修复后同一命令 | 8 通过/0 失败/0 跳过 |
| REGISTRATION_BROWSER_CHECK=1 后运行同一测试 | 8 通过/0 失败/0 跳过，真实浏览器操作后另核对隔离库用户/OWNER/默认仓库 |
| pnpm test:registration | 8 通过/0 失败/0 跳过，完整命令实际成功；registration-command.log |
| pnpm test:auth | 78 通过/0 失败/0 跳过 |
| pnpm typecheck | 全仓退出 0 |
| pnpm lint | 全仓退出 0，0 warning |
| pnpm --filter @caicang/admin-web build | 退出 0，真实类型检查与 Vite 生产构建成功 |
| Prettier 检查三份代码/命令文件 | 退出 0；registration-format-check.log |
| git diff --check | 通过 |

没有声称本轮运行了全量 pnpm test。自动化回归不是单独对一个配置值作断言，而是真实启动现有 Vite 配置、代理到真实 API 并查询数据库，覆盖：匿名加载、有效注册、重复邮箱 409、弱密码 400、登录、初始商家/默认仓库、未登录 401、跨商家 403/404、不可信来源 403、绕过代理直接访问非白名单 API 仍 403。回归沿用随机 caicang_test_* 数据库，结束仅删除自己创建的库。

浏览器在 127.0.0.1:58426 的隔离实例实际执行：

1. 未登录直接进入注册页，无权限错误。
2. 输入弱密码，页面提示“至少 12 位，包含大小写字母、数字和符号”。
3. 使用专用随机测试邮箱和密码注册，跳到 /login?redirect=/。
4. 直接查询隔离库，确认该测试用户为 1、成员关系为 0。
5. 重复邮箱注册，显示“此邮箱已注册”，请求编号 c42ebf20-1650-4622-8e3c-46eaff32e11a。
6. 使用新账号登录，进入 /select-tenant，显示 0 个商家。
7. 创建“注册隔离浏览器验收”，进入首页，显示“仓库数量 1”“商家所有者”。
8. 测试程序直接查询数据库，确认只有该用户自己的 OWNER 成员与 DEFAULT 仓库；清理该隔离实例与库。

截图：`test-results/registration-browser-success.png`；浏览器日志 registration-browser.log，前后失败/通过日志 registration-before.log、registration-after.log，其他日志以 registration- 开头。测试密码和 Token 不写日志/报告，截图仅含合成测试资料。主数据库没有被测试注册/商家创建写入。

最终确认没有剩余 caicang_test_* 数据库；根 .env 和 .env.auth.local 的 SHA256 与排查前一致。API 仍运行在 3000，正式开发 Web 仍为 127.0.0.1:5173，没有为本次验收停止用户的主 API/Web 服务。

## 现在如何重新注册

当前 Web 的开发代理已重新加载修复，无需改 .env 或重启数据库/API。

1. 打开 **http://127.0.0.1:5173/register?redirect=/**，Ctrl+F5 刷新旧页面。
2. 使用尚未注册的邮箱。密码至少 12 位、同时包含大写/小写字母、数字和符号，确认密码必须一致；不要把密码发给排查人员。
3. 点创建账号。成功后去登录页，使用刚注册的账号登录。
4. 没有商家时点创建第一个商家，或让已有商家管理员邀请/添加该邮箱。

若 Web 终端尚未自动重载配置，在原 Web 终端 Ctrl+C 后执行 `pnpm dev:web`；不要在已经运行的 API 上重复执行 start/dev。若仍报错，F12 → Network → 找到失败请求，只提供 URL、Method、HTTP 状态、requestId 和脱敏错误体；不要提供 Request Payload、Authorization、Cookie、登录响应里的 Token 或真实密码。

本次代码尚未提交或推送，等待用户确认。
