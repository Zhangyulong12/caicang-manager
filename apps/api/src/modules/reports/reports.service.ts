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
const filters = (parts: Prisma.Sql[]) => Prisma.join(parts, ' AND ');
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
    >`${definition.prefix} ${definition.selection} ORDER BY key LIMIT ${size} OFFSET ${offset}`;
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
      const purchaseQuery = { ...q, dataset: 'purchase-lines' as const };
      const p = (
        await tx.$queryRaw<
          Row[]
        >`${purchaseCte(tenant, purchaseQuery)} SELECT COALESCE(SUM(amount),0)::text AS amount, COALESCE(SUM(quantity),0)::text AS quantity,COUNT(DISTINCT "orderId")::text AS orders,COALESCE(SUM("pendingQuantity"),0)::text AS pending,COALESCE(SUM("pendingAmount"),0)::text AS "pendingAmount" FROM selected_lines`
      )[0]!;
      const r = (
        await tx.$queryRaw<
          Row[]
        >`${returnsCte(tenant, { ...q, dataset: 'returns' })} SELECT COALESCE(SUM(refund),0)::text AS refund,COALESCE(SUM(quantity),0)::text AS quantity,COALESCE(SUM(cost),0)::text AS cost FROM return_rows`
      )[0]!;
      const b = (
        await tx.$queryRaw<
          Row[]
        >`SELECT COALESCE(SUM(quantity_on_hand),0)::text AS quantity,COALESCE(SUM(total_cost),0)::text AS cost FROM stock_balances WHERE ${filters([Prisma.sql`tenant_id=${tenant}::uuid`, ...(q.warehouseId ? [Prisma.sql`warehouse_id=${q.warehouseId}::uuid`] : [])])}`
      )[0]!;
      const outbound = reportSql(tenant, { ...q, dataset: 'outbound' });
      const o = (
        await tx.$queryRaw<
          Row[]
        >`SELECT COALESCE(SUM(quantity::numeric),0)::text AS quantity,COALESCE(SUM(cost::numeric),0)::text AS cost FROM (${outbound.selection}) report`
      )[0]!;
      return {
        purchaseAmount: amount(p.amount),
        purchaseQuantity: p.quantity!,
        purchaseOrderCount: p.orders!,
        pendingQuantity: p.pending!,
        pendingAmount: amount(p.pendingAmount, 4),
        inventoryQuantity: b.quantity!,
        inventoryCost: amount(b.cost, 4),
        outboundQuantity: o.quantity!,
        outboundCost: amount(o.cost, 4),
        returnRefundAmount: amount(r.refund),
        returnStockCost: amount(r.cost, 4),
        returnQuantity: r.quantity!,
        generatedAt: new Date().toISOString(),
        timeZone: 'Asia/Shanghai',
      };
    });
  }
}
