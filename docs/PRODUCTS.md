# 商品管理 API（任务 08）

## Windows 启动

```powershell
cd D:\Dev\caicang-manager
pnpm db:up
pnpm prisma:migrate:deploy
pnpm start:api
```

本次新增追踪迁移 `20261017093000_product_reference_price_remark`。它只给 products 新增可空参考价/备注、对应 CHECK 与筛选索引，不改写已有商品、订单、库存或旧迁移。已有参考价未知为 null，不能把未知当作免费。不要重放 database/schema.sql，也不要清空数据卷。

Swagger：`http://localhost:3000/api/docs`。先 register/login，将 accessToken 填入 Authorize 的 bearer 栏；创建或选择自己有启用成员身份的商家，在商品接口填写同一 UUID 的 X-Tenant-Id（Authorize 中 tenant 安全凭据也填写此值）。需要新建商家时使用 POST /tenants，无需已有商家头，保存 data.tenant.id。

## 创建“20W 充电器”

POST `/api/v1/products`，Bearer + X-Tenant-Id，正文：

```json
{
  "articleNo": "T20",
  "color": "白色",
  "size": "L",
  "sku": "T20-WHT-L",
  "referencePurchasePrice": "18.50"
}
```

不给 `name` 也可以建商品：服务端按 `货号 颜色 尺码` 拼出名称（本例为 `T20 白色 L`），三者都为空时退回 SKU，名称永远不会是空字符串。想用别的叫法就显式传 `name`。

成功 201，返回标准 `{data:<商品>,requestId:<UUID>}`。保存 data.id。原样再次提交同一商家，返回 409 `PRODUCT_SKU_ALREADY_EXISTS`，消息“当前商家已存在相同 SKU 编码”；修改 SKU 但仍复用非空条码则为 409 `PRODUCT_BARCODE_ALREADY_EXISTS`。不同商家可以使用完全相同的 SKU/条码。

|中文字段|JSON 字段|规则|
|---|---|---|
|商品货号|articleNo|可省略或 null，最长 80；同款不同颜色/尺码共用同一个货号|
|颜色|color|可省略或 null，最长 80|
|尺码|size|可省略或 null，最长 80；也可放 42、均码等|
|SKU 编码|sku|必填，trim 后 1–80，商家内唯一，保留大小写/内部字符/前导零|
|商品名称|name|可省略，最长 200，不允许控制字符；留空或传空串时按 货号/颜色/尺码 自动生成|
|规格|specification|可省略或 null，最长 200，空白归 null|
|单位|unit|默认“件”，trim 后 1–20，不可 null|
|商品条码|barcode|可省略或 null，最长 128，空白归 null；非空商家内唯一；不再是主要录入字段|
|参考进货价|referencePurchasePrice|可省略或 null；非负十进制字符串，最多 16 位整数/2 位小数，返回固定 2 位|
|启用状态|isActive|默认 true，仅 JSON boolean|
|备注|remark|可省略或 null，最长 2000，空白归 null|

同款商品不同颜色、尺码必须各建一个商品、各用一个 SKU，库存、采购、入库、出库都按 SKU 识别到具体变体。唯一性区分大小写，与现有数据库约束一致。条码与 SKU 拒绝控制/无效代理字符；文本不接受 NUL。金额不接受 JS number、负数、指数、NaN/Infinity、额外小数或溢出，不静默四舍五入。"0.00" 表示免费，null 表示未知；不计算会计成本。

## 查询、搜索和筛选

- GET `/api/v1/products/{id}`：返回当前商家商品详情，包括停用商品。
- GET `/api/v1/products?page=1&pageSize=20&search=充电器`：标准 data 数组/pagination/requestId。page≥1，pageSize 1–100；按 createdAt DESC/id DESC 稳定排序，超出页数为空数组；过大 offset 返回 400。
- search 对 name/articleNo/color/size/sku/barcode/specification 做不区分大小写的字面子串搜索。搜 `T20` 会返回同货号的所有颜色尺码，搜 `白色` 只返回该颜色。`%`、`_`、反斜线按普通字符处理，不能扩大匹配范围。URL 参数由客户端正确编码。
- isActive=true/false、hasBarcode=true/false 和 unit 可组合筛选，布尔查询仅接受小写 true/false。省略 isActive 时包含启用和停用。unit 是 trim 后的精确匹配，不支持传入 tenantId 改变范围。

示例：`GET /api/v1/products?isActive=true&hasBarcode=true&unit=个`。所有结果及 total 都属于当前商家，不能从列表总数推断其他商家。

## 扫描或输入商品码

GET `/api/v1/products/lookup?code=CHARGER-20W` 或 `code=0001234567890`。

code trim 后 1–128 字符，按当前商家启用商品的精确 SKU OR barcode 查找，区分大小写、不丢前导零。返回 `data` 数组，无分页：

- 未知或仅匹配停用商品：`[]`。
- 唯一匹配：一个完整商品对象；同商品的 SKU 与条码相同只返回一次。
- 某商品 SKU 与另一商品条码同值：两个候选，客户端必须展示选择，不能自动猜第一个。现有两个独立唯一索引不禁止跨字段重码，因此不伪造唯一命中。

此接口只是商品码查商品，不是运单查包裹，不会入库、扣库存或识别包裹内容。本次没有 Android 扫码界面或真机 APK 交付。

## 修改与停用

PATCH `/api/v1/products/{id}`，例如：

```json
{"referencePurchasePrice":"19.90","remark":"调整下次采购参考价"}
```

至少提供一个合法商品字段。省略字段不改，nullable 字段可 null 清空，barcode 空白也清空；name/sku/unit/isActive 不可 null。金额相同的 "1.0"/"1.00" 视为无变化，重复相同 PATCH 不改 updatedAt、不重复审计。

名称的重算规则：省略 name 时保持原名，但如果原名本来就是自动生成的（正好等于当时的 货号/颜色/尺码 拼装结果），修改货号/颜色/尺码会同步重算名称；显式传 `"name":""` 表示改回自动生成；用户自己写的名称不会被属性修改悄悄覆盖。

停用：`{"isActive":false}`；重新启用：`{"isActive":true}`。停用保留商品 ID、详情、编码唯一性及历史关联，没有 DELETE 接口。名称/SKU/参考价等主数据修改不更新 purchase_orders、purchase_order_items 或库存。历史采购的 unit_price、discount_amount、landed_unit_cost 均是独立快照，不用商品参考价覆盖；历史界面若关联当前名称/SKU，是主数据展示，不等于价格快照改变。

## 权限、事务与审计

OWNER/ADMIN/BUYER 可创建或修改，WAREHOUSE/VIEWER 只读；五角色都可列表、详情与 lookup。所有接口验证 Bearer、X-Tenant-Id 和启用 membership。跨商家与未知商品 ID 都返回标准 404，未加入/停用成员为 403，缺少凭据为 401，非法商家头为 400。

继承 TenantContextService 的租户行锁：读 SHARE、写 UPDATE，锁后重查授权，再按 tenantId+id 查询/更新对象。并发重复编码由现有数据库唯一约束处理；同商家 API 写入跨进程串行化，失败更新不会部分改名称或价格。商品创建/实际变更与 PRODUCT_CREATED/PRODUCT_UPDATED 审计同事务，审计失败全部回滚；审计保存安全状态与 changedFields，不复制任意备注文本。

```powershell
pnpm test:products
pnpm test:models
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
```

测试使用真实 PostgreSQL 随机隔离库和实际生产 AppModule HTTP，不清空开发库。历史价格验证会在隔离库创建真实采购单和明细作为夹具，不代表采购 API 已实现。实际结果、文件清单见 TASK_08_REPORT.md；技术决策见 DECISIONS.md ADR-015。
