# 任务 00—20 阶段复核（2026-10-23）

工作区：`D:\Dev\caicang-manager`。先完成只读审查并向用户报告，再恢复环境和验证。没有新业务功能、任务 21 开发、提交、合并或推送。

## 1. 第一阶段只读结果

已阅读 AGENTS.md、README.md、任务 19/20 报告、MOBILE_APP.md、任务 17 报告和任务 18 的 RECEIVING_TEST_REPORT.md，并核对实际测试的隔离建库、真实 HTTP、幂等/并发/故障注入、数据库账本核对与清理代码。00—16 逐项核对现有源代码入口、测试脚本和历史验收记录；并非重新人工操作所有历史页面。

### Git 原始状态

```text
git status --short --branch
## main...origin/main [gone]

git branch -vv
  feat/task-15 fc16ede [origin/feat/task-15: gone] feat(web): add read-only package management page
* main         b407b77 [origin/main: gone] feat(mobile): confirm receiving on a scanned package

git log -10 --oneline --decorate
b407b77 (HEAD -> main) feat(mobile): confirm receiving on a scanned package
3e74988 feat(mobile): scan tracking codes into read-only package lookup
a0bcd7b feat(mobile): add login, session handling and warehouse home screen
93a5377 test(api): verify receiving safety against real PostgreSQL
1542189 feat(api): confirm acceptance receipts with real inventory
fb09869 feat(api): compute receivable quantities for scanned packages
fc16ede (feat/task-15) feat(web): add read-only package management page
1b99f47 (origin/feat/task-14) feat(api): bind purchase orders to tenant-safe delivery packages
bee5bd6 (origin/feat/task-13) docs: complete task 13 verification after Docker recovery
8e30490 feat(web): add purchase order management pages
```

工作区初始干净，`git diff --check` 无错误。`[gone]` 是本地跟踪引用缺失，不是远端删除的证据。只读 `git ls-remote --heads origin` 确认远端 main 为 `b407b77e1cf47e06cf244c7672238359a3172234`，与本地一致；未 fetch、修复分支引用或改 Git 全局配置。普通直连被 reset 后，仅单次命令使用本机已有代理 `127.0.0.1:7897`。

**基线已含任务 21**，不能把“本次不开发 21”理解为删除其文件或回退提交。现有全仓命令也包含 mobile-receiving 回归，本次不修改该模块。

### 任务代码、测试和历史状态

下表数字来自各任务的交付报告，是历史结果，不是本次重复执行的次数。当前实测统一列在第 3 节，历史全量数量随任务增加，不能与当前总数直接比较。

| 任务 | 现有实现 / 测试入口 | 历史验收依据 |
| --- | --- | --- |
| 00 | ENV_CHECK、PowerShell 开发脚本、Git/依赖/容器检查 | 10-14 Docker/WSL/hello-world 成功；本轮初查已停止，不能沿用旧环境结论 |
| 01 | pnpm workspace，api/admin-web/mobile、共享包、strict/ESLint/Prettier | TASK_01_REPORT：构建/类型/规范通过，全仓 6 项 |
| 02 | Compose 16.15 固定镜像/持久卷/健康、PrismaService、health、db 脚本 | TASK_02_REPORT：数据库生命周期 4 项，全仓 6 项 |
| 03 | Prisma 17 业务表、迁移、seed、database-models.test.mjs | TASK_03_REPORT：模型 65 项，重复 seed/约束/迁移验证 |
| 04 | API 全局响应、异常、验证、日志、requestId、安全/限流基础 | TASK_04_REPORT：全仓 65 项 |
| 05 | auth 注册/登录/me、DTO/哈希、auth.test.mjs | TASK_05_REPORT：全仓 113 项 |
| 06 | Refresh 会话、轮换/撤销、auth-sessions.test.mjs | TASK_06_REPORT：认证 78 项，全仓 149 项 |
| 07 | tenants/members、服务端 Context/Guard/权限/审计 | TASK_07_REPORT：租户 65 项，全仓 214 项 |
| 08 | products CRUD/lookup、同商家 SKU/条码约束 | TASK_08_REPORT：商品 47 项，全仓 261 项 |
| 09 | warehouses API/默认仓库、warehouse 测试 | TASK_09_REPORT：仓库 28 项，全仓 289 项 |
| 10 | Web 认证/主布局、生产会话客户端真实 HTTP 测试 | TASK_10_REPORT：Web 25 项，全仓 314 项 |
| 11 | Web 商品/仓库页面、catalog 服务和测试 | TASK_11_REPORT：Web 49 项，全仓 338 项 |
| 12 | purchase-orders 状态机、Decimal 成本、采购测试 | TASK_12_REPORT：采购 35 项，全仓 373 项 |
| 13 | Web 采购列表/表单/详情和真实 API 客户端测试 | TASK_13_REPORT：Web 66 项，全仓 390 项，有真实采购单验收记录 |
| 14 | packages 绑定/编辑/lookup、承运商同号候选 | TASK_14_REPORT：最新包裹专项 32 项；较早全仓 421 项 |
| 15 | Web 只读包裹管理和客户端测试 | TASK_15_REPORT：全仓 438 项 |
| 16 | receivable/complete-receiving、剩余量与权限测试 | TASK_16_REPORT：全仓 455 项 |
| 17 | receipts 事务、幂等、库存余额/流水/成本 | TASK_17_REPORT：22 项；保留 full-tests-3.log 实证 477 通过/0 失败/0 跳过 |
| 18 | receiving-safety.test.mjs，12 个场景及全局账本核对 | RECEIVING_TEST_REPORT：15 测试节点，全仓 492 项；无单独 TASK_18_REPORT 文件不代表缺失 |
| 19 | uni-app 会话/商家/首页、mobile.test.mjs | TASK_19_REPORT：历史 3 通过/1 跳过，真实 API 组未执行；本轮已补跑并修复夹具 |
| 20 | uni.scanCode 页面、scan.ts、package 页面 | TASK_20_REPORT：历史 10 个扫码逻辑/静态测试通过；真实 API 和摄像头原未验收，本轮补真实 API，硬件仍待验 |

任务 17/18 实测方法可靠地覆盖数据库事务回滚和并发请求的正确性，但同商家写事务首先锁商家行，实际上是排队串行，不能声称已证明高并行吞吐。`PACKAGE_MOVED` 的确定性竞态、断电/进程被杀等硬件级故障仍未覆盖，未因此修改断言。

## 2. 环境恢复与数据保护

只读检查时无 Docker 后端进程，Linux engine 管道不存在；5432/3000/5173 均无监听。WSL 版本命令能运行，docker-desktop 为 WSL2、Stopped。Docker 旧日志报调用 wsl.exe 时 Access is denied，CodeIntegrity/AppLocker 查询没有找到足以归因的关联证据。

之后只正常启动已有 Docker Desktop，没有调整安全策略。Docker Server 29.8.2、Compose v5.6.0 恢复，原 caicang-postgres 自动 healthy；实际 hello-world 成功。WSL 系统命令返回内核 6.18.54.1-microsoft-standard-WSL2。Windows 11 家庭版 25H2/26200.9711 仍在 [Microsoft 支持周期](https://learn.microsoft.com/en-us/lifecycle/products/windows-11-home-and-pro)内。

原数据卷 `caicang-manager-dev_caicang_pgdata` 未更换，宿主 VHDX 在 D:\docker\DockerDesktopWSL。未运行 down -v、数据库 reset、开发库 DROP、schema.sql 重放、seed 写入开发库或软件重装。测试只新建随机 `caicang_test_<uuid>` 隔离库，结束仅清理自己创建的库；这不等于清空开发库。

恢复后、测试前记录开发库：cluster `7696541613473218594`；6 商家、10 用户、9 商品、2 采购单，包裹/收货单/库存余额/流水均 0。六个迁移均已完成，无回滚标记。迁移 status 与 deploy 均实际成功，无待执行迁移。

最终核对：原命名卷与 cluster 标识不变，上述已记录的开发库数量全部与测试前一致，剩余 caicang_test_* 隔离库为 0。根 .env 及手机 .env.development/.env.production 的 SHA256 与开始时逐项一致，没有覆盖；没有打印密码、JWT 或连接串。此处证明的是记录过的基线一致，不将计数比较夸大为全部历史数据逐字节校验。

## 3. 本轮真实命令和结果

以下按通过、失败、跳过和未执行分别记录，完整运行输出保存在 Git 忽略的 `test-results/review-00-20-*.log`。

| 命令 | 本轮结果 | 日志 |
| --- | --- | --- |
| git status / branch -vv / log -10 / diff --check | 已实际执行，初始干净，diff 检查通过 | 第 1 节原始记录 |
| Docker info / ps / inspect；WSL 内核；hello-world | 通过，原 PostgreSQL healthy | 本轮终端记录 |
| pnpm prisma:migrate:status / prisma:migrate:deploy | 通过，6 迁移、无待应用项 | migrate.log |
| pnpm test:receipts | 22 通过 / 0 失败 / 0 跳过 | task17.log |
| pnpm test:receiving-safety | 15 通过 / 0 失败 / 0 跳过 | task18.log |
| pnpm test:mobile（首次） | 失败：注册 400≠201；2 pass / 2 fail（含父节点） | mobile.log |
| pnpm test:mobile（第一次修复后） | 10 pass / 5 fail / 0 skip；含父节点，详见下方原因 | mobile-retry.log |
| node --test scripts/mobile.test.mjs（修复后） | 15 通过 / 0 失败 / 0 跳过 | mobile-retry2.log |
| pnpm test:scan | 10 通过 / 0 失败 / 0 跳过 | scan.log |
| LAN API GET /api/v1/health | HTTP 200，database=reachable；从电脑访问自己的 LAN 地址 | 本轮终端记录 |
| pnpm build:mobile:lan -ApiBaseUrl http://192.168.243.90:3000/api/v1 | 成功，检查 app-service.js 确实包含目标地址 | app-lan.log |
| pnpm test（第一轮） | 528 通过 / 0 失败 / 0 跳过，约 305 秒；含 API/Web/H5/共享包构建 | full-1.log |
| pnpm test（第二轮） | 528 通过 / 0 失败 / 0 跳过，约 307 秒；含 API/Web/H5/共享包构建 | full-2.log |
| pnpm typecheck | 退出码 0，API/Web/mobile/共享包通过 | typecheck.log |
| pnpm lint | 退出码 0，0 warning | lint.log |
| pnpm format | 退出码 0，实际执行 Prettier --write；未引入无关文件改动 | format.log |
| pnpm format:check | 退出码 0，全部格式检查通过 | format-check.log |
| node --test scripts/database-models.test.mjs | 65 通过 / 0 失败 / 0 跳过；隔离空库迁移、重复/并发 seed、主要约束与结构 diff | models.log |
| LAN 构建脚本传入 loopback URL | 按预期拒绝，未执行构建 | app-loopback-rejected.log |

所有日志路径需加前缀 `test-results/review-00-20-`。App 构建有新编译器提示，未升级锁定依赖；这些提示不等于构建失败。

两轮全仓测试包含基线已有的任务 21 回归，但没有修改该模块或进行其独立真机验收。最终自动化结果均无 skip；历史失败日志未删除，不能只保留绿色运行来掩盖修复过程。`git diff --check` 最终成功，Git 的 LF/CRLF 提示不是检查失败，未为此改动全局设置。七份修改/新增 Markdown 的本地文件链接已检查，无缺失目标。

### 实际失败及修复

1. 任务 19 原注册密码 Mobile!2026 只有 11 字符，API 要求至少 12。原联调跳过掩盖了夹具问题。修正为有效密码，并增加旧密码必须 400 VALIDATION_ERROR 的断言，201 正例断言不变。
2. 原“已消费凭据”测试实际上把 Refresh Token 改成 UUID，首先命中格式校验 400，无法验证服务端撤销。改为先调用真实 refresh 消费旧令牌，再用旧令牌测试 401；没有接受 400 来凑通过。
3. 过期用例重建 client 时未更新外层 storage，退出测试查错存储。修正夹具引用，继续断言退出清本地会话/商家与服务端 401 撤销。
4. 新增扫码联调第一次误用 lookup 的 id 字段，实际共享契约为 packageId。按契约修正测试字段，保留精确包裹 ID 断言。
5. 数据库连接/建库/迁移异常原会自动变成 skip。现在准备失败直接报错；最终验收不允许以整组 skip 作为成功。

未修改生产业务模块、权限规则、API 密码策略或返回码以迁就测试。

## 4. 任务 20 真机准备和未执行项

当前 WLAN IPv4 为 192.168.243.90，API 默认监听 0.0.0.0:3000。Android 不能使用 localhost。默认 build:app 使用 production 示例地址，所以仅改 development 不够。本轮保留全部 .env，新增 Windows LAN 构建命令，先检查健康、进程级覆盖、明确 development mode、检查资源 URL，结束恢复原进程变量。

dist/build/app 已真实重建，但它是资源目录，不是 APK。编译器输出提示可导入 HBuilderX；源码 CLI 工程与资源导入步骤已分开说明，不宣称两者已在本机验证等效。源码 AppID 仍为空，需用户在 HBuilderX 申请。未在 PATH/卸载注册信息发现 HBuilderX，未检测到已连接 Android，因此以下均为**未执行**：

- HBuilderX 实际导入、基座安装/运行、签名 APK 构建/安装。
- 手机访问电脑健康接口、真实相机识别、系统拒绝权限/恢复。
- 八项现场扫码验收（正常、前导零、多候选、未知、拒绝权限、重复、手动、库存不变）。

可执行步骤和数据库前后快照命令见 [MOBILE_APP.md](MOBILE_APP.md)第七、八、十一节。若局域网连接受安全策略或防火墙限制，应先告知用户并确认再改；本轮未修改规则。

## 5. GitHub 一致性

远端 main 与复核前本地 HEAD 一致；GitHub API 读取该提交 README 的 blob 为 `272d2934bd3094cc70a9471dc1859375eded1492`，等于本地 HEAD:README.md。远端已存在任务 21，不是本轮上传。

About 实际为「采仓管家 V1.0：采购、仓库验收与出库管理；当前完成 Windows 环境和 Monorepo 骨架。」明显落后。原 README 也有“采购页面、包裹、入库未实现”的旧描述，以及 Docker 仍被拦截、可装 Android 等未区分历史/验收的用语。本轮只在本地增加最新复核入口并校正当前进度；远端 README/About 保持原状，没有 API PATCH、commit 或 push。

建议 About（仅建议，未发布）：**采仓管家 V1.0：多商家采购、包裹与验收入库管理；Web 与手机 API 联调已验证，Android 真机验收待完成。**

## 6. 交付范围与剩余问题

修改：README.md、docs/ENV_CHECK.md、docs/MOBILE_APP.md、docs/TASK_19_REPORT.md、docs/TASK_20_REPORT.md、docs/DECISIONS.md、package.json、scripts/mobile.test.mjs。

新增：本报告、scripts/build-mobile-lan.ps1。测试日志和编译资源均被 Git 忽略。无依赖升级、迁移新增、业务模块重构或任务 21 改动。

剩余：Android/HBuilderX/AppID/现场网络及八项真机验收；生产域名仍是示例，不能发行；PACKAGE_MOVED 确定性并发覆盖仍缺失；本地 origin/main 跟踪引用仍待将来正常 fetch 刷新，不影响本轮 ls-remote 的远端核对。GitHub About 及本轮本地修改按用户要求未发布，不是后端开发阻塞。本轮复核不是任务 21 的独立验收。

本轮结束时 Docker/PostgreSQL healthy，API 进程在 0.0.0.0:3000 运行；电脑访问 LAN 健康接口成功。下一步仅需准备 HBuilderX、自己的 AppID 与 Android 真机，按手机文档第十一节完成现场验收并记录真实结果，不自动开始任务 21。
