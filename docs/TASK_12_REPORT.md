# 任务 12：采购订单业务验收

2026-10-21 至 2026-10-22（Asia/Shanghai），`D:\Dev\caicang-manager`；基线 `d91963a`，分支 `feat/task-12`。

## 交付

实现 GET/POST `/purchase-orders`、GET/PATCH `/purchase-orders/{id}`、POST `/purchase-orders/{id}/place`、POST `/purchase-orders/{id}/cancel`，沿用统一 `/api/v1`、DTO、响应、异常、requestId、Swagger 与安全日志。

- 保存平台/平台单号/店铺、采购日期、目标仓库、收货人/电话/地址、多个 SKU 的数量/原价/行优惠、运费与备注。真实 PostgreSQL 数据与 Prisma 事务，不使用模拟订单。
- 草稿创建与编辑、搜索分页/状态/平台/仓库筛选、详情及真实累计收货数量；确认冻结数量/价格/费用/商品快照，拒绝所有后续 PATCH。
- 独立精度 60 的 Prisma Decimal 计算两位金额，按净额分摊运费，全部免费时按件数；前 N−1 行向下截到分，末行吸收尾差，四位单位成本与分摊来源一起保存。
- DRAFT/PLACED 在无任何收货记录时可取消；部分/全部收货状态拒绝编辑、确认和取消。重复确认 PLACED 或取消 CANCELLED 无重复变更和审计，取消不物理删除订单。
- 全角色读取，OWNER/ADMIN/BUYER 写入；VIEWER 收货三字段隐藏、备注 null。所有读取和关联使用 tenant_id，写入按租户根和采购主单行锁串行、锁后重新鉴权，审计失败整体回滚。
- 第六个可追踪迁移增加日期、行顺序、分摊额和商品快照；旧记录新增列保持 null，不更新既有内容/时间，不修改参考 SQL 或旧迁移。

## 实际验证

| 检查                                       | 结果                                                                                                                             |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm prisma:validate` / `prisma:generate` | 成功，Prisma 7.10.0 保持锁定，未新增依赖                                                                                         |
| `pnpm test:purchases`                      | 35 项通过，0 失败/取消/跳过；真实 PostgreSQL 与两个 API 进程                                                                     |
| `pnpm test:models`                         | 65 项通过；空库迁移、重复部署、重复/并发 seed、约束和无结构漂移                                                                  |
| `pnpm typecheck`                           | API、Web、uni-app、共享包全部通过                                                                                                |
| `pnpm lint` / `pnpm format:check`          | 最终修订后复核通过，0 警告                                                                                                       |
| 最终 `pnpm test`                           | 373 项全部通过，0 失败/取消/跳过；API/Web/uni-app H5/共享包实际构建通过，0 失败/取消/跳过；API/Web/uni-app H5/共享包实际构建通过 |
| 开发库迁移                                 | 六个迁移全部已应用，旧五个校验和不变                                                                                             |
| 实际服务                                   | 新版 API 在 3001 启动，health 返回 ok/reachable，OpenAPI 包含六个采购操作                                                        |

验收用例实际通过真实 HTTP 创建并确认 10 个充电器 × 18.50 元＋10 元运费：`goodsAmount="185.00"`、`totalCost="195.00"`、`landedUnitCost="19.5000"`，并通过 SQL 读取实际持久化成本核对。

专项覆盖六类纯 Decimal 用例及真实 API 的草稿编辑/明细 UUID 保留/显式移除、重复订单号和回滚、多 SKU/免费商品分摊、状态冻结、商品主数据变化保护、收货记录阻止取消、非法输入及客户端伪造金额/状态、外商家资源、五角色及 VIEWER 隐私、停用资源、搜索分页/字面字符、两个 API 实例并发创建/确认/编辑/取消、审计失败回滚及等待锁后的权限降级。原五迁移数据库带真实旧采购行升级后，逐字段验证原值和时间不变。空库迁移及模型约束由 test:models 独立覆盖。

测试使用本机 PostgreSQL 的随机隔离库；仅清理本次创建的随机库，不将夹具写入开发库。用于验证取消条件的收货记录由隔离库 SQL 夹具生成，不代表本任务实现了收货或库存；校验库存余额与流水仍无新增。没有运行浏览器页面或 APK 验收，不将它们计入本任务结果。

日志为被 Git 忽略的 `test-results/task-12-purchases-reviewed.log`、`task-12-models.log`、`task-12-typecheck-reviewed.log`、`task-12-regression-reviewed.log`。373 = 原 338 + 采购 35；模型 65 单独执行，不重复计入全仓数。最终回归含真实等待 Token 到期的认证用例，全部成功。

## 环境与数据保留

开发库迁移前保存所有原行 ID/旧列内容指纹、本地环境/JWT 文件摘要和原迁移校验和，迁移后已验证全部一致。没有新增开发库账号、商家、采购订单或测试商品；开发库保留 9 用户、5 商家、0 采购单。最终复核为 0 遗留随机测试库。

自动审批拒绝了停止 3000 旧 API 进程的操作，返回原因为“策略阻止”，无更具体理由；未尝试其他方式强停。采用空闲端口启动新版 3001，原服务/配置保留。当前 Swagger 为 http://localhost:3001/api/docs，健康检查 http://localhost:3001/api/v1/health。若使用默认 3000，需要先在原服务终端 Ctrl+C，再正常启动新版。

续作时 Docker 引擎停止导致一次健康检查连接失败，已启动原 Docker Desktop 和原持久化容器恢复；未重装软件、清卷或迁移 C 盘数据。Windows 常规启动与临时端口命令见 PURCHASE_ORDERS.md。

## 修复与边界

Prisma migrate dev 在非交互终端拒绝执行，改为在隔离的原五迁移库使用 Prisma Migrate diff 生成增量 SQL，再由 Migrate deploy 执行并验证；迁移包含事务及新增 CHECK。初版复合租户键嵌套创建在真实运行中报参数歧义，改为同事务显式创建主单/明细；异常输入测试发现空数组 recipient 可通过嵌套验证，已增加对象验证。Lint 未使用参数已修复。全仓首次失败来自旧“采购应 404”与 VIEWER 权限数组断言，已改为验证采购需认证、新采购读取权限及未来库存接口仍不存在，并重跑。提交前复查还发现可选文字 `"null"` 与空值比较混淆，改为按字段类型比较，并用真实接口测试文字/空值写入、清空及重复 PATCH。

旧记录未保存的历史日期/快照/分摊不做猜测回填；旧草稿补齐资料才可确认。新单确认后的状态冻结由服务端事务执行，未来收货必须遵守相同采购主单锁。四位单位成本有舍入，保留行净额与运费来源供后续收货处理尾差，不以舍入单位成本重建原订单总额。默认采购币种 CNY，汇总范围见 PURCHASE_ORDERS.md。

采购 Web 页面、包裹管理、收货入库、库存变更、出库及 APK 均留待后续任务。本次无未修复测试失败，3001 的新版 API 可用；3000 旧服务保留属于运行入口限制。本次代码按任务分支本地提交，未上传 GitHub。

## 修改文件（26 个）

- 后端新模块五个：`apps/api/src/modules/purchase-orders/purchase.dto.ts`、`purchase-cost.ts`、`purchase-orders.controller.ts`、`purchase-orders.service.ts`、`purchase-orders.module.ts`。
- 后端/共享修改：`apps/api/src/app.module.ts`、`common/errors.ts`、`common/tenancy/tenant-policy.ts`；`packages/api-contract/src/index.ts`。
- 数据库：Prisma schema 与新 `20261021120000_purchase_order_workflow/migration.sql`，保留原迁移及 database/schema.sql。
- 命令/测试：根 package.json；新 `scripts/purchase-orders.test.mjs`，更新 database-models、smoke、tenancy 测试。
- 文档：README、CHANGELOG、API_SPEC、ARCHITECTURE、CODEX_TASKS、DATABASE_DESIGN、DECISIONS（ADR-019）、TENANT_AUTHORIZATION、新 PURCHASE_ORDERS 与本报告。

AGENTS.md、锁文件、Web/手机代码、本地密钥与项目数据保留；构建目录、测试库凭据和日志均不提交。
