import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { PurchaseReturnData, PurchaseReturnStatus } from '@caicang/api-contract';
import { Prisma } from '../../generated/prisma/client.js';
import { BusinessException } from '../../common/errors.js';
import { PageResult } from '../../common/response.js';
import { TenantContextService, type TenantContext } from '../../common/tenancy/tenant-context.js';
import type {
  CreatePurchaseReturnDto,
  UpdatePurchaseReturnDto,
  PurchaseReturnLineInputDto,
  PurchaseReturnListQueryDto,
} from './purchase-return.dto.js';

const Decimal = Prisma.Decimal.clone({ precision: 60, rounding: Prisma.Decimal.ROUND_HALF_UP });
const include = {
  purchaseOrder: {
    select: {
      orderNo: true,
      purchaseOrderItem_purchaseOrderId: {
        select: { id: true, quantity: true, unitPrice: true, discountAmount: true },
      },
    },
  },
  warehouse: { select: { name: true } },
  creator: { select: { user: { select: { displayName: true } } } },
  confirmer: { select: { user: { select: { displayName: true } } } },
  items: {
    orderBy: { productId: 'asc' },
    include: {
      allocations: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        include: {
          receiptItem: { select: { receiptId: true, receipt: { select: { receiptNo: true } } } },
        },
      },
    },
  },
} satisfies Prisma.PurchaseReturnInclude;
type ReturnRow = Prisma.PurchaseReturnGetPayload<{ include: typeof include }>;
function mapReturn(row: ReturnRow, context: TenantContext): PurchaseReturnData {
  const confirmed = row.status === 'CONFIRMED';
  // Estimate goods paid only: proportional line discount, no freight or stock valuation.
  const estimates = new Map(
    row.items.map((line) => {
      const original = row.purchaseOrder.purchaseOrderItem_purchaseOrderId.find(
        (i) => i.id === line.purchaseOrderItemId,
      )!;
      return [
        line.id,
        new Decimal(original.unitPrice)
          .mul(original.quantity)
          .minus(original.discountAmount)
          .mul(line.quantity)
          .div(original.quantity)
          .toDecimalPlaces(2),
      ] as const;
    }),
  );
  const receivedCost = row.items
    .flatMap((line) => line.allocations)
    .reduce((sum, a) => sum.plus(new Decimal(a.receivedUnitCost).mul(a.quantity)), new Decimal(0));
  return {
    id: row.id,
    estimatedRefundAmount: [...estimates.values()]
      .reduce((sum, amount) => sum.plus(amount), new Decimal(0))
      .toFixed(2),
    tenantId: row.tenantId,
    purchaseOrderId: row.purchaseOrderId,
    purchaseOrderNo: row.purchaseOrder.orderNo,
    warehouseId: row.warehouseId,
    warehouseName: row.warehouse.name,
    returnNo: row.returnNo,
    status: row.status as PurchaseReturnStatus,
    reason: context.role === 'VIEWER' ? '[已隐藏]' : row.reason,
    returnDate: row.returnDate.toISOString().slice(0, 10),
    refundAmount: row.refundAmount.toFixed(2),
    stockCost: confirmed
      ? row.items.reduce((sum, line) => sum.plus(line.stockCost ?? 0), new Decimal(0)).toFixed(4)
      : null,
    receivedCost: confirmed ? receivedCost.toFixed(4) : null,
    remark: context.role === 'VIEWER' ? null : row.remark,
    createdBy: row.createdBy,
    createdByName: row.creator.user.displayName,
    confirmedBy: row.confirmedBy,
    confirmedByName: row.confirmer?.user.displayName ?? null,
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    confirmOperationId: row.confirmOperationId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    items: row.items.map((line) => ({
      id: line.id,
      estimatedRefundAmount: estimates.get(line.id)!.toFixed(2),
      purchaseOrderItemId: line.purchaseOrderItemId,
      productId: line.productId,
      requestedReceiptItemId: line.requestedReceiptItemId,
      sku: line.skuSnapshot,
      name: line.nameSnapshot,
      unit: line.unitSnapshot,
      quantity: line.quantity,
      stockUnitCost: line.stockUnitCost?.toFixed(4) ?? null,
      stockCost: line.stockCost?.toFixed(4) ?? null,
      allocations: line.allocations.map((a) => ({
        id: a.id,
        receiptId: a.receiptItem.receiptId,
        receiptNo: a.receiptItem.receipt.receiptNo,
        receiptItemId: a.receiptItemId,
        quantity: a.quantity,
        receivedUnitCost: a.receivedUnitCost.toFixed(4),
        receivedCost: new Decimal(a.receivedUnitCost).mul(a.quantity).toFixed(4),
      })),
    })),
  };
}
const canonicalConfirm = (id: string) =>
  createHash('sha256')
    .update(
      JSON.stringify({ action: 'CONFIRM_PURCHASE_RETURN', purchaseReturnId: id.toLowerCase() }),
    )
    .digest('hex');
const literal = (text: string) => text.replace(/[\\%_]/g, '\\$&');

@Injectable()
export class PurchaseReturnsService {
  constructor(private readonly contexts: TenantContextService) {}
  private async find(tx: Prisma.TransactionClient, tenantId: string, id: string) {
    const row = await tx.purchaseReturn.findUnique({
      where: { tenantId_id: { tenantId, id } },
      include,
    });
    if (!row) throw new BusinessException('NOT_FOUND');
    return row;
  }
  private async order(tx: Prisma.TransactionClient, tenantId: string, id: string, lock = false) {
    if (lock)
      await tx.$queryRaw`SELECT id FROM purchase_orders WHERE tenant_id=${tenantId}::uuid AND id=${id}::uuid FOR UPDATE`;
    const row = await tx.purchaseOrder.findUnique({
      where: { tenantId_id: { tenantId, id } },
      include: {
        purchaseOrderItem_purchaseOrderId: {
          include: { product: { select: { sku: true, name: true, unit: true } } },
          orderBy: { productId: 'asc' },
        },
      },
    });
    if (!row) throw new BusinessException('NOT_FOUND');
    return row;
  }
  private async locked(tx: Prisma.TransactionClient, tenantId: string, id: string) {
    const initial = await this.find(tx, tenantId, id);
    // Same hierarchy as receiving: tenant -> original purchase order -> business document -> balances.
    await this.order(tx, tenantId, initial.purchaseOrderId, true);
    await tx.$queryRaw`SELECT id FROM purchase_returns WHERE tenant_id=${tenantId}::uuid AND id=${id}::uuid FOR UPDATE`;
    return this.find(tx, tenantId, id);
  }
  private async available(tx: Prisma.TransactionClient, tenantId: string, purchaseOrderId: string) {
    const order = await this.order(tx, tenantId, purchaseOrderId);
    const receipts = await tx.receiptItem.findMany({
      where: { tenantId, purchaseOrderId, receipt: { status: 'CONFIRMED' } },
      include: { receipt: { select: { id: true, receiptNo: true, receivedAt: true } } },
      orderBy: [{ receipt: { receivedAt: 'asc' } }, { id: 'asc' }],
    });
    const returned = await tx.purchaseReturnItem.groupBy({
      by: ['purchaseOrderItemId'],
      where: { tenantId, purchaseOrderId, purchaseReturn: { status: 'CONFIRMED' } },
      _sum: { quantity: true },
    });
    const allocated = await tx.purchaseReturnAllocation.groupBy({
      by: ['receiptItemId'],
      where: {
        tenantId,
        purchaseOrderId,
        purchaseReturnItem: { purchaseReturn: { status: 'CONFIRMED' } },
      },
      _sum: { quantity: true },
    });
    const balances = await tx.stockBalance.findMany({
      where: {
        tenantId,
        warehouseId: order.warehouseId,
        productId: { in: order.purchaseOrderItem_purchaseOrderId.map((line) => line.productId) },
      },
      select: { productId: true, quantityOnHand: true },
    });
    const sourceReturned = new Map(
      allocated.map((row) => [row.receiptItemId, row._sum.quantity ?? 0]),
    );
    return {
      order,
      receipts,
      sourceReturned,
      items: order.purchaseOrderItem_purchaseOrderId.map((line) => {
        const sources = receipts.filter((r) => r.purchaseOrderItemId === line.id),
          receivedQuantity = sources.reduce((sum, r) => sum + r.quantity, 0),
          returnedQuantity =
            returned.find((r) => r.purchaseOrderItemId === line.id)?._sum.quantity ?? 0;
        return {
          purchaseOrderItemId: line.id,
          productId: line.productId,
          sku: line.skuSnapshot ?? line.product.sku,
          name: line.nameSnapshot ?? line.product.name,
          unit: line.unitSnapshot ?? line.product.unit,
          orderedQuantity: line.quantity,
          purchaseNetAmount: new Decimal(line.unitPrice)
            .mul(line.quantity)
            .minus(line.discountAmount)
            .toFixed(2),
          receivedQuantity,
          returnedQuantity,
          availableQuantity: Math.max(0, receivedQuantity - returnedQuantity),
          stockQuantity: balances.find((b) => b.productId === line.productId)?.quantityOnHand ?? 0,
          receipts: sources.map((r) => ({
            receiptId: r.receiptId,
            receiptNo: r.receipt.receiptNo,
            receiptItemId: r.id,
            receivedAt: r.receipt.receivedAt.toISOString(),
            receivedQuantity: r.quantity,
            returnedQuantity: sourceReturned.get(r.id) ?? 0,
            availableQuantity: Math.max(0, r.quantity - (sourceReturned.get(r.id) ?? 0)),
          })),
        };
      }),
    };
  }
  private async plan(
    tx: Prisma.TransactionClient,
    tenantId: string,
    purchaseOrderId: string,
    requested: PurchaseReturnLineInputDto[],
  ) {
    const availability = await this.available(tx, tenantId, purchaseOrderId);
    const seen = new Set<string>();
    const lines = requested.map((input) => {
      const id = input.purchaseOrderItemId.toLowerCase();
      if (seen.has(id)) throw new BusinessException('BUSINESS_VALIDATION_FAILED');
      seen.add(id);
      const source = availability.items.find((line) => line.purchaseOrderItemId === id);
      if (!source) throw new BusinessException('NOT_FOUND');
      const receiptId = input.receiptItemId?.toLowerCase();
      if (receiptId && !source.receipts.some((r) => r.receiptItemId === receiptId))
        throw new BusinessException('NOT_FOUND');
      let remaining = input.quantity;
      const allocations: {
        receiptItemId: string;
        quantity: number;
        receivedUnitCost: Prisma.Decimal;
      }[] = [];
      for (const receipt of availability.receipts.filter(
        (r) => r.purchaseOrderItemId === id && (!receiptId || r.id === receiptId),
      )) {
        const take = Math.min(
          remaining,
          Math.max(0, receipt.quantity - (availability.sourceReturned.get(receipt.id) ?? 0)),
        );
        if (take > 0)
          allocations.push({
            receiptItemId: receipt.id,
            quantity: take,
            receivedUnitCost: receipt.landedUnitCost,
          });
        remaining -= take;
        if (remaining === 0) break;
      }
      if (input.quantity > source.availableQuantity || remaining > 0)
        throw new BusinessException('PURCHASE_RETURN_QTY_EXCEEDED', {
          purchaseOrderItemId: id,
          receivedQuantity: source.receivedQuantity,
          returnedQuantity: source.returnedQuantity,
          availableQuantity: receiptId
            ? source.receipts.find((r) => r.receiptItemId === receiptId)!.availableQuantity
            : source.availableQuantity,
          requestedQuantity: input.quantity,
        });
      return {
        ...source,
        quantity: input.quantity,
        requestedReceiptItemId: receiptId ?? null,
        allocations,
      };
    });
    return { order: availability.order, lines };
  }
  private async audit(
    tx: Prisma.TransactionClient,
    context: TenantContext,
    action: string,
    row: ReturnRow,
    requestId: string,
    before?: ReturnRow,
  ) {
    const state = (r: ReturnRow) => ({
      status: r.status,
      refundAmount: r.refundAmount.toFixed(2),
      items: r.items.map((i) => ({
        id: i.id,
        purchaseOrderItemId: i.purchaseOrderItemId,
        quantity: i.quantity,
        requestedReceiptItemId: i.requestedReceiptItemId,
        stockUnitCost: i.stockUnitCost?.toFixed(4) ?? null,
        stockCost: i.stockCost?.toFixed(4) ?? null,
        allocations: i.allocations.map((a) => ({
          receiptItemId: a.receiptItemId,
          quantity: a.quantity,
          receivedUnitCost: a.receivedUnitCost.toFixed(4),
        })),
      })),
    });
    await tx.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorId: context.userId,
        action,
        objectType: 'purchase_return',
        objectId: row.id,
        metadata: {
          requestId,
          purchaseOrderId: row.purchaseOrderId,
          returnNo: row.returnNo,
          ...(before ? { before: state(before) } : {}),
          after: state(row),
        },
      },
    });
  }
  async returnable(context: TenantContext, id: string) {
    return this.contexts.run(context, 'purchase:read', false, async (tx, current) => {
      const result = await this.available(tx, current.tenantId, id);
      return {
        purchaseOrderId: result.order.id,
        orderNo: result.order.orderNo,
        warehouseId: result.order.warehouseId,
        items: result.items,
      };
    });
  }
  async list(context: TenantContext, query: PurchaseReturnListQueryDto) {
    const skip = (query.page - 1) * query.pageSize;
    if (
      !Number.isSafeInteger(skip) ||
      skip > 2147483647 ||
      (query.from && query.to && query.from > query.to)
    )
      throw new BusinessException('BAD_REQUEST');
    return this.contexts.run(context, 'purchase:read', false, async (tx, current) => {
      const where: Prisma.PurchaseReturnWhereInput = { tenantId: current.tenantId };
      if (query.purchaseOrderId) where.purchaseOrderId = query.purchaseOrderId;
      if (query.status) where.status = query.status;
      if (query.from || query.to)
        where.returnDate = {
          ...(query.from ? { gte: new Date(query.from + 'T00:00:00Z') } : {}),
          ...(query.to ? { lte: new Date(query.to + 'T00:00:00Z') } : {}),
        };
      if (query.search) {
        const search = { contains: literal(query.search), mode: 'insensitive' as const };
        where.OR = [
          { returnNo: search },
          { purchaseOrder: { orderNo: search } },
          { items: { some: { OR: [{ skuSnapshot: search }, { nameSnapshot: search }] } } },
        ];
      }
      const total = await tx.purchaseReturn.count({ where });
      const rows = await tx.purchaseReturn.findMany({
        where,
        include,
        skip,
        take: query.pageSize,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      return new PageResult(
        rows.map((row) => mapReturn(row, current)),
        { page: query.page, pageSize: query.pageSize, total },
      );
    });
  }
  async detail(context: TenantContext, id: string) {
    return this.contexts.run(context, 'purchase:read', false, async (tx, current) =>
      mapReturn(await this.find(tx, current.tenantId, id), current),
    );
  }
  async create(context: TenantContext, dto: CreatePurchaseReturnDto, requestId: string) {
    return this.contexts.run(context, 'purchase:write', true, async (tx, current) => {
      await this.order(tx, current.tenantId, dto.purchaseOrderId, true);
      const { order, lines } = await this.plan(
        tx,
        current.tenantId,
        dto.purchaseOrderId,
        dto.items,
      );
      const header = await tx.purchaseReturn.create({
        data: {
          tenantId: current.tenantId,
          purchaseOrderId: order.id,
          warehouseId: order.warehouseId,
          returnNo:
            'PR-' +
            new Date().toISOString().slice(0, 10).replaceAll('-', '') +
            '-' +
            randomBytes(6).toString('hex').toUpperCase(),
          reason: dto.reason,
          returnDate: new Date(dto.returnDate + 'T00:00:00Z'),
          refundAmount: dto.refundAmount ?? '0.00',
          remark: dto.remark?.trim() || null,
          createdBy: current.userId,
        },
      });
      await tx.purchaseReturnItem.createMany({
        data: lines.map((line) => ({
          tenantId: current.tenantId,
          purchaseReturnId: header.id,
          purchaseOrderId: order.id,
          purchaseOrderItemId: line.purchaseOrderItemId,
          productId: line.productId,
          quantity: line.quantity,
          requestedReceiptItemId: line.requestedReceiptItemId,
          skuSnapshot: line.sku,
          nameSnapshot: line.name,
          unitSnapshot: line.unit,
        })),
      });
      const row = await this.find(tx, current.tenantId, header.id);
      await this.audit(tx, current, 'PURCHASE_RETURN_CREATED', row, requestId);
      return mapReturn(row, current);
    });
  }
  async update(
    context: TenantContext,
    id: string,
    dto: UpdatePurchaseReturnDto,
    requestId: string,
  ) {
    if (
      !['reason', 'returnDate', 'refundAmount', 'remark', 'items'].some(
        (key) => dto[key as keyof UpdatePurchaseReturnDto] !== undefined,
      )
    )
      throw new BusinessException('BAD_REQUEST');
    return this.contexts.run(context, 'purchase:write', true, async (tx, current) => {
      const before = await this.locked(tx, current.tenantId, id);
      if (before.status !== 'DRAFT') throw new BusinessException('STATUS_CONFLICT');
      if (dto.items) {
        const { lines } = await this.plan(tx, current.tenantId, before.purchaseOrderId, dto.items);
        // Only unused DRAFT lines are replaced; confirmed lines and receipt allocations are immutable.
        await tx.purchaseReturnItem.deleteMany({
          where: { tenantId: current.tenantId, purchaseReturnId: id },
        });
        await tx.purchaseReturnItem.createMany({
          data: lines.map((line) => ({
            tenantId: current.tenantId,
            purchaseReturnId: id,
            purchaseOrderId: before.purchaseOrderId,
            purchaseOrderItemId: line.purchaseOrderItemId,
            productId: line.productId,
            quantity: line.quantity,
            requestedReceiptItemId: line.requestedReceiptItemId,
            skuSnapshot: line.sku,
            nameSnapshot: line.name,
            unitSnapshot: line.unit,
          })),
        });
      }
      const row = await tx.purchaseReturn.update({
        where: { tenantId_id: { tenantId: current.tenantId, id } },
        data: {
          ...(dto.reason !== undefined ? { reason: dto.reason } : {}),
          ...(dto.returnDate !== undefined
            ? { returnDate: new Date(dto.returnDate + 'T00:00:00Z') }
            : {}),
          ...(dto.refundAmount !== undefined ? { refundAmount: dto.refundAmount } : {}),
          ...(dto.remark !== undefined ? { remark: dto.remark?.trim() || null } : {}),
        },
        include,
      });
      await this.audit(tx, current, 'PURCHASE_RETURN_UPDATED', row, requestId, before);
      return mapReturn(row, current);
    });
  }
  async cancel(context: TenantContext, id: string, requestId: string) {
    return this.contexts.run(context, 'purchase:write', true, async (tx, current) => {
      const before = await this.locked(tx, current.tenantId, id);
      if (before.status === 'CANCELLED') return mapReturn(before, current);
      if (before.status !== 'DRAFT') throw new BusinessException('STATUS_CONFLICT');
      const row = await tx.purchaseReturn.update({
        where: { tenantId_id: { tenantId: current.tenantId, id } },
        data: { status: 'CANCELLED' },
        include,
      });
      await this.audit(tx, current, 'PURCHASE_RETURN_CANCELLED', row, requestId, before);
      return mapReturn(row, current);
    });
  }
  async confirm(context: TenantContext, id: string, clientOperationId: string, requestId: string) {
    return this.contexts.run(context, 'inventory:write', true, async (tx, current) => {
      const before = await this.locked(tx, current.tenantId, id),
        operationId = clientOperationId.toLowerCase(),
        hash = canonicalConfirm(id);
      const known = await tx.purchaseReturn.findUnique({
        where: {
          tenantId_confirmOperationId: {
            tenantId: current.tenantId,
            confirmOperationId: operationId,
          },
        },
        include,
      });
      if (known) {
        if (known.id !== before.id || known.confirmRequestHash?.trim() !== hash)
          throw new BusinessException('IDEMPOTENCY_CONFLICT');
        return { created: false, data: mapReturn(known, current) };
      }
      if (before.status !== 'DRAFT') throw new BusinessException('STATUS_CONFLICT');
      const { lines } = await this.plan(
        tx,
        current.tenantId,
        before.purchaseOrderId,
        before.items.map((line) => ({
          purchaseOrderItemId: line.purchaseOrderItemId,
          quantity: line.quantity,
          ...(line.requestedReceiptItemId ? { receiptItemId: line.requestedReceiptItemId } : {}),
        })),
      );
      const balances = new Map<string, { quantity_on_hand: number; total_cost: string }>();
      // All products are locked in stable order, as in receipts and outbound shipping.
      for (const line of before.items) {
        const found = await tx.$queryRaw<
          { quantity_on_hand: number; total_cost: string }[]
        >`SELECT quantity_on_hand,total_cost::text AS total_cost FROM stock_balances WHERE tenant_id=${current.tenantId}::uuid AND warehouse_id=${before.warehouseId}::uuid AND product_id=${line.productId}::uuid FOR UPDATE`;
        const balance = found[0];
        if (!balance || balance.quantity_on_hand < line.quantity)
          throw new BusinessException('OUT_OF_STOCK', {
            productId: line.productId,
            warehouseId: before.warehouseId,
            requestedQuantity: line.quantity,
            availableQuantity: balance?.quantity_on_hand ?? 0,
          });
        balances.set(line.productId, balance);
      }
      for (const line of before.items) {
        const plan = lines.find((p) => p.purchaseOrderItemId === line.purchaseOrderItemId)!,
          balance = balances.get(line.productId)!;
        const beforeCost = new Decimal(balance.total_cost),
          unitCost = beforeCost.div(balance.quantity_on_hand).toDecimalPlaces(4),
          afterQuantity = balance.quantity_on_hand - line.quantity;
        const stockCost = Decimal.min(
            beforeCost,
            afterQuantity === 0 ? beforeCost : unitCost.mul(line.quantity).toDecimalPlaces(4),
          ),
          afterCost = beforeCost.minus(stockCost);
        await tx.stockBalance.update({
          where: {
            tenantId_warehouseId_productId: {
              tenantId: current.tenantId,
              warehouseId: before.warehouseId,
              productId: line.productId,
            },
          },
          data: { quantityOnHand: afterQuantity, totalCost: afterCost },
        });
        await tx.purchaseReturnItem.update({
          where: { tenantId_id: { tenantId: current.tenantId, id: line.id } },
          data: { stockUnitCost: unitCost, stockCost },
        });
        await tx.purchaseReturnAllocation.createMany({
          data: plan.allocations.map((a) => ({
            ...a,
            tenantId: current.tenantId,
            purchaseReturnItemId: line.id,
            purchaseOrderItemId: line.purchaseOrderItemId,
            purchaseOrderId: before.purchaseOrderId,
            productId: line.productId,
          })),
        });
        await tx.stockMovement.create({
          data: {
            tenantId: current.tenantId,
            warehouseId: before.warehouseId,
            productId: line.productId,
            sourceType: 'PURCHASE_RETURN',
            sourceItemId: line.id,
            quantityDelta: -line.quantity,
            costDelta: stockCost.negated(),
            quantityBefore: balance.quantity_on_hand,
            quantityAfter: afterQuantity,
            totalCostBefore: beforeCost,
            totalCostAfter: afterCost,
            createdBy: current.userId,
          },
        });
      }
      const row = await tx.purchaseReturn.update({
        where: { tenantId_id: { tenantId: current.tenantId, id } },
        data: {
          status: 'CONFIRMED',
          confirmedBy: current.userId,
          confirmedAt: new Date(),
          confirmOperationId: operationId,
          confirmRequestHash: hash,
        },
        include,
      });
      await this.audit(tx, current, 'PURCHASE_RETURN_CONFIRMED', row, requestId, before);
      return { created: true, data: mapReturn(row, current) };
    });
  }
}
