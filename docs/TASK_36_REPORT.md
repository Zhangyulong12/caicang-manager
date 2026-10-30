# 任务36：全项目最终验收与GitHub整理

执行日期：2026-10-30，Asia/Shanghai。本轮仅复核、补充明确缺失的持久化测试及整理文档；不新增业务、不重置数据库、不发布公网、不替换APK、不提交或推送。

## 结论与验收边界

本轮回归与文档整理完成：全仓自动化744项、数据库模型66项、注册代理8项、生产隔离演练13项均通过，0失败/0跳过；类型、Lint、格式、构建及迁移检查通过。任务27—33已有实际业务与验收，任务34已按用户确认范围完成核心验收；任务35仅安全修复、生产配置及隔离验收完成。不能把本轮自动化通过解释为所有Android异常场景、公网部署或正式上线条件均通过。

开始时main与origin/main一致，HEAD为 `3dba74a677cd267e80bb60ea50a1a83a03dbd11d`。工作区有上轮任务35的未提交修改和原有未跟踪 `test/`；已保留。开工文件SHA-256基线、Git状态、测试原始日志位于忽略目录 `test-results/task36/`，不把其中测试凭据、数据库dump或日志上传GitHub。

## 实际架构与已实现能力

- pnpm workspace 11.25.0、Node.js 22.22.2、TypeScript strict；共享API类型与工具包在packages。
- API：NestJS 12.1.3、Prisma 7.10.0/adapter-pg、PostgreSQL 16、UUID/NUMERIC、10个可追踪迁移。全局DTO、统一响应和requestId、异常脱敏、短期JWT、哈希Refresh Token轮换及撤销。TenantContext核验成员关系，Guard/角色权限与复合外键共同隔离商家。
- Web：Vue 3.5.44、Vite 8.3.4、Element Plus 2.14.7、Pinia及路由；真实API驱动商品/仓库、采购账号、采购、包裹、收货、库存/流水/调整、供应商退货、出库、统计对账与CSV。
- Android：uni-app Vue 3.4.21、锁定DCloud编译器、HBuilderX原生Barcode模块。运单扫码只查包裹，人工核对数量后提交入库；商品扫码出库先草稿后二次确认。网络结果未知时复用幂等号，不在手机直接扣库存。
- 生产：独立Docker多阶段构建、Caddy反向代理/TLS、非root/只读容器、内部数据库网络、最小权限app角色、迁移作业、pg_dump/pg_restore及校验清单。实际配置见 `infra/production/`，不是早期规划的compose.prod路径。开发Docker客户端/Server均29.8.2。

## 业务链路与测试对应

| 环节                   | 本轮验证方式                                                       | 可以证明的范围                                                   |
| ---------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------- |
| 注册、登录、刷新/退出  | auth、auth-sessions、web-session、registration                     | 隔离账号真实API，正确/重复邮箱、校验、过期/撤销和Web代理         |
| 商家/成员/角色/仓库    | tenancy、warehouses、security-audit                                | A/B跨资源及角色矩阵，默认仓库与租户上下文                        |
| 商品新增/编辑/搜索     | products、product-variants、web-catalog                            | 货号/颜色/尺码/SKU、唯一约束、停用、历史价格不被改写             |
| 采购账号和多SKU采购    | purchase-accounts、purchase-orders、web-purchases                  | 两平台/账号独立，Decimal、优惠与运费只分摊一次，草稿与冻结       |
| 多包裹/运单查询        | packages、web-packages、receivables、scan                          | 前导零、多承运商候选、未知码、预计数量与只读查询                 |
| 收货/入库              | receipts、receiving-safety、mobile-receiving                       | 真实事务、部分/全部到货、超收拒绝、并发、幂等和流水              |
| 库存及盘盈盘亏         | inventory、stock-adjustments、web-adjustments                      | 分仓SKU余额、移动平均成本、正负调整、流水与审计                  |
| 供应商退货             | purchase-returns、purchase-returns-migration、web-purchase-returns | 可退量、部分/多SKU、退款/库存成本分离、确认才扣库存              |
| 查询库存/出库          | outbound、web-inventory、web-outbound、mobile-outbound             | 真实商品码查询、缺货、草稿不改库存、确认与成本快照               |
| 统计/CSV               | reports、web-reports                                               | 两账号平台/日期/SKU、待入库、库存/出库/退货分口径、BOM与公式防护 |
| Android摄像头/安装     | 本轮未重新实机执行                                                 | 仅保留任务34历史独立APK核心验收，不把Node逻辑测试算真机通过      |
| 生产核心流/持久化/恢复 | production                                                         | 独立容器真实HTTPS/API/PG、迁移、重启、备份恢复；非公网           |

现有Web脚本主要执行真实前端客户端、表单/路由代码及API事务，包含构建产物检查；本轮未新增Playwright/Selenium浏览器全页面点击测试。现有手机测试包含uni API适配或交互替身，服务端数据为真实隔离PostgreSQL，不能替代硬件测试。不同脚本用独立测试数据，不能声称所有步骤都操作同一个商家；production脚本另提供同一条真实单据贯穿链路。

## 关键异常与数据一致性

| 场景                     | 测试来源 / 判定                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| 重复入库、出库、退货确认 | receipts/receiving-safety/outbound/purchase-returns：同操作号重放不重复增减，内容冲突拒绝       |
| 库存不足、超收/超退      | 对应事务测试：业务错误、余额不为负，失败无部分写入                                              |
| 无权限及商家交叉访问     | tenancy/security-audit/reports：写入和详情403/404；允许的列表筛选200空页，不泄露他商家数据      |
| 中途数据库写入失败       | receiving-safety/outbound/purchase-returns：注入失败后回滚余额、流水和单据，重新核对账本        |
| 超时/丢失响应/并发重复   | 客户端测试模拟响应丢失、网络异常和延迟，再对真实API重试核对幂等；不等于真实手机弱网或路由器断网 |
| 空数据/异常输入          | foundation/DTO、各模块及reports的空商家、日期边界、分页和非法字段                               |
| 数据库重启持久化         | 本轮新增production子用例：独立PG重启前后逐表行数和内容指纹一致，API重连健康；开发库不重启       |
| CSV特殊字符/公式         | reports：UTF-8 BOM字节、中文、逗号/双引号/换行、危险前缀与全分页导出                            |

生产链路核对基准：采购10件×18.50+运费10.00=195.00；收10件成本195.0000；出3件成本58.5000；退2件实际退款35.00、库存成本减少39.0000；再盘盈1件成本19.5000，最终库存6件/117.0000。采购发生额不因退款改写，退款与库存成本独立。

## 本轮真实命令结果

证据目录均为本机Git忽略的 `test-results/task36/`。本轮实际结果，不复用任务35历史数字：

| 命令                                        | 结果                                                                                  | 原始证据                                          |
| ------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `pnpm test`                                 | 744通过、0失败、0跳过、0取消，545.24秒                                                | full-test.log                                     |
| `pnpm test:models`                          | 66通过、0失败、0跳过、0取消，24.11秒；空库迁移、重复迁移/seed、外键/CHECK、schema漂移 | models-test.log                                   |
| `node --test scripts/registration.test.mjs` | 8通过、0失败、0跳过、0取消，10.32秒；真实Web代理与注册/权限                           | registration-test.log                             |
| `pnpm test:production`                      | 13通过、0失败、0跳过、0取消，147.57秒；真实TLS、业务、持久化与备份恢复                | production-test.log                               |
| `pnpm typecheck`                            | exit 0                                                                                | typecheck.log                                     |
| `pnpm lint`                                 | exit 0                                                                                | lint.log                                          |
| `pnpm format:check`                         | exit 0                                                                                | format-check.log                                  |
| `pnpm prisma:validate`                      | exit 0，schema有效                                                                    | prisma-validate.log                               |
| `pnpm prisma:migrate:status`                | exit 0，原开发库10迁移最新                                                            | migration-status.log                              |
| `pnpm build`                                | 随pnpm test实际执行，API/Web/mobile H5及共享包构建成功                                | full-test.log                                     |
| `pnpm --filter @caicang/mobile build:app`   | exit 0，编译器5.24，单独输出APP资源；不是APK                                          | mobile-app-build.log / mobile-app-resources       |
| `pnpm start:api` / `pnpm dev:web`           | 实际监听3000/5173，健康接口和Web首页HTTP 200                                          | local-api.log / local-web.log / local-health.json |

APP构建只在当前进程设置 `UNI_OUTPUT_DIR=D:/Dev/caicang-manager/test-results/task36/mobile-app-resources` 和 `VITE_API_BASE_URL=https://api.example.com/api/v1`；没有改环境文件或覆盖原dist/APK。示例域名不能用于真实验收。编译器提示有新版本，不自动升级锁定工具链。

生产演练沿用既有测试脚本的命名，独立项目为 `caicang-t35-36fbb1a8`，证据实际在 `test-results/task35/caicang-t35-36fbb1a8/`，本轮总日志在task36目录。源库与恢复库全部24张public表（含迁移表）的行数/内容指纹一致，记录在 `restore-fingerprints.json`；`result.json` 明确公网部署和Android验收均为false。测试结束停止演练服务，保留卷和备份。没有对真实开发库做恢复或重启。

本轮没有正式测试失败或skip；开工时本地3000/5173尚未监听，按上述命令启动后再实际HTTP验证通过。这不是忽略启动错误。根源码格式检查及本轮12份Markdown的显式Prettier检查均通过，Git diff --check通过。

根 `pnpm test` 不包含另外四个脚本：database-models、registration、production本轮另执行；database-lifecycle会停启现有开发容器，本轮未运行。持久化由独立production新增子用例验证，不能称已运行test:db。单元/集成计数含Node父套件，不等于唯一业务场景数；不同命令有重叠，不相加冒称唯一覆盖总数。

“0跳过”只指实际启用的Node测试用例；registration及部分Web脚本的可选人工浏览器验收分支没有启用，不计入这些数字。本轮没有通过skip或降低断言强度规避失败。

## 未执行、已知局限与上线门槛

- 本轮未重装APK、未重新实扫摄像头、未新增真机链路。任务34剩余相机拒绝/恢复、手输兜底、未知码、断网恢复的独立包追加测试仍未执行；快速双击最终按钮没有单独人工确认。旧结果见 [TASK_34_REPORT.md](TASK_34_REPORT.md)。
- 任务35新增手机会话/租户缓存安全修复尚未打入旧测试APK。新正式资源、签名、安装和公网核心流程必须再验收；本轮普通APP资源构建使用示例HTTPS地址，仅证明编译能力。
- 无已批准正式域名、服务器、证书、签名发布方案，未购买或公开任何服务。隔离私有CA由测试客户端明确验证，不修改Windows信任库，不等于公网证书。
- 公开注册生产默认关闭，开发仍可注册；尚无邮箱归属验证，需要上线前确定人工开通或邮箱验证方案。单进程内存限流未做多实例共享及正式容量压测。
- 任务35当日依赖审计快照仍有工作区移动端/工具链高13、中23、低6、严重0；API匹配路径0公告，不代表全项目/镜像零漏洞。本轮没有重新执行公告审计、容器OS扫描、长时压测或渗透测试。
- 备份演练使用小型隔离业务库；未配置真实定时备份、异地加密存储、正式数据量RPO/RTO或故障切换。保留策略仅dry-run，未删备份或数据库卷。
- 不实现客户退货、自动抓电商订单、离线直接入库、仓间调拨或销售利润；统计退款登记不代表平台已实际打款。

## Windows本地启动与验收

在已安装锁定Node/pnpm且现有.env有效的PowerShell中：

```powershell
cd D:\Dev\caicang-manager
pnpm install --frozen-lockfile
pnpm db:up
pnpm prisma:migrate:status
# 有待应用的迁移才运行deploy；不要reset、db push或导入schema.sql
pnpm prisma:migrate:deploy
pnpm prisma:generate
pnpm start:api
```

另一个终端：

```powershell
cd D:\Dev\caicang-manager
pnpm dev:web
Invoke-RestMethod http://127.0.0.1:3000/api/v1/health
```

打开 `http://127.0.0.1:5173`，开发Swagger为 `http://127.0.0.1:3000/api/docs`。在独立验收商家按商品→采购账号→多SKU采购→包裹→收货→库存→调整→退货→出库→统计顺序操作，确认真实金额和流水。`/reports` 按账号/平台/日期/SKU筛选、打开来源单据并导出CSV，Excel检查中文及公式文本。刷新后服务端余额应保持；切另一商家应看不到原商品。不要在真实业务商家重复确认测试。

## Android步骤

测试APK及签名仍按 [MOBILE_APP.md](MOBILE_APP.md) 与任务34报告管理；旧测试包仅使用当时局域网开发API，电脑IP改变后需重新配置资源和打包。电脑API健康、手机可互访局域网IPv4、Windows防火墙授权由用户确认；手机localhost不能指电脑。

正式资源使用已批准真实HTTPS地址与新输出目录：

```powershell
pnpm build:shared
pnpm build:mobile:production --api-base-url https://<已批准正式域名>/api/v1 --output-dir D:/ReleaseArtifacts/<全新目录>
```

用HBuilderX导入对应资源/工程，按文档使用自有AppID与独立管理的签名证书打包；密钥、密码和APK不进入Git。用户确认后才替换测试包或发布。新包需登录/商家切换、运单只读查询、部分收货、重复请求、库存/出库与Web/数据库交叉核对，异常项逐项记录。

## 生产部署、备份与恢复

完整可执行命令和风险见 [PRODUCTION_DEPLOYMENT.md](PRODUCTION_DEPLOYMENT.md)。先批准服务器/域名/证书、维护窗口、注册方式、备份策略，再用prepare-production创建仓库外全新私有目录，审核Compose配置并build/up。PG健康→迁移成功→API健康→Web/TLS健康；不暴露PG或API端口，不复用开发.env。

```powershell
# 已准备并批准的生产配置；此处变量不含任何secret值
$ProdEnv = 'D:/Deploy/caicang-production/.env.production.local'
docker compose --env-file $ProdEnv -f infra/production/compose.yml config --quiet
docker compose --env-file $ProdEnv -f infra/production/compose.yml build
docker compose --env-file $ProdEnv -f infra/production/compose.yml up -d --wait --wait-timeout 240
node scripts/production-db.mjs backup --env-file $ProdEnv --output-dir D:/PrivateBackups/caicang/daily
node scripts/production-db.mjs restore --env-file $ProdEnv --backup D:/PrivateBackups/caicang/daily/<文件>.dump --target-database caicang_restore_<全新标识至少8字符>
node scripts/production-db.mjs prune --env-file $ProdEnv --output-dir D:/PrivateBackups/caicang/daily --retention-days 14
```

恢复只允许新目标库，验证SHA、迁移/约束、单据和余额/流水，逐表内容指纹对比；原库不被覆盖。业务连接切换和恢复后的权限授予另行审批，不能把“创建脚本”当作恢复成功。上面prune默认预览，不加apply。正式凭据目录和备份须限制访问并加密保管。

## 修改清单、安全扫描与GitHub

本轮新增：本报告、`docs/GITHUB_REVIEW.md`。本轮修改：`scripts/production.test.mjs`（仅追加隔离数据库重启断言）、README、CODEX_TASKS、MOBILE_APP、API_SPEC、DATABASE_DESIGN、DEPLOYMENT、PRODUCTION_DEPLOYMENT及任务33—35报告。没有修改业务模块、既有迁移、schema.sql或环境文件。上轮任务35源码、依赖和生产配置修改继续保留，其文件清单见 [TASK_35_REPORT.md](TASK_35_REPORT.md)，不冒称本轮新开发。

GitHub About仍称只有环境/骨架，已读取现状并提出更新文本，见 [GITHUB_REVIEW.md](GITHUB_REVIEW.md)；等待用户确认，没有远端写入。正式站点地址空缺，不把LAN或测试地址填写为官网。

扫描针对当前受跟踪文件和待审阅新文件，不涵盖完整Git历史或原有test/。已知本机数据库/JWT及隔离生产secret字面量、私钥/Token模式和常见真实邮箱扫描不输出敏感匹配内容。两个既有受跟踪移动端.env配置仅含公开的开发localhost和正式example地址，不含secret；不是生产凭据，也不是可直接真机使用的正式地址。fixture密码为隔离测试数据，不把它们当作用户密码。本轮未暂存文件。

最终提交前请审查本轮文件清单、`git diff --stat`、`git diff --check` 和所有新增文件。完整待审阅差异保存在本机忽略目录；新文件需单独查看。用户确认后才选择文件提交/推送及修改About，不使用git add .。

具体差异证据：`test-results/task36/review-all.patch` 包含全部当前待审阅修改和新增文本（排除原有test/），`change-review.json` 区分本轮13个变更文件与保留的40个原有未提交文件，`test-summary.json` 汇总各条测试原始计数。本轮13个文件包括12份文档与1份测试脚本，其中TASK_36_REPORT/GITHUB_REVIEW是新增文档；未暂存任何文件。原.env、.env.auth.local及手机manifest的SHA-256与开工一致，既有schema/迁移/schema.sql也无差异。
