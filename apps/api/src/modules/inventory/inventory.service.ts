import { Injectable } from '@nestjs/common';
import {
  ADJUSTMENT_REASON_LABELS,
  STOCK_MOVEMENT_TYPES,
  type AdjustmentReason,
  type InventoryBalanceData,
  type InventoryMovementData,
  type InventoryPendingData,
  type InventorySummaryData,
  type PurchasePlatform,
  type PurchaseStatus,
  type StockMovementType,
} from '@caicang/api-contract';
import { Prisma } from '../../generated/prisma/client.js';
import { BusinessException } from '../../common/errors.js';
import { PageResult } from '../../common/response.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { TenantContextService, type TenantContext } from '../../common/tenancy/tenant-context.js';
import type {
  InventoryBalanceQueryDto,
  InventoryMovementQueryDto,
  InventoryPendingQueryDto,
} from './inventory.dto.js';

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
  lastReceivedAt: Date | null;
  updatedAt: Date | null;
}

interface SummaryRow {
  warehouseId: string;
  warehouseName: string;
  skuCount: number;
  quantityOnHand: number;
  totalCost: string;
  pendingInboundQuantity: number;
  lastReceivedAt: Date | null;
}

interface PendingRow {
  purchaseOrderId: string;
  orderNo: string;
  status: string;
  platform: string;
  purchaseDate: string | null;
  warehouseId: string;
  warehouseName: string;
  productId: string;
  sku: string;
  name: string;
  unit: string;
  orderedQuantity: number;
  receivedQuantity: number;
  pendingQuantity: number;
  unitPrice: string;
  pendingAmount: string;
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
  sourceDocumentId: string | null;
  note: string | null;
  /** 调整流水的来源原因；用于在备注为空时显示可读的原因而不是空白。 */
  adjustmentReason: string | null;
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
          lr.received_at AS "lastReceivedAt",
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
          COALESCE(r.receipt_no, o.outbound_no, sa.adjustment_no, pr.return_no) AS "sourceNo",
          m.source_item_id::text AS "sourceId",
          COALESCE(r.id, o.id, sa.id, pr.id)::text AS "sourceDocumentId",
          COALESCE(r.remark, o.remark, sa.remark, pr.remark) AS "note",
          sa.reason AS "adjustmentReason",
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

  /** 库存总览：全仓合计 + 分仓明细，全部来自同一个读事务，保证卡片与明细自洽。 */
  async summary(context: TenantContext): Promise<InventorySummaryData> {
    return this.contexts.run(context, 'products:read', false, async (tx, current) => {
      const tenantId = current.tenantId;
      const [counted, rows] = await Promise.all([
        tx.$queryRaw<{ count: bigint }[]>(Prisma.sql`
          ${this.balanceWith(tenantId)}
          SELECT COUNT(DISTINCT product_id)::bigint AS count FROM keys`),
        tx.$queryRaw<SummaryRow[]>(Prisma.sql`
          ${this.balanceWith(tenantId)},
          rows AS (
            SELECT k.warehouse_id, w.name AS warehouse_name,
                   COALESCE(b.quantity_on_hand, 0) AS quantity_on_hand,
                   COALESCE(b.total_cost, 0) AS total_cost,
                   COALESCE(pd.qty, 0) AS pending_qty,
                   lr.received_at
            FROM keys k
            JOIN warehouses w ON w.tenant_id = ${tenantId}::uuid AND w.id = k.warehouse_id
            JOIN products p ON p.tenant_id = ${tenantId}::uuid AND p.id = k.product_id
            LEFT JOIN stock_balances b
              ON b.tenant_id = ${tenantId}::uuid
             AND b.warehouse_id = k.warehouse_id
             AND b.product_id = k.product_id
            LEFT JOIN pending pd
              ON pd.warehouse_id = k.warehouse_id AND pd.product_id = k.product_id
            LEFT JOIN last_receipt lr
              ON lr.warehouse_id = k.warehouse_id AND lr.product_id = k.product_id
          )
          SELECT warehouse_id::text AS "warehouseId",
                 warehouse_name AS "warehouseName",
                 COUNT(*)::int AS "skuCount",
                 SUM(quantity_on_hand)::int AS "quantityOnHand",
                 SUM(total_cost)::text AS "totalCost",
                 SUM(pending_qty)::int AS "pendingInboundQuantity",
                 MAX(received_at) AS "lastReceivedAt"
          FROM rows
          GROUP BY warehouse_id, warehouse_name
          ORDER BY warehouse_name ASC`),
      ]);
      let quantity = 0,
        pending = 0,
        totalCost = new Decimal(0),
        last: Date | null = null;
      for (const row of rows) {
        quantity += row.quantityOnHand;
        pending += row.pendingInboundQuantity;
        totalCost = totalCost.add(row.totalCost);
        if (row.lastReceivedAt && (!last || row.lastReceivedAt > last)) last = row.lastReceivedAt;
      }
      const averageCost =
        quantity > 0
          ? totalCost.div(quantity).toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
          : new Decimal(0);
      return {
        totalProducts: Number(counted[0]?.count ?? 0),
        totalWarehouses: rows.length,
        quantityOnHand: quantity,
        totalCost: totalCost.toFixed(4),
        averageCost: averageCost.toFixed(4),
        pendingInboundQuantity: pending,
        lastReceivedAt: last ? last.toISOString() : null,
        warehouses: rows.map((row) => ({
          warehouseId: row.warehouseId,
          warehouseName: row.warehouseName,
          skuCount: row.skuCount,
          quantityOnHand: row.quantityOnHand,
          pendingInboundQuantity: row.pendingInboundQuantity,
          totalCost: new Decimal(row.totalCost).toFixed(4),
          lastReceivedAt: row.lastReceivedAt ? row.lastReceivedAt.toISOString() : null,
        })),
        generatedAt: new Date().toISOString(),
      };
    });
  }

  /** 待入库采购商品：已下单未收完的采购行，按仓库+商品展开，供仓库提前排位。 */
  async pending(
    context: TenantContext,
    query: InventoryPendingQueryDto,
  ): Promise<PageResult<InventoryPendingData>> {
    const skip = this.offset(query.page, query.pageSize);
    const from = this.day(query.from, 'from');
    const to = this.day(query.to, 'to');
    this.assertDayRange(from, to);
    return this.contexts.run(context, 'products:read', false, async (tx, current) => {
      const tenantId = current.tenantId;
      const where = this.pendingFilter(query, tenantId, from, to);
      const counted = await tx.$queryRaw<{ count: bigint }[]>(Prisma.sql`
        ${this.pendingFrom(tenantId)}
        SELECT COUNT(*)::bigint AS count
        ${this.pendingTail()}
        WHERE ${where}`);
      const total = Number(counted[0]?.count ?? 0);
      const rows = await tx.$queryRaw<PendingRow[]>(Prisma.sql`
        ${this.pendingFrom(tenantId)}
        SELECT po.id::text AS "purchaseOrderId",
               po.order_no AS "orderNo",
               po.status,
               po.platform,
               to_char(po.purchase_date, 'YYYY-MM-DD') AS "purchaseDate",
               po.warehouse_id::text AS "warehouseId",
               w.name AS "warehouseName",
               poi.product_id::text AS "productId",
               p.sku,
               p.name,
               p.unit,
               poi.quantity::int AS "orderedQuantity",
               COALESCE(r.received, 0)::int AS "receivedQuantity",
               (poi.quantity - COALESCE(r.received, 0))::int AS "pendingQuantity",
               poi.unit_price::text AS "unitPrice",
               ROUND((poi.quantity - COALESCE(r.received, 0)) * poi.unit_price, 4)::text AS "pendingAmount"
        ${this.pendingTail()}
        WHERE ${where}
        ORDER BY po.purchase_date ASC NULLS LAST, po.order_no ASC,
                 poi.line_no ASC NULLS LAST, poi.id ASC
        LIMIT ${query.pageSize} OFFSET ${skip}`);
      return new PageResult(
        rows.map((row) => this.mapPending(row)),
        { page: query.page, pageSize: query.pageSize, total },
      );
    });
  }

  /** 待入库的统一行集：采购行 × 已入库量，只保留还有剩余的行。 */
  private pendingFrom(tenantId: string): Prisma.Sql {
    return Prisma.sql`
      WITH received AS (
        SELECT ri.purchase_order_item_id AS item_id, SUM(ri.quantity)::bigint AS received
        FROM receipt_items ri
        WHERE ri.tenant_id = ${tenantId}::uuid
        GROUP BY ri.purchase_order_item_id
      )`;
  }

  private pendingTail(): Prisma.Sql {
    return Prisma.sql`
      FROM purchase_order_items poi
      JOIN purchase_orders po ON po.tenant_id = poi.tenant_id AND po.id = poi.purchase_order_id
      JOIN warehouses w ON w.tenant_id = poi.tenant_id AND w.id = po.warehouse_id
      JOIN products p ON p.tenant_id = poi.tenant_id AND p.id = poi.product_id
      LEFT JOIN received r ON r.item_id = poi.id`;
  }

  private pendingFilter(
    query: InventoryPendingQueryDto,
    tenantId: string,
    from?: string,
    to?: string,
  ): Prisma.Sql {
    const parts: Prisma.Sql[] = [
      Prisma.sql`poi.tenant_id = ${tenantId}::uuid`,
      Prisma.sql`po.status IN ('PLACED', 'PARTIAL_RECEIVED')`,
      Prisma.sql`poi.quantity - COALESCE(r.received, 0) > 0`,
    ];
    if (query.warehouseId) parts.push(Prisma.sql`po.warehouse_id = ${query.warehouseId}::uuid`);
    if (query.productId) parts.push(Prisma.sql`poi.product_id = ${query.productId}::uuid`);
    if (query.sku) parts.push(Prisma.sql`p.sku = ${query.sku}`);
    if (query.barcode) parts.push(Prisma.sql`p.barcode = ${query.barcode}`);
    if (query.search) {
      const like = '%' + literal(query.search) + '%';
      parts.push(
        Prisma.sql`(po.order_no ILIKE ${like} OR p.sku ILIKE ${like} OR p.name ILIKE ${like})`,
      );
    }
    if (from) parts.push(Prisma.sql`po.purchase_date >= ${from}::date`);
    if (to) parts.push(Prisma.sql`po.purchase_date <= ${to}::date`);
    return Prisma.join(parts, ' AND ');
  }

  private mapPending(row: PendingRow): InventoryPendingData {
    const known = ['DRAFT', 'PLACED', 'PARTIAL_RECEIVED', 'RECEIVED', 'CANCELLED'];
    return {
      purchaseOrderId: row.purchaseOrderId,
      orderNo: row.orderNo,
      status: (known.includes(row.status) ? row.status : 'PLACED') as PurchaseStatus,
      platform: row.platform as PurchasePlatform,
      purchaseDate: row.purchaseDate,
      warehouseId: row.warehouseId,
      warehouseName: row.warehouseName,
      productId: row.productId,
      sku: row.sku,
      name: row.name,
      unit: row.unit,
      orderedQuantity: row.orderedQuantity,
      receivedQuantity: row.receivedQuantity,
      pendingQuantity: row.pendingQuantity,
      unitPrice: new Decimal(row.unitPrice).toFixed(2),
      pendingAmount: new Decimal(row.pendingAmount).toFixed(4),
    };
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
      ), last_receipt AS (
        SELECT r.warehouse_id, ri.product_id, MAX(r.received_at) AS received_at
        FROM receipt_items ri
        JOIN receipts r ON r.tenant_id = ri.tenant_id AND r.id = ri.receipt_id
        WHERE ri.tenant_id = ${tenantId}::uuid
        GROUP BY r.warehouse_id, ri.product_id
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
      LEFT JOIN pending pd ON pd.warehouse_id = k.warehouse_id AND pd.product_id = k.product_id
      LEFT JOIN last_receipt lr
        ON lr.warehouse_id = k.warehouse_id AND lr.product_id = k.product_id`;
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
        ON m.source_type = 'ADJUSTMENT' AND sa.tenant_id = ${tenantId}::uuid AND sa.id = m.source_item_id
      LEFT JOIN purchase_return_items pri
        ON m.source_type = 'PURCHASE_RETURN' AND pri.tenant_id = ${tenantId}::uuid AND pri.id = m.source_item_id
      LEFT JOIN purchase_returns pr ON pr.tenant_id = ${tenantId}::uuid AND pr.id = pri.purchase_return_id`;
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
      lastReceivedAt: row.lastReceivedAt ? row.lastReceivedAt.toISOString() : null,
      updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
    };
  }

  private mapMovement(row: MovementRow): InventoryMovementData {
    const known = STOCK_MOVEMENT_TYPES as readonly string[];
    return {
      id: row.id,
      occurredAt: row.occurredAt.toISOString(),
      // Supplier returns remain a separate source type, never an adjustment or customer return.
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
      sourceDocumentId: row.sourceDocumentId,
      // 调整单常没有备注，回退到原因中文名，避免列表里出现空白说明或裸枚举值。
      note:
        row.note ??
        (row.adjustmentReason
          ? (ADJUSTMENT_REASON_LABELS[row.adjustmentReason as AdjustmentReason] ??
            row.adjustmentReason)
          : null),
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

  /** 采购日期是 DATE 列，这里只取日期部分（ISO 字符串按字典序即可比较）。 */
  private day(value: string | undefined, field: string): string | undefined {
    if (!value) return undefined;
    const text = value.slice(0, 10);
    if (!DATE_ONLY.test(text) || Number.isNaN(new Date(text + 'T00:00:00.000Z').getTime()))
      throw new BusinessException('BUSINESS_VALIDATION_FAILED', { field });
    return text;
  }

  private assertDayRange(from?: string, to?: string): void {
    if (from && to && from > to)
      throw new BusinessException('BUSINESS_VALIDATION_FAILED', {
        field: 'from',
        reason: 'RANGE_REVERSED',
      });
  }
}
