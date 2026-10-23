import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { ReceiptData } from '@caicang/api-contract';
import { Prisma } from '../../generated/prisma/client.js';
import { BusinessException } from '../../common/errors.js';
import { PageResult } from '../../common/response.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { TenantContextService, type TenantContext } from '../../common/tenancy/tenant-context.js';
import type { CreateReceiptDto, ReceiptListQueryDto } from './receipt.dto.js';

// Independent precision so large cost intermediates never round before storage.
const Decimal = Prisma.Decimal.clone({ precision: 60, rounding: Prisma.Decimal.ROUND_HALF_UP });
// NUMERIC(20,4) upper bound; anything beyond it must fail instead of silently truncating.
const MAX_STORED_COST = new Decimal('9999999999999999.9999');
const ACTIVE_ORDER_STATUSES = ['PLACED', 'PARTIAL_RECEIVED'];
// LIKE wildcards stay literal so a search term cannot broaden the result set.
const literal = (value: string) => value.replace(/[\\%_]/g, '\\$&');
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
/** 只写日期时，上界补到当天 23:59:59.999Z，避免"选了今天却查不到今天的入库单"。 */
function instant(value: string | undefined, field: string, endOfDay: boolean): Date | undefined {
  if (!value) return undefined;
  const text = DATE_ONLY.test(value)
    ? value + (endOfDay ? 'T23:59:59.999Z' : 'T00:00:00.000Z')
    : value;
  const date = new Date(text);
  if (Number.isNaN(date.getTime()))
    throw new BusinessException('BUSINESS_VALIDATION_FAILED', { field });
  return date;
}

const receiptInclude = {
  purchaseOrder: { select: { orderNo: true, status: true } },
  package: { select: { trackingNo: true, carrierCode: true } },
  warehouse: { select: { name: true } },
  receivedByMembership: { select: { user: { select: { displayName: true } } } },
  receiptItem_purchaseOrderId: {
    // Follow the purchase order line order so item output is reproducible across environments.
    orderBy: [{ purchaseOrderItem: { lineNo: 'asc' } }, { purchaseOrderItemId: 'asc' }],
    include: {
      purchaseOrderItem: {
        include: { product: { select: { sku: true, name: true, unit: true } } },
      },
    },
  },
} satisfies Prisma.ReceiptInclude;
type ReceiptRow = Prisma.ReceiptGetPayload<{ include: typeof receiptInclude }>;
interface CreatedItem {
  item: {
    id: string;
    purchaseOrderItemId: string;
    productId: string;
    quantity: number;
    landedUnitCost: Prisma.Decimal;
  };
  productId: string;
  quantity: number;
}

function mapReceipt(row: ReceiptRow, role: TenantContext['role']): ReceiptData {
  const items = row.receiptItem_purchaseOrderId.map((item) => {
    const unitCost = new Decimal(item.landedUnitCost);
    return {
      id: item.id,
      purchaseOrderItemId: item.purchaseOrderItemId,
      productId: item.productId,
      sku: item.purchaseOrderItem.skuSnapshot ?? item.purchaseOrderItem.product.sku,
      name: item.purchaseOrderItem.nameSnapshot ?? item.purchaseOrderItem.product.name,
      unit: item.purchaseOrderItem.unitSnapshot ?? item.purchaseOrderItem.product.unit,
      quantity: item.quantity,
      landedUnitCost: unitCost.toFixed(4),
      lineCost: unitCost.mul(item.quantity).toFixed(4),
    };
  });
  return {
    id: row.id,
    tenantId: row.tenantId,
    receiptNo: row.receiptNo,
    purchaseOrderId: row.purchaseOrderId,
    purchaseOrderNo: row.purchaseOrder.orderNo,
    packageId: row.packageId,
    trackingNo: row.package.trackingNo,
    carrierCode: row.package.carrierCode,
    warehouseId: row.warehouseId,
    warehouseName: row.warehouse.name,
    status: 'CONFIRMED',
    clientOperationId: row.clientOperationId,
    receivedBy: row.receivedBy,
    receivedByName: row.receivedByMembership.user.displayName,
    // Same rule as package remarks: the viewer role never sees free-text notes.
    remark: role === 'VIEWER' ? null : row.remark,
    receivedAt: row.receivedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
    totalCost: items.reduce((sum, item) => sum.plus(item.lineCost), new Decimal(0)).toFixed(4),
    items,
  };
}
/** Stable canonical payload of the acceptance facts only; server-derived fields are excluded. */
function requestHash(dto: CreateReceiptDto): string {
  const payload = {
    packageId: dto.packageId.toLowerCase(),
    items: dto.items
      .map((item) => ({
        purchaseOrderItemId: item.purchaseOrderItemId.toLowerCase(),
        receivedQty: item.receivedQty,
      }))
      .sort((a, b) => a.purchaseOrderItemId.localeCompare(b.purchaseOrderItemId)),
    remark: dto.remark?.trim() || null,
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
function uniqueConstraint(error: unknown): string | undefined {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002')
    return undefined;
  const meta = error.meta as
    | {
        target?: unknown;
        driverAdapterError?: { cause?: { constraint?: { index?: unknown; fields?: unknown } } };
      }
    | undefined;
  const target =
    meta?.target ??
    meta?.driverAdapterError?.cause?.constraint?.index ??
    meta?.driverAdapterError?.cause?.constraint?.fields;
  if (typeof target === 'string') return target;
  if (Array.isArray(target)) return target.map(String).join(',');
  return undefined;
}
const receiptNo = () =>
  'RCV-' +
  new Date().toISOString().slice(0, 10).replaceAll('-', '') +
  '-' +
  randomBytes(5).toString('hex').toUpperCase();

@Injectable()
export class ReceiptsService {
  constructor(
    private readonly contexts: TenantContextService,
    private readonly prisma: PrismaService,
  ) {}

  private async find(tx: Prisma.TransactionClient, tenantId: string, id: string) {
    const row = await tx.receipt.findUnique({
      where: { tenantId_id: { tenantId, id } },
      include: receiptInclude,
    });
    if (!row) throw new BusinessException('NOT_FOUND');
    return row;
  }
  private async findByOperation(
    tx: Prisma.TransactionClient,
    tenantId: string,
    clientOperationId: string,
  ) {
    return tx.receipt.findUnique({
      where: { tenantId_clientOperationId: { tenantId, clientOperationId } },
      include: receiptInclude,
    });
  }
  private replay(row: ReceiptRow, hash: string, context: TenantContext): ReceiptData {
    // Same operation id with a different payload must never be treated as a retry.
    if (row.requestHash.trim() !== hash)
      throw new BusinessException('IDEMPOTENCY_CONFLICT', {
        clientOperationId: row.clientOperationId,
      });
    return mapReceipt(row, context.role);
  }
  /** Inserts the balance row when missing, then locks it: the unique key is the concurrency gate. */
  private async lockBalance(
    tx: Prisma.TransactionClient,
    tenantId: string,
    warehouseId: string,
    productId: string,
  ) {
    await tx.$executeRaw`INSERT INTO stock_balances (tenant_id, warehouse_id, product_id, quantity_on_hand, total_cost)
      VALUES (${tenantId}::uuid, ${warehouseId}::uuid, ${productId}::uuid, 0, 0)
      ON CONFLICT (tenant_id, warehouse_id, product_id) DO NOTHING`;
    const rows = await tx.$queryRaw<{ quantity_on_hand: number; total_cost: string }[]>`
      SELECT quantity_on_hand, total_cost::text AS total_cost FROM stock_balances
      WHERE tenant_id=${tenantId}::uuid AND warehouse_id=${warehouseId}::uuid AND product_id=${productId}::uuid
      FOR UPDATE`;
    if (!rows[0]) throw new BusinessException('INTERNAL_ERROR');
    return rows[0];
  }
  private async receivedTotals(
    tx: Prisma.TransactionClient,
    tenantId: string,
    purchaseOrderId: string,
  ) {
    const rows = await tx.$queryRaw<{ id: string; quantity: string }[]>`
      SELECT purchase_order_item_id AS id, SUM(quantity)::text AS quantity
      FROM receipt_items
      WHERE tenant_id=${tenantId}::uuid AND purchase_order_id=${purchaseOrderId}::uuid
      GROUP BY purchase_order_item_id`;
    return new Map(rows.map((row) => [row.id, BigInt(row.quantity)]));
  }
  private async packageTotals(tx: Prisma.TransactionClient, tenantId: string, packageId: string) {
    const rows = await tx.$queryRaw<{ id: string; quantity: string }[]>`
      SELECT ri.purchase_order_item_id AS id, SUM(ri.quantity)::text AS quantity
      FROM receipt_items ri
      JOIN receipts r ON r.tenant_id = ri.tenant_id AND r.id = ri.receipt_id
      WHERE ri.tenant_id=${tenantId}::uuid AND r.package_id=${packageId}::uuid
      GROUP BY ri.purchase_order_item_id`;
    return new Map(rows.map((row) => [row.id, BigInt(row.quantity)]));
  }
  /**
   * Confirms one acceptance. Returns `created=false` for an idempotent replay so the controller can
   * answer 200 instead of 201 without inventing a second receipt.
   */
  async create(context: TenantContext, dto: CreateReceiptDto, requestId: string) {
    const hash = requestHash(dto),
      operationId = dto.clientOperationId.toLowerCase();
    try {
      return await this.contexts.run(context, 'receiving:confirm', true, async (tx, current) => {
        const known = await this.findByOperation(tx, current.tenantId, operationId);
        if (known) return { created: false, data: this.replay(known, hash, current) };

        const initial = await tx.package.findUnique({
          where: { tenantId_id: { tenantId: current.tenantId, id: dto.packageId } },
          select: { id: true, purchaseOrderId: true },
        });
        if (!initial) throw new BusinessException('NOT_FOUND');

        // Lock hierarchy: tenant (already locked), purchase order, package, then stock rows by product.
        await tx.$queryRaw`SELECT id FROM purchase_orders WHERE tenant_id=${current.tenantId}::uuid AND id=${initial.purchaseOrderId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM packages WHERE tenant_id=${current.tenantId}::uuid AND id=${initial.id}::uuid FOR UPDATE`;

        // A concurrent retry may have committed while this request waited for the locks.
        const raced = await this.findByOperation(tx, current.tenantId, operationId);
        if (raced) return { created: false, data: this.replay(raced, hash, current) };

        const row = await tx.package.findUnique({
          where: { tenantId_id: { tenantId: current.tenantId, id: initial.id } },
          include: {
            purchaseOrder: true,
            packageExpectedItem_purchaseOrderId: true,
          },
        });
        if (!row) throw new BusinessException('NOT_FOUND');
        // A concurrent PATCH may have re-bound the package while we waited; the locked order would
        // then be the wrong one, so reject and let the client retry against the new order.
        if (row.purchaseOrderId !== initial.purchaseOrderId)
          throw new BusinessException('STATUS_CONFLICT', { reason: 'PACKAGE_MOVED' });
        const order = row.purchaseOrder;
        // Only placed orders accept goods; DRAFT, CANCELLED and already-complete orders do not.
        if (!ACTIVE_ORDER_STATUSES.includes(order.status))
          throw new BusinessException('STATUS_CONFLICT', { purchaseStatus: order.status });
        if (row.receivingClosedAt)
          throw new BusinessException('STATUS_CONFLICT', { receivingClosed: true });

        const orderLines = await tx.purchaseOrderItem.findMany({
          where: { tenantId: current.tenantId, purchaseOrderId: order.id },
        });
        const lineById = new Map(orderLines.map((line) => [line.id, line]));
        const orderReceived = await this.receivedTotals(tx, current.tenantId, order.id);
        const packageReceived = await this.packageTotals(tx, current.tenantId, row.id);
        const plan = new Map(
          row.packageExpectedItem_purchaseOrderId.map((line) => [
            line.purchaseOrderItemId,
            line.expectedQuantity,
          ]),
        );
        const hasPlan = plan.size > 0;

        const requested = dto.items.map((item) => ({
          id: item.purchaseOrderItemId.toLowerCase(),
          quantity: item.receivedQty,
        }));
        // class-validator already rejects duplicates; normalize-case duplicates must not slip through.
        if (new Set(requested.map((item) => item.id)).size !== requested.length)
          throw new BusinessException('BUSINESS_VALIDATION_FAILED', { field: 'items' });

        for (const item of requested) {
          const line = lineById.get(item.id);
          // The line must belong to this package's purchase order, in this tenant.
          if (!line) throw new BusinessException('BUSINESS_VALIDATION_FAILED', { field: 'items' });
          if (line.landedUnitCost === null)
            throw new BusinessException('BUSINESS_VALIDATION_FAILED', { field: 'landedUnitCost' });
          const received = orderReceived.get(line.id) ?? 0n,
            orderRemaining = BigInt(line.quantity) - received,
            orderMax = orderRemaining > 0n ? orderRemaining : 0n;
          if (BigInt(item.quantity) > orderMax)
            throw new BusinessException('RECEIPT_QTY_EXCEEDED', {
              purchaseOrderItemId: line.id,
              requestedQuantity: item.quantity,
              maxReceivableQuantity: Number(orderMax),
            });
          if (hasPlan) {
            const expected = plan.get(line.id);
            if (expected === undefined)
              throw new BusinessException('BUSINESS_VALIDATION_FAILED', { field: 'items' });
            const inPackage = packageReceived.get(line.id) ?? 0n,
              packageMax = BigInt(expected) - inPackage;
            if (BigInt(item.quantity) > packageMax)
              throw new BusinessException('RECEIPT_QTY_EXCEEDED', {
                purchaseOrderItemId: line.id,
                requestedQuantity: item.quantity,
                maxReceivableQuantity: Number(packageMax > 0n ? packageMax : 0n),
                scope: 'PACKAGE',
              });
          }
        }

        const receipt = await tx.receipt.create({
          data: {
            tenantId: current.tenantId,
            receiptNo: receiptNo(),
            purchaseOrderId: order.id,
            packageId: row.id,
            warehouseId: order.warehouseId,
            clientOperationId: operationId,
            requestHash: hash,
            status: 'CONFIRMED',
            receivedBy: current.userId,
            remark: dto.remark?.trim() || null,
          },
          select: { id: true, receiptNo: true },
        });
        // Stable product order keeps balance locks consistent between concurrent receipts.
        const sorted = [...requested].sort((a, b) => {
          const left = lineById.get(a.id)!.productId,
            right = lineById.get(b.id)!.productId;
          return left.localeCompare(right) || a.id.localeCompare(b.id);
        });
        const created: CreatedItem[] = [];
        for (const line of sorted) {
          const source = lineById.get(line.id)!;
          const item = await tx.receiptItem.create({
            data: {
              tenantId: current.tenantId,
              receiptId: receipt.id,
              purchaseOrderId: order.id,
              purchaseOrderItemId: source.id,
              productId: source.productId,
              quantity: line.quantity,
              landedUnitCost: new Decimal(source.landedUnitCost!),
            },
          });
          created.push({ item, productId: source.productId, quantity: line.quantity });
        }

        for (const line of created) {
          const balance = await this.lockBalance(
            tx,
            current.tenantId,
            order.warehouseId,
            line.productId,
          );
          const unitCost = new Decimal(line.item.landedUnitCost);
          // Moving weighted average: keep the exact cost pool, the average is derived on read.
          const costDelta = unitCost.mul(line.quantity),
            beforeCost = new Decimal(balance.total_cost),
            afterCost = beforeCost.plus(costDelta),
            afterQuantity = balance.quantity_on_hand + line.quantity;
          if (afterQuantity > 2147483647 || !afterCost.isFinite() || afterCost.gt(MAX_STORED_COST))
            throw new BusinessException('BUSINESS_VALIDATION_FAILED', { field: 'items' });
          await tx.stockBalance.update({
            where: {
              tenantId_warehouseId_productId: {
                tenantId: current.tenantId,
                warehouseId: order.warehouseId,
                productId: line.productId,
              },
            },
            data: { quantityOnHand: afterQuantity, totalCost: afterCost },
          });
          await tx.stockMovement.create({
            data: {
              tenantId: current.tenantId,
              warehouseId: order.warehouseId,
              productId: line.productId,
              sourceType: 'RECEIPT',
              sourceItemId: line.item.id,
              quantityDelta: line.quantity,
              costDelta,
              quantityBefore: balance.quantity_on_hand,
              quantityAfter: afterQuantity,
              totalCostBefore: beforeCost,
              totalCostAfter: afterCost,
              createdBy: current.userId,
            },
          });
        }

        const finalOrderTotals = await this.receivedTotals(tx, current.tenantId, order.id);
        const orderComplete = orderLines.every(
          (line) => (finalOrderTotals.get(line.id) ?? 0n) >= BigInt(line.quantity),
        );
        const nextOrderStatus = orderComplete ? 'RECEIVED' : 'PARTIAL_RECEIVED';
        if (order.status !== nextOrderStatus)
          await tx.purchaseOrder.update({
            where: { tenantId_id: { tenantId: current.tenantId, id: order.id } },
            data: { status: nextOrderStatus },
          });

        const finalPackageTotals = await this.packageTotals(tx, current.tenantId, row.id);
        const packageComplete =
          hasPlan &&
          [...plan.entries()].every(
            ([lineId, expected]) => (finalPackageTotals.get(lineId) ?? 0n) >= BigInt(expected),
          );
        await tx.package.update({
          where: { tenantId_id: { tenantId: current.tenantId, id: row.id } },
          data: packageComplete
            ? { status: 'RECEIVED', receivingClosedAt: new Date() }
            : { status: 'PARTIAL_RECEIVED' },
        });

        await tx.auditLog.create({
          data: {
            tenantId: current.tenantId,
            actorId: current.userId,
            action: 'RECEIPT_CONFIRMED',
            objectType: 'receipt',
            objectId: receipt.id,
            metadata: {
              requestId,
              receiptNo: receipt.receiptNo,
              packageId: row.id,
              purchaseOrderId: order.id,
              purchaseStatus: nextOrderStatus,
              packageClosed: packageComplete,
              items: created.map((line) => ({
                receiptItemId: line.item.id,
                purchaseOrderItemId: line.item.purchaseOrderItemId,
                productId: line.productId,
                quantity: line.quantity,
                landedUnitCost: line.item.landedUnitCost.toFixed(4),
              })),
            },
          },
        });

        return {
          created: true,
          data: mapReceipt(await this.find(tx, current.tenantId, receipt.id), current.role),
        };
      });
    } catch (error) {
      // Defence in depth: a cross-order retry may lose the order-lock race but still hit the key.
      if (
        ['receipts_tenant_id_client_operation_id_key', 'tenant_id,client_operation_id'].includes(
          uniqueConstraint(error) ?? '',
        )
      ) {
        const existing = await this.prisma.receipt.findUnique({
          where: {
            tenantId_clientOperationId: {
              tenantId: context.tenantId,
              clientOperationId: operationId,
            },
          },
          include: receiptInclude,
        });
        if (existing) return { created: false, data: this.replay(existing, hash, context) };
      }
      throw error;
    }
  }
  async list(context: TenantContext, query: ReceiptListQueryDto) {
    const skip = (query.page - 1) * query.pageSize;
    if (!Number.isSafeInteger(skip) || skip > 2147483647)
      throw new BusinessException('BAD_REQUEST');
    return this.contexts.run(context, 'packages:read', false, async (tx, current) => {
      const where: Prisma.ReceiptWhereInput = { tenantId: current.tenantId };
      if (query.packageId) where.packageId = query.packageId;
      if (query.purchaseOrderId) where.purchaseOrderId = query.purchaseOrderId;
      const from = instant(query.from, 'from', false),
        to = instant(query.to, 'to', true);
      if (from && to && from.getTime() > to.getTime())
        throw new BusinessException('BUSINESS_VALIDATION_FAILED', {
          field: 'from',
          reason: 'RANGE_REVERSED',
        });
      if (from || to)
        where.receivedAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
      if (query.search) {
        const search = { contains: literal(query.search), mode: 'insensitive' as const };
        where.OR = [
          { receiptNo: search },
          { purchaseOrder: { orderNo: search } },
          { package: { trackingNo: search } },
        ];
      }
      const total = await tx.receipt.count({ where });
      const rows = await tx.receipt.findMany({
        where,
        include: receiptInclude,
        skip,
        take: query.pageSize,
        orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
      });
      return new PageResult(
        rows.map((row) => mapReceipt(row, current.role)),
        { page: query.page, pageSize: query.pageSize, total },
      );
    });
  }
  async detail(context: TenantContext, id: string) {
    return this.contexts.run(context, 'packages:read', false, async (tx, current) =>
      mapReceipt(await this.find(tx, current.tenantId, id), current.role),
    );
  }
}
