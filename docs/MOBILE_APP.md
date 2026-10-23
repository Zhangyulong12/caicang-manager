# 手机端 App（uni-app）

## 一、这一版做了什么

任务 19 交付的是**可登录、可切换商家、能跑在 Android 上**的 App 骨架：

| 能力 | 说明 |
| --- | --- |
| 登录 | 真实调用 `POST /auth/login`，邮箱 + 密码，失败有明确中文原因 |
| 会话管理 | access token 提前 30 秒自动刷新，refresh token 轮换，401 只重试一次，刷新失败即退出 |
| 切换商家 | 拉取 `GET /tenants`，选中后调 `GET /tenants/current`，并持久化偏好 |
| 首页 | 四个大按钮：扫码入库、库存查询、扫码出库、入库记录；按角色权限置灰 |
| 底部导航 | 首页 / 入库记录 / 我的 |
| 我的账户 | 账号、角色、当前商家、服务环境与地址、版本、退出登录 |
| 请求封装 | 统一 `ApiFailure(status, code, message, requestId)`，15 秒超时，429 统一文案 |
| 断网提示 | 启动即监听网络状态，断开时页面顶部红色条 + toast |
| 双环境地址 | `.env.development` / `.env.production` 注入 `VITE_API_BASE_URL` |
| 扫码查包裹 | 官方 `uni.scanCode` 扫一维码/二维码，调 `GET /packages/lookup`，唯一进详情、多候选手动选、未知给异常提示；**只查不改库存** |

**尚未实现**：库存查询、扫码出库的真实业务页面（点击入口会提示"将在下一阶段开放"）。入库记录已接 `GET /receipts`，可翻页、下拉刷新。

## 二、目录结构

```
apps/mobile/
  .env.development / .env.production / .env.example
  src/
    config.ts                 环境地址解析（开发/正式）
    api/client.ts             与 UI、uni API 解耦的会话与请求逻辑（Node 里可直接跑）
    api/index.ts              注入 uni.request 与 uni storage 的适配层
    services/network.ts       网络状态监听
    services/scan.ts          扫码结果清洗、lookup 请求、去重闸门（框架无关，可单测）
    stores/session.ts         登录态、商家列表、当前商家、本地缓存
    utils/feedback.ts         错误文案、toast、确认框
    utils/guard.ts            页面级登录守卫
    utils/package.ts          包裹/收货状态中文名、时间格式化
    components/NetworkBanner.vue
    pages/login|home|records|account|tenant|scan|package/index.vue
    pages.json / manifest.json
```

`client.ts` 不 import 任何 uni API，`api/index.ts` 才做适配。这样同一份令牌逻辑既跑在手机上，也能在 `scripts/mobile.test.mjs` 里对真实 API 执行。

## 三、页面与导航

| 路径 | 作用 | 底部 tab |
| --- | --- | --- |
| `pages/login/index` | 启动页，未登录时停留；已登录自动跳首页 | 否 |
| `pages/home/index` | 商家、角色、四个入口 | 首页 |
| `pages/records/index` | 入库记录列表（真实接口，分页 + 下拉刷新） | 入库记录 |
| `pages/account/index` | 我的账户、服务地址、退出登录 | 我的 |
| `pages/tenant/index` | 切换商家 | 否（从首页/我的进入） |
| `pages/scan/index` | 扫一扫：相机扫码 / 手动输入，查包裹 | 否（首页「扫码入库」进入） |
| `pages/package/index` | 包裹详情：采购单、预计明细、入库单（只读） | 否（扫码命中后进入） |

四个入口按权限判断：`receiving:confirm`（扫码入库）、`products:read`（库存查询）、`outbound:write`（扫码出库）、`packages:read`（入库记录）。没有权限的入口置灰并提示原因，而不是点了报 403。扫码页还额外校验 `packages:lookup`（服务端同样会校验）。

## 四、会话与令牌

- 存储键：`caicang.mobile.session.v1`（令牌 + 用户快照）、`caicang.mobile.tenant.v1`（上次选的商家）、`caicang.mobile.cache.v1`（商家列表与当前商家快照，供断网时首页仍可打开）。
- 启动时若有本地会话，先乐观展示，再调 `GET /me` 校验；只有 **401** 才清空，网络错误保留缓存并提示离线。
- access token 距过期不足 30 秒时，先刷新再发业务请求；刷新成功会换一对新令牌（服务端 refresh token 一次性使用）。
- 业务请求返回 401 时刷新一次并重试；重试仍 401 才放弃，不会无限循环。
- 刷新失败一律清空本地会话并要求重新登录——因为刷新凭证可能已被服务端消费，重试有安全风险。断网导致的刷新失败也按此处理，这是空间换安全的取舍。
- 退出登录先调 `POST /auth/logout` 让服务端吊销刷新凭证，即使网络失败也清本地状态，避免卡在失效会话里。
- 令牌只写入 uni storage（App 私有目录），不打印、不拼接进 URL、不放进日志。

## 五、请求封装与错误处理

```ts
const result = await api.request<ReceiptData[]>('/receipts?page=1&pageSize=20', {
  tenantId: session.currentTenant?.tenant.id,
});
```

- 统一返回 `ApiResponse<T>`，异常统一抛 `ApiFailure`：`status`（0 表示没连上服务器）、`code`（后端错误码）、`message`（可直接展示）、`requestId`（排障用）。
- 网络失败 → `status=0, code=NETWORK_ERROR`，文案"网络连接失败，请检查网络后重试"。
- 429 → "操作过于频繁，请稍后再试"，不透传服务端长文案。
- 响应缺 `data` 字段 → `INVALID_RESPONSE`，避免把 HTML 错误页当数据渲染。
- 请求超时 15 秒，与 `manifest.json` 的 `networkTimeout.request` 保持一致。

## 六、断网提示

`App.vue` 的 `onLaunch` 调用 `startNetworkWatch()`：先用 `uni.getNetworkType` 取初始状态，再监听 `uni.onNetworkStatusChange`。断开/恢复时各弹一次 toast，页面顶部固定显示红色提示条（`NetworkBanner`）。断网时请求会立刻失败并给出可读提示，不做静默重试。

## 七、开发 / 正式地址

| 文件 | 用途 |
| --- | --- |
| `.env.development` | `pnpm dev:mobile` 使用，默认 `http://localhost:3000/api/v1` |
| `.env.production` | `uni build` 打包使用，默认示例 `https://api.example.com/api/v1`，**上线前必须改成真实域名** |
| `.env.example` | 说明如何用 `.env.development.local` 覆盖 |

- Android 真机**不能用 localhost**：把 `.env.development` 改成电脑的局域网地址，例如 `http://192.168.1.10:3000/api/v1`，并确认手机与电脑同一 Wi-Fi、电脑防火墙放行 3000 端口。
- 代码里的兜底地址是 `https://api.invalid.local/api/v1`，故意不可解析：忘记配置时宁可连不上，也不要悄悄连到错误服务器。
- 正式环境必须 HTTPS；`manifest.json` 里保留了 `usesCleartextTraffic: true` 以便真机调试 HTTP，上线前应改为 `false`。

## 八、在 HBuilderX 里跑 Android

```bash
pnpm install
pnpm --filter @caicang/mobile build:app   # 产出 apps/mobile/dist/build/app
```

1. 打开 HBuilderX（4.x 及以上），`文件 → 导入 → 从本地目录导入`，选择 `apps/mobile/dist/build/app`。
2. 双击 `manifest.json`，在「基础配置」里点「重新获取」拿到 DCloud AppID（当前仓库里是空值，必须由本机申请，不能共用）。
3. 手机开启开发者模式与 USB 调试，用数据线连接；HBuilderX 菜单 `运行 → 运行到手机或模拟器 → 运行到 Android App 基座`。
4. 首次运行会自动安装 HBuilderX 基座；页面出现登录界面即表示工程可用。
5. 真机联调前先启动后端：`pnpm db:up && pnpm start:api`，并把 App 的 API 地址改成电脑局域网 IP。
6. 打正式包：`发行 → 原生App-云打包`，选择 Android，使用自有证书。

也可以直接用 HBuilderX 打开 `apps/mobile`（CLI 工程）运行，效果一致；`dist/build/app` 是编译产物，不含 `package.json`，两种方式择一即可。

## 九、扫码查包裹

首页「扫码入库」→ `pages/scan/index`，整条链路只读：**扫到的码只用来查包裹，不会写收货单、不会改库存**。

```
点击「扫一扫」
   ├─ 非 App 环境（H5 预览）→ 提示"请在手机 App 中扫码"，引导用手动输入
   ├─ 相机被拒（getAppAuthorizeSetting.cameraAuthorized === 'denied'）→ 权限面板 + 「去设置开启」
   └─ uni.scanCode({ scanType: ['barCode','qrCode'], onlyFromCamera: true })
          ↓ 成功回调拿到原始字符串 result.result
      normalizeTrackingNo()  → 裁剪首尾空白，保留前导零，拒绝空/超长/控制字符
          ↓
      ScanGuard.begin()      → 正在查询则忽略；同一单号 3 秒内重复上报则忽略
          ↓
      GET /packages/lookup?trackingNo=<encodeURIComponent(码值)>
          ├─ 1 个 → 跳转 pages/package/index?id=…
          ├─ 多个 → 列出候选（采购单号、承运商、收货状态、已收件数）让用户点选
          ├─ 0 个 → 异常提示：单号有误 / 未绑定采购单 / 属于其他商家，并给出补录建议
          └─ 失败 → 错误文案 + 「重试」/「手动输入」
```

几个刻意的取舍：

- **前导零必须保留。** 扫码结果是字符串，`normalizeTrackingNo` 只 trim，绝不 `Number()` 转换——`000783456123` 变成 `783456123` 就永远查不到。
- **查询串由 `encodeURIComponent` 编码**，商家通过 `X-Tenant-Id` 头传递，不塞进 query。
- **防抖是双层的**：`inFlight` 挡住"查询没回来又扫一次"，3 秒同码窗口挡住摄像头连续解码同一张面单。点「重新扫码」会 `reset()`，允许立刻重扫同一个箱子。
- **多候选不自动选第一个**：同一运单号可能被不同承运商复用，猜错会把货记到别的采购单上。
- **权限被拒不是死路**：面板里「去设置开启」调 `uni.openAppAuthorizeSetting`，「我已开启，重新扫码」直接重试；`uni.scanCode` 的 fail 回调也会识别 `auth/permission/denied/权限` 关键字兜底切到权限面板。
- **H5 不能假装能扫**：`plus` 不存在时直接给模态提示，避免把浏览器当扫码设备"验收通过"。
- **详情页只读**：`GET /packages/:id` + `GET /receipts?packageId=…`，没有验收按钮；入库确认属于后续任务。

排障：

| 现象 | 处理 |
| --- | --- |
| 点扫码没反应 / 提示"请在手机 App 中扫码" | 当前是 H5 或浏览器预览，必须用 HBuilderX 跑到 App 基座 |
| 相机黑屏、提示需要相机权限 | 系统设置 → 应用 → 采仓管家 → 权限 → 相机 → 允许；返回后点「我已开启，重新扫码」 |
| 扫到了但提示"没有找到这个运单的包裹" | 用管理端确认该运单已绑定到本商家的采购单；确认当前商家是否选错 |
| 一直提示"刚刚已查询过该单号" | 3 秒防抖，等一秒或点「重新扫码」 |
| 条码磨损扫不出 | 用页面下方手动输入，或「粘贴」剪贴板里的单号 |

## 十、已知限制

- 底部导航暂时只有文字没有图标（避免往仓库里塞二进制资源），后续补 81×81 PNG。
- 断网时不做离线队列：收货、查询都要求在线，避免出现"以为收了、其实没入库"。
- 未做指纹/面容解锁与"保持登录"开关。
- `uni.request` 的类型声明没有 PATCH：H5 走 XHR 可用，App 端接入写接口（如修改包裹）前需要真机实测一次。
- 扫码只做查询；收货确认（写收货单、加库存）不在本版范围内，详情页没有任何验收按钮。
- 相机扫码无法在自动化测试里覆盖：`scripts/scan.test.mjs` 覆盖码值清洗、去重、候选分类与"不写库存"，摄像头与授权弹窗必须真机验收。
