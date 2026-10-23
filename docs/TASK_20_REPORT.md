# 任务 20 报告 — Android 手机扫一扫

## 2026-10-23 补充验收（优先于下方历史结论）

Docker/PostgreSQL 环境已通过正常启动恢复。`pnpm test:scan` 实际 **10 通过、0 失败、0 跳过**。手机联调测试实际 **15 通过、0 失败、0 跳过**，其中新增子测试使用手机端实际 `lookupPackages` 与会话客户端调用真实 NestJS/隔离 PostgreSQL，验证：前导零单号原样返回、唯一结果、不同承运商同号的两个候选、未知单号空列表、跨商家查询空列表与详情 404。查询前后对比收货单/明细/库存余额/流水的完整数据库行，以及采购单/包裹状态，均保持不变。

新增测试首次使用了错误的 lookup 字段 `id`，实际契约为 `packageId`，已修正测试接线并保留失败日志。原扫码逻辑与断言没有放宽。前述真实联调不覆盖 `uni.scanCode`、Android 相机和系统授权弹窗。

实际 App 资源构建成功，资源内已核对当前电脑 LAN 地址 `http://192.168.243.90:3000/api/v1`。原 `.env.development` 的 localhost 与 `.env.production` 的示例域名均未覆盖；使用新 Windows 命令 `pnpm build:mobile:lan -ApiBaseUrl 'http://192.168.243.90:3000/api/v1'`，不会误读正式示例域名。该地址可能随 Wi-Fi/DHCP 改变，重新构建前用 `ipconfig` 核对。

**Android 真机验收未完成，未构建/安装/验证签名 APK。** 未检测到 HBuilderX 或已连接 Android。导入方式与可执行的八项清单见 [手机说明](MOBILE_APP.md)。下方是任务交付时的历史记录，其中“改 .env.development 后直接 build:app”的旧步骤应由手机说明第七、八节取代；全量回归见 [阶段报告](STAGE_REVIEW_00_20.md)。

## 一、结论

`apps/mobile` 新增了真正调用官方 `uni.scanCode` 的扫码页与包裹详情页，扫码结果只用于查询包裹，**不写收货单、不动库存**。

- 12 项要求全部落地，`typecheck` / `lint` / `format:check` 通过，H5 与 App 两套产物构建成功。
- 扫码逻辑被抽到框架无关的 `services/scan.ts`，`scripts/scan.test.mjs` **10/10 通过**（前导零、输入校验、请求拼装、候选分类、去重闸门、路由与"不写库存"静态校验）。
- **摄像头与授权弹窗只能在真机上验收**，本机没有 HBuilderX 与连接的 Android 设备；同时 Docker 被系统策略拦截，真实 `lookup` 链路未在本机复跑（与任务 19 同一原因）。这两项都明确写在第五节，没有当作通过。

## 二、12 项要求的落地

| # | 要求 | 实现 | 位置 |
| --- | --- | --- | --- |
| 1 | 点击"扫一扫"打开摄像头 | 320rpx 大按钮 → `uni.scanCode` | `pages/scan/index.vue` |
| 2 | 请求相机权限 | Android 清单声明 `CAMERA`；调用前用 `getAppAuthorizeSetting` 预判，`uni.scanCode` 首次调用触发系统授权 | `manifest.json`、`pages/scan/index.vue` |
| 3 | 扫描快递面单运单码 | `scanType: ['barCode','qrCode']`，`onlyFromCamera: true`（不允许相册选图） | 同上 |
| 4 | 保留前导零 | `normalizeTrackingNo` 只 trim，不转数字、不改大小写 | `services/scan.ts` |
| 5 | 调 `GET /packages/lookup` | `lookupPackages(api, code, tenantId)`，query 参数 `encodeURIComponent` | `services/scan.ts` |
| 6 | 唯一包裹进详情 | `classifyLookup` 返回 `single` → `navigateTo('/pages/package/index?id=…')` | `pages/scan/index.vue`、`pages/package/index.vue` |
| 7 | 多候选手动选择 | 列出采购单号 / 承运商 / 收货状态 / 已收件数，点选后进详情，不自动取第一条 | `pages/scan/index.vue` |
| 8 | 未知单号异常流程 | `notFound` 面板：单号有误 / 未绑定采购单 / 属于其他商家 + 补录建议 + 重扫 / 手输 / 回首页 | 同上 |
| 9 | 手动输入单号 | 输入框（`maxlength=128`、`confirm-type=search`）+ 粘贴 + 查询 | 同上 |
| 10 | 防止重复请求 | `ScanGuard`：`inFlight` 挡并发，3 秒同码窗口挡连续解码 | `services/scan.ts` |
| 11 | 可重新扫码 | 「重新扫码」→ `guard.reset()` 后直接再开相机 | `pages/scan/index.vue` |
| 12 | 拒绝权限有清晰提示 | `denied` 面板：说明原因 + 「去设置开启」(`openAppAuthorizeSetting`) + 「我已开启，重新扫码」 | 同上 |

`GET /packages/lookup` 需要 `packages:lookup` 权限（OWNER / ADMIN / BUYER / WAREHOUSE），扫码页在 `onShow` 里先校验，缺权限直接回首页并提示，不让用户点了才吃 403。

## 三、设计要点

**码值一律按字符串处理。** 快递单号的前导零是有意义的（`000783456123` ≠ `783456123`），所以整条链路没有一次 `Number()`。`normalizeTrackingNo` 只做三件事：trim、限长 128（与后端 DTO 一致）、拒绝控制字符（扫码枪偶尔会带 `\u0000`）。

**查询是纯 GET。** 页面与服务里没有任何 `POST`/`PATCH`/`DELETE`，`scripts/scan.test.mjs` 用静态断言守住这条线：谁在扫码路径上加了写接口，测试立刻红。详情页也只读 `GET /packages/:id` 与 `GET /receipts?packageId=…`，没有验收按钮。

**防抖分两层，而不是简单节流。** `inFlight` 解决"上一次查询还没回来又扫一次"，3 秒同码窗口解决"摄像头连续解码同一张面单"。窗口从最后一次被接受的扫码算起；用户点「重新扫码」调 `reset()` 清空，允许立刻重扫同一个箱子——否则仓管复核时会以为 App 卡了。

**多候选不替用户做主。** 同一运单号可能被不同承运商复用，猜错会把货记到别的采购单上，所以必须让用户看清采购单号再点。

**H5 不伪装成扫码。** `plus` 不存在时（浏览器预览）点扫码直接弹提示，引导用手动输入。这样"在浏览器里点了一下"不会被误当成真机验收。

**权限被拒不是死路。** 面板里既能跳系统设置，也能"我已开启，重新扫码"；`uni.scanCode` 的 fail 回调还会识别 `auth|permission|denied|权限` 关键字兜底切到权限面板，避免某些机型只给一句 `scanCode:fail`。

## 四、实际执行的检查

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @caicang/mobile typecheck` | 通过（`vue-tsc --noEmit`） |
| `pnpm lint` | 通过，0 warning |
| `pnpm format:check` | 通过 |
| `pnpm --filter @caicang/mobile build` | 成功，`dist/build/h5` |
| `pnpm --filter @caicang/mobile build:app` | 成功，`dist/build/app`（HBuilderX 可直接导入） |
| `node --test scripts/scan.test.mjs` | **10/10 通过** |
| `node --test scripts/mobile.test.mjs` | **3 通过 / 1 跳过**（页面清单已更新为 7 个页面；真实 API 用例跳过原因见第五节） |

`scripts/scan.test.mjs` 覆盖的 10 组断言：

1. `000783456123` 原样返回，`typeof` 仍是 string；trim 只裁首尾；`000T14-0` 内部符号不被改写。
2. 空 / 纯空格 / `null` / `undefined` → `EMPTY`；129 字符 → `TOO_LONG`；含 `\u0000` → `INVALID`。
3. 请求路径是 `/packages/lookup?trackingNo=000783456123`，商家走 `tenantId` 头不走 query，默认 GET。
4. 非法码值在发请求前就被拦下（`request` 调用次数为 0）。
5. `classifyLookup`：0 → `none`、1 → `single`、≥2 → `multiple`。
6. `ScanGuard`：并发 `busy`、3 秒内同码 `duplicate`、超窗 `ok`。
7. 上一次查询结束后换单号可立刻扫。
8. `reset()` 后同一单号立刻可重扫。
9. `pages.json` 注册了 `pages/scan/index` 与 `pages/package/index`，tabBar 仍是 3 项；扫码页确实用 `uni.scanCode` + `scanType: ['barCode','qrCode']` + `onlyFromCamera` + 授权 API + 各状态面板 + 手动输入；详情页展示预计明细与该包裹入库单。
10. 扫码页 / 扫码服务 / 详情页三处都没有写接口、没有 `confirm-receiving`、没有 `complete-receiving`。

## 五、没跑起来的部分与原因

**1）真实 `lookup` 链路本机无法执行。** 与任务 19 同一阻塞：`wsl.exe` 在「安全中心 → 命令安全 → 程序黑名单」中，Docker Desktop 无法启动，本机也没有原生 PostgreSQL，5432 无监听。`scripts/mobile.test.mjs` 的真实 API 子测试因此标记 `SKIP` 并打印原因。

处理方式：**没有用 mock 冒充真实接口**。服务端 `lookup` 的语义（前导零、精确匹配、多承运商候选、跨商家隔离、`VIEWER` 无 `packages:lookup`）已由 `scripts/packages.test.mjs` 在真实 PostgreSQL 上覆盖；客户端到服务端的拼装由 `scripts/scan.test.mjs` 用注入 transport 覆盖。缺的只是"这一版客户端 + 这一版服务端"合起来的端到端一次。

解除后执行：`pnpm db:up && pnpm test:mobile`。

**2）摄像头扫码、系统授权弹窗只能真机验收。** 本机未安装 HBuilderX，也没有连接的 Android 设备，自动化测试无法覆盖相机硬件行为。这属于任务验收里明确要求人工确认的部分，步骤见第六节。

## 六、HBuilderX 真机调试步骤

前置：后端已启动、手机与电脑同一 Wi-Fi、手机开启开发者模式与 USB 调试。

```powershell
cd D:\Dev\caicang-manager
pnpm start:api   # 终端一保持运行
# 终端二，先用 ipconfig 核对 WLAN IPv4；以下为本轮实际地址
pnpm build:mobile:lan -ApiBaseUrl 'http://192.168.243.90:3000/api/v1'
```

1. 电脑上 `ipconfig` 查到局域网 IPv4，确认手机浏览器能打开 `http://<该IP>:3000/api/v1/health`。打不开先定位网络/策略；调整防火墙或安全设置前须用户确认。
2. HBuilderX 源码 CLI 工程导入选 `apps/mobile`；编译器还提示可导入 `apps/mobile/dist/build/app` 资源。两者的配置差异和待验证边界见 MOBILE_APP 第八节，未实测 IDE，不宣称导入通过。
3. 在源码 `src/manifest.json` 申请自己的 DCloud AppID，再重新构建需要导入的资源；源码由 IDE 重编译时还需开发本地地址覆盖，不能依赖之前终端的临时变量。
4. 手机插 USB，授权调试；HBuilderX `运行 → 运行到手机或模拟器 → 运行到 Android App 基座`。首次会自动安装基座。
5. App 启动 → 登录真实账号 → 首页 → 点「扫码入库」。
6. **首次点「扫一扫」会弹系统相机授权**，选"允许"。若之前误点拒绝：系统设置 → 应用 → 采仓管家 → 权限 → 相机 → 允许，再回 App 点「我已开启，重新扫码」（页面应显示权限面板，而不是静默失败）。
7. **对准一个真实的一维条形码**（快递面单上的运单号最佳）。识别成功后：
   - 屏幕出现「正在查询运单」+ 完整码值；
   - 唯一命中 → 直接进入「包裹详情」，顶部应显示**完整运单号（前导零一个不少）**、采购单号、包裹状态、预计明细与该包裹入库单；
   - 多个命中 → 出现候选列表，点第一条同样能进详情；
   - 没命中 → 「没有找到这个运单的包裹」+ 补录建议。
8. 连扫同一个码两次：第二次应在 3 秒内被拦下并提示"刚刚已查询过该单号"；点「重新扫码」后可立刻再扫。
9. 用手动输入框输入带前导零的单号（如 `000783456123`）→「查询包裹」，结果应与扫码一致。
10. 返回首页点「入库记录」，**不应出现刚才扫码产生的新记录**——这是"扫码不写库存"的现场证据。
11. 已有 adb 时可用 PowerShell `adb logcat | Select-String 'scanCode'` 辅助排查，不记录或转发 Token、密码与完整地址。本轮没有安装 adb 或执行相机日志检查。

验收标准：手机对准实际一维条形码 → 能识别码值 → 显示匹配结果（唯一则进详情）。

## 七、新增与修改文件

新增：

| 文件 | 作用 |
| --- | --- |
| `apps/mobile/src/services/scan.ts` | `normalizeTrackingNo` / `lookupPackages` / `classifyLookup` / `ScanGuard` |
| `apps/mobile/src/pages/scan/index.vue` | 扫码页：相机、授权、查询、候选、未知、手输、重扫 |
| `apps/mobile/src/pages/package/index.vue` | 包裹详情（只读）：采购单、状态、预计明细、入库单 |
| `apps/mobile/src/utils/package.ts` | 包裹/收货/采购状态中文名、时间格式化、状态配色 |
| `scripts/scan.test.mjs` | 扫码逻辑单测 + 路由/接口静态校验（10 项） |
| `docs/TASK_20_REPORT.md` | 本报告 |

修改：

| 文件 | 改动 |
| --- | --- |
| `apps/mobile/src/pages.json` | 新增 `pages/scan/index`、`pages/package/index` |
| `apps/mobile/src/pages/home/index.vue` | 「扫码入库」入口跳扫码页（原来只提示"下一阶段开放"） |
| `apps/mobile/src/pages/scan/index.vue` | 补 `packages:lookup` 权限校验与 `backToInput` |
| `scripts/mobile.test.mjs` | 页面清单断言加入扫码页与详情页 |
| `package.json` | 新增 `test:scan`，并加入全仓 `test` |
| `docs/MOBILE_APP.md` | 新增「九、扫码查包裹」：流程、取舍、排障表 |

无新依赖，无新表，无后端改动。

## 八、未验证与风险

- **真机扫码未执行**：`uni.scanCode` 在 Android 基座上的实际表现（尤其国产 ROM 的权限弹窗差异）只有真机能确认。
- **端到端 lookup 未在本机复跑**：Docker 被拦，客户端与服务端各自都有覆盖，但合起来的一次留待 `pnpm db:up && pnpm test:mobile`。
- **二维码也走同一条清洗逻辑**：如果二维码里塞的是 URL，会被当作运单号去查、返回空结果，属预期行为（本版只支持运单号）。
- **`onlyFromCamera: true`** 意味着不能从相册选图识别；若现场需要"拍照识别"，要另开入口并单独评估。
- 详情页没有验收按钮，收货确认是后续任务；本版严格保持"扫码只查"。
