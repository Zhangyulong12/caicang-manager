# 任务35：多商家安全审计与生产部署准备

任务36复核补充：本轮保留安全修复，重新执行全仓与独立生产演练，并增加隔离数据库重启后的逐表内容指纹及API重连验证。本文原数字是任务35历史结果；最新结果见 [TASK_36_REPORT.md](TASK_36_REPORT.md)。公网、正式Android、异地备份和容量验收仍未完成，不能据此标记所有上线标准完成。

执行日期：2026-10-28—30（Asia/Shanghai）。状态：**安全修复、生产配置及隔离验收已完成**，最终全仓744项、生产演练12项全部通过，均0失败/0跳过。**未执行公网部署和正式Android发行，不标记所有上线验收完成。**

开工Git为main同步origin/main，原有未跟踪test/保留。未提交、推送、重置数据库、删除卷或覆盖.env；不修改既有数据库迁移。风险与修复先在会话说明，完整清单见 SECURITY_AUDIT.md；可执行部署/备份/恢复/排障见 PRODUCTION_DEPLOYMENT.md。

## 修改文件范围

- API：bootstrap生产CORS；config/env公开注册开关；auth.service注册门禁；common/errors及共享api-contract标准错误码；logging/exception.filter/main安全诊断；prisma.config生产不加载开发.env。
- 手机：api/client会话和商家响应边界；stores/session按用户缓存和重新核验；tenant页面切换清空页面栈；config生产HTTPS。没有重做入库、出库、调整、退货功能，没有替换APK。
- infra/production：Dockerfile、compose.yml、Caddyfile及acceptance、routes/logging、初始化app角色脚本、生产.env.example；.dockerignore/.gitignore保护凭据与产物。
- scripts：security-audit、mobile-security、mobile-production、production测试；production-db真实二进制备份恢复及dry-run保留策略、PowerShell包装；prepare-production私有配置生成；build-mobile-production资源副本构建。report-fixture仅向新安全测试提供隔离库连接参数。
- pnpm-workspace.yaml/pnpm-lock.yaml：精确安全overrides，保留Nest/Prisma/三端主版本；package.json独立安全/生产测试及正式资源构建入口。
- 文档：本报告、SECURITY_AUDIT、PRODUCTION_DEPLOYMENT、DEPLOYMENT、README、CODEX_TASKS、API_SPEC及DECISIONS同步。

## 验收记录

| 项目                               | 真实状态                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------ |
| A/B原始业务交叉访问                | 安全专项41项通过，0失败/跳过；原始日志security-audit-rerun.log                       |
| 手机旧请求/会话/缓存               | 新增6项真实API/源码测试通过，0失败/跳过；未做新版本APK真机复验                       |
| 第一轮全仓回归                     | 738通过、0失败/跳过；在最后依赖及手机修复前，不冒称最终版本全部通过                  |
| 最终全仓回归                       | 最后原样重跑744通过、0失败/跳过，518.33秒；含全仓build，日志full-test-sequential.log |
| 最终生产Compose/TLS/备份恢复       | 12项通过、0失败/跳过，292.78秒；含真实恢复及故障日志脱敏                             |
| typecheck/lint/format:check        | 全仓类型、Lint、格式检查已通过；PowerShell包装语法和私有目录边界验证通过             |
| 公网服务器/DNS/公网证书            | 未执行，等待用户确认资源、费用和访问方案                                             |
| 正式Android构建/签名/安装/公网联调 | 未执行，缺少已批准正式API域名/签名发布方案；仅地址和manifest副本规则自动化           |
| 备份清理                           | 只验证dry-run，不执行删除；无定时/异地服务配置                                       |

证据均位于Git忽略的test-results/task35，包含随机测试密钥/备份的隔离目录不提交、不发送第三方。生产演练项目以caicang-t35-开头，数据库卷与caicang-manager-dev分离，主机端口只绑定127.0.0.1；测试结束只stop保留卷，没有down -v。

## 失败与修复过程

1. 首次安全矩阵误把两个库存列表的外ID筛选要求为404；现有文档明确200空页，核对未泄露数据后改为严格data=[]、total=0断言，所有详情/写入仍要求403/404。
2. 第一轮生产启动代理IP被API动态分配占用；给API与Caddy分别指定IP，验收项目使用独立测试网段，避免污染其他环境。
3. Caddy镜像低端口file capability与cap_drop/no-new-privileges冲突；移除无用capability并监听高端口，保留安全限制，加Web健康检查。
4. 真实恢复后的完整性校验发现旧调整原因约束刻意NOT VALID；在全新恢复库执行真实VALIDATE，若历史数据不满足则失败保留供审查，不修改原库或删行。
5. 一次测试中正在构建的镜像和宿主机实时修改的验收Caddy文件不一致，导致找不到logging导入；改为每次复制固定验收配置到独立目录，最终镜像包含相同日志过滤文件后重跑。
6. 初次Lint指出structuredClone全局和未用导入，已用纯JSON副本及清理未用导入修正；没有取消检查。
7. 最后依赖版本的全量回归在并行生产镜像构建期间出现一次API重启30秒准备超时，原始错误为“API did not become ready”，无业务断言改动；单独原样重跑认证44项全部通过。随后再次运行完整回归，结果见最终验收行，不将失败日志删除或计为通过。

最终生产证据：`test-results/task35/production-test-final.log`；独立项目 `caicang-t35-706fc56a`。逐表源库/恢复库行数及内容指纹在该目录 `restore-fingerprints.json` 一致，重复迁移未改业务行；备份校验、拒绝覆盖/损坏备份、仅dry-run保留策略均真实执行。故障测试停掉隔离API产生502，检查Caddy正常及错误日志不含测试Token、邮箱和查询敏感标记。全部测试服务已停止，卷和备份保留，开发数据库仍Healthy。

依赖审计原始JSON为 `dependency-audit-release.json`：按apps__api路径匹配的当前公告0；整个工作区仍有高13/中23/低6/严重0，不是全仓零漏洞。主要涉及Vite、esbuild、Vue/i18n、PostCSS、adm-zip等移动端/工具链依赖，需DCloud兼容升级审查。未运行容器OS CVE扫描，不能据此声称镜像无漏洞。

## 上线前待确认

需要用户确认服务器地域/服务商/预算、域名/DNS、证书联系人、运维访问、异地备份和公开注册方式。未核实任何采购报价，也没有产生采购。生产默认关闭公开注册，明确返回REGISTRATION_DISABLED，避免未经验证邮箱直接参与商家邀请。

残余依赖公告、镜像OS漏洞扫描、真实容量压测、正式公网和新Android真机结果单列，不用本地或旧APK结果冒充。详见两份专项文档。

## 复核命令与文件保护

- `pnpm test`：包含Prisma生成、共享包/API/Web/mobile H5构建、API测试夹具和全部回归；最后744项全绿。上一次同版本为742通过/2失败（1次启动超时及其父用例），认证单独44项通过，随后完整原样重跑通过；没有改断言、放宽超时或skip。
- `pnpm test:production`：固定镜像实际构建并启动独立PG/API/Web，TLS私有CA由客户端严格校验、真实业务及备份恢复12项全绿；不是公网或Android验收。
- `pnpm typecheck`、`pnpm lint`、`pnpm format:check`：均实际通过；新文档另经Prettier检查。两份PowerShell包装实际语法解析通过，底层备份恢复Node命令已真实执行。
- `pnpm prisma:migrate:status`：原开发库10个迁移最新；schema.prisma、既有迁移、database/schema.sql、测试manifest未改变。
- 私有配置路径拒绝仓库内路径（含..前缀伪装目录）验证通过，未创建真实生产凭据；成功生成生产凭据和正式App资源构建仍须确认实际域名后由运维执行，不能称为已验证正式构建。
- 修改内容及新文件的已知真实密钥字面量扫描通过；HEAD仍为3dba74a，原test/排除且保留；本任务未git add/commit/push。最终仅原caicang-postgres运行Healthy，隔离测试服务均stop，未删卷或备份。
