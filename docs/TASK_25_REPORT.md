# 任务 25 报告 — 电脑端出库页面

## 一、结论

「出库管理」从占位页变成可用模块：列表、新建草稿、多 SKU 加行、填写数量、自动查可用库存、收货信息、快递公司、运单号、确认发货、详情、筛选、取消草稿，12 条要求全部落地。

| # | 要求 | 实现 | 对应测试 |
| --- | --- | --- | --- |
| 1 | 出库订单列表 | `/outbound`：单号 / 状态 / 仓库 / 收件人 / 商品 / 件数 / 成本 / 快递运单 / 发货时间 | `the pages are routed…`、`列表筛选与状态展示来自服务端` |
| 2 | 创建出库草稿 | `/outbound/new` → `POST /outbound-orders`，保存后跳详情 | `新建草稿：选商品与数量，草稿不动库存` |
| 3 | 添加多个商品 SKU | `OutboundProductPicker` 弹窗按仓库查余额，可反复添加，最多 100 个、禁止重复 SKU | `表单校验与幂等指纹…` |
| 4 | 填写发货数量 | 明细表逐行输入，只收 1–2147483647 的整数 | 同上 |
| 5 | 自动查询可用库存 | 选品时读 `GET /inventory/balances`，加行/改仓库/点刷新都重查；每行显示服务端可用数量 | `确认发货：库存 10 件发 3 件后剩 7 件` |
| 6 | 填写客户收货地址 | 收件人 / 电话 / 地址三栏，草稿可留空但发货前必须补齐（页面提示 + 服务端拒绝） | `表单校验与幂等指纹…`、`只读角色…` 之外的发货用例 |
| 7 | 选择快递公司 | 10 个常用编码下拉（顺丰、圆通、中通、申通、韵达、京东、EMS、极兔、德邦、其他），发货时可覆盖 | `确认发货…` |
| 8 | 填写发货单号 | 表单与发货弹窗都能填，按字符串保存、前导零保留 | 同上 |
| 9 | 确认发货 | 详情页「确认发货」→ `POST /outbound-orders/{id}/ship`，带 `clientOperationId` | `确认发货…`、`重复确认…` |
| 10 | 出库详情 | `/outbound/:id`：指标卡 + 收货信息 + 库存成本 + 明细（含成本快照） | `新建草稿…`、`确认发货…` |
| 11 | 出库记录筛选 | 搜索（单号/运单号/收件人/电话）、状态、仓库、创建日期区间、分页 | `列表筛选与状态展示来自服务端` |
| 12 | 合法条件下取消草稿 | 仅草稿 + `outbound:write` 出现按钮，二次确认后 `POST …/cancel`；重复取消提示而非报错 | `取消草稿不扣库存，重复取消不报错` |

**验收路径已跑通**：库存 10 件 → 页面选该 SKU 填 3 件 → 确认发货 → 库存变 7 件（成本快照 20.0000 / 行成本 60.0000）→ 再建 8 件草稿确认发货 → 服务端返回「需要 8 件、可用 7 件」，库存仍 7 件、单据仍待发货。

## 二、四个页面

| 文件 | 作用 |
| --- | --- |
| `views/OutboundView.vue` | 出库单列表与筛选 |
| `views/OutboundFormView.vue` | 新建 / 修改草稿，含选品与数量录入 |
| `views/OutboundDetailView.vue` | 详情、确认发货、取消草稿 |
| `components/OutboundProductPicker.vue` | 按仓库选可出库 SKU |

配套：`api/outbound.ts`（请求 + 校验 + 状态文案 + 错误翻译 + 幂等指纹）、`composables/outbound.ts`（带上 userId/sessionKey/tenantId/permissions 的 scope 守卫）、`outbound.css`。

## 三、三条关键设计

**库存不足时，页面不自己判死刑。** 表单与详情都会用服务端返回的可用数量标出"超过可用库存"，但按钮不做静默禁用 —— 否则用户永远看不到服务器到底差多少。真正的判定发生在发货事务里，失败后页面把 `details.shortages` 翻成一句话：「库存不足，未扣减任何库存：GA-65W 需要 8 件、可用 7 件。请调整数量或先补货。」

**前端不碰库存。** 可用数量、成本、均价、合计全部来自接口；页面只做千分位与 `¥`。`api/inventory.ts` 仍只有 GET，页面不出现 `stock_balances` / `stock_movements`，测试用正则守这三条。

**幂等号跟着内容走。** `shipFingerprint(orderId, body)` 由单号 + 快递公司 + 运单号 + 备注生成；同指纹重试复用同一 `clientOperationId`（超时重点不会二次扣减），内容改了换新号（否则服务端按"同号不同内容"409，页面有专门文案）。

## 四、测试

`scripts/web-outbound.test.mjs`（`pnpm test:web-outbound`）：一次性 PostgreSQL + 真实 API + 生产构建产物，**12 通过 / 0 失败 / 0 跳过**。

做法与任务 23 一致：把页面真正 import 的 `api/client.ts`、`api/inventory.ts`、`api/outbound.ts` 用 TypeScript 转译成 ESM 再调用，请求走真实 HTTP，不是 mock；页面本身做静态断言（路由、列名、字段、无本地算库存、无假数据）。

覆盖：草稿不动库存 → 发货 3 件后余额 7、流水 `10→7` 且来源单据可跳 → 8 件被拒且库存/状态/流水都不变 → 同操作号重放不二次扣减、换号 409、已发货不能 PATCH → 取消不扣库存且重复取消幂等 → 列表按状态/单号/商品/仓库/日期筛选 → VIEWER 能读不能写（客户端 403，绕过客户端服务端也 403）→ 本地校验与指纹规则 → 构建产物包含四个页面文案。

全仓 `pnpm test`：**581 通过 / 0 失败 / 0 跳过**（6 分 29 秒）；`typecheck` / `lint` / `format:check` 全过。

## 五、文件

- 新增：`apps/admin-web/src/views/OutboundView.vue`、`OutboundFormView.vue`、`OutboundDetailView.vue`、`components/OutboundProductPicker.vue`、`api/outbound.ts`、`composables/outbound.ts`、`outbound.css`、`scripts/web-outbound.test.mjs`、`docs/WEB_OUTBOUND.md`、本报告
- 修改：`api/client.ts`（`ApiFailure.details`）、`router/index.ts`（4 条路由）、`router/policy.ts`（`outboundPath` + 权限）、`main.ts`（样式）、`eslint.config.mjs`（声明 `crypto` 全局）、`package.json`（`test:web-outbound` 并纳入 `test` / `test:web`）、`README.md`、`CHANGELOG.md`、`docs/CODEX_TASKS.md`、`docs/OUTBOUND.md`

## 六、未做与风险

1. **没有浏览器 E2E**：渲染与交互由 `vue-tsc` + 生产构建 + 客户端真实请求覆盖，点击行跳转、弹窗关闭等仍需人工点一遍；要防回归建议后续引入 Playwright。
2. **不发部分发货**：一张单要么全发要么不发，与任务 24 的 API 一致；发错货只能靠尚未实现的盘点调整。
3. **列表日期筛选按 UTC 边界**：与库存页同源问题，北京时间 08:00 前查"今天"会少几小时。
4. **手机端出库仍未做**（阶段 07），扫码出库入口还是占位。
