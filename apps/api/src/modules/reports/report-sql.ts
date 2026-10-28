import type { ReportColumn, ReportDataset } from '@caicang/api-contract';
import { Prisma } from '../../generated/prisma/client.js';
import type { ReportExportQueryDto, ReportOverviewQueryDto } from './report.dto.js';
const and = (parts: Prisma.Sql[]) => Prisma.join(parts, ' AND ');
export function dateParts(q: ReportOverviewQueryDto, column: Prisma.Sql): Prisma.Sql[] {
  return [
    ...(q.from ? [Prisma.sql`${column} >= ${q.from}::date`] : []),
    ...(q.to ? [Prisma.sql`${column} <= ${q.to}::date`] : []),
  ];
}
function accountParts(q: ReportExportQueryDto) {
  return [
    ...(q.purchaseAccountId
      ? [
          q.purchaseAccountId === 'UNASSIGNED'
            ? Prisma.sql`o.purchase_account_id IS NULL`
            : Prisma.sql`o.purchase_account_id=${q.purchaseAccountId}::uuid`,
        ]
      : []),
    ...(q.platform ? [Prisma.sql`o.platform=${q.platform}`] : []),
  ];
}
export function orderParts(tenant: string, q: ReportExportQueryDto) {
  return [
    Prisma.sql`o.tenant_id=${tenant}::uuid`,
    ...(q.warehouseId ? [Prisma.sql`o.warehouse_id=${q.warehouseId}::uuid`] : []),
    ...accountParts(q),
  ];
}
/** Freight is allocated across ALL original lines before any SKU filter; no fan-out joins. */
export function purchaseCte(tenant: string, q: ReportExportQueryDto) {
  const filters = [
    ...orderParts(tenant, q),
    Prisma.sql`o.status IN ('PLACED','PARTIAL_RECEIVED','RECEIVED')`,
    ...dateParts(q, Prisma.sql`o.purchase_date`),
  ];
  return Prisma.sql`WITH base AS (
    SELECT i.id::text AS key, SUM(i.quantity::numeric*i.unit_price-i.discount_amount) OVER (PARTITION BY o.id)+o.freight_amount AS order_total, i.purchase_order_id::text AS "orderId", o.order_no AS "orderNo", o.purchase_date AS "purchaseDate",
      o.platform, o.purchase_account_id::text AS "accountId", COALESCE(a.alias,'未指定账号') AS "accountName",
      o.purchase_account_alias_snapshot AS "accountAliasSnapshot", w.name AS "warehouseName", o.status,
      COALESCE(i.sku_snapshot,p.sku) AS sku, CASE WHEN i.sku_snapshot IS NOT NULL THEN i.article_no_snapshot ELSE p.article_no END AS "articleNo",
      COALESCE(i.name_snapshot,p.name) AS name, i.quantity, i.unit_price AS "unitPrice", i.discount_amount AS discount,
      i.quantity::numeric*i.unit_price AS gross, i.quantity::numeric*i.unit_price-i.discount_amount AS net,
      i.freight_allocated AS stored_freight, i.landed_unit_cost AS stored_unit, o.freight_amount,
      ROW_NUMBER() OVER (PARTITION BY o.id ORDER BY i.line_no NULLS LAST,i.id) AS rn,
      COUNT(*) OVER (PARTITION BY o.id) AS line_count,
      COUNT(i.freight_allocated) OVER (PARTITION BY o.id) AS stored_count,
      SUM(i.freight_allocated) OVER (PARTITION BY o.id) AS stored_total,
      SUM(i.quantity::numeric*i.unit_price-i.discount_amount) OVER (PARTITION BY o.id) AS total_net,
      SUM(i.quantity::numeric) OVER (PARTITION BY o.id) AS total_qty
    FROM purchase_orders o JOIN purchase_order_items i ON i.tenant_id=o.tenant_id AND i.purchase_order_id=o.id
    JOIN products p ON p.tenant_id=o.tenant_id AND p.id=i.product_id
    JOIN warehouses w ON w.tenant_id=o.tenant_id AND w.id=o.warehouse_id
    LEFT JOIN purchase_accounts a ON a.tenant_id=o.tenant_id AND a.id=o.purchase_account_id
    WHERE ${and(filters)}
  ), allocated AS (
    SELECT *, CASE WHEN stored_count=line_count AND stored_total=freight_amount THEN stored_freight
      WHEN freight_amount=0 THEN 0 ELSE NULL END AS freight,
      CASE WHEN stored_count=line_count AND stored_total=freight_amount THEN '原单分摊'
        WHEN freight_amount=0 THEN '零运费' ELSE '缺少原始分摊，不推测' END AS "freightSource"
    FROM base
  ), received AS (
    SELECT ri.purchase_order_item_id::text AS key, SUM(ri.quantity)::numeric AS qty
    FROM receipt_items ri JOIN receipts r ON r.tenant_id=ri.tenant_id AND r.id=ri.receipt_id AND r.status='CONFIRMED'
    WHERE ri.tenant_id=${tenant}::uuid GROUP BY ri.purchase_order_item_id
  ), lines AS (
    SELECT x.*, net+freight AS amount, COALESCE(r.qty,0) AS "receivedQuantity",
      CASE WHEN x.status IN ('PLACED','PARTIAL_RECEIVED') THEN GREATEST(x.quantity-COALESCE(r.qty,0),0) ELSE 0 END AS "pendingQuantity",
      CASE WHEN x.status IN ('PLACED','PARTIAL_RECEIVED') THEN GREATEST(x.quantity-COALESCE(r.qty,0),0)*COALESCE(stored_unit,ROUND((net+freight)/quantity,4)) ELSE 0 END AS "pendingAmount"
    FROM allocated x LEFT JOIN received r ON r.key=x.key
  ), selected_lines AS (
    SELECT * FROM lines WHERE ${and([Prisma.sql`TRUE`, ...(q.sku ? [Prisma.sql`sku=${q.sku}`] : []), ...(q.articleNo ? [Prisma.sql`"articleNo"=${q.articleNo}`] : [])])}
  )`;
}
/** Aggregate return items separately from the header refund to avoid multiplying whole-order refunds. */
export function returnsCte(tenant: string, q: ReportExportQueryDto, withPrefix = true) {
  const filters = [
    ...orderParts(tenant, q),
    Prisma.sql`r.tenant_id=${tenant}::uuid AND r.status='CONFIRMED'`,
    ...dateParts(q, Prisma.sql`r.return_date`),
  ];
  return Prisma.sql`${withPrefix ? Prisma.sql`WITH` : Prisma.sql`,`} return_amounts AS (
    SELECT i.purchase_return_id, SUM(i.quantity)::numeric AS quantity, SUM(i.stock_cost) AS cost
    FROM purchase_return_items i WHERE i.tenant_id=${tenant}::uuid GROUP BY i.purchase_return_id
  ), return_rows AS (
    SELECT r.id::text AS key, r.return_no AS "returnNo", r.purchase_order_id::text AS "orderId", o.order_no AS "orderNo",
      r.return_date AS "returnDate", r.refund_amount AS refund, r.confirmed_at AS "confirmedAt", o.platform,
      o.purchase_account_id::text AS "accountId", COALESCE(a.alias,'未指定账号') AS "accountName",
      z.quantity, z.cost, w.name AS "warehouseName"
    FROM purchase_returns r JOIN purchase_orders o ON o.tenant_id=r.tenant_id AND o.id=r.purchase_order_id
    JOIN return_amounts z ON z.purchase_return_id=r.id
    JOIN warehouses w ON w.tenant_id=o.tenant_id AND w.id=r.warehouse_id
    LEFT JOIN purchase_accounts a ON a.tenant_id=o.tenant_id AND a.id=o.purchase_account_id
    WHERE ${and(filters)}
  )`;
}
const text = (key: string, label: string): ReportColumn => ({ key, label, kind: 'text' });
const qty = (key: string, label: string): ReportColumn => ({ key, label, kind: 'quantity' });
const money = (key: string, label: string, digits: 2 | 4 = 2): ReportColumn => ({
  key,
  label,
  kind: 'money',
  digits,
});
const purchaseColumns = [
  qty('quantity', '采购数量'),
  money('gross', '商品原额（元）'),
  money('discount', '优惠（元）'),
  money('freight', '运费（元）'),
  money('amount', '采购总额（元）'),
  qty('pendingQuantity', '当前待入库数量'),
  money('pendingAmount', '当前待入库估值（元）', 4),
];
export function reportSql(
  tenant: string,
  q: ReportExportQueryDto,
): {
  prefix: Prisma.Sql;
  selection: Prisma.Sql;
  orderBy?: Prisma.Sql;
  columns: ReportColumn[];
  note: string;
} {
  if (['accounts', 'platforms', 'daily'].includes(q.dataset)) {
    const dimension =
      q.dataset === 'accounts'
        ? Prisma.sql`COALESCE("accountId",'UNASSIGNED')`
        : q.dataset === 'platforms'
          ? Prisma.sql`platform`
          : Prisma.sql`COALESCE(TO_CHAR("purchaseDate",'YYYY-MM-DD'),'未记录日期')`;
    const retDimension =
      q.dataset === 'daily' ? Prisma.sql`TO_CHAR("returnDate",'YYYY-MM-DD')` : dimension;
    const label = q.dataset === 'accounts' ? Prisma.sql`MAX("accountName")` : dimension;
    const retLabel = q.dataset === 'accounts' ? Prisma.sql`MAX("accountName")` : retDimension;
    return {
      prefix: Prisma.sql`${purchaseCte(tenant, q)} ${returnsCte(tenant, q, false)}, purchases_group AS (
      SELECT ${dimension} AS key,${label} AS label,COUNT(DISTINCT "orderId")::text AS "orderCount",
        SUM(quantity) AS quantity,SUM(gross) AS gross,SUM(discount) AS discount,SUM(freight_amount) FILTER (WHERE rn=1) AS freight,SUM(order_total) FILTER (WHERE rn=1) AS amount,SUM("pendingQuantity") AS "pendingQuantity",CASE WHEN BOOL_AND("pendingAmount" IS NOT NULL) THEN SUM("pendingAmount") END AS "pendingAmount"
      FROM selected_lines GROUP BY ${dimension}
    ), refunds_group AS (SELECT ${retDimension} AS key,${retLabel} AS label,SUM(refund) AS refund,SUM(quantity) AS "returnQuantity",SUM(cost) AS "returnStockCost" FROM return_rows GROUP BY ${retDimension})`,
      selection: Prisma.sql`SELECT COALESCE(p.key,r.key) AS key,COALESCE(p.label,r.label) AS label,COALESCE(p."orderCount",'0') AS "orderCount",
        COALESCE(p.quantity,0)::text AS quantity,COALESCE(p.gross,0)::text AS gross,COALESCE(p.discount,0)::text AS discount,COALESCE(p.freight,0)::text AS freight,COALESCE(p.amount,0)::text AS amount,
        COALESCE(p."pendingQuantity",0)::text AS "pendingQuantity",CASE WHEN p.key IS NULL THEN '0' ELSE p."pendingAmount"::text END AS "pendingAmount",COALESCE(r.refund,0)::text AS refund,COALESCE(r."returnQuantity",0)::text AS "returnQuantity",COALESCE(r."returnStockCost",0)::text AS "returnStockCost"
        FROM purchases_group p FULL OUTER JOIN refunds_group r ON r.key=p.key`,
      columns: [
        text(
          'label',
          q.dataset === 'accounts' ? '采购账号' : q.dataset === 'platforms' ? '平台' : '业务日期',
        ),
        qty('orderCount', '采购单数'),
        ...purchaseColumns,
        money('refund', '期间确认退款登记（元）'),
        qty('returnQuantity', '期间确认退货数量'),
        money('returnStockCost', '退货库存成本（元）', 4),
      ],
      note: '采购按原采购日期；退款按退货业务日期且必须已确认。两者为独立期间发生额，不相减冒充原单成本。未指定账号单独汇总；待入库是所选采购期间单据截至当前的剩余。',
    };
  }
  if (q.dataset === 'purchase-lines' || q.dataset === 'pending')
    return {
      prefix: purchaseCte(tenant, q),
      orderBy: Prisma.sql`"purchaseDate" DESC NULLS LAST, key`,
      selection: Prisma.sql`SELECT key,"orderId","orderNo",TO_CHAR("purchaseDate",'YYYY-MM-DD') AS "purchaseDate",platform,"accountName","accountAliasSnapshot","warehouseName",sku,"articleNo",name,quantity::text AS quantity,"unitPrice"::text AS "unitPrice",gross::text AS gross,discount::text AS discount,freight::text AS freight,amount::text AS amount,"receivedQuantity"::text AS "receivedQuantity","pendingQuantity"::text AS "pendingQuantity","pendingAmount"::text AS "pendingAmount","freightSource" FROM selected_lines ${q.dataset === 'pending' ? Prisma.sql`WHERE "pendingQuantity">0` : Prisma.empty}`,
      columns: [
        text('orderNo', '原采购单号'),
        text('purchaseDate', '采购日期'),
        text('platform', '平台'),
        text('accountName', '采购账号（当前别名）'),
        text('accountAliasSnapshot', '下单账号别名快照'),
        text('warehouseName', '目标仓库'),
        text('articleNo', '原单货号'),
        text('sku', '原单 SKU'),
        text('name', '商品'),
        qty('quantity', '采购数量'),
        money('unitPrice', '原采购单价（元）'),
        ...purchaseColumns.filter((c) => c.key !== 'quantity'),
        qty('receivedQuantity', '累计已入库'),
        text('freightSource', '运费分摊依据'),
      ],
      note: '旧明细缺少原始分摊时金额为空，不按随机顺序重建。只计 PLACED/PARTIAL_RECEIVED/RECEIVED；先按原单全部商品分摊运费，再按原单货号/SKU 筛选。待入库估值按剩余量×冻结到仓单位成本（四位），不等于应付账款；退货不重新开放原单入库量。',
    };
  if (q.dataset === 'products')
    return {
      prefix: purchaseCte(tenant, q),
      selection: Prisma.sql`SELECT jsonb_build_array(sku,"articleNo")::text AS key,sku,"articleNo",SUM(quantity)::text AS quantity,
      (SUM(gross)/NULLIF(SUM(quantity),0))::text AS "averagePrice",MIN("unitPrice")::text AS "minPrice",MAX("unitPrice")::text AS "maxPrice",
      CASE WHEN BOOL_AND(amount IS NOT NULL) THEN SUM(amount)::text END AS amount,
      SUM("receivedQuantity")::text AS "receivedQuantity",SUM("pendingQuantity")::text AS "pendingQuantity"
      FROM selected_lines GROUP BY sku,"articleNo"`,
      columns: [
        text('articleNo', '原单货号'),
        text('sku', '原单 SKU'),
        qty('quantity', '采购数量'),
        money('averagePrice', '数量加权原采购单价', 4),
        money('minPrice', '最低原单价'),
        money('maxPrice', '最高原单价'),
        money('amount', '含优惠与运费采购金额'),
        qty('receivedQuantity', '累计已入库'),
        qty('pendingQuantity', '当前待入库'),
      ],
      note: '按原单 SKU、货号分组；平均原单价=商品原额/数量，不含优惠运费。含税费等额外费用不另行推测；缺失原始分摊时采购金额为空。',
    };
  if (q.dataset === 'returns')
    return {
      prefix: returnsCte(tenant, q),
      orderBy: Prisma.sql`"returnDate" DESC, key`,
      selection: Prisma.sql`SELECT key,"returnNo","orderId","orderNo",TO_CHAR("returnDate",'YYYY-MM-DD') AS "returnDate",platform,"accountName","warehouseName",quantity::text AS quantity,refund::text AS refund,cost::text AS cost,"confirmedAt"::text AS "confirmedAt" FROM return_rows`,
      columns: [
        text('returnNo', '退货单号'),
        text('orderNo', '原采购单号'),
        text('returnDate', '退货业务日期'),
        text('platform', '原采购平台'),
        text('accountName', '原采购账号'),
        text('warehouseName', '仓库'),
        qty('quantity', '已确认退货数量'),
        money('refund', '实际退款登记（元）'),
        money('cost', '退货库存成本（元）', 4),
        text('confirmedAt', '确认时间'),
      ],
      note: '每张已确认退货单只计一次实际 refundAmount，按退货业务日期筛选；原采购日期可在本期间之外。退款登记不代表银行到账。',
    };
  const itemFilters = [
    Prisma.sql`p.tenant_id=${tenant}::uuid`,
    ...(q.sku ? [Prisma.sql`p.sku=${q.sku}`] : []),
    ...(q.articleNo ? [Prisma.sql`p.article_no=${q.articleNo}`] : []),
  ];
  if (q.dataset === 'inventory')
    return {
      prefix: Prisma.empty,
      selection: Prisma.sql`SELECT b.id::text AS key,w.name AS "warehouseName",p.id::text AS "productId",p.sku,p.article_no AS "articleNo",p.name,b.quantity_on_hand::text AS quantity,b.total_cost::text AS cost,(CASE WHEN b.quantity_on_hand=0 THEN 0 ELSE b.total_cost/b.quantity_on_hand END)::text AS "averageCost" FROM stock_balances b JOIN products p ON p.tenant_id=b.tenant_id AND p.id=b.product_id JOIN warehouses w ON w.tenant_id=b.tenant_id AND w.id=b.warehouse_id WHERE ${and([Prisma.sql`b.tenant_id=${tenant}::uuid`, ...itemFilters, ...(q.warehouseId ? [Prisma.sql`b.warehouse_id=${q.warehouseId}::uuid`] : [])])}`,
      columns: [
        text('warehouseName', '仓库'),
        text('articleNo', '当前货号'),
        text('sku', '当前 SKU'),
        text('name', '商品'),
        qty('quantity', '当前库存数量'),
        money('averageCost', '移动加权平均单位成本（元）', 4),
        money('cost', '当前库存账面成本（元）', 4),
      ],
      note: '实时库存余额，不按日期回溯；SKU/货号为商品当前资料。混合库存不按采购账号或平台归属。',
    };
  if (q.dataset === 'receipts')
    return {
      prefix: Prisma.empty,
      orderBy: Prisma.sql`"occurredAt" DESC,key`,
      selection: Prisma.sql`SELECT m.id::text AS key,r.id::text AS "receiptId",r.receipt_no AS "documentNo",o.id::text AS "orderId",o.order_no AS "orderNo",r.received_at::text AS "occurredAt",w.name AS "warehouseName",p.sku,p.article_no AS "articleNo",m.quantity_delta::text AS quantity,m.cost_delta::text AS cost
      FROM stock_movements m JOIN receipt_items i ON i.tenant_id=m.tenant_id AND i.id=m.source_item_id
      JOIN receipts r ON r.tenant_id=i.tenant_id AND r.id=i.receipt_id AND r.status='CONFIRMED'
      JOIN purchase_orders o ON o.tenant_id=r.tenant_id AND o.id=r.purchase_order_id
      JOIN products p ON p.tenant_id=m.tenant_id AND p.id=m.product_id
      JOIN warehouses w ON w.tenant_id=m.tenant_id AND w.id=m.warehouse_id
      WHERE ${and([Prisma.sql`m.tenant_id=${tenant}::uuid AND m.source_type='RECEIPT'`, ...orderParts(tenant, q), ...itemFilters, ...dateParts(q, Prisma.sql`(r.received_at AT TIME ZONE 'Asia/Shanghai')::date`)])}`,
      columns: [
        text('documentNo', '入库单'),
        text('orderNo', '原采购单'),
        text('occurredAt', '入库时间'),
        text('warehouseName', '仓库'),
        text('sku', '当前 SKU'),
        qty('quantity', '入库数量'),
        money('cost', '实际入库成本', 4),
      ],
      note: '按实际入库时间（上海）及入库流水统计；采购日期可能在所选期间之外。成本不与采购发生额相加。',
    };
  if (q.dataset === 'adjustments')
    return {
      prefix: Prisma.empty,
      orderBy: Prisma.sql`"occurredAt" DESC,key`,
      selection: Prisma.sql`SELECT m.id::text AS key,a.id::text AS "adjustmentId",COALESCE(a.adjustment_no,a.id::text) AS "documentNo",a.created_at::text AS "occurredAt",w.name AS "warehouseName",p.sku,p.article_no AS "articleNo",m.quantity_delta::text AS quantity,m.cost_delta::text AS cost,a.reason
      FROM stock_movements m JOIN stock_adjustments a ON a.tenant_id=m.tenant_id AND a.id=m.source_item_id
      JOIN products p ON p.tenant_id=m.tenant_id AND p.id=m.product_id
      JOIN warehouses w ON w.tenant_id=m.tenant_id AND w.id=m.warehouse_id
      WHERE ${and([Prisma.sql`m.tenant_id=${tenant}::uuid AND m.source_type='ADJUSTMENT'`, ...itemFilters, ...(q.warehouseId ? [Prisma.sql`m.warehouse_id=${q.warehouseId}::uuid`] : []), ...dateParts(q, Prisma.sql`(a.created_at AT TIME ZONE 'Asia/Shanghai')::date`)])}`,
      columns: [
        text('documentNo', '调整单'),
        text('occurredAt', '调整时间'),
        text('warehouseName', '仓库'),
        text('sku', '当前 SKU'),
        qty('quantity', '调整数量'),
        money('cost', '库存成本变化', 4),
        text('reason', '原因'),
      ],
      note: '按实际调整流水及上海日期统计，调整成本变化单独展示，不当成采购或退款。',
    };
  return {
    prefix: Prisma.empty,
    orderBy: Prisma.sql`"shippedAt" DESC,key`,
    selection: Prisma.sql`SELECT m.id::text AS key,o.id::text AS "outboundId",o.outbound_no AS "outboundNo",TO_CHAR(o.shipped_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS') AS "shippedAt",w.name AS "warehouseName",p.sku,p.article_no AS "articleNo",p.name,(-m.quantity_delta)::text AS quantity,(-m.cost_delta)::text AS cost FROM stock_movements m JOIN outbound_order_items i ON i.tenant_id=m.tenant_id AND i.id=m.source_item_id JOIN outbound_orders o ON o.tenant_id=m.tenant_id AND o.id=i.outbound_order_id AND o.status='SHIPPED' JOIN products p ON p.tenant_id=m.tenant_id AND p.id=m.product_id JOIN warehouses w ON w.tenant_id=m.tenant_id AND w.id=m.warehouse_id WHERE ${and([Prisma.sql`m.tenant_id=${tenant}::uuid AND m.source_type='OUTBOUND'`, ...itemFilters, ...(q.warehouseId ? [Prisma.sql`m.warehouse_id=${q.warehouseId}::uuid`] : []), ...dateParts(q, Prisma.sql`(o.shipped_at AT TIME ZONE 'Asia/Shanghai')::date`)])}`,
    columns: [
      text('outboundNo', '出库单号'),
      text('shippedAt', '发货时间（上海）'),
      text('warehouseName', '仓库'),
      text('articleNo', '当前货号'),
      text('sku', '当前 SKU'),
      text('name', '商品'),
      qty('quantity', '已出库数量'),
      money('cost', '实际出库成本（元）', 4),
    ],
    note: '按实际发货日期（Asia/Shanghai）筛选，只计 SHIPPED 对应 OUTBOUND 流水的数量和实际扣减成本，包含清零尾差；不按采购账号/平台追认混合库存来源。',
  };
}
export const isPurchaseReport = (dataset: ReportDataset) =>
  [
    'accounts',
    'platforms',
    'daily',
    'purchase-lines',
    'pending',
    'returns',
    'products',
    'receipts',
  ].includes(dataset);
