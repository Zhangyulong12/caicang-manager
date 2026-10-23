# 任务 26 报告 — Android 库存查询与扫码出库

## 一、结论

手机端两块能力都上线了，验收路径跑通：**扫条码查到 10 件 → 建单发 3 件 → App 与 Web 都看到 7 件 → 再发 8 件被拒且仍是 7 件 → 改成 2 件发货 → 两边都看到 5 件**。

### 一、库存查询

| # | 要求 | 实现 | 对应测试 |
| --- | --- | --- | --- |
| 1 | 手动搜索商品名称或 SKU | 搜索框走 `GET /inventory/balances?search=`，服务端按 SKU / 名称 / 条码子串匹配 | `scan finds stock…`（氮化镓 / GA-65W / 编织 三种输入） |
| 2 | 手机扫描商品条形码 | `uni.scanCode({ scanType: ['barCode','qrCode'] })`，H5 无摄像头时提示改用手输 | 静态断言 `uni.scanCode` |
| 3 | 查询对应商品 | `findByCode()` 依次按条码 → SKU → 子串精确/模糊查，命中即停并标注命中方式 | `scan finds stock…`（match='barcode'） |
| 4 | 查看当前库存数量和仓库 | 结果按仓库分组，行内显示数量、SKU、单位、条码、均价、待入库、最近入库；详情页给出各仓余额 | 同上（`quantityOnHand=10`、`warehouseName`） |
| 5 | 查看最近库存流水 | 详情页 `GET /inventory/movements?productId=` 最近 20 条：类型、变动、操作前后、来源单据、操作人 | 同上（1 条 RECEIPT，operator=验收人） |

### 二、扫码出库

| # | 要求 | 实现 | 对应测试 |
| --- | --- | --- | --- |
| 1 | 打开出库功能 | 首页「扫码出库」→ `/pages/outbound/index`（`outbound:write` 才可进） | 页面注册 + 入口断言 |
| 2 | 选择目标仓库 | `GET /warehouses`，默认第一个启用仓库；换仓库重查可用数量 | `scan finds stock…` |
| 3 | 扫商品条码查询 SKU | 扫码 → `findByCode(…, { warehouseId })`，优先取该仓库那一行 | 同上 |
| 4 | 添加到出库商品列表 | `addOrIncrementLine()`：同商品合并成一行，不同商品各占一行（上限 100） | `repeated scans merge…` |
| 5 | 设置发货数量 | `− / 输入框 / +`，`parseQuantity` 只收 1–2147483647 整数；超可用量标红 | 同上 |
| 6 | 填写客户和快递资料 | 收件人 / 电话 / 地址（发货必填）+ 快递公司 picker + 运单号 + 备注 | `draft payload is the same…` |
| 7 | 创建出库草稿 | `POST /outbound-orders`；已存在草稿时改走 `PATCH`（改完再发） | `scan finds stock…`（草稿后库存仍 10） |
| 8 | 二次确认发货 | `uni.showModal` 列出仓库/每个 SKU 件数/收件人/快递，确认后才发货 | 页面静态断言 |
| 9 | 调用服务端出库事务接口 | `OutboundShipSubmitting.submit()` → `POST /outbound-orders/{id}/ship` | `10 → 7`、`7 → 5` |
| 10 | 显示发货结果 | 成功页：单号、件数、成本、时间、逐 SKU 最新余额 + "库存已在服务端扣减" | 同上（`totalCost=60.0000`） |

### 补充要求

| 要求 | 实现 | 测试 |
| --- | --- | --- |
| 没有条码时手动搜索 SKU | 扫不到自动打开搜索面板，也可主动点「没有条码？手动搜索 SKU」 | `CABLE-2M`（无条码商品）能搜到 |
| 重复扫码增加待发数量，但不直接减库存 | 累加只发生在内存数组；发货前只发 GET | 扫两次后 `quantity=2`，库存仍 10 |
| 请求失败时避免重复扣库存 | 操作号落盘 + 同指纹复用；4xx 明确拒绝才丢弃 | `network failure reuses the operation id…`、真实 API 重放仍 7 |

## 二、新增文件

| 文件 | 作用 |
| --- | --- |
| `apps/mobile/src/services/stock.ts` | 条码/查询词规范化、三层查找、余额与流水查询、展示用文案 |
| `apps/mobile/src/services/outbound.ts` | 行合并与数量、草稿组装与提交、幂等发货闸门、错误翻译、快递选项 |
| `apps/mobile/src/pages/stock/index.vue` | 库存查询（搜索 + 扫码 + 仓库筛选 + 结果分组） |
| `apps/mobile/src/pages/stock/detail.vue` | 库存详情（各仓余额 + 最近流水） |
| `apps/mobile/src/pages/outbound/index.vue` | 扫码出库全流程（含手动搜索面板、结果页） |
| `scripts/mobile-outbound.test.mjs` | 单元 + 真实 API 验收 |
| `docs/MOBILE_STOCK_OUTBOUND.md` | 页面与流程说明、手工验收步骤 |

改动：`pages.json`（注册 3 个页面）、`pages/home/index.vue`（两个入口接上 url）、`scripts/mobile.test.mjs`（页面清单断言加 3 项）、`eslint.config.mjs`（声明 `Event` 全局，供 `.vue` 里的 blur 事件类型使用）、`package.json`（`test:mobile-outbound` 并纳入 `test`）、`README.md`、`CHANGELOG.md`、`docs/CODEX_TASKS.md`。

## 三、关键设计

**扫码查询是只读的三段式**：条码精确 → SKU 精确 → 子串兜底。这样"条码没登记但 SKU 就是这串数字"的商家也能扫得动，且三次都是 GET，失败也不会留下任何副作用。

**待发数量只是页面状态**：`addOrIncrementLine` 是纯函数，没有网络调用；库存只在 `POST …/ship` 的事务里变化。页面上也写明"数量只存在本页，未提交前不会影响任何仓库库存"。

**幂等闸门的关键判断**是"这次失败到底有没有扣库存"：

- 网络中断 / 5xx → 结果未知，**保留**操作号，重试复用同一个，服务端唯一键保证只扣一次；
- 库存不足 / 状态冲突 / 参数错 → 服务端明确没写，**丢弃**操作号，改完再发是全新操作（否则会被判"同号不同内容"的 409）。

记录落在 `caicang.mobile.outbound-pending.v1`，App 被杀掉重开仍能复用——这正是"请求失败不重复扣库存"的最后一道保险。

**换仓库要重查**：`pickWarehouse` 会把已有行的可用数量清零再查，避免用 A 仓的数字发 B 仓的货。

## 四、测试

`scripts/mobile-outbound.test.mjs`（`pnpm test:mobile-outbound`）：**7 通过 / 0 失败 / 0 跳过**。

- 4 组纯逻辑：条码规范化与防抖、重复扫码合并且不动库存、草稿排序与校验、幂等闸门（网络失败复用 / 业务拒绝丢弃 / 指纹）。
- 1 组页面静态断言：三个页面已注册、首页入口接了 url、页面不出现 `stock_balances` / `quantityOnHand =`、发货必须走服务层。
- 1 组真实验收（一次性 PostgreSQL + 真实 Nest API）：备货 10 件 → 扫码读到 10 → 扫两次待发 2 → 存 3 件草稿（库存仍 10）→ 发货（10→7，成本快照 20.0000）→ **用 admin-web 的库存客户端读到 7** → 重放同一操作号仍 7 → 另一商品发 2 件 → 发 8 件被拒（"需要 8 件、可用 7 件"）→ 改成 2 件发货（7→5）→ Web 端读到 5，数据库 `stock_balances` 也是 5。

全仓 `pnpm test`：**591 通过 / 0 失败 / 0 跳过**（7 分 10 秒）；`typecheck` / `lint` / `format:check` 全过，`uni build -p h5` 构建通过。

## 五、未验证与风险

1. **没有真机验收**：测试跑在 H5 构建 + 真实 API 上，扫码入口用函数调用模拟。摄像头权限、`uni.scanCode` 在 App 端的表现、`<picker>` 交互仍需按 README 的 `pnpm build:mobile:lan` 出包实测。
2. **手机端不能取消草稿**：建了草稿只能在 Web 端取消或继续发货；出库单没有删除入口。
3. **Android 返回键/手势**未在出库页做拦截，表单内容不落盘（只有操作号会落盘）。
4. **同一商品跨仓库**：扫码时优先当前仓库，若该商品只在别的仓库有货，会提示但仍允许加入——数量上限按当前仓库的可用量为准，服务端会在发货时给出准确差额。
