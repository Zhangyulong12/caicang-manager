# 采购账号与采购单关联

采购账号是"这笔采购用的是哪个平台账号"这一层档案：只存平台、别名、备注与启停用状态，**不存任何第三方平台登录凭据**。采购单引用账号，并在确认下单时冻结别名快照，因此账号后来改名或停用都不会改变历史对账口径。

## 一、数据模型

表 `purchase_accounts`（迁移 `20261023140000_purchase_accounts`）：

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | UUID | 主键 |
| `tenant_id` | UUID | 商家；外键到 `tenants`，`ON DELETE RESTRICT` |
| `platform` | VARCHAR(20) | `TAOBAO` / `JD` / `PDD` / `OTHER`，有 CHECK 约束 |
| `alias` | VARCHAR(100) | 账号别名，服务端 trim，非空 |
| `remark` | TEXT | 业务备注，可为空 |
| `is_active` | BOOLEAN | 默认 true；停用后不能用于新采购 |
| `created_at` / `updated_at` | TIMESTAMPTZ | `updated_at` 由既有 `set_updated_at()` 触发器维护 |

约束与索引：

- `UNIQUE (tenant_id, platform, alias)`：同一商家同一平台别名不重复；不同平台可以同名。
- `INDEX (tenant_id, is_active, created_at DESC)`：账号选择器与列表的常用路径。
- 采购单侧新增 `purchase_account_id`（可空）、`purchase_account_alias_snapshot`（可空），复合外键 `(tenant_id, purchase_account_id) → (tenant_id, id)`，`ON DELETE RESTRICT`。
- 采购单侧新增 `INDEX (tenant_id, purchase_account_id, purchase_date)`，按账号对账不必全表扫描。

列顺序与命名见 `apps/api/prisma/schema.prisma` 的 `PurchaseAccount` / `PurchaseOrder`。

同一批改动里的商品属性（货号 / 颜色 / 尺码）走独立迁移 `20261023130000_product_attributes`：`products` 加三个可空列，`purchase_order_items` 加三个快照列，采购下单时冻结。它不属于账号功能，拆开是为了每个迁移只做一件事。

## 二、API

四个端点，均需 Bearer + `X-Tenant-Id`，响应 `Cache-Control: no-store`。

| 方法 | 路径 | 权限 | 角色 | 说明 |
|---|---|---|---|---|
| GET | `/purchase-accounts` | `purchase:read` | 全部 | 分页；`search` 别名子串、`platform`、`isActive` |
| POST | `/purchase-accounts` | `purchase:write` | OWNER/ADMIN/BUYER | 创建，201 |
| PATCH | `/purchase-accounts/{id}` | `purchase:write` | OWNER/ADMIN/BUYER | 改别名/备注/启停用；有关联后禁止改平台 |
| DELETE | `/purchase-accounts/{id}` | `purchase:write` | OWNER/ADMIN/BUYER | 仅限从未被采购单引用；有历史 409 |

账号对象：

```json
{
  "id": "…",
  "tenantId": "…",
  "platform": "TAOBAO",
  "alias": "淘宝主账号",
  "remark": "女装类目专用",
  "isActive": true,
  "hasOrders": true,
  "createdAt": "2026-10-23T12:00:00.000Z",
  "updatedAt": "2026-10-23T12:00:00.000Z"
}
```

`hasOrders` 由 `COUNT(purchase_orders)` 得出，是删除与改平台的前置依据，客户端不需要自己推断。

### 请求示例

```json
POST /purchase-accounts
{"platform":"JD","alias":"京东采购号","remark":"3C 类目"}
```

```json
PATCH /purchase-accounts/{id}
{"alias":"京东采购号（主）","isActive":false}
```

`PATCH` 只更新传入字段；`{}` 返回 400（没有可更新内容），`platform: null` 也是 400。别名首尾空格由服务端去掉，控制字符与服务端 trim 后为空都拒绝。

### 错误码

| 场景 | 状态 | code |
|---|---|---|
| 同平台别名重复（含并发创建） | 409 | `PURCHASE_ACCOUNT_ALREADY_EXISTS` |
| 账号已停用，仍用于新建/确认采购 | 409 | `PURCHASE_ACCOUNT_INACTIVE` |
| 账号与采购单平台不一致 | 422 | `PURCHASE_ACCOUNT_PLATFORM_MISMATCH` |
| 已有采购记录仍试图改平台 | 409 | `PURCHASE_ACCOUNT_PLATFORM_LOCKED` |
| 已有采购记录仍试图删除 | 409 | `PURCHASE_ACCOUNT_HAS_ORDERS` |
| 跨商家 / 不存在的账号 | 404 | `NOT_FOUND` |
| 请求体含未知字段（例如 `password`） | 400 | `VALIDATION_ERROR` |

并发创建同名账号由数据库唯一键兜底，两个请求一个 201、一个 409，不会产生重复行。

## 三、采购单如何关联

采购单新增两个只读字段：

- `purchaseAccountId`：所引用账号；老单据为 `null`。
- `purchaseAccountAlias`：**草稿取账号当前别名，确认下单后取冻结快照**。老单据或未指定账号为 `null`。

规则：

1. 新建/修改草稿时若传 `purchaseAccountId`，服务端校验：同商家、平台一致、且启用（草稿保留原有停用关联时例外，确认下单会再校验）。
2. `POST /purchase-orders/{id}/place` 时再次校验账号启用，并把当前别名写进 `purchase_account_alias_snapshot`。
3. 已下单（PLACED 及之后）的采购单不能改账号——与"不能改商品/价格"同一条规则，接口返回 409。
4. 账号改名不影响已下单单据：详情读快照，历史对账口径稳定。草稿取消时也冻结当时账号别名，避免取消后被显示为“未指定账号”；已确认单取消时保留原有快照。
5. 没有账号的老单据照常读取、搜索、导出，字段为 `null`，不猜测、不回填。

列表新增筛选：

- `purchaseAccountId`：按账号过滤，金额仍是每行的 `totalCost`（商品金额 − 优惠 + 运费，服务端计算）。
- `dateFrom` / `dateTo`：按 `purchase_date` 含当日过滤；`dateFrom > dateTo` 返回 400。

`search` 仍按字面子串匹配单号、平台订单号、店铺与商品快照；任务 27 另外补了按货号搜索（见 `docs/PURCHASE_ORDERS.md`）。

## 四、历史数据兼容

迁移是**只增**的：没有 `DROP`、`UPDATE`、`DELETE`、`TRUNCATE`，新列全部可空。`scripts/purchase-accounts.test.mjs` 直接读迁移文件做静态断言，并按迁移前的列形状插入一条 200 天前的老采购单，验证：

- 老单据详情可读，`purchaseAccountId` 与 `purchaseAccountAlias` 均为 `null`；
- 老明细没有快照时回落到商品主数据的 SKU/名称，**不会被清空**；
- 金额仍按 商品金额 − 优惠 + 运费 计算（4 × 12.00 − 1.00 + 3.50 = 50.50）；
- 按账号筛选不会把老单据卷进来，按单号搜索仍能找到它。

## 五、权限与租户隔离

- 读：`purchase:read`（OWNER/ADMIN/BUYER/WAREHOUSE/VIEWER）。
- 写：`purchase:write` + 角色 OWNER/ADMIN/BUYER。WAREHOUSE 与 VIEWER 的创建、编辑、删除都返回 403，客户端也会隐藏按钮，但服务端才是权威。
- 所有查询都以 `tenantId` 为条件；`(tenant_id, id)` 复合查找，跨商家 ID 一律 404，不会返回"存在但无权限"。
- 采购单引用他商家账号时，服务端按"不存在"处理（404），数据库复合外键也会拒绝直接写入。
- 账号写入、删除都写 `audit_logs`：`PURCHASE_ACCOUNT_CREATED` / `PURCHASE_ACCOUNT_UPDATED` / `PURCHASE_ACCOUNT_DELETED`，metadata 含请求 ID 与前后状态快照。

## 六、手工验收

1. 起 API 与 Web，登录后进入「采购账号」。
2. 新建「淘宝主账号」（平台淘宝）、「京东采购号」（平台京东）。
3. 进「采购管理」→ 新建采购单，平台选淘宝，采购账号下拉只出现淘宝账号；填平台订单号、商品与数量、实际采购单价、优惠、运费，保存。
4. 再建一笔京东采购单，选京东账号。
5. 回列表，按账号筛选分别查看两笔，核对每笔金额与合计；详情里显示账号别名。
6. 回「采购账号」，把淘宝账号改名——已下单单据仍显示旧别名（快照）；草稿显示新别名。
7. 尝试删除有采购记录的账号：按钮禁用，直接调接口返回 409；新建一个不用的账号再删除，成功。

## 七、核对 SQL

```sql
-- 账号与其采购单数量、金额
SELECT a.platform, a.alias, a.is_active, count(o.id) AS orders,
       coalesce(sum(o.freight_amount), 0) AS freight
  FROM purchase_accounts a
  LEFT JOIN purchase_orders o ON o.tenant_id = a.tenant_id AND o.purchase_account_id = a.id
 WHERE a.tenant_id = $1
 GROUP BY a.id ORDER BY a.created_at DESC;

-- 已下单单据的别名是否都冻结了
SELECT id, order_no, status
  FROM purchase_orders
 WHERE tenant_id = $1 AND status <> 'DRAFT' AND purchase_account_id IS NOT NULL
   AND purchase_account_alias_snapshot IS NULL;

-- 是否有账号被删除后采购单仍引用（应为 0 行，外键兜底）
SELECT o.id FROM purchase_orders o
  LEFT JOIN purchase_accounts a ON a.tenant_id = o.tenant_id AND a.id = o.purchase_account_id
 WHERE o.purchase_account_id IS NOT NULL AND a.id IS NULL;
```
