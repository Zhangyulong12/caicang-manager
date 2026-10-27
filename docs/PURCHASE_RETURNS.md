# 采购退货 API（任务 31）

任务 32 已增加 [采购退货 Web 页面](WEB_PURCHASE_RETURNS.md)。无迁移；API 新增只读 `estimatedRefundAmount`（主单/逐行）、`confirmedByName`，returnable 明细增加 `orderedQuantity` 和 `purchaseNetAmount`。预估按原采购净商品金额比例、逐行四舍五入到分计算，不含运费；实际 refundAmount 和原库存事务保持独立，不接受客户端提交预估总额。

仅处理已实际入库后退给原供应商的商品。客户退货、退款支付、退货 Web/手机页面不属于本阶段。

## 接口与权限

以下路径均以 `/api/v1` 为前缀，并要求 Bearer Access Token 与当前商家的 `X-Tenant-Id`。

| 方法 / 路径 | 用途 | 角色 |
| --- | --- | --- |
| GET /purchase-orders/{id}/returnable | 原采购明细、实际入库、已退、剩余可退、库存和入库来源 | 全部五角色 |
| GET /purchase-returns | 分页列表 | 全部五角色 |
| GET /purchase-returns/{id} | 详情、成本和原入库分配 | 全部五角色 |
| POST /purchase-returns | 创建草稿（201） | OWNER / ADMIN / BUYER |
| PATCH /purchase-returns/{id} | 修改草稿（200） | OWNER / ADMIN / BUYER |
| POST /purchase-returns/{id}/cancel | 取消草稿（200） | OWNER / ADMIN / BUYER |
| POST /purchase-returns/{id}/confirm | 确认并扣库存（首次 201，重放 200） | OWNER / ADMIN / WAREHOUSE |

读接口沿用 `purchase:read`，草稿操作沿用 `purchase:write`，确认沿用 `inventory:write`。Guard 和事务内均复核成员、启停用和权限。无成员身份 403；其他商家的采购单、退货单、采购明细和入库明细统一 404。VIEWER 的原因显示 `[已隐藏]`，备注为 null。不开放删除或修改已确认单据。

列表支持 `page`、`pageSize`、`purchaseOrderId`、`status`、`from`、`to`、`search`。日期是 `YYYY-MM-DD`，区间包含边界；搜索退货单号、原采购单号、SKU 和名称的字面子串。数据与分页均遵守项目统一响应结构。

## Swagger 操作顺序

打开 `http://localhost:3000/api/docs`，登录后设置 Bearer 和 X-Tenant-Id。先调用 `GET /purchase-orders/{id}/returnable` 获取真实的 `purchaseOrderItemId`，不要用商品 ID 代替采购明细 ID。

创建草稿：将下面 UUID 换成当前商家真实 ID。数量为整数，退款金额必须是非负十进制字符串，最多两位小数。

```json
{
  "purchaseOrderId": "11111111-1111-4111-8111-111111111111",
  "reason": "收到的商品破损，退给原供应商",
  "returnDate": "2026-10-25",
  "refundAmount": "35.00",
  "remark": "已与店铺确认",
  "items": [
    {
      "purchaseOrderItemId": "22222222-2222-4222-8222-222222222222",
      "quantity": 2
    }
  ]
}
```

一单可含 1—100 条采购明细，每条原采购明细只能出现一次。可选 `receiptItemId` 指定原入库来源；省略时，确认事务按原入库时间、入库明细 UUID 顺序分配，可跨多次入库。确认结果 `items[].allocations[]` 返回原入库单号、入库单 ID、入库明细 ID、数量与历史单位成本。即使不指定来源，每件已确认退货也有真实入库追溯。

PATCH 只接受 `reason`、`returnDate`、`refundAmount`、`remark`、`items`；提交 items 表示替换草稿全部明细。原采购单和仓库不可改绑，仓库由原采购单推导；客户端不能提交库存、状态、操作者、成本或单号。草稿默认退款金额 0.00，不代表已经收到付款。

确认时生成并保留一个 UUID：

```json
{ "clientOperationId": "33333333-3333-4333-8333-333333333333" }
```

请求 `POST /purchase-returns/{id}/confirm`。网络超时后对同一单据重试必须复用该 ID。同商家、同 ID、同单据返回原结果 200，不再扣库存、不写重复流水/审计；同 ID 用于另一单据返回 `409 IDEMPOTENCY_CONFLICT`。换 ID 再确认已确认单据返回 `409 STATUS_CONFLICT`。不同商家的操作号互不影响。取消接口不带正文或提交 `{}`；重复取消不重复审计。

## 数量、事务与历史

`可退数量 = 原采购明细的已确认实际入库数量 − 已确认采购退货数量`。采购下单量、包裹预计量和物流状态不能代替实际入库量。指定 receiptItemId 时还要满足该入库明细自己的剩余可退数量。

草稿创建和修改校验可退来源，但不预留数量、不改变库存；取消也不改变库存。确认重新校验最新可退量，并检查原仓库当前库存。原采购有可退量但商品已发出时，仍可能因库存不足拒绝。

确认锁序为商家根行 → 原采购单 → 退货单 → 按商品 UUID 排序的库存余额。与既有收货、发货、调整共用商家锁及余额锁。全部 SKU 先检查库存，再同事务更新余额和成本、保存原入库分配与退货成本、写 PURCHASE_RETURN 负向流水、确认人/时间/操作号/摘要及审计。任一步失败全部回滚，操作号也不消耗，可原号重试。

超退 `409 PURCHASE_RETURN_QTY_EXCEEDED`；库存不足 `409 OUT_OF_STOCK`；非法状态 `409 STATUS_CONFLICT`；DTO 非法 `400 VALIDATION_ERROR`。已确认单据不可改价、改量、取消或改绑。

三种金额分别返回：

- `stockCost`：确认时按原仓库当前移动加权平均扣除的实际库存价值，四位小数；清零时扣完剩余成本池，保存实际尾差。
- `receivedCost`：分配到原入库明细的历史单位成本 × 数量，仅作来源追溯，四位小数。
- `refundAmount`：本单记录的实际退款金额，两位小数；独立于成本，不调用支付系统。

例如同 SKU 原单入库 10×18.50，另一单入库 10×30.00 后退原单 2 件，均价 24.25，stockCost=48.5000、receivedCost=37.0000，refundAmount 可独立记录 35.00。原采购单价不改，商品参考价不参与重算。

原采购数量、价格、费用、累计入库、采购及包裹收货状态均保持；退货不重新开放原采购单的可入库额度。returnDate 是业务日期，流水发生时间为真实确认事务时间。

`GET /inventory/movements?type=PURCHASE_RETURN` 返回 sourceNo（退货单号）、sourceId（退货明细 ID）、sourceDocumentId（退货单 ID），可通过退货详情继续追溯。本阶段仅补 Web 流水类型名称，不创建退货页面或手机功能。

## 迁移、启动与测试

第十个迁移 `20261025090000_purchase_returns` 新增 `purchase_returns`、`purchase_return_items`、`purchase_return_allocations`，全部带 tenant_id/UUID/时间。复合外键同时验证商家、原采购单、仓库、采购行、商品和原入库行，删除策略 RESTRICT。数据库包含正数量、非负有限金额、状态/确认字段 CHECK、更新时间触发器和幂等唯一键。

现有 receipt_items 仅增一个含 ID 的复合唯一索引；流水 CHECK 保留原三种类型并增加 PURCHASE_RETURN。无旧数据回填、重置或历史单价修改，不重复导入 database/schema.sql。有退货业务后删除新表会丢失追溯，缩回旧流水类型也可能失败；回滚应保留结构、停止新写入并用后续补丁修复，不能执行破坏性 down。

```powershell
cd D:\Dev\caicang-manager
pnpm db:up
pnpm prisma:migrate:deploy
pnpm prisma:generate
pnpm start:api
# 另一个终端
pnpm test:purchase-returns
pnpm test:models
```

测试只创建/清理随机 caicang_test_* 库，不修改开发库业务记录。覆盖 10→8、重放、超退、缺货、多 SKU、分批入库、指定来源、跨租户、五角色、双进程并发、出库竞争、成本尾差、审计故障回滚。升级测试在旧九迁移库保存采购/入库/库存/流水夹具，升级后比较所有旧行内容不变。
