# 任务 19 报告 — uni-app 手机应用基础功能

## 2026-10-23 补充验收（优先于下方历史结论）

正常启动现有 Docker Desktop 后，真实 PostgreSQL 与 API 联调已恢复。修改 `scripts/mobile.test.mjs`，数据库连接、建库、迁移失败直接失败，移除整组联调的自动跳过；原注册正例的 11 字符密码修正为满足既有规则的测试密码，并增加原弱密码返回 400 的反例。刷新测试改为先真实消费凭证，再测试同一凭证被拒绝；退出测试修正客户端与 storage 夹具不一致，未放宽服务端规则或 401/201 断言。

本轮 `node --test scripts/mobile.test.mjs`：**15 通过、0 失败、0 跳过**，含 11 个真实 API 子测试（新增任务 20 扫码联调）。首次 `pnpm test:mobile` 的注册 400，以及第一次修复后的刷新/退出夹具失败均保留在 `test-results/review-00-20-mobile*.log`；最终结果见 `review-00-20-mobile-retry2.log`。H5 构建已实际成功。

`pnpm build:mobile:lan -ApiBaseUrl 'http://192.168.243.90:3000/api/v1'` 实际构建成功并检查资源包含指定地址，未覆盖任何 .env。**这不是 APK 安装或 Android 真机通过**：未检测到 HBuilderX/已连接 Android，仍需完成 [手机验收清单](MOBILE_APP.md#十一任务-20-真机验收清单2026-10-23)。完整复核与全量回归见 [阶段报告](STAGE_REVIEW_00_20.md)。下方 Docker 被策略拦截与 3 通过/1 跳过是历史记录。

## 一、结论

`apps/mobile` 从"骨架页"变成了一个能登录、能切换商家、能看真实入库记录的 App 工程：

- 10 项要求全部实现，代码通过 `typecheck`、`lint`、`format:check`。
- H5 与 App 两套产物都构建成功，`uni build -p app` 生成 `dist/build/app`，Android 清单里带 INTERNET / ACCESS_NETWORK_STATE / CAMERA 权限，可直接导入 HBuilderX。
- **真实 API 登录链路的自动化用例本次没有跑起来**：本机 Docker Desktop 的 WSL 后端被系统安全策略（`wsl.exe` 程序黑名单）拦住，PostgreSQL 无法启动。测试已把这种情况显式标记为 `SKIP`，没有伪装通过。详见第五节。

## 二、10 项要求的落地

| # | 要求 | 实现 | 位置 |
| --- | --- | --- | --- |
| 1 | 登录页面 | 邮箱 + 密码，大号输入框与按钮，错误内联展示 + toast，回车即提交 | `pages/login/index.vue` |
| 2 | 登录状态与 Token 管理 | access 到期前 30 秒自动刷新；刷新凭证轮换；401 只重试一次；刷新失败清会话；令牌写入 uni storage | `api/client.ts`、`stores/session.ts` |
| 3 | 切换当前商家 | 拉 `GET /tenants`，切换调 `GET /tenants/current`，请求带 `X-Tenant-Id`，偏好持久化 | `pages/tenant/index.vue`、`stores/session.ts` |
| 4 | 首页 | 商家名 + 角色 + 四个大入口，按权限置灰，提示条可重新加载 | `pages/home/index.vue` |
| 5 | 底部导航 | 首页 / 入库记录 / 我的，`tabBar` 文本项 | `pages.json` |
| 6 | 我的账户 | 账号、角色、当前商家、服务环境与地址、版本、退出 | `pages/account/index.vue` |
| 7 | 退出登录 | 二次确认 → 调 `/auth/logout` 吊销 → 清本地 → 回登录页 | `pages/account/index.vue`、`api/client.ts` |
| 8 | 请求封装与统一错误 | `ApiFailure(status, code, message, requestId)`；网络失败 `NETWORK_ERROR`；429 统一文案；15 秒超时；缺 `data` 判 `INVALID_RESPONSE` | `api/client.ts` |
| 9 | 网络断开提示 | `onLaunch` 监听网络，顶部红条 + 断开/恢复 toast | `services/network.ts`、`components/NetworkBanner.vue` |
| 10 | 开发 / 正式地址 | `.env.development` / `.env.production` 注入 `VITE_API_BASE_URL`，兜底域名故意不可解析 | `config.ts`、`.env.*` |

四个入口：**扫码入库 / 库存查询 / 扫码出库 / 入库记录**。其中入库记录已接真实接口（分页、下拉刷新、空态、错误重试），其余三个按任务范围只做入口，点击提示"将在下一阶段开放"，未做假页面。

## 三、设计要点

**会话逻辑与 UI 解耦。** `api/client.ts` 只依赖注入进来的 `storage` 与 `transport`，不 import 任何 uni API；`api/index.ts` 才把它们接到 `uni.request` / `uni.getStorageSync`。好处是这套令牌逻辑能直接在 Node 里对真实 API 跑测试，而不是只能靠手点。

**刷新凭证一次性，失败即退出。** 服务端刷新会作废旧 refresh token，因此刷新失败（包括网络超时）一律清空本地会话，宁可让用户重新登录，也不拿可能已被消费的凭证反复重试。

**离线可用但只读。** 商家列表与当前商家做了本地快照，断网启动时首页仍能打开；但任何写操作都要求在线，避免出现"以为收了、其实没入库"。启动校验只在 401 时清会话，网络错误保留缓存。

**权限前置。** 入口是否可点由 `currentTenant.permissions` 判断，没有 `receiving:confirm` 的账号看到的是"无权限"而不是点了之后报 403。

**环境地址兜底不可解析。** 正式环境兜底写成 `https://api.invalid.local/api/v1`，忘记配 `.env.production` 时直接连不上，不会悄悄把生产数据打到测试服务器。

## 四、实际执行的检查

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @caicang/mobile typecheck` | 通过（`vue-tsc --noEmit`） |
| `pnpm lint` | 通过，0 warning |
| `pnpm format:check` | 通过 |
| `pnpm --filter @caicang/mobile build` | 成功，产出 `dist/build/h5`；产物内确认含 `.env.production` 的地址 |
| `pnpm --filter @caicang/mobile build:app` | 成功，产出 `dist/build/app`，`manifest.json` 中 Android 权限已带上 INTERNET / ACCESS_NETWORK_STATE / CAMERA / VIBRATE |
| `node --test scripts/mobile.test.mjs` | **3 通过 / 1 跳过**：页面路由与 tabBar 一致、Android 权限齐备、首页四入口齐全、适配层确实走 `uni.request`、构建产物使用正式地址 —— 全部通过；真实 API 用例跳过（见下） |

测试文件 `scripts/mobile.test.mjs` 里另有一组 10 个真实 API 用例（错误密码不落会话、登录持久化、Bearer 头、过期自动刷新并轮换、401 重试一次、刷新凭证失效、断网错误、切换商家改变 `X-Tenant-Id`、退出吊销、404 文案），已写好但本次未执行。

## 五、没跑起来的部分与原因

`docker ps` 报 `open //./pipe/dockerDesktopLinuxEngine: no such file`，启动 Docker Desktop 后提示 **Docker Desktop is unable to start**，安全中心日志给出根因：`wsl.exe` 被列入程序黑名单，沙箱与提权都无法绕过。本机没有原生 PostgreSQL（`psql`/`pg_ctl` 均不存在），5432 端口无人监听，因此任何需要数据库的集成测试都无法在此环境执行。

处理方式：测试文件在检测不到数据库时，把真实 API 子测试标记为 `SKIP` 并打印原因，其余断言照常执行。**没有用 mock 服务替代真实认证接口，也没有把跳过报告成通过。**

当时的恢复建议（本轮正常启动已恢复，以下不再是当前阻塞）：

1. 若再次出现策略拦截，先记录具体错误和策略来源并向用户确认；不得自行移除黑名单、关闭防护或修改安全设置。本轮没有执行此类操作。
2. 或者在一台能跑 Docker 的机器上执行同样两条命令。

## 六、真机验收步骤（需要人工在 HBuilderX 完成）

1. 先启动后端 `pnpm start:api`，手机浏览器访问电脑局域网 IP 的健康接口。
2. 按 [MOBILE_APP.md](MOBILE_APP.md) 第七、八节配置 LAN、自己的 AppID，并选择源码或编译资源导入方式。
3. 资源构建使用 `pnpm build:mobile:lan -ApiBaseUrl 'http://<电脑局域网IPv4>:3000/api/v1'`。只修改 .env.development 后执行默认 build:app 不会保证读到开发地址。
4. HBuilderX 实际导入与运行仍需现场验证，不能以产物存在判定成功。
5. 手机与电脑同一 Wi-Fi，USB 调试连接，`运行 → 运行到 Android App 基座`。
6. 验收点：能打开登录页 → 用真实账号登录 → 首页显示商家与角色 → 四个入口可见且大按钮可点 → 切换商家生效 → 我的页显示服务地址 → 退出后回到登录页。

## 七、新增与修改文件

新增：

| 文件 | 作用 |
| --- | --- |
| `apps/mobile/src/api/client.ts` | 框架无关的会话与请求客户端（刷新、重试、错误归一） |
| `apps/mobile/src/api/index.ts` | uni.request / uni storage 适配 |
| `apps/mobile/src/config.ts` | 开发 / 正式地址解析 |
| `apps/mobile/src/services/network.ts` | 网络状态监听 |
| `apps/mobile/src/stores/session.ts` | 登录态、商家列表、当前商家、离线缓存 |
| `apps/mobile/src/utils/feedback.ts`、`utils/guard.ts` | 错误文案 / 确认框、页面级登录守卫 |
| `apps/mobile/src/components/NetworkBanner.vue` | 断网红条 |
| `apps/mobile/src/pages/{login,records,account,tenant}/index.vue` | 登录、入库记录、我的、切换商家 |
| `apps/mobile/.env.development`、`.env.production` | 双环境地址 |
| `scripts/mobile.test.mjs` | 结构 / 构建 / 真实 API 测试 |
| `docs/MOBILE_APP.md`、`docs/TASK_19_REPORT.md` | 说明与报告 |

修改：

| 文件 | 改动 |
| --- | --- |
| `apps/mobile/src/pages/home/index.vue` | 重写为四入口首页（原为"检查服务连接"占位） |
| `apps/mobile/src/App.vue` | 启动时开启网络监听，补齐全局样式与大按钮规范 |
| `apps/mobile/src/pages.json` | 5 个页面 + 3 项 tabBar + 下拉刷新 |
| `apps/mobile/src/manifest.json` | 版本 0.2.0、Android 权限、网络超时、明文调试开关 |
| `apps/mobile/.env.example` | 说明真机地址与 `.env.*.local` 覆盖 |
| `apps/mobile/src/services/health.ts` | 删除（被统一客户端取代） |
| `eslint.config.mjs` | `.vue` 文件声明 `uni` 全局 |
| `package.json` | 新增 `test:mobile`，并加入全仓 `test` |

无新依赖（未引入 pinia，用模块级 `reactive` 保持轻量），无新表，无后端改动。

## 八、未验证与风险

- **真实 API 登录链路未在本机跑通**（Docker 被拦），这是本次最大的未验证项。客户端逻辑做了逐条静态复核，但"能登录"目前只有类型与构建层面的保证。
- **未在真机或模拟器运行过**：本机没有安装 HBuilderX，也没有连接的 Android 设备；App 基座运行属于验收要求里明确要人工确认的部分。
- tabBar 暂无图标，纯文字。
- `uni.request` 的类型不含 PATCH，将来接入修改类接口需真机验证。
- 扫码页、库存页、出库页未实现，属后续任务。
