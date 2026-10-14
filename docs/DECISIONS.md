# 架构决策记录（ADR）

- ADR-001：业务优先“采购到仓库再出库”，不做买家订单自动同步（首版无需电商平台授权）。
- ADR-002：模块化单体 NestJS，而不是微服务；PostgreSQL 事务保障一致性。
- ADR-003：扫码运单仅定位包裹，必须人工核对入库内容；支持无预计装箱明细的包裹验收后手动完结。
- ADR-004：库存使用移动加权平均成本；价格保存 Decimal，保留采购原始成本快照。
- ADR-005：一个商家多成员，所有业务请求校验 membership/role 与 tenant_id。
- ADR-006：移动端优先 uni-app Android 真机；Web 管理端独立 Vue3。

后续 Codex 如需修改任一决策，应写明变更原因、影响表、API、迁移与新验收测试。

## ADR-007：Windows 工作区与工具准备（2026-10-14，任务 00）

- 工作区采用用户指定的 `D:\Dev\caicang-manager`。从原资料包复制并校验 16 个文件；原目录保留，不迁移 C 盘用户数据。
- 保留可用的 Node 22.22.2 LTS 和 Corepack 0.34.6，不重装。通过 Corepack 启用现有 pnpm 11.25.0 对应的系统命令，实测普通 PowerShell 可以执行。此版本作为环境基线；阶段 01 再在 packageManager 与锁文件中固定项目依赖。
- 使用系统 Windows PowerShell 5.1 作为普通终端基线，不要求将 Codex 私有 PowerShell 7 加入系统 PATH。
- 初始化 main 分支并保存设计与环境快照。Docker、WSL2、HBuilderX 的失败项如实记录，不以已安装 CLI 或默认 WSL 版本代替引擎验证。
- Windows 11 22H2 超出支持期，先通过系统更新进入支持期，再修复 WSL2 和安装 Docker Desktop。不安装旧 Docker 绕过操作系统条件。
- 影响范围：开发工作区、工具配置、Git 忽略规则和环境文档；无数据库变更、API 变更或业务实现。验收依据见 `ENV_CHECK.md`。
