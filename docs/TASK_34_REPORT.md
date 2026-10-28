# 任务 34：Android 真机验收与测试 APK

检查日期：2026-10-26—28（Asia/Shanghai）。状态：**已按用户确认范围完成核心真机验收与测试 APK 交付**。独立 APK 入出库、库存对账与权限检查通过；用户决定不继续剩余手机异常测试，未执行项如下单列，不计为通过。

2026-10-28 后续状态同步：用户已另行授权继续任务33，统计草稿转为正式实施，进展及结果见 `TASK_33_REPORT.md`。下文“任务33未启用”等描述为任务34收尾时的历史记录。本次不重复手机验收，保留下列未执行项。

## 最终验收结果（2026-10-28）

用户确认独立 APK 的入库、出库和只读权限正常，并明确表示不再继续其余手机异常测试，转入下一任务。因此本阶段按用户接受范围收尾；不是“全部原计划用例均通过”。

| 检查项              | 实际结果及验证方式                                                                                                            |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| API / 数据库 / LAN  | HTTP 200 / reachable；手机实际通过电脑 WLAN IPv4 连接，无 ADB reverse/forward 映射                                            |
| 独立 APK            | 小米 13 / Android 16 已安装运行；手机安装包 SHA-256 与交付文件一致，签名 v1/v2/v3 校验通过                                    |
| 登录 / 库存查询     | 用户确认独立包可登录、按名称搜索库存；首次打开库存页需输入关键词并点击查询                                                    |
| 包裹及商品扫码      | 真实面单查询、前导零包裹二维码、多承运商候选选择、商品重复扫描合并已实际验证；一次屏幕商品码未识别，重试后恢复，未改业务校验  |
| 独立包入库          | 收充电器 1 件：库存 3→4，成本 55.5000→74.0000；一张新入库单、一条明细和流水                                                   |
| 独立包出库          | 5 件草稿不改库存，用户确认超库存被拒；修改为 1 件后出库，库存 4→3、成本回到 55.5000，仅一次扣减                               |
| 重复提交            | 对手机真实操作号和相同内容实际 API 重放返回原单；改变内容复用操作号返回 409。未把页面+弹窗的两步确认算成已验证快速双击        |
| 权限 / 商家隔离     | 用户确认独立包只读权限正常；真实 VIEWER API 写入返回 403、读取他商家商品/包裹返回 404，只读测试空间查询为空                   |
| Web / 手机 / 数据库 | 代理实际在 Web 切换至任务34真机验收商家并打开商品库存，看到充电器 3 件 / 55.50 元、数据线 2 件 / 16.00 元，与手机及数据库一致 |
| 流水与历史成本      | 共 2 张入库单、3 条入库明细、2 张已发货出库单、5 条库存流水；数量/成本链闭合，无重复来源明细，采购原价未变                    |
| 本轮自动化          | 移动端五脚本 46 通过 / 0 失败 / 0 跳过 / 0 取消；没有据此冒称硬件场景通过                                                     |

**未执行/未确认：**独立包的相机拒绝及恢复、拒绝相机时手输候选、未知单号、断网及恢复的追加重测，用户明确决定不再继续；标准基座已有未知码/断网恢复记录仍保留。手机同一个最终确认按钮的连续快速双击未得到单独确认，幂等以真实 API 重放及单据/库存对账验证。这些均未标为真机通过。

Web 先前看不到测试数量，是因为停在原业务商家的首页；测试商品属于独立验收商家。已将浏览器切到 `任务34真机验收-4775375d` → `库存管理` → `商品库存`，无筛选时展示两行，查看“当前数量”列；“待入库数量”是尚未收货的采购量。画面证据在 Git 忽略的 `test-results/task34-final-web-stock-20261028.png`，不上传含账号信息的截图。

核心入出库及测试 APK 已交付；没有待修复的已确认业务缺陷。未完成的统计任务33仍保持未启用草稿。用户将另行发送下一任务的编号与要求，本次不提前开发。

## 2026-10-28 现场过程记录

- 用户要求继续完成任务 34。现有 API 健康接口 HTTP 200 / 数据库 reachable，电脑 WLAN 仍为 192.168.243.90，手机通过 USB 识别，独立包 com.caicang.manager.test 已安装。直接读取手机安装 APK 的 SHA-256，与保留的测试 APK 完全一致：`74fbd15ec19adc413a98a16e87c02a96561c472d49ff2aa151781021e796ba09`，不是调试基座。
- 重新核对真实库存仍为充电器 3 件 / 55.5000、数据线 2 件 / 16.0000；保存独立 APK 事务前快照。查询前导零单号 0000340000002 返回 YTO/ZTO 两个候选，ZTO 包裹可收明细接口 HTTP 200；已提供二维码，随后用户在独立包完成只收充电器 1 件、数据线 0 件，结果见下文。没有代用户修改库存。
- 移动端五脚本重跑：46 通过 / 0 失败 / 0 跳过 / 0 取消（32.81 秒），日志 `test-results/task34-final-mobile-tests-20261028.log`。仍区分 Node/API 自动化与真机操作。
- 为后续手机无权限检查创建独立“任务34只读验收-4775375d”，只在该新测试空间将用户当前账号加入为 VIEWER；原测试商家 ADMIN 和其他既有成员关系保持。该空间查询原测试商家商品返回 HTTP 404，无跨商家泄露。后续用户确认手机只读权限正常。
- 用户确认在独立 APK 扫前导零二维码、从两承运商候选选择 ZTO 后，充电器收 1 件、数据线收 0，库存变为 4/2。数据库核实只新增入库单 `RCV-20261028-9EFAF5F9FB`（北京时间 13:14:20），一条明细/一条 RECEIPT 流水，充电器 3→4、成本 +18.5000，余额 74.0000；数据线保持 2 / 16.0000。同操作号原请求 API 重放 HTTP 200 返回原单。证据 `task34-apk-after-receipt-20261028.json`。用户尚未单独确认实际重复点击动作，不单凭数量正确就记作物理双击通过。
- 商品扫码首次出现“相机一直不识别、无提示”，商品条码真实查询接口 HTTP 200 唯一匹配充电器 4 件，近 500 条 App 进程日志未见相关 JS/扫码异常。重新展示同内容二维码/大 Code128 条形码后用户确认恢复识别；保留首次失败和重试结果，没有改商品条码或关闭校验。
- 用户确认同商品重复扫描合并、5 件显示库存不足，改 1 件后按页面按钮和弹窗两步确认发货。数据库捕捉到 5 件草稿时库存仍为 4 件；随后同一单 `OUT-20261028-6F5DA10408` 更新为 1 件并 SHIPPED（北京时间 13:22:55），只产生一条 OUTBOUND 流水和一次发货审计，库存 4→3、成本 -18.5000。数据线仍 2 / 16.0000。两步确认属于正常交互，不记为已单独证实连续双击同一按钮。
- 对独立包这次发货原操作号/原请求实际重放 HTTP 200 返回原单；同操作号改运单内容返回 409 IDEMPOTENCY_CONFLICT。最终只读对账：2 张入库单、3 条入库明细、2 张已发货出库单、5 条库存流水；每条流水前后数量与成本连续，余额等于流水合计，无重复 source_item_id；充电器 3 / 55.5000、数据线 2 / 16.0000。采购原价仍 18.50 / 8.00，采购数量 10 / 4、累计入库 6 / 2。证据 `task34-apk-outbound-progress-20261028-later.json`、`task34-apk-after-outbound-20261028.json`、`task34-final-ledger-20261028.json`。后续用户确认权限正常，并决定不再继续剩余异常场景测试，按最终矩阵记录。
- 现有未跟踪 test/ 目录保留。验收过程未擅自提交或推送；用户随后明确要求将完成的任务34上传 GitHub，仅同步本次文档。

## 2026-10-27 现场记录（历史）

- 继续工作时 Docker/API/Web 已停止，首次数据库查询报 `ECONNREFUSED ::1:5432 / 127.0.0.1:5432`。正常启动现有 Docker Desktop 后原容器自动恢复 healthy，API 重新监听 `0.0.0.0:3000`，LAN 健康检查返回 200 / database reachable，Web 监听 `127.0.0.1:5173`；未重建数据库或修改安全策略。
- 用户自行登录 DCloud，并授权首次申请 AppID `__UNI__D5AEA8E`；官方真机运行插件已安装，Android 基座 14.76 安装成功。前两次安装报 `INSTALL_FAILED_USER_RESTRICTED`，用户开启 USB 安装后第三次成功。没有关闭系统安全检查。
- 使用独立商家 `任务34真机验收-4775375d`，采购单 `T34-4775375d`：订购充电器 10 件 × 18.50、数据线 4 件 × 8.00，无运费优惠。将用户提供的圆通运单（末六位 125060）绑定到测试包裹；用户当前账号只在该测试商家新增 ADMIN 成员，原商家权限未改。
- 用户确认手机相机实际识别真实面单、详情正确；扫码前后数据库快照完全相同：没有新增收货、余额、流水或改变采购/包裹状态。
- 用户于 2026-10-26 20:43（北京时间）在手机确认充电器 5 件、数据线 2 件入库。2026-10-27 实查入库单 `RCV-20261026-43F5548CC7`，只有 1 张入库单、2 条明细、2 条 RECEIPT 流水、1 条 RECEIPT_CONFIRMED 审计；余额分别为 5 / 92.5000 和 2 / 16.0000，采购单 PARTIAL_RECEIVED，当前包裹 RECEIVED，其余两个包裹 CREATED。
- 以真实手机操作原 `clientOperationId` 和相同请求重放 `POST /receipts` 返回 HTTP 200、同一入库单 ID；余额、入库单数和流水数保持不变。请求编号 `6e22e964-8bb4-48cc-8796-98d99d6a8c9b`。这是 API 幂等重放验证，不能冒充手机重复点击测试。
- 用户已在手机识别测试商品码 `06912345000017`，看到可用库存 5 件，填写测试收件信息后保存并确认出库 2 件，反馈剩余 3 件。数据库核实出库单 `OUT-20261027-816E99683F`（2026-10-27 13:53:33 北京时间）为 SHIPPED，只有一条出库明细、成本单价 18.5000；流水 5→3、成本变动 -37.0000，充电器余额 3 / 55.5000，数据线保持 2 / 16.0000；审计分别记录草稿创建和发货。二维码是测试商品标签，真实快递面单扫码另有上述记录。
- 对上述手机出库的原操作号和原请求重放，HTTP 200 返回原单，没有重复扣库存；请求编号 `203bae62-b607-4b81-bdbb-4d08482a770c`。在当前库存 3 件时新建独立 4 件出库草稿并确认，实际 API 返回 409 OUT_OF_STOCK（`56b3130c-4bcc-4288-b629-9e83f3a5bc69`），该拒绝测试草稿保留为 DRAFT；专用 VIEWER 账号创建出库返回 403 FORBIDDEN（`844632f3-65a9-4c39-8be2-827c4274b46c`）。三项校验后余额及总共三条库存流水均不变。这里是 API 重放/拒绝测试，不冒充手机重复点击或无权限页面测试。
- App 云打包插件已获用户授权且界面显示安装成功，本机 `app-safe-pack` 为 2.0.0.2025071610。第一次实际打包校验拒绝：账号未绑定手机号（当前用户和 App 所有者均提示）、新 App 不再支持公共测试证书；另提示 IDE 4.76 使用旧版云 SDK，以及 x86/隐私上架配置提醒。用户已自行完成手机号绑定。
- 改用仓库外自有测试签名，保持 app 编译资源工程、包名 `com.caicang.manager.test`、快速安心打包，取消默认开屏与悬浮红包广告。2026-10-27 13:56:05 提交成功，界面显示 Android 自有证书、当时排队约第 291 位/预计 17 分钟进入打包；未购买加速，当时 APK 尚未生成或安装。排队网页地址含临时凭据，不复制到报告。
- 实际于 13:58:32 已输出 APK，比排队预估早。Android SDK 37.0.0 的 apksigner 校验通过（v1/v2/v3，RSA 2048，证书指纹与仓库外测试证书一致）；aapt2 核对包名、版本、ARM64、CAMERA 权限。压缩包内 AppID、Barcode 模块、LAN API 地址正确，不含私钥文件/环境文件或已知的数据库密码、JWT 密钥、测试账号密码、签名密码。证据扫描不等同于 APK 运行成功。
- 第一次安装该独立包返回 `INSTALL_FAILED_USER_RESTRICTED: Install canceled by user`。用户确认手机已准备后重试，ADB 安装返回 Success；dumpsys 核对独立包版本 0.2.0 / 200，安装时间为 2026-10-27 14:48:23。没有修改安全检查或卸载已有调试基座。
- 用户逐项确认标准基座的追加现场检查：手输 `0000340000002` 完整保留前导零且出现两家快递候选；`UNKNOWN-T34` 提示未找到；关闭 Wi-Fi 和移动数据后刷新提示网络失败，恢复 Wi-Fi 后充电器仍 3 件；电脑 Web 切换测试商家刷新同样为充电器 3 件、数据线 2 件。该记录为用户实际反馈，不冒充独立 APK 检查。
- APK 安装成功后，一条包含健康检查、ADB 启动新 APK、读取安装版本的组合命令被自动审批以 `blocked by policy` 拒绝，未给出具体原因，整条命令未执行。没有换方式重试启动；请用户手动打开独立应用。随后独立执行只读健康检查返回 HTTP 200 / reachable、只读 dumpsys 确认上述安装版本成功。等待用户在独立包登录/查询/扫码反馈。
- 用户随后在独立 APK 确认：可以扫码查看原圆通包裹；库存页分别搜索“充电器”“数据线”，得到 3 件和 2 条。代码与现场画面核实当前库存页仅在输入关键词并点击查询后请求余额，首次进入显示操作说明、不自动列出库存；包裹中的 10/4 是采购数量，当前余额仍为 3/2。真实库存接口再次核对 HTTP 200，结果与数据库一致（请求编号 `071e7ae0-46ff-4717-8b06-78e810d8ebad`），无 App JS 异常日志。独立 APK 的查询/扫码通过，独立 APK 内新增入库与出库事务尚未执行；此前事务证据来自标准基座，不能混记。
- 用户随后要求将此前代码和文档上传 GitHub；本轮不继续操作手机入出库测试。任务 33 仍为未启用的统计源码草稿，任务 34 保留上述未验收项，不宣称整体完成。

### 真机发现并修复的兼容问题

首次 App 白屏，Android 原始日志为 `Uncaught ReferenceError: URL is not defined`（app-service.js:2:1337，随后 weex / WX_RENDER_ERR_JS_CREATE_INSTANCE_CONTEXT）。共享 API 地址校验在模块初始化时依赖浏览器 URL，全局变量在 App JS service 不存在。最小修改为保留 Web/Node 的原生 URL 路径，在无 URL 时严格校验 HTTP(S) 地址，拒绝凭证、非法端口等；同时去除库存查询对 URLSearchParams 的依赖，逐值 encodeURIComponent，保留前导零与商家/仓库范围。冷启动基座后首页和真实扫码入库恢复正常。

独立 APK 的源码 manifest 原未声明 Barcode 模块，标准基座的扫码成功不能证明独立 APK 包含它。按 [DCloud 功能模块说明](https://uniapp.dcloud.net.cn/tutorial/app-modules.html) 增加 `app-plus.modules.Barcode`，保留 CAMERA 权限；重建后编译 manifest 的 permissions 已含 Barcode。没有增加拍照/相册等无关模块。

### 最新自动化与证据

```powershell
pnpm test:mobile-runtime
pnpm --filter @caicang/mobile typecheck
pnpm exec eslint apps/mobile packages/utils scripts/mobile-runtime.test.mjs --max-warnings 0
pnpm exec prettier --check apps/mobile/src/manifest.json scripts/mobile-runtime.test.mjs
pnpm build:mobile:lan -ApiBaseUrl 'http://192.168.243.90:3000/api/v1'
node --test --test-concurrency=1 scripts/mobile-runtime.test.mjs scripts/mobile.test.mjs scripts/scan.test.mjs scripts/mobile-receiving.test.mjs scripts/mobile-outbound.test.mjs
```

2026-10-27 结果：运行时回归 3/3；完整上述五脚本 **46 通过、0 失败、0 跳过、0 取消**（49.44 秒）；移动端类型检查、作用域 ESLint、上述 Prettier check、LAN App 构建全部通过。前一轮修复后曾有 API 启动等待超时，记录为 43 通过/2 失败（父子测试计数）；单独重试出库 7/7，随后五脚本 45/45。新增 Barcode 配置回归后才是本轮 46/46。未删除失败日志、未改断言掩盖失败。全量 pnpm test 本任务未执行。

`git diff --check` 通过（有 Windows 换行提示）。额外对四份 Markdown 文档运行 Prettier check：TASK_34_REPORT 通过，MOBILE_APP / CODEX_TASKS / DECISIONS 仍有格式提示；未对这些包含大量既有修改的文档做整篇自动重排。该检查未记为通过。

证据位于 Git 忽略的 test-results：`task34-after-phone-receipt.json`、`task34-receipt-api-replay.json`、`task34-after-phone-outbound.json`、`task34-outbound-api-safety.json`、`task34-signing-metadata.json`、`task34-before-real-scan.json`、`task34-after-real-scan.json`、`task34-real-parcel-detail.png`、`task34-mobile-tests-current.log`、`task34-app-resources-current.log`、`task34-mobile-typecheck-current.log`、`task34-lint-current.log`。私有测试账号资料仅在忽略文件中，不在报告保存密码或 Token。四份既有环境文件与初始 SHA-256 对比均未改变。

只读核验脚本第一次误用 `unit_cost_snapshot`，第二次误用 `source_id`，均报 PostgreSQL 42703；按实际 schema 改成 `shipped_unit_cost`、`source_item_id` 后核验通过。这两次是核验 SQL 错误，没有修改数据库或业务代码，不记为业务接口失败。

## 初次环境检查（2026-10-26 历史记录）

| 项目                | 结果与证据                                                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Docker / PostgreSQL | Docker Desktop 4.95.0，Docker Client/Server 29.8.2；`caicang-postgres` running / healthy，PostgreSQL 16.15                         |
| 迁移状态            | 现有 10 个迁移，数据库结构最新；未重置、未重复应用 schema.sql、未删除卷                                                            |
| API                 | 重新构建并启动，监听 `0.0.0.0:3000`；健康接口返回数据库 reachable                                                                  |
| Web                 | `pnpm dev:web` 启动，`http://127.0.0.1:5173/`                                                                                      |
| Android USB         | 小米 13 / 型号 2211133C，Android 16 / API 36；ADB 1.0.41（platform-tools 37.0.0）识别为 device，用户已授权                         |
| 手机到电脑 WLAN     | 手机在 192.168.243.0/24 网段，电脑 192.168.243.90；手机内 curl 请求电脑健康接口 HTTP 200；未用 adb reverse/forward 冒充 WLAN       |
| 防火墙              | 当前 WLAN 为 Public，现有 Node.js 程序 Inbound Allow 规则适用 Public；实际 HTTP 已连通，未新增规则或关闭防火墙                     |
| HBuilderX 导入      | `D:\HBuilderX\HBuilderX\cli.exe project open --path D:\Dev\caicang-manager\apps\mobile` 成功；project list 返回 mobile(UniApp_VUE) |
| App 编译资源        | `pnpm build:mobile:lan -ApiBaseUrl 'http://192.168.243.90:3000/api/v1'` 成功，编译器 5.24，产物含指定 LAN URL                      |
| 移动端类型检查      | `pnpm --filter @caicang/mobile typecheck` 通过                                                                                     |
| API 类型检查及构建  | `pnpm --filter @caicang/api typecheck`、`pnpm --filter @caicang/api build` 均通过                                                  |
| 相关静态检查        | `pnpm exec eslint apps/mobile apps/api/src/app.module.ts --max-warnings 0` 和对应源码 Prettier check 通过                          |
| 自动化测试          | 下列 4 个脚本：43 通过、0 失败、0 跳过、0 取消；包括独立测试数据库的真实 API 联调和纯逻辑测试，**不包括物理相机/手机页面操作**     |

```powershell
node --test --test-concurrency=1 scripts/mobile.test.mjs scripts/scan.test.mjs scripts/mobile-receiving.test.mjs scripts/mobile-outbound.test.mjs
```

本机证据保存在 Git 忽略的 `test-results/task34-*`：`mobile-tests.log`、`mobile-typecheck.log`、`app-resources.log`、`phone-health.log`、`hbuilder-projects.log`、`firewall-readonly.json`、`api-runtime.log`。其中自动化出库流程由页面共用客户端模块驱动，验证 10→7、重复确认仍 7、超库存拒绝、修改后 5；这仍然不是手机实扫。

## 初次检查的阻塞与后续解决情况

1. 初次缺少真机运行插件，现已获用户授权安装。
2. 初次未登录且 AppID 为空，现用户已自行登录，并授权申请自己的 AppID。
3. 编译器 5.24 与 IDE/原生 SDK 4.76 的本次测试路径已在小米 13 验证；未升级依赖或关闭版本检查，结果不外推到未测机型。
4. `.env.development` 仍为 localhost，production 仍为示例域名。LAN 构建通过进程变量注入真实地址，**没有修改任何 .env 文件**。HBuilderX 运行源码会重新编译，须另行配置本机 LAN 覆盖并验证「我的」页 API 地址；不能直接用默认源码运行宣称通过。
5. `dist/build/app` 是 App 资源；DCloud 标准基座已安装并完成真实面单扫码入库和扫码出库、前导零/多候选手输/未知码/断网恢复/Web 对账。独立 APK 已生成并真实安装成功，独立包核心事务和权限已验证；其余异常场景按最终矩阵记录，未执行项不计通过。

曾有一条组合命令（LAN 健康检查、创建本地环境覆盖、启动 Web）被自动审批以 `blocked by policy` 拒绝，没有给出具体理由；整条命令未执行。没有换方式重试其中的环境文件写入。随后采用只读检查、既有 LAN 构建脚本及独立 Web 启动完成可行准备。

## 恢复运行步骤

```powershell
cd D:\Dev\caicang-manager
# Docker Desktop 正常运行后，已有环境文件保留
pnpm db:up
pnpm prisma:migrate:status
pnpm start:api
# 另一个终端；先用 ipconfig 核对地址，如已变化需替换以下 IPv4
pnpm dev:web
pnpm build:mobile:lan -ApiBaseUrl 'http://192.168.243.90:3000/api/v1'
& 'D:\AndroidstudioSDK\platform-tools\adb.exe' devices -l
```

目前 API/Web 已运行，不要再重复启动同端口服务。手机浏览器打开 `http://192.168.243.90:3000/api/v1/health`。本轮手机内 curl 已验证，但浏览器与 App 须各自验证。无需暴露 5432，PostgreSQL 保持仅本机监听。

用户自行登录 DCloud 后，在源码 `src/manifest.json` 配置真实 AppID；经确认安装官方真机运行插件。按 IDE 提示核对基座版本与项目编译器，不能忽略不匹配提示。源码方式先配置本机 LAN 环境覆盖；编译资源方式则在配置 AppID 后重新执行 LAN 构建，再导入 `apps/mobile/dist/build/app`（CLI 的实际运行提示），识别类型与基座兼容性仍须现场验证。运行到已授权 Android 手机，记录基座版本和 App「我的」页服务地址。

## 原始测试计划（参考场景，不作为实际执行结果）

下表是原计划的操作清单，不表示全部通过；**实际状态和数量以上方最新现场记录为准**。真实面单识别、扫码不改库存、一次两 SKU 入库、扫码出库及 API 幂等重放已验证；未执行项及测试方式以最终矩阵为准。只操作专用测试商家。设备相机授权/拒绝与断网开关由用户亲自操作。

| 用例                | 操作与验收条件                                                                                                                                        |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 登录 / 商家         | 使用专用验收账号登录，核对角色、商家与 API 地址；退出后受保护页面不能继续访问                                                                         |
| 正常实扫            | 把真实面单运单字符串绑定至测试采购包裹，使用后置相机实际识别；记录单号末几位、包裹 ID、采购单 ID，须匹配正确                                          |
| 前导零              | 准备包含前导零的测试条码，扫后显示和 API 查询均保持完整字符串，不转数字；与真实面单用例分别记录                                                       |
| 多候选              | 同商家同运单、不同承运商的两包裹；扫码后由人选择正确候选，不能自动选第一项                                                                            |
| 未知码 / 手输       | 未知码给明确提示，可重试；手输或粘贴有效码可查，空白/超长输入被拒                                                                                     |
| 拒绝相机            | 用户拒绝权限后有可恢复提示与手输入口；用户授权后重新扫描能恢复，取消不记作成功                                                                        |
| 扫码不改库存        | 比较扫码前后收货单、库存余额、流水、采购/包裹状态；仅查包裹不得新增收货或改变数量成本                                                                 |
| 实际入库            | 专用采购 10 件、单价 18.50、无运费优惠；先部分收 5 再收 5。手机二次确认后每次只增加实际确认数，最终 10 件/185.0000；Web 刷新及数据库同值              |
| 重复扫描 / 重复提交 | 连续同码查询不重复并发；同一入库操作 ID、相同请求重试只返回原单，不重复加库存。成功后新操作 ID 是另一笔合法部分收货，不能把它当成同操作重试           |
| 扫码出库            | 扫测试商品码选 3 件、保存草稿时库存仍 10；二次确认成功后为 7 件/129.5000，出库成本 55.5000，Web 和数据库一致；重复扫商品只加待发量                    |
| 出库幂等 / 库存不足 | 同一确认操作 ID 重试仍 7；尝试发 8 被拒且仍 7，无额外出库流水                                                                                         |
| 断网 / 恢复         | 用户断网后查询/提交提示失败，不提前改变本地余额；恢复网络后同内容复用原操作 ID，对未知提交结果安全重试；刷新 Token 失败可能要求重新登录，记录实际行为 |
| 无权限 / 跨商家     | BUYER/VIEWER 不可确认库存写操作；尝试他商家资源返回 403/404，不泄露详情，库存不变                                                                     |
| 单据与对账          | 每个确认操作只产生一张对应单和预期流水；按商家+仓库+商品核对余额等于流水合计，前数量+变动=后数量，成本保持闭合；保留脱敏结果及请求编号                |

数量/成本场景相互隔离，不能在已收满 10 件的包裹继续测试新增收货；未知结果的重试保留原请求。实际采购存在运费、优惠时以服务端分摊后成本验收，不能套用上表 18.50 示例。

## 测试 APK 与签名

目前独立测试 APK：**已生成、签名和包内容检查通过；初次安装被手机取消，重试安装成功，独立 APK 核心业务及库存对账已通过，其余未测项按用户决定收尾**。DCloud 标准基座不作为测试 APK 交付。公共测试证书已被当前 DCloud 校验拒绝；插件安装与用户手机号绑定完成后，改用下述自有测试签名生成 APK。

| 交付项                    | 实际结果                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 稳定保留路径              | `artifacts/android/caicang-manager-test-0.2.0-200-20261027.apk`（Git 忽略；复制留存，避免下次 LAN 资源构建清理 dist）                 |
| HBuilderX 原输出          | `apps/mobile/dist/build/app/unpackage/release/apk/__UNI__D5AEA8E__20261027135605.apk`                                                 |
| 大小                      | 14,624,099 字节                                                                                                                       |
| APK SHA-256               | `74fbd15ec19adc413a98a16e87c02a96561c472d49ff2aa151781021e796ba09`                                                                    |
| AppID / 包名              | `__UNI__D5AEA8E` / `com.caicang.manager.test`                                                                                         |
| versionName / versionCode | `0.2.0` / `200`                                                                                                                       |
| min / target SDK；ABI     | 21 / 33；arm64-v8a                                                                                                                    |
| API 地址                  | `http://192.168.243.90:3000/api/v1`，仅本次局域网开发测试；电脑 IP 改变后需重新构建                                                   |
| 构建状态                  | 未提交的任务 34 工作区，HBuilderX / 原生云 SDK 4.76、CLI 编译器 5.24；跨版本风险保留，未关闭版本检查                                  |
| 校验日志                  | `test-results/task34-apk-signature.log`、`task34-apk-badging.log`、`task34-apk-artifact.json`                                         |
| 安装日志                  | `test-results/task34-test-apk-install.log` 首次 USER_RESTRICTED；`task34-test-apk-install-retry.log` 重试 Success，安装版本已只读核对 |

apksigner 同时对 META-INF 版本/服务条目给出 JAR(v1) 警告，完整保留在日志；v2/v3 整包签名验证通过，没有删除这些条目或重打补丁。APK 扫描脚本初次因 Windows 默认 GBK 读取 UTF-8 测试夹具失败，显式使用 UTF-8 后检查通过；不涉及业务代码修改。

准备真实 AppID、兼容编译器/基座后，使用 HBuilderX「发行 → 原生 App 云打包」生成 Android 测试 APK。云打包会上传项目打包资源到 DCloud，操作前核对所选项目、测试服务地址与测试签名方案。云打包成功仍需安装 APK，重测相机、联网与核心业务。

已按 [DCloud Android 证书指南](https://ask.dcloud.net.cn/article/35777) 使用现有 HBuilderX Amazon Corretto 17 的 keytool 生成 RSA 2048 / SHA256withRSA / JKS 测试证书：`D:\CaicangSigning\caicang-task34-test.keystore`，别名 `caicang_task34_test`；有效期至 2054-03-14，公开证书 SHA-256 为 `CB:AC:DB:F6:8F:39:56:17:E2:0B:44:50:9E:9C:19:EC:9D:5E:F2:B9:F0:77:65:88:A1:D0:70:F8:A5:9A:FA:FD`。密码安全随机生成，只在仓库外本机签名配置中保存；keytool 通过子进程环境读取，不将密码放入命令行或日志。源码 manifest、编译 manifest、app-service.js 均检查不含该密码。

HBuilderX 自有证书界面选择上述文件和别名，两处签名密码相同；使用 [安心打包](https://uniapp.dcloud.net.cn/tutorial/build/SafePack.html)，原生模块配置发至云端，前端代码合并和证书签名在本机进行。没有创建云端证书。签名说明在仓库外 `D:\CaicangSigning\TASK34_SIGNING_README.txt`；不要把该目录的私钥和密码配置上传 Git/聊天。相同测试包的后续安装升级须保留该证书，正式发布请另行管理生产证书。

已在独立 APK 验证登录、扫码、入出库和库存查询，实际结果见最终矩阵；基座内的历史测试没有直接记入独立包通过。

## 本轮修改与数据保护

- `docs/TASK_34_REPORT.md`：实际证据、阻塞、运行/签名流程与待执行清单。
- `docs/MOBILE_APP.md`：修正库存/出库仍未实现、收货是唯一写库存页面等过时说明，补充已验证 WLAN 与 IDE 状态。
- `docs/CODEX_TASKS.md`：当前阶段改为任务 34，明确任务 33 草稿暂停。
- `apps/api/src/app.module.ts`：撤下本会话先前未完成统计模块的注册，保留任务 30—32 与其他既有模块；统计源码草稿仍保留，不扩大本次功能。
- `packages/utils/src/index.ts`：修复 App service 无 URL 时的 API 地址校验。
- `apps/mobile/src/services/stock.ts`：移除库存查询对 URLSearchParams 的依赖。
- `apps/mobile/src/manifest.json`：用户授权取得的 AppID 与独立打包必需的 Barcode 模块。
- `scripts/mobile-runtime.test.mjs`、`package.json`：真实源码运行时兼容回归和测试命令。
- `docs/DECISIONS.md`：记录 App 运行时兼容和原生扫码模块决定。

保留全部已有工作区修改。真机验收阶段没有数据库重置、删除卷、覆盖环境文件、关闭安全检查或自行提交/推送。后续用户明确要求将已有工作上传 GitHub，按以下范围同步；全量 pnpm test 本轮未执行。

## 用户授权的 GitHub 同步检查（2026-10-27）

用户要求把此前已做内容上传，包含任务 30—32、已有 API 启动/注册和采购账号修复，以及任务 34 的运行时兼容、测试和现场报告；任务 33 的统计草稿保留但未启用。此次不继续开发业务或操作手机入出库。

- `pnpm typecheck`、`pnpm lint`、`pnpm format:check` 均通过；API 构建、API 测试夹具构建、Web 构建通过。Lint 首次对统计草稿 CSV 的两处刻意匹配 ASCII 控制字符的正则报 no-control-regex；只增加逐行原因说明与规则豁免，正则及业务行为未变，随后 Lint 通过。
- 以下八脚本第一次合跑 102 通过 / 1 失败 / 0 跳过，失败为 API 基础测试夹具等待启动超时；失败日志完整保留。该脚本单独重跑 68/68，最后整组重跑 **140 通过、0 失败、0 跳过、0 取消**（104.89 秒），未修改断言或测试超时。

```powershell
node --test --test-concurrency=1 scripts/api-foundation.test.mjs scripts/registration.test.mjs scripts/purchase-accounts.test.mjs scripts/web-adjustments.test.mjs scripts/purchase-returns.test.mjs scripts/purchase-returns-migration.test.mjs scripts/web-purchase-returns.test.mjs scripts/mobile-runtime.test.mjs
```

- 输出在本机 Git 忽略的 `test-results/github-*.log`；相关测试通过不表示全量测试或独立 APK 事务已验收。
- 待提交文件与 Git 暂存内容均扫描本机真实凭据，未发现数据库/JWT/签名/专用测试账号密码或私钥。APK、签名、环境文件和本机测试证据均未暂存。`git diff --cached --check` 通过。
- GitHub 直连先后发生连接重置与 443 超时；随后使用电脑已启用的本地代理作为 Git 单次命令参数成功 fetch，未修改全局代理或 Git 配置，确认本地和远端 main 没有历史分叉。提交/推送结果以交付时实际 Git 回执为准。
