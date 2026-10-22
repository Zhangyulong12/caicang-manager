# 任务 14：采购单绑定快递包裹验收

2026-10-22（Asia/Shanghai），`D:\Dev\caicang-manager`，基线 `bee5bd6`，分支 `feat/task-14`。

## 交付

实现 POST `/api/v1/purchase-orders/{id}/packages`、PATCH/GET `/api/v1/packages/{id}`、GET `/api/v1/packages/lookup?trackingNo=`，使用真实 Nest Controller/DTO/Service、Prisma/PostgreSQL、Guard/Decorator/TenantContext 和公共响应/错误/Swagger。包裹、预计 SKU、采购单关联均严格限定 tenant_id。

支持多个包裹、一个包裹多个 SKU、空计划、同 SKU 分包；运单为字符串并保留前导零。同商家同公司同号返回明确重码冲突，不同公司同号返回候选数组。预计计划变更会排除自身旧份额后检查全单累计上限；未收货改绑必须显式提供目标采购单完整计划。相关主单按 UUID 顺序锁定，再锁包裹重读状态与收货；写入/计划/审计整体提交或回滚。

已有任何收货记录（包括空头）、收货状态或关闭标记后，核心字段不可变，仅可补充备注；采购终态同样受限。状态只允许明确的物流转换，不接受人工写收货数量/关闭标记或 RECEIVED/PARTIAL_RECEIVED。响应将物流/兼容包裹状态与真实 receivingStatus/receivedQuantity 分开，物流到达不会触发收货、采购状态或库存变化。完全相同 PATCH 不改时间/审计，保留预计行 UUID；VIEWER 隐藏备注，日志及审计不含原始运单/备注、密码或 Token。

复用现有 packages/package_expected_items、唯一索引及复合外键，无新表、迁移、依赖或锁文件变化；没有修改参考 SQL。包裹 Web、扫码、收货/库存、完成收货与 receivable API 均不在本次范围。

## 修改文件

- `apps/api/src/modules/packages/package.dto.ts`、`packages.controller.ts`、`packages.service.ts`、`packages.module.ts`：四个真实接口、输入/输出文档、状态和事务逻辑。
- `apps/api/src/app.module.ts`、`common/errors.ts`、`common/tenancy/tenant-policy.ts`：模块注册、重码/超预计量错误、包裹读/写/查询权限。
- `packages/api-contract/src/index.ts`：共享 PackageData、候选、状态类型、权限及错误码。
- `scripts/packages.test.mjs`、`scripts/tenancy.test.mjs`、根 `package.json`：真实双 API/数据库测试、更新 VIEWER 权限断言、test:packages 和全仓测试入口。
- `README.md`、`CHANGELOG.md`、`docs/PACKAGES.md`、`API_SPEC.md`、`ARCHITECTURE.md`、`DATABASE_DESIGN.md`、`CODEX_TASKS.md`、`DECISIONS.md`、`TENANT_AUTHORIZATION.md`、本报告：启动/契约、当前范围、角色与 ADR-021。

## 实际测试

| 执行 | 结果 |
| --- | --- |
| 首轮 `node --test scripts/packages.test.mjs` | 31 项通过，0 失败/取消/跳过 |
| 最新 `pnpm test:packages` | 32 项通过，0 失败/取消/跳过；Prisma 生成、共享包/API 构建成功 |
| `pnpm test` | 421 项通过，0 失败/取消/跳过；API/Web/uni-app H5/共享包实际构建通过 |
| `pnpm typecheck` | API、Web、uni-app、共享包全部通过 |
| `pnpm lint`、`pnpm format:check` | 通过，0 lint 警告 |
| `git diff --check` | 通过 |
| `pnpm api:check` 和开发 Swagger | 3000 API 的 health 返回 ok/reachable，OpenAPI 实际存在四个新操作 |
| 原数据/环境/迁移指纹 | 本轮原有行内容全部一致，环境/JWT 文件与六个迁移不变 |

全仓 421 是原 390 加首轮包裹 31。全仓进程已载入包裹测试后，又补充“等待锁期间提交收货”用例；最新完整包裹专项 32 全部通过，补齐这一新增用例。不把专项与全仓相加重复计数，也不声称本轮全仓执行过 422 项。

专项测试在真实本机 PostgreSQL 创建随机空隔离库、执行现有六个迁移，实际启动两个 API 进程，并使用第三个新进程验证持久化读取。覆盖：

- **100 件采购（两个 SKU 分别 80/20）拆成 30/30/40 三包裹**：第一个 SKU 分 20/20/40，第二个分 10/10/0。测试显式断言采购总量 100、各包裹总量 30/30/40；逐个 GET 包裹有独立 UUID、相同采购归属和各自预计明细，SQL GROUP BY 验证两条采购行总预计量分别为 80/20。不是 Mock 响应。
- 空/省略计划、多个 SKU、同公司重码/公司大小写标准化、不同公司同号候选、跨商家同号、前导零/符号/大小写保留、精确匹配与未知空数组。
- 非法数量/嵌套字段/重复行/null/数字运单/非法 UUID/空 PATCH/伪造收货字段，统一错误与 requestId/no-store；新增权限及 VIEWER 隐私。
- 每行超预计总量、修改排除自身份额、保留行 ID、完整替换/清空释放份额、无副作用重复 PATCH、改绑计划必须属于新采购单、错单/跨商家资源 404、外人成员 403。
- DRAFT/CANCELLED/RECEIVED 采购状态拒绝新增，PARTIAL_RECEIVED 可新增；物流转换/倒退限制，ARRIVED 仍无收货且库存无变化。
- 空收货头和实际收货数量、显式关闭标记/历史收货状态锁定修改；实际数量驱动部分/完成视图，取消单历史仍可读且仅可补充备注。
- 双进程同时新建 60+60 计划只接受一笔、同时提高已有计划不超过 100、并发重码只保留一包裹、相反方向改绑无死锁、重码/超量改绑回滚、审计故障主从数据一起回滚。
- 等待商家锁期间发生收货后拒绝旧编辑，等待期间降权后服务端重新授权，日志/审计无测试密码、Token、备注或原始运单。

收货头/明细由隔离库 SQL 夹具生成，仅验证已有收货对本次修改的限制；没有实现或宣称完成收货/库存流程。上述验收记录在本轮测试库中实际创建并查询，测试结束仅清理本轮拥有的库，不在日常开发库重复创建账号/商品/采购单/包裹。最终随机测试库为 0；开发库仍为 10 用户、6 商家、2 采购单，任务 13 的双 SKU 单保留。

首轮包裹夹具是 100 件首 SKU 加 20 件第二 SKU，收尾复核时发现与“总计 100 件”的验收口径不符，已改为 80+20，并增加采购总量和每包件数断言后完整重跑专项。文档补丁一次上下文未匹配，核对后修正，没有覆盖原文件。实际输出保存在被忽略的 `test-results/task-14-packages-initial.log`、`task-14-packages-final.log`、`task-14-full-tests.log`、`task-14-typecheck.log`。原数据比对脚本/指纹仅保存在忽略的 `.test-build`，不提交本地配置或凭据。

## 使用与未解决问题

当前 Docker/PostgreSQL 健康，最新后端已在 http://localhost:3000 启动；在 http://localhost:3000/api/docs 可执行真实接口。Swagger 需要真实登录的 Bearer 与本商家的 X-Tenant-Id。Windows 启动、字段、错误和 100 件拆包操作见 PACKAGES.md、README.md。

无未解决的本任务阻塞。包裹新增仍用数据库唯一键拒绝重复 POST，不承诺无条件重放创建请求为成功；查询运单确认已有绑定后再操作。物流不能代替实际验收，当前仅 API 可独立查看包裹，不宣称存在 Web 包裹页面或 Android 真机验证。仅创建本地 Git 提交，本任务未要求推送 GitHub。
