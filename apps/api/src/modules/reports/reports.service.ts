import { Injectable } from '@nestjs/common';
import type { ReportExportData, ReportOverviewData, ReportTableData } from '@caicang/api-contract';
import { Prisma } from '../../generated/prisma/client.js';
import { TenantContextService, type TenantContext } from '../../common/tenancy/tenant-context.js';
import { BusinessException } from '../../common/errors.js';
import type {
  ReportExportQueryDto,
  ReportOverviewQueryDto,
  ReportTableQueryDto,
} from './report.dto.js';
import { purchaseCte, returnsCte, reportSql, isPurchaseReport } from './report-sql.js';
import { reportCsv } from './report-csv.js';
type Row = Record<string, string | null>;
const amount = (value: string | null | undefined, digits = 2) =>
  new Prisma.Decimal(value ?? '0').toFixed(digits);
@Injectable()
export class ReportsService {
  constructor(private readonly contexts: TenantContextService) {}
  private async validate(
    tx: Prisma.TransactionClient,
    tenantId: string,
    q: ReportOverviewQueryDto & { purchaseAccountId?: string },
  ) {
    if (q.from && q.to && q.from > q.to) throw new BusinessException('BAD_REQUEST');
    if (
      q.warehouseId &&
      !(await tx.warehouse.findUnique({
        where: { tenantId_id: { tenantId, id: q.warehouseId } },
        select: { id: true },
      }))
    )
      throw new BusinessException('NOT_FOUND');
    if (
      q.purchaseAccountId &&
      q.purchaseAccountId !== 'UNASSIGNED' &&
      !(await tx.purchaseAccount.findUnique({
        where: { tenantId_id: { tenantId, id: q.purchaseAccountId } },
        select: { id: true },
      }))
    )
      throw new BusinessException('NOT_FOUND');
  }
  private validateDataset(q: ReportExportQueryDto) {
    if (
      (!isPurchaseReport(q.dataset) && (q.purchaseAccountId || q.platform)) ||
      (['accounts', 'platforms', 'daily', 'returns'].includes(q.dataset) &&
        (q.sku || q.articleNo)) ||
      (q.dataset === 'inventory' && (q.from || q.to))
    )
      throw new BusinessException('BAD_REQUEST', {
        reason: '当前报表不支持此筛选，库存为当前余额且不归属采购账号；退款不虚构 SKU 分摊',
      });
  }
  private async tableIn(
    tx: Prisma.TransactionClient,
    tenantId: string,
    q: ReportExportQueryDto,
    page: number,
    size: number,
  ): Promise<ReportTableData> {
    this.validateDataset(q);
    await this.validate(tx, tenantId, q);
    const offset = (page - 1) * size;
    if (!Number.isSafeInteger(offset) || offset > 2147483647)
      throw new BusinessException('BAD_REQUEST');
    const definition = reportSql(tenantId, q);
    const totals = await tx.$queryRaw<
      { total: bigint }[]
    >`${definition.prefix} SELECT COUNT(*) AS total FROM (${definition.selection}) report`;
    const rows = await tx.$queryRaw<
      Row[]
    >`${definition.prefix} ${definition.selection} ORDER BY ${definition.orderBy ?? Prisma.sql`key`} LIMIT ${size} OFFSET ${offset}`;
    for (const row of rows)
      for (const column of definition.columns)
        if (column.kind === 'money' && row[column.key] !== null)
          row[column.key] = amount(row[column.key], column.digits);
    return {
      dataset: q.dataset,
      columns: definition.columns,
      rows,
      pagination: { page, pageSize: size, total: Number(totals[0]!.total) },
      generatedAt: new Date().toISOString(),
      scopeNote: definition.note,
    };
  }
  table(context: TenantContext, q: ReportTableQueryDto) {
    return this.contexts.run(context, 'reports:read', false, (tx, current) =>
      this.tableIn(tx, current.tenantId, q, q.page, q.pageSize),
    );
  }
  export(context: TenantContext, q: ReportExportQueryDto): Promise<ReportExportData> {
    return this.contexts.run(context, 'reports:export', false, async (tx, current) => {
      const table = await this.tableIn(tx, current.tenantId, q, 1, 10001);
      if (table.pagination.total > 10000)
        throw new BusinessException('BUSINESS_VALIDATION_FAILED', {
          reason: '导出最多 10000 行，请缩小日期范围或筛选条件',
          limit: 10000,
          total: table.pagination.total,
        });
      const day = new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
      return {
        fileName: `caicang-${q.dataset}-${day}.csv`,
        csv: reportCsv(table.columns, table.rows),
        rowCount: table.rows.length,
        generatedAt: table.generatedAt,
      };
    });
  }
  overview(context: TenantContext, q: ReportOverviewQueryDto): Promise<ReportOverviewData> {
    return this.contexts.run(context, 'reports:read', false, async (tx, current) => {
      const tenant = current.tenantId;
      await this.validate(tx, tenant, q);
      const p = (
        await tx.$queryRaw<Row[]>`${purchaseCte(tenant, { ...q, dataset: 'purchase-lines' })}
        SELECT ${q.sku || q.articleNo ? Prisma.sql`CASE WHEN COUNT(*)=0 THEN 0 WHEN BOOL_AND(amount IS NOT NULL) THEN SUM(amount) END` : Prisma.sql`COALESCE(SUM(order_total) FILTER (WHERE rn=1),0)`}::text AS amount,
        COALESCE(SUM(quantity),0)::text AS quantity,COUNT(DISTINCT "orderId")::text AS orders,
        COUNT(*) FILTER (WHERE amount IS NULL)::text AS missing,
        COALESCE(SUM("pendingQuantity"),0)::text AS pending,
        CASE WHEN COUNT(*) FILTER (WHERE "pendingAmount" IS NULL)>0 THEN NULL ELSE COALESCE(SUM("pendingAmount"),0)::text END AS "pendingAmount",
        (SELECT COUNT(*)::text FROM packages pkg WHERE pkg.tenant_id=${tenant}::uuid AND pkg.receiving_closed_at IS NULL AND pkg.status<>'CANCELLED'
          AND EXISTS (SELECT 1 FROM selected_lines l WHERE l."orderId"=pkg.purchase_order_id::text AND l."pendingQuantity">0
            AND (NOT EXISTS(SELECT 1 FROM package_expected_items e WHERE e.tenant_id=pkg.tenant_id AND e.package_id=pkg.id)
              OR EXISTS(SELECT 1 FROM package_expected_items e WHERE e.tenant_id=pkg.tenant_id AND e.package_id=pkg.id AND e.purchase_order_item_id::text=l.key)))) AS packages
        FROM selected_lines`
      )[0]!;
      const today = new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
      const month = (
        await tx.$queryRaw<
          Row[]
        >`${purchaseCte(tenant, { ...q, sku: undefined, articleNo: undefined, from: today.slice(0, 7) + '-01', to: today, dataset: 'purchase-lines' })}
        SELECT COALESCE(SUM(order_total) FILTER(WHERE rn=1),0)::text AS amount FROM selected_lines`
      )[0]!;
      // Header-level refunds cannot be allocated to individual SKUs. Inventory is pooled across accounts.
      const r = (
        await tx.$queryRaw<
          Row[]
        >`${returnsCte(tenant, { ...q, sku: undefined, articleNo: undefined, dataset: 'returns' })}
        SELECT COALESCE(SUM(refund),0)::text AS refund,COALESCE(SUM(quantity),0)::text AS quantity,COALESCE(SUM(cost),0)::text AS cost FROM return_rows`
      )[0]!;
      const aggregate = async (dataset: 'inventory' | 'outbound' | 'receipts') => {
        const definition = reportSql(tenant, {
          ...q,
          dataset,
          ...(dataset === 'receipts' ? {} : { purchaseAccountId: undefined, platform: undefined }),
          ...(dataset === 'inventory' ? { from: undefined, to: undefined } : {}),
        });
        return (
          await tx.$queryRaw<
            Row[]
          >`${definition.prefix} SELECT COALESCE(SUM(quantity::numeric),0)::text AS quantity,COALESCE(SUM(cost::numeric),0)::text AS cost FROM (${definition.selection}) report`
        )[0]!;
      };
      const b = await aggregate('inventory'),
        o = await aggregate('outbound'),
        received = await aggregate('receipts');
      return {
        purchaseAmount: p.amount === null ? null : amount(p.amount),
        monthPurchaseAmount: amount(month.amount),
        missingAllocationCount: p.missing!,
        purchaseQuantity: p.quantity!,
        purchaseOrderCount: p.orders!,
        pendingQuantity: p.pending!,
        pendingAmount: p.pendingAmount === null ? null : amount(p.pendingAmount, 4),
        pendingPackageCount: p.packages!,
        receivedQuantity: received.quantity!,
        receivedCost: amount(received.cost, 4),
        inventoryQuantity: b.quantity!,
        inventoryCost: amount(b.cost, 4),
        outboundQuantity: o.quantity!,
        outboundCost: amount(o.cost, 4),
        returnRefundAmount: amount(r.refund),
        returnStockCost: amount(r.cost, 4),
        returnQuantity: r.quantity!,
        scopeNote:
          '采购按采购日期；待入库为所选采购单当前剩余，未关闭包裹数为候选包裹。入库/出库按实际发生时间（上海），退款按退货日期。库存为当前余额，库存/出库不归属采购账号或平台。退款为所选账号整张退货单，不按 SKU 分摊。本月卡片为所选账号/平台/仓库从月初至今天的采购总额，不按 SKU 拆分。缺失原始分摊的 SKU 金额为空。',
        generatedAt: new Date().toISOString(),
        timeZone: 'Asia/Shanghai',
      };
    });
  }
}
