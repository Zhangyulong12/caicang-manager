# 第一次发送给 Codex 的指令

我正在 Windows 桌面版 Codex 中开发一个名叫“采仓管家”的项目，业务是：从淘宝、京东等平台采购商品到自己的仓库，通过 Android 手机扫描快递单号验收入库，再为客户出库发货。

我已经准备好本仓库的全部需求文档：AGENTS.md、docs/PROJECT_SPEC.md、docs/ARCHITECTURE.md、docs/DATABASE_DESIGN.md、docs/API_SPEC.md、docs/SCAN_FLOW.md、docs/DEPLOYMENT.md、docs/CODEX_TASKS.md、database/schema.sql。

**请先阅读全部文档，检查工作目录、git 状态和我已经有的文件。现在只执行 CODEX_TASKS.md 的“阶段 00 — 确认环境与初始化 Git”。不要一次性生成全部系统，也不要运行危险的文件迁移/删除操作。**

本阶段需要：
- 核查 Node.js、pnpm、Docker Desktop、WSL2、Git、HBuilderX 是否具备；不存在的列出官方下载和需要的人工步骤。
- 建议在合适的数据盘（例如 D:\\Dev\\caicang-manager）建立项目工作区，但先检查路径和现有文件，不要覆盖。
- 输出下一阶段具体执行命令、风险，以及本阶段实测结果。
- 只有我明确告诉你进入下一阶段时，再开始阶段 01。

规则：遵守 AGENTS.md；不可编造测试通过，也不可用假数据宣称完成扫码与库存。每个阶段都要有验证命令和实际输出。
