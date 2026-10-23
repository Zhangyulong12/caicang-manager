# 手机端 App（uni-app）

## 一、这一版做了什么

任务 19 交付的是**可登录、可切换商家、面向 Android 的 uni-app** 骨架；2026-10-23 已完成真实 API 联调与 App 资源构建，Android 安装、摄像头与权限弹窗仍未验收：

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
| 扫码查包裹 | 官方 `uni.scanCode` 扫一维码/二维码，调 `GET /packages/lookup`，唯一进详情、多候选手动选、未知给异常提示 |
| 扫码验收入库 | 收货页按 SKU 填实际到货数、写备注、二次确认后调 `POST /receipts` 真实事务；断网未提交、重试复用同一操作号不重复入库 |

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
    services/receiving.ts     收货草稿、幂等 UUID 闸门、错误文案（框架无关，可单测）
    services/operation-log.ts 本机操作日志（50 条环形缓冲）
    stores/session.ts         登录态、商家列表、当前商家、本地缓存
    utils/feedback.ts         错误文案、toast、确认框
    utils/guard.ts            页面级登录守卫
    utils/package.ts          包裹/收货状态中文名、时间格式化
    components/NetworkBanner.vue
    pages/login|home|records|account|tenant|scan|package|receiving/index.vue
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
| `pages/package/index` | 包裹详情：采购单、预计明细、入库单；有权限时可进收货 | 否（扫码命中后进入） |
| `pages/receiving/index` | 扫码验收入库：按 SKU 填到货数、备注、二次确认、提交事务 | 否（详情页「确认收货」进入） |

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

- Android 真机**不能用 localhost**。本轮检查 `.env.development` 仍是 localhost、`.env.production` 仍是示例域名，均未覆盖。**默认 `build:app` 读取 production；只改 development 后直接 build:app 仍会连接示例域名。** 使用下方 LAN 构建命令，通过进程变量覆盖并检查产物中的真实地址。
- 手机与电脑必须在可互访的局域网，先用手机浏览器打开健康接口；本轮只验证了电脑访问自己的 LAN 地址。若有访客 Wi-Fi 隔离、防火墙或安全策略拦截，先定位并取得用户确认，不自动调整规则。
- 代码里的兜底地址是 `https://api.invalid.local/api/v1`，故意不可解析：忘记配置时宁可连不上，也不要悄悄连到错误服务器。
- 正式环境必须 HTTPS；`manifest.json` 里保留了 `usesCleartextTraffic: true` 以便真机调试 HTTP，上线前应改为 `false`。

## 八、在 HBuilderX 里跑 Android

```powershell
cd D:\Dev\caicang-manager
# 终端一；Docker Desktop 已运行，已有 .env 保留
pnpm start:api

# 终端二；ipconfig 核对 WLAN IPv4，以下是本轮实际地址
ipconfig
Invoke-RestMethod 'http://192.168.243.90:3000/api/v1/health'
pnpm build:mobile:lan -ApiBaseUrl 'http://192.168.243.90:3000/api/v1'
```

LAN 脚本先要求健康接口成功，再运行 `build:app --mode development`。环境变量只对该进程生效，结束恢复原值；构建后验证 `dist/build/app/app-service.js` 包含指定 URL。当前已实际构建成功，**dist/build/app 是编译资源，不是签名 APK**。默认 `build:app` 仍是 production 构建，后续执行会覆盖该目录，真机测试前应重新执行 LAN 构建。

1. 安装兼容锁定编译器的 HBuilderX（本轮 CLI 输出编译器 5.24；[官方下载](https://www.dcloud.io/hbuilderx.html)）。本机尚未执行安装或验证 IDE 版本兼容性，不升级项目依赖来迁就 IDE。
2. 在 HBuilderX「文件 → 导入 → 从本地目录导入」选择 `D:\Dev\caicang-manager\apps\mobile`，这是有 package.json/src 的 CLI 源码工程，不能多选一层项目父目录。按 [DCloud CLI 说明](https://uniapp.dcloud.io/quickstart-cli) 与 [项目类型说明](https://ask.dcloud.net.cn/article/id-35878__page-2)核对工程类型。
3. 在 `src/manifest.json` 的基础配置申请自己的 DCloud AppID；仓库现值为空。本轮未代申请、未改 AppID。若使用编译资源导入方式，应在源码配置 AppID 后重新构建，不能依靠旧资源自动带入。
4. 源码由 HBuilderX 运行时会重新编译，需要本地 `.env.development.local` 配置 LAN 地址。先检查该文件，保留已有内容，仅在本机配置 `VITE_API_BASE_URL=http://192.168.243.90:3000/api/v1`；不能沿用 localhost。该文件已被 Git 忽略。本轮没有创建或覆盖它。
5. 本轮 CLI 成功后明确提示 `open HBuilderX, import dist\\build\\app run`；也可按此提示导入 `apps/mobile/dist/build/app` 编译资源。其识别、AppID、基座运行仍须在实际 HBuilderX 验证，不能宣称与源码导入“效果一致”。
6. 手机开启开发者模式、USB 调试并授权电脑；在手机浏览器先访问 LAN 健康接口，再运行 HBuilderX「运行 → 运行到手机或模拟器 → Android App 基座」。记录 HBuilderX/基座版本、手机型号、Android 版本及实际 API 地址。
7. 登录、扫码、拒绝权限等按第十一节逐项验证。需要签名 APK 时再走「发行 → 原生App-云打包」，使用自有证书；基座可运行也不代表签名 APK 已通过。本轮没有打包、安装或验证 APK。

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
- **详情页本身不改库存**：`GET /packages/:id` + `GET /receipts?packageId=…` 只读；真正的入库在「确认收货」后的收货页里单独提交。

排障：

| 现象 | 处理 |
| --- | --- |
| 点扫码没反应 / 提示"请在手机 App 中扫码" | 当前是 H5 或浏览器预览，必须用 HBuilderX 跑到 App 基座 |
| 相机黑屏、提示需要相机权限 | 系统设置 → 应用 → 采仓管家 → 权限 → 相机 → 允许；返回后点「我已开启，重新扫码」 |
| 扫到了但提示"没有找到这个运单的包裹" | 用管理端确认该运单已绑定到本商家的采购单；确认当前商家是否选错 |
| 一直提示"刚刚已查询过该单号" | 3 秒防抖，等一秒或点「重新扫码」 |
| 条码磨损扫不出 | 用页面下方手动输入，或「粘贴」剪贴板里的单号 |

## 十、扫码验收入库

`pages/package/index` 点「确认收货」→ `pages/receiving/index?id=…`。这一页是**唯一会写库存的地方**，调的是任务 17 的真实事务接口。

```
GET /packages/:id            → 采购单、承运商、运单号、包裹状态
GET /packages/:id/receivable → 每个 SKU 的订购 / 已入库 / 剩余 / 本次最多可收
        ↓ 每行默认填「最多可收」，可改小；留空 = 这件没到
二次确认（uni.showModal，列出商品 × 数量 + 总件数 + 备注）
        ↓
POST /receipts { packageId, clientOperationId, items[{purchaseOrderItemId, receivedQty}], remark }
        ↓ 201 首次 / 200 幂等重放
成功页：入库单号、本次入库件数、逐商品数量、时间 → 「继续扫下一包裹」
```

**数量规则**

- 只收非负整数；空 = 0（本次没到），不进入请求体。
- 每行上限是 `maxReceivableQuantity`（服务端已按"整单剩余"与"本包裹计划剩余"取小），提交前本地先拦一次并指出是哪一行，服务端 409 再兜底。
- 部分收货、多 SKU 混合都只是"提交哪些行、各多少"的区别，不需要额外开关。

**幂等：什么时候复用 UUID**

| 场景 | 行为 |
| --- | --- |
| 断网 / 5xx 后重试，内容没改 | 复用原 `clientOperationId` + 原样请求体；服务端返回原入库单，库存不变 |
| App 被杀掉后重开再重试 | 同样复用（待提交记录写在 `caicang.mobile.receipt-pending.v1`） |
| 改了数量或备注再提交 | 内容指纹变化 → 生成新 UUID，服务端按新一次入库处理 |
| 成功后再次提交 | 记录已清除 → 新 UUID（确实是一次新的入库） |
| 服务端 4xx 拒绝（超收/已关闭/已取消） | 不会产生入库单，清掉记录，让用户改完再提 |

**断网与错误**

- 断网提交：页面显示「未提交」，并明确写"App 不会提前增加库存"；本地不扣减任何数量，也不把待确认当成已入库。
- 网络恢复后点「重试本次提交」，走同一条幂等路径；如果上次其实已写成功，返回的是同一张入库单，成功页会标注"重试命中同一入库单，未重复加库存"。
- 超收、包裹已关闭、采购单已取消、无权限、操作号冲突都有独立标题与处理建议，且都说明"本次未入库"。

**操作日志**

`services/operation-log.ts` 在本机留最近 50 条（提交、成功、失败原因、读明细失败），收货页底部展示最近 5 条。它只用于现场追溯；库存事实以服务端入库单与 `audit_logs` 为准。

## 十一、任务 20 真机验收清单（2026-10-23）

状态：**以下各项均未执行真机验收**。自动化的扫码逻辑 10 项与手机客户端/真实 API 15 项已通过，不能替代此表。当前代码原已含任务 21 的「确认收货」入口，本次扫码验收停留在查询与详情，**不要点击确认收货/提交入库**。

准备：在专用测试商家用真实 Web/Swagger 建商品和已下单的 100 件采购单，绑定三个无预计明细的包裹：ZTO `1234567890123`、ZTO `0000123456789`、YTO `0000123456789`。准备相同内容的一维条码标签，勿使用包含真实收件地址的面单截图。另准备没有包裹的第二测试商家。自动化测试的隔离库已清理，不是手机可直接使用的测试数据。

| 项目 | 实际操作 | 通过条件 |
| --- | --- | --- |
| 正常条码 | 授权相机，扫描 `1234567890123` | 实际打开相机并识别，唯一命中后展示对应包裹与采购单 |
| 前导零 | 扫描 `0000123456789` | 完整 13 位显示，提交与返回都保留四个前导零 |
| 多候选 | 扫描上述两家承运商同号条码 | 显示两个候选，展示承运商/采购单并由人选择，不自动挑第一条 |
| 未知单号 | 扫描或输入 `UNKNOWN-0000` | 给出未找到提示，能够重新扫描；不产生业务记录 |
| 拒绝相机权限 | 首次拒绝授权；再在系统设置禁用后重试 | 有明确权限面板、设置入口；授权后可恢复，取消扫码不被误报为成功 |
| 重复扫描 | 同一单号在查询期间及 3 秒内重复触发，再点重新扫码 | 查询期间只发一次，重复窗口内提示已查；主动重新扫码后允许再次查询 |
| 手动输入 | 输入/粘贴相同前导零单号；再提交空白或超长值 | 有效值与扫码结果相同；无效值有提示且不发查询 |
| 库存不变与商家隔离 | 开始前后记录下方数据库快照；切到第二商家查询同号 | 收货单/明细/余额/流水无增减，采购单和包裹状态不变；第二商家查不到第一商家包裹 |

数据库检查可在操作前后各执行并保存输出，使用专用测试商家的 UUID 替换占位符。验收期间停止其他人对该测试商家的写操作；只看入库列表“没有新增”不足以证明余额/流水未被改动。

```powershell
docker exec caicang-postgres psql -U caicang -d caicang -c "SELECT id,total_cost,quantity_on_hand FROM stock_balances WHERE tenant_id='<测试商家UUID>' ORDER BY id; SELECT id,quantity_delta,cost_delta FROM stock_movements WHERE tenant_id='<测试商家UUID>' ORDER BY id; SELECT id FROM receipts WHERE tenant_id='<测试商家UUID>' ORDER BY id; SELECT id,quantity FROM receipt_items WHERE tenant_id='<测试商家UUID>' ORDER BY id; SELECT id,status FROM purchase_orders WHERE tenant_id='<测试商家UUID>' ORDER BY id; SELECT id,status,receiving_closed_at FROM packages WHERE tenant_id='<测试商家UUID>' ORDER BY id;"
```

每项记录执行人/时间、设备、码值、结果、失败错误及重试结果；不能把“待执行”改成“通过”。相机拒绝、硬件识别、手机至电脑网络均仍待现场确认。

## 十二、已知限制

- 底部导航暂时只有文字没有图标（避免往仓库里塞二进制资源），后续补 81×81 PNG。
- 断网时不做离线队列：收货、查询都要求在线，避免出现"以为收了、其实没入库"。
- 未做指纹/面容解锁与"保持登录"开关。
- `uni.request` 的类型声明没有 PATCH：H5 走 XHR 可用，App 端接入写接口（如修改包裹）前需要真机实测一次。
- 收货只支持"整件"数量，不支持按重量/批次/序列号验收，也不支持拆行分批到货的独立包装记录。
- 备注只保存在入库单文本字段，不支持拍照附件。
- 相机扫码无法在自动化测试里覆盖：`scripts/scan.test.mjs` 覆盖码值清洗、去重与候选分类，`scripts/mobile-receiving.test.mjs` 覆盖数量与幂等，摄像头、授权弹窗与真机入库必须真机验收。
