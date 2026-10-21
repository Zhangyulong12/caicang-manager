# 采购订单 API（任务 12）

## Windows 启动

启动现有 Docker Desktop，在 PowerShell 执行：

```powershell
cd D:\Dev\caicang-manager
pnpm install --frozen-lockfile
pnpm db:up
pnpm prisma:migrate:deploy
pnpm start:api
```

第六个迁移 `20261021120000_purchase_order_workflow` 增加采购日期、明细顺序、分摊运费及商品资料快照。只使用 Prisma Migrate，不重放 `database/schema.sql`，不清空数据卷。Swagger：http://localhost:3000/api/docs。

若 3000 已有旧 API 进程，先在其所属终端正常 Ctrl+C 后重启。也可另开终端用下列命令在空闲 3001 运行同一数据库的新版服务；本次验收采用此入口，保留旧进程和原配置：

```powershell
cd D:\Dev\caicang-manager
$env:API_PORT = '3001'
pnpm start:api
```

对应 Swagger 为 http://localhost:3001/api/docs，健康检查为 http://localhost:3001/api/v1/health。此变量只作用于当前 PowerShell 及其子进程，不改 .env；Web 默认仍代理 3000，本任务尚不包含采购 Web 页面。

## 请求与权限

六个接口均以 `/api/v1` 为前缀，必须提供 Bearer 和 X-Tenant-Id。五种有效成员可读；OWNER/ADMIN/BUYER 可创建、编辑、确认和取消，WAREHOUSE/VIEWER 不可写。VIEWER 的收货姓名、电话、地址为 `[已隐藏]`，备注为 null，`recipientMasked=true`；其他角色可查看履约资料。响应均 no-store，业务日志和审计均不保存收货资料/备注原文。

| 接口                              | 结果                                           |
| --------------------------------- | ---------------------------------------------- |
| GET /purchase-orders              | 标准分页 data 数组/pagination/requestId        |
| POST /purchase-orders             | 201，新建 DRAFT 及明细、金额预览               |
| GET /purchase-orders/{id}         | 200，详情、原始价格、明细累计已收数量          |
| PATCH /purchase-orders/{id}       | 200，仅编辑无包裹/收货关联的 DRAFT             |
| POST /purchase-orders/{id}/place  | 200，DRAFT → PLACED，冻结成本和商品快照        |
| POST /purchase-orders/{id}/cancel | 200，无任何收货记录的 DRAFT/PLACED → CANCELLED |

列表参数：page 默认 1，pageSize 默认 20、最多 100；search 按单号、平台订单号、店铺和商品 SKU/名称快照做字面子串搜索，不区分大小写；可按 status、platform、warehouseId 筛选。按 createdAt DESC/id DESC 稳定排序。所有列表/总数/关联查询限定租户；外商家或未知对象 ID 均 404，未授权成员 403。

## 创建草稿

```json
{
  "orderNo": "PO-20261021-0001",
  "warehouseId": "<当前商家的仓库 UUID>",
  "platform": "TAOBAO",
  "platformOrderNo": "T202610210001",
  "supplierName": "采购店铺",
  "purchaseDate": "2026-10-21",
  "recipient": { "name": "仓库收货人", "phone": "13800000000", "address": "示例仓库收货地址" },
  "freightAmount": "10.00",
  "remark": "采购备注",
  "items": [
    {
      "productId": "<CHARGER-20W 商品 UUID>",
      "quantity": 10,
      "unitPrice": "18.50",
      "discountAmount": "0.00"
    }
  ]
}
```

- 必填：warehouseId、platform、purchaseDate、完整 recipient、1–100 个 items。商品必须属于当前商家且启用，商品 ID 不可重复（含 UUID 大小写变体），数量为 1–2147483647 的整数。单价必填，行优惠默认 `0.00`，整单运费默认 `0.00`。
- platform 为 JD/TAOBAO/PDD/OTHER；purchaseDate 为真实日历日期 YYYY-MM-DD（年份 0001–9999），以 PostgreSQL DATE 保存，不随显示时区改变。
- orderNo 可省略，服务端生成 `PO-<随机 UUID hex>`；自定义值商家内唯一、最多 50 字。重试创建应复用明确的 orderNo，重复返回 409 `PURCHASE_ORDER_NO_ALREADY_EXISTS`，不会自动覆盖原单。省略单号的多次创建是不同订单，客户端不可盲目重试。
- platformOrderNo/supplierName/remark 可省略或 null，空白归 null，最大 100/200/2000 字。收货姓名/电话/地址最大 100/50/1000 字；电话支持数字、空格、+、括号、短横线且至少含一位数字；不接受空白必填、NUL 或额外字段。
- 金额仅接受非负十进制字符串，最多 16 位整数/2 位小数；不接受浮点 JSON number、指数或 NaN。单行优惠不能超过数量×单价，汇总商品原价、优惠和应付成本均不能超过 `9999999999999999.99`，超限/不合理折扣返回 422 `BUSINESS_VALIDATION_FAILED`。
- PATCH 可提供上述字段的子集；recipient 若提供须完整，items 若提供代表完整明细替换，空数组非法。保留商品的明细 UUID 不变，仅移除明确删掉且尚无后续单据的草稿行。完全相同的 PATCH 不更新时间或重复审计。

## 确认、金额与状态

确认请求正文省略或 `{}`，禁止客户端提交 status、分摊额、成本或数量来覆盖草稿。服务端事务重新验证权限、仓库与商品启用状态，按采购单加行锁后计算：

```text
line_net = quantity × unit_price − discount_amount
goods_amount = Σ(quantity × unit_price)
discount_amount = Σ行优惠
total_cost = Σline_net + freight_amount
```

使用独立精度 60 的 Prisma Decimal，不使用浮点金额运算。运费按各行折后净额占比，全部净额为 0 时按件数占比；按照提交的明细顺序，前 N−1 行向下截取到分，最后一行吸收全部尾差，保证非负且分摊和等于整单运费。单位到仓成本 `(line_net + freight_allocated)/quantity` 四舍五入保留四位。行优惠是该行总优惠，并非每件优惠；不额外叠加整单优惠。

10 个充电器 × 18.50、运费 10.00、无优惠：`goodsAmount=185.00`、`totalCost=195.00`、分摊运费 `10.00`、`landedUnitCost=19.5000`。所有金额响应为字符串，主单/行原金额两位、单位成本四位。

草稿保存原价格/数量与商品资料，分摊额及单位到仓成本为 null；确认时保存分摊额、成本和当时的 SKU/名称/单位快照。之后任何 PATCH 均 409 `STATUS_CONFLICT`，商品主数据改价、改名、改码不会改变已确认采购明细。成本分摊保留行净价和运费来源，后续收货须处理四位单位成本与行总额的尾差，不能以单位成本反推原单金额。

- DRAFT 可确认或取消；PLACED 仅在没有任何 receipts/receipt_items 记录时可取消。包裹未收货不妨碍 PLACED 取消，但取消后不得收货。
- PARTIAL_RECEIVED、RECEIVED、CANCELLED 不可编辑或再次确认，部分/全部收货状态由未来收货事务产生，本任务不开放手动设状态。
- 已为 PLACED 的单重复确认返回当前单，不重复分摊/审计；已为 CANCELLED 的单重复取消同理。不同最终状态返回 409，取消不删明细或历史快照，也不增加或扣减库存。
- 事务锁顺序：租户根 → 重新鉴权 → 采购主单 FOR UPDATE → 明细及审计；保持与未来收货约定一致。两个 API 实例并发确认、编辑/确认、确认/取消依数据库锁串行，审计失败整体回滚。

## 迁移兼容与验收

新增列对旧记录为 nullable，保留原内容和时间，不猜测历史采购日期/快照/运费分摊；旧行缺少快照时详情仅以关联商品展示资料。旧草稿缺日期/收货资料时须先补齐再确认，旧 PLACED 不自动重算历史分摊。新接口创建时必填完整数据并保存明细顺序。

Swagger 验收：注册并登录 → Authorize Bearer 与商家头 → 创建/选择商家 → GET /warehouses 获取 warehouseId → 创建或查询 CHARGER-20W 获取 productId → 用上例 POST 草稿 → GET 详情确认 `195.00` → POST /place `{}` → 确认 `19.5000` → PATCH 原价格应 409 → POST /cancel 无收货时成功。替换示例中的 UUID；重复单号时更换编号或查询已有单，不删除开发数据。

```powershell
pnpm test:purchases
pnpm test:models
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
```

专项用真实隔离 PostgreSQL 和两个 NestJS 进程，验证旧五迁移升级、重复部署、金额、输入、状态、租户/角色、收货阻止取消、跨进程并发与审计回滚。收货记录为隔离库 SQL 测试夹具，只验证取消条件，不宣称已经实现入库。测试后仅清理本次随机测试库。任务交付结果见 TASK_12_REPORT.md。
