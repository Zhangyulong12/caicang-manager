# 技术架构与项目目录结构

## 1. 取舍

首版采用“模块化单体后端 + 两个客户端”：避免微服务过度设计。电脑后台用 Vue 3/Vite/Element Plus；手机使用 uni-app Vue 3，安卓原生打包优先；后端使用 NestJS TypeScript；PostgreSQL 作为单一事务真相来源。Redis、RabbitMQ、K8s、AI/OCR 不做首版硬性依赖。

Prisma 版本建议选择已明确兼容的 V7（整仓版本锁定，不用 `latest` 浮动）。**V7 关键差异**：`prisma-client` generator 显式输出目录；`prisma.config.ts` 配数据源 URL；PostgreSQL 运行时必须配 `@prisma/adapter-pg` + `new PrismaClient({ adapter })`；Node.js ESM/CLI 版本要求依真实创建时间的官方文档核查。

## 2. Monorepo 计划目录

```text
caicang-manager/
├─ AGENTS.md                         # Codex 必须遵守的开发规则
├─ README.md
├─ package.json                      # pnpm workspace 根命令
├─ pnpm-workspace.yaml
├─ pnpm-lock.yaml
├─ .env.example
├─ .gitignore
├─ apps/
│  ├─ api/                           # NestJS
│  │  ├─ package.json
│  │  ├─ prisma/
│  │  │  ├─ schema.prisma             # Prisma schema
│  │  │  └─ migrations/              # 版本化数据库迁移
│  │  ├─ prisma.config.ts
│  │  ├─ src/
│  │  │  ├─ main.ts                  # /api/v1 / OpenAPI / CORS
│  │  │  ├─ app.module.ts
│  │  │  ├─ config/
│  │  │  ├─ common/                  # DTO、guards、filters、decorators
│  │  │  ├─ prisma/                  # @prisma/adapter-pg 初始化
│  │  │  ├─ modules/
│  │  │  │  ├─ auth/
│  │  │  │  ├─ tenants/
│  │  │  │  ├─ members/
│  │  │  │  ├─ warehouses/
│  │  │  │  ├─ products/
│  │  │  │  ├─ purchasing/
│  │  │  │  ├─ packages/
│  │  │  │  ├─ receiving/
│  │  │  │  ├─ inventory/
│  │  │  │  ├─ outbound/
│  │  │  │  ├─ reports/
│  │  │  │  └─ audit/
│  │  │  └─ generated/prisma/
│  │  └─ test/                       # e2e/integration/concurrency
│  ├─ admin-web/                     # Vue 3 + Element Plus
│  │  ├─ package.json
│  │  ├─ src/
│  │  │  ├─ api/                    # typed client
│  │  │  ├─ router/
│  │  │  ├─ stores/                 # Pinia auth/tenant
│  │  │  ├─ layouts/
│  │  │  ├─ components/
│  │  │  ├─ views/
│  │  │  │  ├─ dashboard/
│  │  │  │  ├─ products/
│  │  │  │  ├─ purchases/
│  │  │  │  ├─ packages/
│  │  │  │  ├─ receipts/
│  │  │  │  ├─ inventory/
│  │  │  │  ├─ outbound/
│  │  │  │  └─ settings/
│  │  │  └─ main.ts
│  └─ mobile/                         # uni-app Vue 3 + TS，HBuilderX 打开
│     ├─ manifest.json
│     ├─ pages.json
│     ├─ App.vue
│     ├─ main.ts
│     ├─ pages/
│     │  ├─ login/
│     │  ├─ home/
│     │  ├─ scan-package/
│     │  ├─ receive-check/
│     │  ├─ receive-result/
│     │  ├─ inventory/
│     │  ├─ outbound/
│     │  └─ me/
│     ├─ components/
│     ├─ services/                   # 与后台共用 API 语义
│     ├─ stores/
│     └─ utils/
├─ packages/
│  ├─ api-contract/                   # OpenAPI 生成或可跨端安全复用 DTO
│  └─ utils/                          # 仅纯 TS 辅助工具，不依赖浏览器 API
├─ infra/
│  ├─ compose.dev.yml                 # 本地 PostgreSQL
│  ├─ compose.prod.yml                # 正式 API、PostgreSQL、反代
│  ├─ Dockerfile.api
│  ├─ Dockerfile.web
│  ├─ Caddyfile
│  └─ backup/
├─ docs/
│  ├─ PROJECT_SPEC.md
│  ├─ ARCHITECTURE.md
│  ├─ DATABASE_DESIGN.md
│  ├─ API_SPEC.md
│  ├─ SCAN_FLOW.md
│  ├─ DEPLOYMENT.md
│  └─ CODEX_TASKS.md
└─ scripts/
   ├─ dev.ps1
   ├─ seed.ts
   └─ smoke-test.ps1
```

以上是**目标代码仓结构**。任务 01 已建立 API、管理端、手机端和两个公共包的骨架；业务 modules、迁移和生产 infra 按后续任务建立。手机工程采用 DCloud CLI 标准布局，App.vue、main.ts、manifest.json、pages.json 和页面实际位于 `apps/mobile/src`，HBuilderX 后续打开 `apps/mobile` 根目录。开发 Compose 统一位于 `scripts/compose.dev.yml`；具体版本与取舍见 ADR-008。

## 3. 关键职责边界

- 前端只负责表单、扫码、扫码候选展示和请求发出；**不得在前端计算最终库存或写入成本**。
- API guard 负责认证、商家成员身份和角色；DTO 负责输入验证；业务 service 负责状态机及权限细节；数据库负责最终事务/约束。
- `receiving`、`outbound`、`inventory` 必须共同约定库存写入服务，不允许三套独立库存算法。
- 共享 `api-contract` 只放 JSON schema/OpenAPI 生成类型，不要跨端引用 NestJS runtime。

## 4. 工程质量

- 分支：`main` 稳定，按任务提交 `feat/task-xx`。每个阶段前 Git commit，Codex 要展示文件变更和测试结果。
- 规范：ESLint + Prettier + TypeScript strict + Zod/class-validator DTO + 自动测试；API Swagger/OpenAPI。
- CI：安装锁文件、静态检查、构建 API/Web、测试、数据库 schema/migration 校验；Android 手工真机验收另列。
- 配置：三个客户端使用不同的环境变量；任何私钥、签名文件、服务端数据库密码不得进 Git。
- 部署：生产 API 无状态，可横向扩；DB/存储仅后端可达；HTTPS 与 CORS 只允许明确域名。

## 5. 安全与多租户

数据库行采用 `tenant_id`，所有业务查询显式应用租户范围，API 每请求检查当前用户归属。关键读写禁止 `findUnique({where:{id}})` 后无租户验证；跨商家资源返回 404，避免枚举。成员权限变更需审计。收货人、手机号、地址为敏感资料：导出前做角色授权、日志不记录原文、最小化展示/脱敏。

## 6. 成本与商品码

商品条码仅用于映射 SKU；扫码入库运单匹配包裹。一个 SKU 可以有多次不同采购价，账面库存成本按移动加权平均。采购信息必须保留原始单价与费用，不能因为库存平均成本变化覆盖采购历史。

## 7. 文档更新规则

任何业务流程改变必须先更新 spec/API/DB 决策，再改实现，最后加测试。`schema.sql` 和 Prisma schema 要一致；后续以 Prisma 迁移为最终运行源，SQL 参考稿需标示是否仍同步。分阶段由 Codex 更新 CHANGELOG。
