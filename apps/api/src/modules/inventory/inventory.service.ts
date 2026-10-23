import { Injectable } from '@nestjs/common';
import {
  STOCK_MOVEMENT_TYPES,
  type InventoryBalanceData,
  type InventoryMovementData,
  type StockMovementType,
} from '@caicang/api-contract';
import { Prisma } from '../../generated/prisma/client.js';
import { BusinessException } from '../../common/errors.js';
import { PageResult } from '../../common/response.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { TenantContextService, type TenantContext } from '../../common/tenancy/tenant-context.js';
import type { InventoryBalanceQueryDto, InventoryMovementQueryDto } from './inventory.dto.js';

const Decimal = Prisma.Decimal.clone({ precision: 60, rounding: Prisma.Decimal.ROUND_HALF_UP });
// LIKE wildcards stay literal so a search term cannot broaden the result set.
const literal = (value: string) => value.replace(/[\\%_]/g, '\\$&');
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

interface BalanceRow {
  warehouseId: string;
  warehouseName: string;
  productId: string;
  sku: string;
  barcode: string | null;
  name: string;
  specification: string | null;
  unit: string;
  quantityOnHand: number;
  totalCost: string;
  pendingInboundQuantity: number;
  updatedAt: Date | null;
}

interface MovementRow {
  id: string;
  occurredAt: Date;
  sourceType: string;
  quantityDelta: number;
  quantityBefore: number;
  quantityAfter: number;
  costDelta: string;
  unitCost: string;
  totalCostBefore: string;
  totalCostAfter: string;
  warehouseId: string;
  warehouseName: string;
  productId: string;
  sku: string;
  productName: string;
  unit: string;
  sourceNo: string | null;
  sourceId: string;
  note: string | null;
  operatorId: string;
  operatorName: string;
}

/**
 * 库存只读查询。这里刻意没有任何写接口：库存数量只能由收货事务等业务动作通过
 * stock_movements + stock_balances 的既有路径改变，避免出现"直接改余额"的 CRUD 后门。
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly contexts: TenantContextService,
    private readonly prisma: PrismaService,
  ) {}

  async balances(
    context: TenantContext,
    query: InventoryBalanceQueryDto,
  ): Promise<PageResult<InventoryBalanceData>> {
    const skip = this.offset(query.page, query.pageSize);
    const updatedFrom = this.instant(query.updatedFrom, 'updatedFrom', false);
    const updatedTo = this.instant(query.updatedTo, 'updatedTo', true);
    this.assertRange(updatedFrom, updatedTo);
    return this.contexts.run(context, 'products:read', false, async (tx, current) => {
      const tenantId = current.tenantId;
      const where = this.balanceFilter(query, updatedFrom, updatedTo);
      const counted = await tx.$queryRaw<{ count: bigint }[]>(Prisma.sql`
        ${this.balanceWith(tenantId)}
        SELECT count(*)::bigint AS count
        ${this.balanceFrom(tenantId)}
        WHERE ${where}`);
      const total = Number(counted[0]?.count ?? 0);
      const rows = await tx.$queryRaw<BalanceRow[]>(Prisma.sql`
        ${this.balanceWith(tenantId)}
        SELECT
          k.warehouse_id::text AS "warehouseId",
          w.name AS "warehouseName",
          k.product_id::text AS "productId",
          p.sku,
          p.barcode,
          p.name,
          p.specification,
          p.unit,
          COALESCE(b.quantity_on_hand, 0)::int AS "quantityOnHand",
          COALESCE(b.total_cost, 0)::text AS "totalCost",
          COALESCE(pd.qty, 0)::int AS "pendingInboundQuantity",
          b.updated_at AS "updatedAt"
        ${this.balanceFrom(tenantId)}
        WHERE ${where}
        ORDER BY w.name ASC, p.sku ASC, k.warehouse_id ASC, k.product_id ASC
        LIMIT ${query.pageSize} OFFSET ${skip}`);
      return new PageResult(
        rows.map((row) => this.mapBalance(row)),
        { page: query.page, pageSize: query.pageSize, total },
      );
    });
  }

  async movements(
    context: TenantContext,
    query: InventoryMovementQueryDto,
  ): Promise<PageResult<InventoryMovementData>> {
    const skip = this.offset(query.page, query.pageSize);
    const from = this.instant(query.from, 'from', false);
    const to = this.instant(query.to, 'to', true);
    this.assertRange(from, to);
    return this.contexts.run(context, 'products:read', false, async (tx, current) => {
      const tenantId = current.tenantId;
      const where = this.movementFilter(query, tenantId, from, to);
      const counted = await tx.$queryRaw<{ count: bigint }[]>(Prisma.sql`
        SELECT count(*)::bigint AS count
        ${this.movementFrom(tenantId)}
        WHERE ${where}`);
      const total = Number(counted[0]?.count ?? 0);
      const rows = await tx.$queryRaw<MovementRow[]>(Prisma.sql`
        SELECT
          m.id::text AS "id",
          m.created_at AS "occurredAt",
          m.source_type AS "sourceType",
          m.quantity_delta::int AS "quantityDelta",
          m.quantity_before::int AS "quantityBefore",
          m.quantity_after::int AS "quantityAfter",
          m.cost_delta::text AS "costDelta",
          COALESCE(ROUND(ABS(m.cost_delta) / NULLIF(ABS(m.quantity_delta), 0), 4), 0)::text AS "unitCost",
          m.total_cost_before::text AS "totalCostBefore",
          m.total_cost_after::text AS "totalCostAfter",
          m.warehouse_id::text AS "warehouseId",
          w.name AS "warehouseName",
          m.product_id::text AS "productId",
          p.sku,
          p.name AS "productName",
          p.unit,
          COALESCE(r.receipt_no, o.outbound_no) AS "sourceNo",
          m.source_item_id::text AS "sourceId",
          COALESCE(r.remark, o.remark, sa.reason) AS "note",
          m.created_by::text AS "operatorId",
          COALESCE(NULLIF(u.display_name, ''), u.email) AS "operatorName"
        ${this.movementFrom(tenantId)}
        WHERE ${where}
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT ${query.pageSize} OFFSET ${skip}`);
      return new PageResult(
        rows.map((row) => this.mapMovement(row)),
        { page: query.page, pageSize: query.pageSize, total },
      );
    });
  }

  /** 现存数量与待入库合并成一个行集：只收过货的、只有待入库的都出现在同一张表里。 */
  private balanceWith(tenantId: string): Prisma.Sql {
    return Prisma.sql`
      WITH received AS (
        SELECT ri.purchase_order_item_id AS item_id, SUM(ri.quantity)::bigint AS received
        FROM receipt_items ri
        WHERE ri.tenant_id = ${tenantId}::uuid
        GROUP BY ri.purchase_order_item_id
      ), pending AS (
        SELECT po.warehouse_id, poi.product_id,
               SUM(GREATEST(poi.quantity - COALESCE(r.received, 0), 0))::bigint AS qty
        FROM purchase_order_items poi
        JOIN purchase_orders po ON po.tenant_id = poi.tenant_id AND po.id = poi.purchase_order_id
        LEFT JOIN received r ON r.item_id = poi.id
        WHERE poi.tenant_id = ${tenantId}::uuid
          AND po.status IN ('PLACED', 'PARTIAL_RECEIVED')
        GROUP BY po.warehouse_id, poi.product_id
      ), keys AS (
        SELECT b.warehouse_id, b.product_id
        FROM stock_balances b
        WHERE b.tenant_id = ${tenantId}::uuid
        UNION
        SELECT pd.warehouse_id, pd.product_id FROM pending pd
      )`;
  }

  private balanceFrom(tenantId: string): Prisma.Sql {
    return Prisma.sql`
      FROM keys k
      JOIN warehouses w ON w.tenant_id = ${tenantId}::uuid AND w.id = k.warehouse_id
      JOIN products p ON p.tenant_id = ${tenantId}::uuid AND p.id = k.product_id
      LEFT JOIN stock_balances b
        ON b.tenant_id = ${tenantId}::uuid
       AND b.warehouse_id = k.warehouse_id
       AND b.product_id = k.product_id
      LEFT JOIN pending pd ON pd.warehouse_id = k.warehouse_id AND pd.product_id = k.product_id`;
  }

  private balanceFilter(
    query: InventoryBalanceQueryDto,
    updatedFrom?: Date,
    updatedTo?: Date,
  ): Prisma.Sql {
    const parts: Prisma.Sql[] = [Prisma.sql`TRUE`];
    this.commonFilter(parts, query);
    if (updatedFrom) parts.push(Prisma.sql`b.updated_at >= ${updatedFrom}::timestamptz`);
    if (updatedTo) parts.push(Prisma.sql`b.updated_at <= ${updatedTo}::timestamptz`);
    return Prisma.join(parts, ' AND ');
  }

  private movementFrom(tenantId: string): Prisma.Sql {
    return Prisma.sql`
      FROM stock_movements m
      JOIN warehouses w ON w.tenant_id = ${tenantId}::uuid AND w.id = m.warehouse_id
      JOIN products p ON p.tenant_id = ${tenantId}::uuid AND p.id = m.product_id
      JOIN users u ON u.id = m.created_by
      LEFT JOIN receipt_items ri
        ON m.source_type = 'RECEIPT' AND ri.tenant_id = ${tenantId}::uuid AND ri.id = m.source_item_id
      LEFT JOIN receipts r ON r.tenant_id = ${tenantId}::uuid AND r.id = ri.receipt_id
      LEFT JOIN outbound_order_items oi
        ON m.source_type = 'OUTBOUND' AND oi.tenant_id = ${tenantId}::uuid AND oi.id = m.source_item_id
      LEFT JOIN outbound_orders o ON o.tenant_id = ${tenantId}::uuid AND o.id = oi.outbound_order_id
      LEFT JOIN stock_adjustments sa
        ON m.source_type = 'ADJUSTMENT' AND sa.tenant_id = ${tenantId}::uuid AND sa.id = m.source_item_id`;
  }

  private movementFilter(
    query: InventoryMovementQueryDto,
    tenantId: string,
    from?: Date,
    to?: Date,
  ): Prisma.Sql {
    const parts: Prisma.Sql[] = [Prisma.sql`m.tenant_id = ${tenantId}::uuid`];
    this.commonFilter(parts, query, 'm');
    if (query.type) parts.push(Prisma.sql`m.source_type = ${query.type}`);
    if (from) parts.push(Prisma.sql`m.created_at >= ${from}::timestamptz`);
    if (to) parts.push(Prisma.sql`m.created_at <= ${to}::timestamptz`);
    return Prisma.join(parts, ' AND ');
  }

  /** 两个查询共用的商品/仓库筛选；余额用 k/b，流水用 m。 */
  private commonFilter(
    parts: Prisma.Sql[],
    query: InventoryBalanceQueryDto | InventoryMovementQueryDto,
    scope: 'm' | 'k' = 'k',
  ): void {
    if (query.warehouseId)
      parts.push(
        scope === 'm'
          ? Prisma.sql`m.warehouse_id = ${query.warehouseId}::uuid`
          : Prisma.sql`k.warehouse_id = ${query.warehouseId}::uuid`,
      );
    if (query.productId)
      parts.push(
        scope === 'm'
          ? Prisma.sql`m.product_id = ${query.productId}::uuid`
          : Prisma.sql`k.product_id = ${query.productId}::uuid`,
      );
    if (query.sku) parts.push(Prisma.sql`p.sku = ${query.sku}`);
    if (query.barcode) parts.push(Prisma.sql`p.barcode = ${query.barcode}`);
    if (query.search) {
      const like = '%' + literal(query.search) + '%';
      parts.push(
        Prisma.sql`(p.sku ILIKE ${like} OR p.name ILIKE ${like} OR p.barcode ILIKE ${like})`,
      );
    }
  }

  private mapBalance(row: BalanceRow): InventoryBalanceData {
    const totalCost = new Decimal(row.totalCost);
    const averageCost =
      row.quantityOnHand > 0
        ? totalCost.div(row.quantityOnHand).toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
        : new Decimal(0);
    return {
      warehouseId: row.warehouseId,
      warehouseName: row.warehouseName,
      productId: row.productId,
      sku: row.sku,
      barcode: row.barcode,
      name: row.name,
      specification: row.specification,
      unit: row.unit,
      quantityOnHand: row.quantityOnHand,
      pendingInboundQuantity: row.pendingInboundQuantity,
      averageCost: averageCost.toFixed(4),
      totalCost: totalCost.toFixed(4),
      updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
    };
  }

  private mapMovement(row: MovementRow): InventoryMovementData {
    const known = STOCK_MOVEMENT_TYPES as readonly string[];
    return {
      id: row.id,
      occurredAt: row.occurredAt.toISOString(),
      // 目前只有三种来源；将来新增类型时这里会跟着枚举一起扩。
      type: (known.includes(row.sourceType) ? row.sourceType : 'ADJUSTMENT') as StockMovementType,
      direction: row.quantityDelta >= 0 ? 'IN' : 'OUT',
      quantityDelta: row.quantityDelta,
      quantityBefore: row.quantityBefore,
      quantityAfter: row.quantityAfter,
      costDelta: new Decimal(row.costDelta).toFixed(4),
      unitCost: new Decimal(row.unitCost).toFixed(4),
      totalCostBefore: new Decimal(row.totalCostBefore).toFixed(4),
      totalCostAfter: new Decimal(row.totalCostAfter).toFixed(4),
      warehouseId: row.warehouseId,
      warehouseName: row.warehouseName,
      productId: row.productId,
      sku: row.sku,
      productName: row.productName,
      unit: row.unit,
      sourceType: row.sourceType,
      sourceNo: row.sourceNo,
      sourceId: row.sourceId,
      note: row.note,
      operatorId: row.operatorId,
      operatorName: row.operatorName,
    };
  }

  private offset(page: number, pageSize: number): number {
    const skip = (page - 1) * pageSize;
    if (!Number.isSafeInteger(skip) || skip > 2147483647)
      throw new BusinessException('BAD_REQUEST');
    return skip;
  }

  /** 只写日期时，上界补到当天 23:59:59.999Z，避免"选了今天却查不到今天的流水"。 */
  private instant(value: string | undefined, field: string, endOfDay: boolean): Date | undefined {
    if (!value) return undefined;
    const text = DATE_ONLY.test(value)
      ? value + (endOfDay ? 'T23:59:59.999Z' : 'T00:00:00.000Z')
      : value;
    const date = new Date(text);
    if (Number.isNaN(date.getTime()))
      throw new BusinessException('BUSINESS_VALIDATION_FAILED', { field });
    return date;
  }

  private assertRange(from?: Date, to?: Date): void {
    if (from && to && from.getTime() > to.getTime())
      throw new BusinessException('BUSINESS_VALIDATION_FAILED', {
        field: 'from',
        reason: 'RANGE_REVERSED',
      });
  }
}
