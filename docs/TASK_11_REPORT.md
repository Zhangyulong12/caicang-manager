# 任务 11：商品和仓库管理页面验收

2026-10-21（Asia/Shanghai），`D:\Dev\caicang-manager`；基线 `6a2fc05`，分支 `feat/task-11`。用户追加要求验收后上传 GitHub。

## 交付

- 商品真实列表、名称/SKU/条码/规格搜索、启用筛选、分页、添加/编辑、详情、停用确认及重新启用；刷新从数据库重取数据。
- 名称/SKU/单位必填、编码长度与控制字符、可空条码、精确金额字符串等统一表单校验。服务端重复 SKU/条码分别显示字段错误和 requestId，保留输入；忙碌时阻止重复保存。
- 仓库真实分页列表、创建、重复编码提示、默认业务仓库选择。默认偏好按账号+商家保存在本浏览器，恢复时真实分页查询验证；失效回退、无可用仓库置空，不跨设备同步。
- OWNER/ADMIN/BUYER 可维护商品，OWNER/ADMIN 可创建仓库，其他角色只读。按钮禁用与 catalog 服务检查共用真实权限；服务端仍独立鉴权。异步请求绑定账号会话与商家，切换后拒绝迟到响应，详情切换 ID 重新加载。
- 失败清空旧列表并提供重试；新增独立仓库导航，现为十个入口。其余采购/库存/出库等页面保持待开放。

## 实际检查

| 检查                                            | 实际结果                                                                                                              |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 专项 `node --test scripts/web-catalog.test.mjs` | 24 项通过，0 失败/取消/跳过                                                                                           |
| `pnpm typecheck`                                | API、Web、uni-app、共享包全部通过                                                                                     |
| `pnpm lint` / `pnpm format:check`               | 通过，0 警告                                                                                                          |
| `pnpm test`                                     | 338 项通过，0 失败/取消/跳过；实际构建 API、Web、uni-app H5、共享包和 API 测试代码                                    |
| 最终 `pnpm test:web`                            | 49 项通过，0 失败/取消/跳过；最终 API/Web 构建通过                                                                    |
| 实际浏览器                                      | 真实注册、登录、商家创建、仓库/商品表单、重复编码、编辑、详情刷新、停用及搜索筛选、默认仓库刷新恢复、退出均已操作验证 |

338 = 原有 314 + 新 catalog 24（含 Node 父测试）；专项不重复相加。最终 Web 集合覆盖认证/路由与 catalog；实际等待旧认证集合的 61 秒 Token 到期。Node 运行生产 `client.ts`、`catalog-form.ts`、`catalog.ts` 与 `policy.ts`，通过真实迁移后的随机 PostgreSQL 和 NestJS HTTP 验证，未复制业务实现。网络失败和延迟为明确注入；浏览器验收独立，不把服务层测试称为自动化浏览器点击。

新集合覆盖必填/非法编码/金额、无效输入不发请求、真实保存与重新查询、重复 SKU/条码/仓库编码、并发相同 SKU 只保存一条、搜索分页及特殊字面字符、启停、BUYER/VIEWER 权限与绕过前端直接请求、跨商家商品 404、偏好跨账号/商家隔离、失效/停用回退、超过 100 个仓库的分页选择、无启用仓库、商家切换迟到响应、失败重试及服务端撤销成员后的旧权限拒绝。

日志保存在 Git 忽略的 `test-results/task-11-catalog-final.log`、`task-11-full-regression.log`、`task-11-web-final.log`、`task-11-typecheck.log`。本次没有数据库模型/API变更，不重跑独立 `test:models`、`test:db` 停启集合，不将历史结果作为本次结果。

## 浏览器验收与数据保留

使用 computer-use 技能，在独立 http://localhost:5174 运行同一 Web 源码并代理到真实 3000 API，避免影响用户 5173 的会话；常规启动地址仍是 5173。

1. 注册随机新邮箱，登录后创建“任务11页面验收商家”，自动拥有 DEFAULT 仓库。
2. 空仓库表单显示中文必填；创建“验收二号仓”/`ACCEPT-02`，设为默认，刷新仍为该仓；再次使用编码会报冲突且保留表单。
3. 空商品表单显示必填；创建“20W 充电器”/`CHARGER-20W`，条码 `0002026102101`，价格 `18.50`，保留前导零。
4. 重复 SKU、重复非空条码分别显示字段错误；修改名称为“20W 充电器（页面已更新）”、价格 `26.50`，详情刷新仍显示修改结果。
5. 确认停用，搜索 SKU 可找到；仅启用筛选不显示，切到仅停用可找到；刷新后仍保留停用记录。
6. 保存商品/仓库画面后通过真实退出接口退出，登录框已清空。最终运行错误日志为空。

截图为本机忽略文件：`test-results/task-11-products.png`、`task-11-warehouses.png`，无密码或 Token。随机验收密码未写文件、未提交。

续作前中断留下一名已注册验收账号，本次另建一名账号完成流程，均保留。共新增 2 用户、1 商家、2 仓库、1 商品；当前开发库为 9 用户、5 商家、8 仓库、7 商品。原业务行逐 ID/内容指纹、`.env`/本地 JWT 配置和五个迁移校验和保持不变。核对时发现原浏览器会话正常刷新过一次：仅一个原 refresh_tokens 行的 used_at/updated_at 变化；通过在内存还原这两列并匹配原指纹确认，无凭据内容变化，也未回写数据库。最终没有遗留随机测试库，API health 返回 ok/reachable，5173 实际 HTTP 200。未删除开发数据、重装工具或迁移 C 盘数据。

## 修复与限制

续作时 Docker/API/Web 已停止，首次测试连接拒绝；启动现有 Docker Desktop 和持久化数据库恢复，未清卷。第一次重启与编译同时运行的测试 API 启动超时；编译完成后复跑正常。专项首次发现测试预期数组排序错误，已修正并复跑。浏览器发现主按钮白底白字、表单重复英文必填提示，已修复样式作用范围、关闭重复自动字段验证；修复后的 ESLint 属性顺序警告已处理。商品详情 ID 变化重新加载并拒绝旧响应，搜索无结果有独立提示。

本任务不新增后端 API、Prisma 模型或迁移，不变更依赖/锁文件。默认业务仓库属于本浏览器个人偏好；采购单使用仓库、全商家默认字段、跨设备同步留待相关任务。未验证 Android APK 或生产部署。无已知功能阻塞；启动和详细边界见 WEB_CATALOG.md，决策见 ADR-018。

## 修改文件

- Web 新增 8 个：`src/api/catalog-form.ts`、`src/api/catalog.ts`、`src/composables/catalog.ts`、`src/components/ProductEditor.vue`、`src/views/ProductsView.vue`、`src/views/ProductDetailView.vue`、`src/views/WarehousesView.vue`、`src/catalog.css`（均在 apps/admin-web）。
- Web 原文件：`src/main.ts`、`src/router/index.ts`、`src/router/policy.ts`、`src/layouts/MainLayout.vue`、`src/style.css`、`src/views/HomeView.vue`。
- 命令/测试：根 `package.json`、新增 `scripts/web-catalog.test.mjs`、更新 `scripts/web-session.test.mjs`。
- 文档：README、CHANGELOG、ARCHITECTURE、CODEX_TASKS、DECISIONS、WEB_AUTHENTICATION、新 WEB_CATALOG 和本报告。

AGENTS.md、database/schema.sql、API 源码、Prisma、旧迁移及本地密钥未改动。上传结果在任务最终答复中给出，真实数据、环境文件、构建缓存和截图不上传。
