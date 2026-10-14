# Codex Agent Instructions — 采仓管家 V1.0

## 产品原则

- 业务模型 A：电商平台采购 → 自有仓库收货 → 商品入库 → 出库发货；非直接代发。
- 每个包裹的运单条码只匹配包裹和采购单，不能自动识别里面的 SKU。
- 请遵守 `docs/PROJECT_SPEC.md`、`docs/DATABASE_DESIGN.md`、`docs/API_SPEC.md`、`docs/SCAN_FLOW.md`。
- 以 `docs/CODEX_TASKS.md` 当前阶段为范围，避免大规模“一次性生成”。

## 技术规则

- API：NestJS + TypeScript strict + Prisma 7 + PostgreSQL，服务器端执行库存与成本运算。
- Web：Vue3 + Vite + Element Plus；Android：uni-app Vue3 + HBuilderX 真机测试。
- Prisma 7 配置：`prisma-client` generator 明确 output、`@prisma/adapter-pg` 驱动适配器、Prisma Client ESM，按选定的具体版本固定 lockfile。
- 保持一致的 DTO 与 OpenAPI 文档；校验用户输入、规范错误码。
- 所有业务数据以 `tenant_id` 隔离；服务端每次验证用户 membership + role，不允许仅用 `id` 查询暴露跨租户对象。
- 库存余额不允许直接 CRUD；仅服务端 receipt、outbound、adjustment 事务修改。并发收货需锁采购主单，禁止超收；库存余额不为负。
- 收货 `clientOperationId` 与出库 `confirmOperationId` 要幂等；输入不变的重试返回原操作，不同内容复用相同 ID 返回冲突。
- 订单/包裹/收货/发货状态机必须限制合法状态转换；重要事件应有审计日志。
- 金额用数据库 NUMERIC/TS Decimal 或字符串，不能用 JS float 实现会计运算。

## 操作习惯

- 开始前检查用户文件、Git status、依赖与已有工作；不得静默删除文件、覆盖配置或在生产 DB 执行危险命令。
- 输出具体文件和测试结果，绝不声明没有运行过的测试成功。
- 优先可复现命令/脚本，PowerShell 兼容 Windows；项目工作区可在 D 盘。
- API 密钥、JWT 密钥、数据库连接串、APK 签名文件不得提交仓库；生产使用 HTTPS；生产数据库不对公网暴露。
- V1 核心路径必须使用真实 PostgreSQL + 事务 + API，不能仅做样式页面或 Mock 库存。
- 不在未经授权的情况下获取电商平台私有用户订单/物流信息，不使用爬虫模拟登录。

## 文档、测试与完成定义

- 每次实现功能同步维护相关文档，并新增正例、反例、并发与权限用例。
- 每阶段都要运行 lint/typecheck/build/相关测试并提交输出摘要。
- API 约定详见 `docs/API_SPEC.md`，避免出现手机端、Web 端不一致。
- Android 扫码上线条件是真机 APK 验证；浏览器按钮模拟扫码不算。
- 对无法在当前环境运行的任务应写明实际限制和准确的手动验收流程，不能编造结果。
