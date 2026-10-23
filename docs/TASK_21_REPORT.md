# 任务 21 报告 — 手机扫码验收入库全流程

## 一、结论

扫码到详情之间多了一个**真正写库**的收货页 `pages/receiving/index`：展示采购单、承运商与运单号、每个 SKU 的订购/已入库/剩余数量，按实际到货填数量（可部分收货、可多 SKU），填备注，二次确认后调 `POST /receipts`（任务 17 的真实事务），成功后展示服务端返回的入库单号与本次入库件数，并能直接继续扫下一包裹。

- 16 项要求全部落地；`typecheck` / `lint` / `format:check` 通过，H5 与 App 产物构建成功。
- 收货逻辑抽到框架无关的 `services/receiving.ts`，`scripts/mobile-receiving.test.mjs` **10 通过 / 1 跳过**（跳过的是需要 PostgreSQL 的真实入库验收）。
- **本机 Docker 仍被系统策略拦截**，因此"扫一单收 5 件、数据库库存 +5"这条验收目前只有代码与单元测试保证，需要按第六节在真机 + 可启动 PostgreSQL 的机器上确认。这一点没有被我当作已通过。

## 二、16 项要求的落地

| # | 要求 | 实现 | 位置 |
| --- | --- | --- | --- |
| 1 | 展示采购单信息 | `GET /packages/:id` 的采购单号、采购状态；`GET /packages/:id/receivable` 的收货方式（按包裹计划 / 按采购单剩余） | `pages/receiving/index.vue` |
| 2 | 快递公司与运单号 | 顶部强调区展示 `carrierCode` + `trackingNo`（原样字符串，前导零不丢） | 同上 |
| 3 | 采购 SKU 与商品名称 | 每个可收明细行展示 `name` 与 `sku`（含单位） | 同上 |
| 4 | 订购 / 已入库 / 剩余 | 每行三列数字：`orderedQuantity`、`receivedQuantity`、`orderRemainingQuantity`；有包裹计划时多一列「本包裹待收」 | 同上 |
| 5 | 输入本次实际到货数量 | 每行大号数字输入框，默认带出 `maxReceivableQuantity`，可改小；「收满」「全部清零」快捷操作 | 同上 |
| 6 | 一个包裹多个 SKU | 明细按行渲染，`buildReceiptDraft` 支持任意多行（后端上限 100 行） | `services/receiving.ts` |
| 7 | 只收到部分商品 | 留空 = 本次没到货，该行不进入请求；只提交实际填了数量的行 | 同上 |
| 8 | 收货备注 | 2000 字上限的文本域 + 剩余字数提示，提交前 trim，空则不发送 | 同上 |
| 9 | 二次确认 | `uni.showModal`：标题带总件数，正文列「商品 + 数量」与备注，按钮「确认入库 / 再核对」 | `pages/receiving/index.vue` |
| 10 | 提交 `POST /receipts` | `ReceiptSubmitting.submit()` 发真实事务接口，带 `packageId`、`clientOperationId`、`items`、`remark` | `services/receiving.ts` |
| 11 | 成功结果与本次入库数量 | 成功页展示 `receiptNo`、`totalQuantity`（服务端返回值）、逐商品数量、时间 | `pages/receiving/index.vue` |
| 12 | 继续扫下一包裹 | 「继续扫下一包裹」回退两层直达扫码页；无上一页时 `redirectTo` 扫码页 | 同上 |
| 13 | 重试复用原 UUID 与请求内容 | 同一包裹 + 同一数量 + 同一备注 → 复用落盘的 `clientOperationId`，body 完全一致；App 重启后仍复用 | `services/receiving.ts` |
| 14 | 改数量生成新 UUID | 内容指纹（规范化后的 packageId/items/remark）变化即生成新 UUID | 同上 |
| 15 | 断网显示未提交、不提前加库存 | 网络失败 → 标题「未提交」+ 明确文案「App 不会提前增加库存」，本地不做任何数量扣减；重试复用同一操作号 | 同上 |
| 16 | 超限或已收完的明确错误 | 提交前按 `maxReceivableQuantity` 拦截并指出是哪一行、最多还能收几件；服务端 409 `RECEIPT_QTY_EXCEEDED` 再兜底，展示剩余可收数；`receivingClosed` / 采购单非 PLACED/PARTIAL_RECEIVED 直接给结论面板 | 同上 |

## 三、幂等是怎么做的

服务端 `POST /receipts` 用 `clientOperationId` + `requestHash` 判重：同 ID 同请求返回原入库单（200，不重复加库存），同 ID 不同请求返回 409 `IDEMPOTENCY_CONFLICT`。

客户端这一侧要做的是"什么时候复用、什么时候换新"：

```
draftFingerprint(draft) = JSON.stringify({
  packageId: 小写,
  items: [{purchaseOrderItemId: 小写, receivedQty}] 按 ID 排序,
  remark: trim 或 null
})
```

- 与服务端 `requestHash` 的输入口径**完全一致**，所以"指纹相同"等价于"服务端会认定为同一请求"。
- 提交前先把 `{operationId, fingerprint, payload, attempts}` 写进 `caicang.mobile.receipt-pending.v1`，**再**发请求；进程被杀、App 重开都能接着用同一个 UUID。
- 成功后删除待提交记录；被服务端明确拒绝（4xx：超收、状态冲突、包已关闭）也删除——这类错误没有产生入库单，留着只会让下次提交被误当成"未完成重试"。
- 网络中断 / 5xx 属于"结果未知"，保留记录，页面横幅提示"上次提交未完成，继续提交会复用同一操作号"。

因此："连点两次确认"、"断网后重试"、"杀进程再重试"都不会多入库；"把 5 改成 3 重新提交"才会生成新单。

## 四、错误文案与操作日志

服务端错误码被翻译成仓库同事能直接执行的话，并且**明确告知库存有没有变**：

| 错误 | 页面展示 |
| --- | --- |
| 网络中断（status 0） | 未提交 · 网络中断，本次收货没有确认成功…恢复网络后点「重试」，会复用同一操作号，不会重复入库 |
| `RECEIPT_QTY_EXCEEDED` | 数量超过可收上限 · 按本包裹/整张采购单剩余，这一项最多还能收 N 件；本次未入库 |
| `STATUS_CONFLICT` + `receivingClosed` | 包裹已验收完成 · 不能再入库，本次未写入任何库存 |
| `STATUS_CONFLICT` + `purchaseStatus` | 采购单状态不允许收货 · 例如「已取消」 |
| `IDEMPOTENCY_CONFLICT` | 操作号与请求内容不一致 · 本次未入库，请重新填写 |
| `FORBIDDEN` / 403 | 没有收货权限 · 联系管理员 |

操作日志：`services/operation-log.ts` 把「提交入库 / 入库成功 / 各类失败 / 读取明细失败」写入本机环形缓冲（50 条），收货页底部展示最近 5 条（时间、结果、明细）。日志只在本机，服务端的 `audit_logs` 与入库单才是事实来源。

## 五、实际执行的检查

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @caicang/mobile typecheck` | 通过 |
| `pnpm lint` | 通过，0 warning |
| `pnpm format:check` | 通过 |
| `pnpm --filter @caicang/mobile build` | 成功（H5） |
| `pnpm --filter @caicang/mobile build:app` | 成功（`dist/build/app`） |
| `node --test scripts/mobile-receiving.test.mjs` | **10 通过 / 1 跳过** |
| `node --test scripts/scan.test.mjs` | 10 通过（任务 20 回归） |
| `node --test scripts/mobile.test.mjs` | 3 通过 / 1 跳过（页面清单已更新为 8 个页面） |

`mobile-receiving.test.mjs` 覆盖：

1. 数量解析：空 = 0、`007` = 7、`1.5`/`-1`/`1e3`/中文一律拒绝。
2. 部分收货：数量为 0 的行被剔除；多 SKU 保留；按行 ID 稳定排序；空提交报 `EMPTY`；重复行报 `DUPLICATE_LINE`；备注超长报 `REMARK_TOO_LONG`。
3. 指纹：输入顺序与备注空白不影响；改数量、改备注都会变。
4. 幂等：断网提交 → 记录 UUID → 原样重试复用同一 UUID 且请求体逐字节相同 → 换实例（模拟重启）仍复用 → 改数量 → 新 UUID 且 `reused=false` → 成功后记录清除。
5. 重试被标记为 `reused=true`，`attempts=2`。
6. 错误文案：断网"未提交/不提前加库存"、超收带剩余数、已关闭、已取消、幂等冲突。
7. 收货前置判断：已关闭、已取消、无可收行、可收正常。
8. 操作日志：上限 50、最新在前、损坏数据不崩溃、可清空。
9. 页面接线：注册 `pages/receiving/index`、读 `/receivable`、有 `uni.showModal` 二次确认、成功展示 `result.totalQuantity`、有「继续扫下一包裹」、详情页有「确认收货」；页面里不出现 `quantityOnHand` / `stock_balances`（不允许前端自己推算库存）。

## 六、Android 真机测试步骤

前置：能启动 PostgreSQL（Docker Desktop 或本机 PG），手机与电脑同一 Wi-Fi。

```bash
cd D:\Dev\caicang-manager
pnpm db:up
pnpm prisma:migrate:deploy
pnpm start:api            # 另开终端；确认 http://localhost:3000/api/v1/health
# apps/mobile/.env.development 改成电脑局域网 IP，例如
# VITE_API_BASE_URL=http://192.168.1.10:3000/api/v1
pnpm --filter @caicang/mobile build:app
```

1. `ipconfig` 取局域网 IPv4；手机浏览器打开 `http://<IP>:3000/api/v1/health` 应返回正常，打不开先放行防火墙 3000 端口。
2. HBuilderX 4.x → `文件 → 导入 → 从本地目录导入` → `apps/mobile/dist/build/app`；双击 `manifest.json` → 基础配置 →「重新获取」DCloud AppID。
3. 手机开启 USB 调试，`运行 → 运行到手机或模拟器 → 运行到 Android App 基座`。
4. 用 **WAREHOUSE 或老板账号**登录（`receiving:confirm` 权限），选择商家。
5. 准备一张真实快递面单：管理端先把这张运单绑定到一个**已下单**采购单的包裹上，且该采购单某 SKU 订购 10 件、包裹预计 10 件。
6. 首页「扫码入库」→ 扫面单条形码 → 命中唯一包裹进入详情 →（首次会弹相机授权，选允许）。
7. 详情页点「确认收货」，进入收货页，逐项核对：
   - 采购单号、采购状态、承运商、完整运单号（含前导零）；
   - 每个 SKU 的订购 10 / 已入库 0 / 剩余 10，「本次到货」默认 10。
8. 把数量改成 **5**（模拟只到 5 件），备注填「实收 5 件，外箱完好」，点「确认入库 5 件」。
9. 弹二次确认框，核对「商品 5 件 + 备注」后点「确认入库」。
10. 成功页应显示：**本次入库 5 件**、入库单号（`RCV-YYYYMMDD-XXXX`）、逐商品数量、时间。
11. 点「继续扫下一包裹」，应回到扫码页且状态干净。
12. **核对库存（验收关键）**，任选其一：
    ```sql
    -- psql 或任意客户端连到 caicang 库
    SELECT p.sku, b.quantity_on_hand, b.total_cost
    FROM stock_balances b JOIN products p ON p.id = b.product_id
    WHERE b.tenant_id = '<当前商家 ID>' ORDER BY p.sku;

    SELECT r.receipt_no, pk.tracking_no, SUM(ri.quantity) AS qty, r.received_at
    FROM receipts r
    JOIN receipt_items ri ON ri.receipt_id = r.id
    JOIN packages pk ON pk.id = r.package_id
    WHERE r.tenant_id = '<当前商家 ID>'
    GROUP BY r.id, r.receipt_no, pk.tracking_no, r.received_at
    ORDER BY r.received_at DESC LIMIT 5;
    ```
    期望：`quantity_on_hand = 5`，入库单一条、数量合计 5。也可以回手机端「入库记录」看到这张单（管理端目前还没有库存/入库单页面，属后续任务，所以库存要以数据库查询为准）。
13. **幂等验证**：手机开飞行模式 → 再点一次「确认入库」（数量仍 5）→ 页面应显示「未提交」，此时库存不变；关飞行模式 → 点「重试本次提交」→ 成功页出现**同一张入库单号**，库存仍是 5（不会变 10）。
14. **改数量验证**：同一包裹再收 2 件 → 成功页是新入库单号，库存变 7。
15. **超限验证**：再填 5 件（只剩 3 件可收）→ 输入框失焦前就能看到「本次最多可收 3 件」；若绕过直接提交，服务端 409 应显示「最多还能收 3 件，本次未入库」，库存保持 7。
16. **已收完验证**：把包裹剩余全部收完后再扫码进入，收货页应直接显示「包裹已验收完成」，没有输入框。

## 七、新增与修改文件

新增：

| 文件 | 作用 |
| --- | --- |
| `apps/mobile/src/services/receiving.ts` | 数量解析、草稿构建、内容指纹、UUID 复用闸门、错误文案、可收回执行转换 |
| `apps/mobile/src/services/operation-log.ts` | 本机操作日志（50 条环形缓冲） |
| `apps/mobile/src/pages/receiving/index.vue` | 收货页：明细、数量、备注、二次确认、提交、成功页、错误重试、日志 |
| `scripts/mobile-receiving.test.mjs` | 收货逻辑单测 + 真实 API 入库验收（需 PostgreSQL） |
| `docs/TASK_21_REPORT.md` | 本报告 |

修改：

| 文件 | 改动 |
| --- | --- |
| `apps/mobile/src/api/client.ts` | `ApiFailure` 增加 `details`（超收的剩余数、状态冲突原因要展示给用户） |
| `apps/mobile/src/api/index.ts` | 导出 `mobileStorage`，供收货幂等记录与操作日志复用 |
| `apps/mobile/src/pages/package/index.vue` | 新增「确认收货」入口（有权限且未收完时显示），返回时刷新详情 |
| `apps/mobile/src/pages/scan/index.vue` | 页脚提示改为"确认收货在包裹详情页单独提交" |
| `apps/mobile/src/pages.json` | 新增 `pages/receiving/index` |
| `scripts/mobile.test.mjs` | 页面清单断言加入收货页（8 个页面） |
| `package.json` | 新增 `test:mobile-receiving`，并纳入全仓 `test` |

无新依赖，无新表，无后端改动（复用任务 17 的 `POST /receipts`）。

## 八、未验证与风险

- **真实入库验收（收 5 件 → 库存 +5）本机未执行**：`wsl.exe` 在安全中心程序黑名单，Docker Desktop 起不来，本机也无原生 PostgreSQL。`scripts/mobile-receiving.test.mjs` 里的真实 API 用例已写好并会在数据库可用时自动运行（`pnpm test:mobile-receiving`），当前显式标记 `SKIP`，没有用 mock 冒充。
- **真机摄像头与系统授权**未执行，同任务 20，需要在 HBuilderX + 真机确认。
- 收货页的初始数量默认「收满」，依赖用户核对；二次确认框会列出每行数量与总件数作为最后一道校验。
- 备注只保存在入库单上，不做图片附件（拍照留证不在本任务范围）。
- 服务端 4xx 拒绝后会清掉操作号；若用户在网络不稳定时连续重试"同一次提交"，只有未确认（断网/5xx）的成功重试会复用 UUID——这正是幂等需要覆盖的场景。
