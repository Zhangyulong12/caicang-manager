# 任务35：生产部署、恢复与上线边界

任务36复核保留本部署方案，并在独立Compose项目追加PostgreSQL重启、逐表内容指纹和API重连验证；真实结果与已执行备份恢复记录见 [TASK_36_REPORT.md](TASK_36_REPORT.md)。演练项目默认loopback、私有CA，不代表公网证书或正式服务器验收。本轮未改变既有数据库迁移、开发环境配置或测试APK。

本轮只完成安全修复、独立生产配置及隔离验收。没有购买服务器、配置真实 DNS、申请公网证书或发布正式 APK。**不能把本地 HTTPS 演练解释为公网部署成功。** 真实执行结果和剩余风险见 `TASK_35_REPORT.md`，模块隔离清单见 `SECURITY_AUDIT.md`。

## 1. 架构和生产凭据

`Web/Caddy HTTPS → NestJS API → PostgreSQL 16`。Compose 仅 Web 发布端口，API 和数据库都没有 host ports；代理网与数据库网为 internal。默认仍绑定127.0.0.1，改公网绑定、云安全组、DNS前必须经用户确认。

`infra/production/Dockerfile` 多阶段构建共享包、API、Web，运行镜像不包含开发 .env、Git、APK、备份、签名文件或测试凭据。Node22和Caddy2基础镜像锁 digest，包使用现有锁文件。Prisma保持7.10；安全补丁使用明确的 pnpm overrides。API 和 Web 非 root、只读文件系统、drop ALL capabilities、no-new-privileges；Caddy监听8080/8443，移除镜像自带低端口 capability。9000仅容器 loopback 健康检查，不发布。

运行 API 只得到 app_password/jwt_secret；迁移作业只得到 owner_password；数据库初始化得到 owner/app 密码。密码和JWT由运行时 secret 文件读取，不烘入镜像，也不直接放入 Compose 环境变量。`caicang_app` 不能建库、建角色或DDL，不能改/删库存流水与审计；迁移独立使用 owner，不能把 owner 连接串交给 API。Docker/主机管理员仍有权读取容器与备份，必须限制运维权限；本地 Compose secrets 不是独立的加密密钥管理服务。

### 准备独立配置

先确认真实域名、证书联系人和发布标识，再由运维执行（占位参数不可原样运行）：

```powershell
cd D:\Dev\caicang-manager
node scripts/prepare-production.mjs --directory D:/Deploy/caicang-production --domain <已确认的域名> --email <证书联系人邮箱> --release-tag <已审阅的镜像标识>
```

脚本要求全新、位于仓库外的目录；使用密码学随机值，拒绝覆盖已有目录、凭据或配置。Windows新目录收紧NTFS ACL；Linux目录0700。secret文件只能通过私有父目录或已授权的容器挂载读取。保护整个目录，禁止 Git、聊天、工单或云日志上传真实凭据。不要复用开发 `.env`。

发布时最终使用已审阅提交/CI镜像digest；本地未提交工作区构建标识只是 review 标识，不能声称对应某个干净提交。示例 `infra/production/.env.example` 只含结构，真实 secret 值不在其中。

## 2. 上线前审查和运行

PowerShell（Linux同样使用docker compose命令，变量语法按shell调整）：

```powershell
$ProdEnv = 'D:/Deploy/caicang-production/.env.production.local'
docker compose --env-file $ProdEnv -f infra/production/compose.yml config --quiet
docker compose --env-file $ProdEnv -f infra/production/compose.yml build
# 以下启动仅在确认服务器/域名/防火墙方案后执行；默认仍为loopback
docker compose --env-file $ProdEnv -f infra/production/compose.yml up -d --wait --wait-timeout 240
docker compose --env-file $ProdEnv -f infra/production/compose.yml ps
```

顺序为 PG Healthy → `prisma migrate deploy` 成功及 app 权限授予 → API Healthy → Web Healthy。禁止生产 migrate dev/db push/schema.sql重复导入；禁止 down -v、删卷或为“修复启动”重置库。现有开发卷 caicang-manager-dev 不参与此配置。

生产 `NODE_ENV=production` 不读取本地 .env 或自动生成 JWT。Swagger关闭，CORS必须匹配配置的HTTPS域名；生产不接受客户端伪造Host/Origin来绕过白名单。Caddy删除外部伪造的转发链，API仅信任配置的Caddy精确IP；API不可直接暴露，CDN/负载均衡需另行审阅可信代理链，不能随意扩大TRUSTED_PROXIES到整个网络。

生产默认 `PUBLIC_REGISTRATION_ENABLED=false`，注册返回403 `REGISTRATION_DISABLED`及明确提示，开发默认保持开放。当前账号没有邮箱归属验证，邀请成员按已注册邮箱匹配，正式公开注册前必须选择邮箱验证或经过人工核实的开通方案。隔离测试显式开启公开注册只是QA配置，不可直接照搬公网。

限流为单API进程内存，默认120次/分钟，登录/注册/刷新另有敏感限流；复制API实例前需共享限流存储及压测。Access Token短期、Refresh Token随机值仅存哈希并轮换/撤销，退出后刷新失败。TLS静态Web设置CSP、安全头；代理限制请求体，API仍执行DTO校验。Vite开发服务器不能作为公网Web运行方式。

## 3. HTTPS与公网确认事项

Caddy生产配置使用真实域名自动获取和续期ACME证书，保留持久化 `/data` 和 `/config`。HTTP80转HTTPS443，数据库5432和API3000不放行。正式服务器只允许必要80/443，管理端口另设可信来源；主机与云防火墙一起审查。不能通过关闭证书验证解决错误。

本地验收 `Caddyfile.acceptance` 使用私有CA，仅测试客户端显式信任导出的root.crt，未安装到Windows/Android系统，也未设置TLS不校验。不得将该CA配置当公网证书发布。

需用户先确认：服务器服务商/地域和预算、域名归属、DNS权限、证书联系邮箱、备份异地存储、运维访问方式、预计商家量和注册开通方式。费用项目为服务器、域名、备份存储/流量及可选监控；未选地域和服务商，尚无准确报价，也没有采购。ACME可选免费证书发行机构；不等于服务器/域名免费。不得为省步骤直接开放开发电脑。

## 4. 迁移、发布与回退

1. 先在隔离库演练当前10个迁移和重复deploy；记录现存行数、成本及账本指纹。
2. 发布前生成并校验备份，确认最近有真实恢复验证；记录镜像digest、schema版本和回退镜像。
3. 采用增量兼容迁移，先加字段/表，再发布兼容代码；删除、改类型、跨表回填必须另行审阅影响与锁时间。
4. API运行时无DDL权限，所有迁移由一次性作业完成；失败时API不启动。
5. 代码回退只回退仍兼容当前schema的镜像；不要盲目回滚数据库。恢复到新库、核对后，在维护窗口经确认再切换连接配置；保留原库供复核。

本轮未新增数据库迁移，也未修改既有迁移文件。

## 5. 备份和恢复

备份脚本使用容器内 PostgreSQL16 `pg_dump -Fc --no-owner --no-acl`，二进制流直接写文件，不经PowerShell文本重定向；成功后才将.part更名为.dump，记录SHA256、版本、时间和发布标识。SHA256能检测损坏，不能证明不可信备份的来源。备份含商家资料和认证哈希，必须放在受限、加密的磁盘/异地存储中；自定义dump格式压缩不等于加密。本轮没有配置真实异地存储或定时任务。

```powershell
node scripts/production-db.mjs backup --env-file $ProdEnv --output-dir D:/PrivateBackups/caicang/daily
# 或 PowerShell 包装
./scripts/backup-production.ps1 -EnvFile $ProdEnv -OutputDirectory D:/PrivateBackups/caicang/daily

node scripts/production-db.mjs restore --env-file $ProdEnv --backup D:/PrivateBackups/caicang/daily/<文件>.dump --target-database caicang_restore_<新标识至少8字符>
# 或 ./scripts/restore-production.ps1 -EnvFile $ProdEnv -BackupFile <文件> -NewDatabase <新库名>
```

恢复只允许全新的 `caicang_restore_*`，先验证SHA、再创建新库，使用单事务及exit-on-error；拒绝覆盖现存库或caicang。脚本会在**新恢复库**真实验证历史NOT VALID约束；如旧数据不符合约束则失败并保留新库待审查，不删/改原始行以凑通过。核对迁移、业务表数量、非负余额及约束，再比较单据和账本。恢复备份不带ACL，切换前用迁移作业给新库重新授予 app 最小权限。

```powershell
# 只用于已完成验证的新恢复库；迁移和授予权限，不替换当前服务连接
docker compose --env-file $ProdEnv -f infra/production/compose.yml run --rm -e POSTGRES_DB=<新恢复库名> migrate
```

建议日备14天、至少保留最近2份，月备单独目录保留12月；异地加密副本、每月真实恢复演练。建议先约定RPO24小时、RTO1小时目标并以真实容量测试确认；小测试库几秒恢复不代表正式容量达标。

```powershell
# 先预览，默认不删任何文件
node scripts/production-db.mjs prune --env-file $ProdEnv --output-dir D:/PrivateBackups/caicang/daily --retention-days 14
```

只有运维核对清单并确认后才加 `--apply`；脚本保留最新2份、要求近期有恢复验证、校验路径/文件名/哈希，未知和不完整文件不自动删除。不得对月备目录运行日备清理。本轮仅测试dry-run，没有执行清理删除。

## 6. 健康、日志和排障

`docker compose ... ps` 看PG/API/Web健康，`logs --tail 200 api/migrate/web/postgres` 看启动与迁移。API的HTTP requestId关联错误，生产诊断仅记录固定异常名、错误码及源文件/行号，不记录原始SQL、错误参数、密码、Token、地址。PG关闭SQL和参数错误详情；Caddy正常请求及上游失败日志删除URI/headers/IP。不要为排错打开公网Swagger或输出完整环境变量。

| 现象           | 检查                                                                                         |
| -------------- | -------------------------------------------------------------------------------------------- |
| PG unhealthy   | secret文件权限、独立卷、磁盘、官方镜像日志；不删卷重试                                       |
| migrate失败    | owner凭据、迁移历史、数据库网络；停止发布并保留错误                                          |
| API启动失败    | Config错误键、诊断code/frames、数据库与app授权、端口；不忽略异常                             |
| Web起不来      | caddy validate、固定代理IP冲突、私有卷写权限、去除无用file capability；保留no-new-privileges |
| 证书错误       | DNS、80/443、域名/SAN、ACME日志、时间和持久化卷；不关闭校验                                  |
| 登录429        | 查看是否真实触发限流、反代是否覆盖转发链，不能扩大可信代理解决                               |
| 注册403        | 默认上线保护；确认邮箱验证/人工开通方案，不是删除Tenant权限                                  |
| 业务403/404    | 当前用户、X-Tenant-Id、有效membership和角色；不返回其他商家资源来帮助排查                    |
| 恢复完整性失败 | 只查新恢复库的约束和旧行原因；原库保持不动，人工制定修复方案                                 |

服务器监控和告警需覆盖健康、5xx/429、磁盘、DB容量、证书续期、备份/恢复失败；本轮未接入真实通知服务。

## 7. Android正式环境准备

保持现有已安装测试APK和源码测试manifest不变。确认真实HTTPS域名后：

```powershell
pnpm build:shared
pnpm build:mobile:production --api-base-url https://<已批准真实域名>/api/v1 --output-dir D:/ReleaseArtifacts/<全新资源目录>
```

脚本拒绝HTTP、localhost、IP、局域网/保留示例域名、凭据或query；在已忽略缓存内复制输入，只把副本 `usesCleartextTraffic=false`，输出目录必须全新。这里只生成uni-app资源，不签名、不安装、不发布APK。源码生产环境也拒绝明文HTTP，开发LAN流程保留。

HBuilderX导入该资源工程后，核对生产包名、DCloud AppID、版本和Android目标SDK；按官方发行流程使用专属生产签名。不要直接覆盖测试包；签名密钥、口令保存在仓库外受限位置，APK签名证书指纹可另行记录，私钥和密码不能入Git。本轮未申请生产AppID/签名、未发布正式安装包，也未用实际公网API做真机验收。

正式设备清单：可信HTTPS登录 → 选择商家 → 面单查询不写库存 → 二次确认入库 → Web/DB同数量成本 → 库存查询 → 确认出库及流水 → 同操作号重试 → 库存不足/越权拒绝 → 退出后不能刷新；还需冷启动、切换商家缓存清理、断网恢复和旧响应拒收。本次新增移动端安全修复只有自动化验证，不能用任务34旧APK验收代替新版本真机结果。

## 官方依据

- [Docker生产Compose](https://docs.docker.com/compose/how-tos/production/)、[内部网络](https://docs.docker.com/reference/compose-file/networks/)、[Compose secrets](https://docs.docker.com/compose/how-tos/use-secrets/)：网络与凭据隔离。
- [Caddy反向代理](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)、[日志过滤](https://caddyserver.com/docs/caddyfile/directives/log)、[TLS](https://caddyserver.com/docs/caddyfile/directives/tls)：转发头、日志与本地CA/证书配置。
- [PostgreSQL16 pg_dump](https://www.postgresql.org/docs/16/app-pgdump.html)、[pg_restore](https://www.postgresql.org/docs/16/app-pgrestore.html)：一致性逻辑备份、单事务恢复与不可信dump边界。
- [uni-app安心打包](https://uniapp.dcloud.net.cn/tutorial/build/SafePack)：正式安装包与签名由HBuilderX流程完成。
