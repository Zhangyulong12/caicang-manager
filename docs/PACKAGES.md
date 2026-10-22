# 采购包裹 API（任务 14）

## 启动与访问

启动现有 Docker Desktop，在 PowerShell 中执行：

```powershell
cd D:\Dev\caicang-manager
pnpm db:up
pnpm prisma:migrate:deploy
pnpm start:api
```

打开 http://localhost:3000/api/docs，登录取得 Access Token，Authorize 填写 Bearer，并为各请求设置当前商家的 `X-Tenant-Id`。沿用六个迁移及现有 packages/package_expected_items，不导入参考 SQL，不清空数据卷。本任务仅交付 API，包裹 Web 页面、扫码、正式收货及库存操作尚未实现。

| 方法与路径（统一前缀 /api/v1） | 成功 | 权限 |
| --- | --- | --- |
| GET /packages | 200，PackageData 分页 | 全角色，packages:read |
| POST /purchase-orders/{id}/packages | 201，PackageData | OWNER/ADMIN/BUYER，packages:write |
| PATCH /packages/{id} | 200，PackageData | OWNER/ADMIN/BUYER，packages:write |
| GET /packages/{id} | 200，PackageData | 全角色，packages:read |
| GET /packages/lookup?trackingNo= | 200，候选数组 | OWNER/ADMIN/BUYER/WAREHOUSE，packages:lookup |
| GET /packages/{id}/receivable | 200，PackageReceivableData | OWNER/ADMIN/WAREHOUSE，receiving:confirm |
| POST /packages/{id}/complete-receiving | 200，PackageData | OWNER/ADMIN/WAREHOUSE，receiving:confirm |
| POST /receipts | 201 首次 / 200 幂等重放，ReceiptData | OWNER/ADMIN/WAREHOUSE，receiving:confirm |

`POST /receipts` 是唯一增加库存的入口，接收包裹维度的验收事实并在单事务内写收货单、库存与流水；字段、幂等与锁序见 [RECEIPTS.md](RECEIPTS.md)。

`GET /packages` 由任务 15 补充，供 Web 包裹页面使用：`page`/`pageSize`、`search`（运单号、快递公司、采购单号、本包裹预计明细 SKU/名称，字面子串）、`purchaseOrderId`、`carrierCode`（转大写精确匹配）、`status`（物流状态）、`hasReceipts`（true/false）。返回与详情相同的 PackageData，按 `createdAt DESC, id DESC` 排序，总数与列表均限定 `tenant_id`；`receivingStatus` 由真实收货推导，不作为检索条件。页面说明见 [WEB_PACKAGES.md](WEB_PACKAGES.md)。

所有响应遵循统一 `{data,requestId}`，含 `Cache-Control: no-store`；错误使用公共错误体。VIEWER 可查看单个包裹，但备注返回 null，不开放扫码 lookup。接口不返回收货地址、电话或密码。

## 100 件拆成三个包裹

先通过采购 API 新建含 100 件商品的采购单并 `/place`，保存返回的订单 `id` 和首条 `items[0].id`。下面 UUID 需要替换为真实采购行 UUID。

```json
{
  "carrierCode": "ZTO",
  "trackingNo": "000PACKAGE-01",
  "expectedItems": [
    {"purchaseOrderItemId":"00000000-0000-4000-8000-000000000001","expectedQuantity":30}
  ],
  "remark": "第一箱"
}
```

POST `/purchase-orders/{id}/packages` 三次，分别使用独立运单 `000PACKAGE-01/02/03` 与数量 **30/30/40**。每次返回独立包裹 UUID，可分别 GET `/packages/{id}` 查询；同一 SKU 可以出现在不同包裹。一个包裹也可有多个不同采购行。

- `carrierCode` 为 1–40 位字母数字/下划线/连字符，以字母数字开头，去首尾空格并转大写。
- `trackingNo` 必须为 1–128 字符的字符串；仅去首尾空白，不转数字、不推测快递公司、不移除内部符号，保留前导零及大小写，拒绝控制字符。
- `expectedItems` 可省略或为 `[]`，不推断包裹内容、不生成任何收货或库存数据；最多 100 行，同一采购行不可重复。`expectedQuantity` 必须为 1–2147483647 的整数，不能用字符串替代数字。
- 预计行必须属于当前商家、当前采购单。所有包裹的每条采购行预计数量之和不得超过该行采购数量。全部包裹（包括物流异常或已收货的历史包裹）都占用其预计份额。
- 只允许 PLACED/PARTIAL_RECEIVED 的采购单新增包裹；DRAFT/CANCELLED/RECEIVED 返回 409 STATUS_CONFLICT。创建总是 CREATED；不能伪造收货状态。
- 同一商家同快递公司同运单只允许一个包裹，重复 POST 返回 409 PACKAGE_TRACKING_ALREADY_EXISTS，不自动覆盖已有绑定；不同商家可同码，不同公司可同号。

## 查询与独立明细

GET `/packages/{id}` 返回采购单 ID/单号/状态、目标仓库、快递公司、原始运单字符串、包裹状态、独立的 receivingStatus、hasReceipts、实际已收数量、明确完成时间及预计明细。每条预计行包括采购行 ID、商品 ID/SKU/名称/单位、采购数量、包裹预计数量、本包裹该行实际已收数量。SKU/名称/单位优先采用采购单快照，不覆盖历史采购价格。

`status` 沿用现有包裹状态字段；`receivingStatus` 为 NOT_RECEIVED/PARTIAL_RECEIVED/RECEIVED，依据真实收货明细与明确完成标记计算。物流 ARRIVED、甚至历史记录中的 RECEIVED 字样都不能凭空增加实际已收数量。没有预计明细时，有实际收货仍为 PARTIAL_RECEIVED，直到未来收货流程显式关闭。预计计划不是当前实际可验收数量承诺，未来收货接口仍须校验全单及本包裹剩余量。

GET `/packages/lookup?trackingNo=000PACKAGE-01` 精确匹配，未知返回空数组。相同号码分属多家快递公司时，返回全部候选，按公司/UUID 排序，不猜第一项；各候选含 packageId、carrierCode、trackingNo、purchaseOrderId、purchaseOrderNo、packageStatus、receivingStatus、hasReceipts、receivedQuantity。扫描内容必须 URL 编码；不是 SKU 或订单 ID。未知单号只返回空数组，不创建包裹、不写收货、不动库存。

## 可验收明细与人工完成（任务 16）

`GET /packages/{id}/receivable` 返回该包裹当前可验收的逐 SKU 明细，只读，不写收货单、不改库存。

| 字段 | 含义 |
| --- | --- |
| orderedQuantity | 采购行数量 |
| receivedQuantity | **整张采购单**全部包裹的累计实收 |
| orderRemainingQuantity | 采购数量 − 全单实收，最小 0 |
| inPackagePlan / expectedQuantity | 该行是否属于本包裹预计明细及其预计数量 |
| packageReceivedQuantity | 本包裹该行累计实收 |
| packageRemainingQuantity | 预计数量 − 本包裹实收，最小 0；无预计时为 null |
| maxReceivableQuantity | 本次最大可收 = min(全单剩余, 本包裹剩余)；包裹已关闭为 0 |

- **有预计明细**：`hasPlan=true`，`lines` 只含本包裹计划行（含已收满的行，便于显示进度），最大可收同时受本包裹剩余和全单剩余限制。
- **无预计明细**：`hasPlan=false`，`lines` 为整张采购单仍有剩余的 SKU（`inPackagePlan=false`、`expectedQuantity=null`、`maxReceivableQuantity` 取全单剩余），由验收员人工选择实际到货 SKU。
- 全单累计实收包含其他包裹的收货，因此同一采购行的两个包裹不会各收一次满量。历史超收数据只向下夹到 0，不出现负数。
- 采购单为空或无剩余时 `lines` 为空数组；包裹、采购单均限当前商家，跨商家返回 404。

验收口径示例：采购 10 件、其中另一包裹已收 4 件时，本包裹（预计 6）返回 `orderedQuantity=10`、`receivedQuantity=4`、`orderRemainingQuantity=6`、`packageRemainingQuantity=6`、`maxReceivableQuantity=6`。

`POST /packages/{id}/complete-receiving` 供**没有预计明细**的包裹人工标记验收完成：

- 仅接受 OWNER/ADMIN/WAREHOUSE（`receiving:confirm`）。写入 `receivingClosedAt` 与包裹 `status=RECEIVED`，不创建收货单、不增加库存、不改采购单状态。
- 有预计明细的包裹返回 409 STATUS_CONFLICT：这类包裹按预计数量自动完成，不能绕开数量校验手工关闭。
- 采购单已取消返回 409 STATUS_CONFLICT；已关闭的包裹重复调用返回 200 且不修改时间、不重复写审计，可安全重试。
- 关闭后 `receivable` 返回 `receivingClosed=true`，全部 `maxReceivableQuantity` 为 0；`receivingStatus` 由关闭标记直接推导为 RECEIVED，即使该包裹一条收货记录也没有（空包/破损无货也需明确关闭）。

## 修改与状态限制

PATCH 仅修改提供的字段，空对象返回 400。`expectedItems` 提供时为完整替换，`[]` 清空未收货计划并释放其预计份额；省略则保留。保留的采购行维持预计行 UUID。完全相同的 PATCH 不改时间、不重复审计。

未收货包裹可通过 `purchaseOrderId` 改绑另一个本商家有效采购单，但必须同时提供该目标单的完整 `expectedItems`（可空）；原单及目标单都必须 PLACED/PARTIAL_RECEIVED。服务同时校验新单总预计量与复合外键，失败全部回滚。跨商家资源或其他订单的采购行均返回 404。

任何收货记录（包括空收货单）、receivingClosedAt 标记或 PARTIAL_RECEIVED/RECEIVED 包裹状态都会锁定归属、运单、预计明细和物流状态，仅允许补充/清除备注。采购单已取消/已收货时同样只可补充备注，不删除历史。与原值相同的有效 PATCH 可以安全重试。

物流 PATCH `status` 只允许 CREATED、IN_TRANSIT、ARRIVED、EXCEPTION，并遵守：

- CREATED → IN_TRANSIT / ARRIVED / EXCEPTION。
- IN_TRANSIT → ARRIVED / EXCEPTION。
- ARRIVED → EXCEPTION。
- EXCEPTION → IN_TRANSIT / ARRIVED。

同状态重复提交无副作用，不允许倒退到 CREATED。不能通过本接口提交 PARTIAL_RECEIVED/RECEIVED 或 receivingClosedAt、receivedQuantity。物流更新不创建收货单、不改采购单状态、不修改库存。

## 事务、错误与测试

写入顺序：TenantContext 事务锁商家并重查权限 → 按 UUID 排序锁相关采购主单 → 锁包裹 → 重读收货/状态/计划 → 校验累计数量 → 写主单及预计行 → 原子审计。改绑删除的仅是明确替换的未收货计划行，不删除包裹或历史收货。审计只存订单/行 ID、数量、状态、变化字段及 requestId，不复制原始运单或备注。

累计预计量超过采购数量：409 PACKAGE_EXPECTED_QTY_EXCEEDED；非法状态/已有收货的修改：409 STATUS_CONFLICT；改绑漏传新计划：422 BUSINESS_VALIDATION_FAILED；字段验证错误：400 VALIDATION_ERROR；外商家或不属于指定订单的资源：404 NOT_FOUND。数据库唯一键与复合外键为最终约束，应用锁防止两个 API 进程共同超分配。

```powershell
pnpm test:packages
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
```

采购包裹测试连接真实 PostgreSQL 随机隔离数据库并执行六个迁移、启动两个 API 进程。只有本轮拥有的测试库会在结束后清理；不把夹具写进开发库。收货限制由隔离库 SQL 夹具验证，不代表本任务实现了收货业务。实际结果见 TASK_14_REPORT.md。
