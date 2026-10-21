import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PurchaseOrderData, PurchasePlatform, PurchaseStatus } from '@caicang/api-contract';
import { Prisma } from '../../generated/prisma/client.js';
import { BusinessException } from '../../common/errors.js';
import { PageResult } from '../../common/response.js';
import { TenantContextService, type TenantContext } from '../../common/tenancy/tenant-context.js';
import type { CreatePurchaseDto, UpdatePurchaseDto, PurchaseListQueryDto } from './purchase.dto.js';
import { purchaseCost } from './purchase-cost.js';

const include = {
  purchaseOrderItem_purchaseOrderId: {
    orderBy: [{ lineNo: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    include: {
      product: { select: { sku: true, name: true, unit: true } },
      receiptItem_productId: { select: { quantity: true } },
    },
  },
} satisfies Prisma.PurchaseOrderInclude;
type Order = Prisma.PurchaseOrderGetPayload<{ include: typeof include }>;
const fields = [
  'orderNo',
  'warehouseId',
  'platform',
  'platformOrderNo',
  'supplierName',
  'purchaseDate',
  'recipient',
  'freightAmount',
  'remark',
  'items',
] as const;
const literal = (value: string) => value.replace(/[\\%_]/g, '\\$&');
function mapOrder(order: Order, role: TenantContext['role']): PurchaseOrderData {
  const lines = order.purchaseOrderItem_purchaseOrderId;
  const cost = purchaseCost(lines, order.freightAmount);
  const masked = role === 'VIEWER';
  const conceal = (value: string | null) => (value === null ? null : '[已隐藏]');
  return {
    id: order.id,
    tenantId: order.tenantId,
    orderNo: order.orderNo,
    warehouseId: order.warehouseId,
    platform: order.platform as PurchasePlatform,
    platformOrderNo: order.platformOrderNo,
    supplierName: order.supplierName,
    purchaseDate: order.purchaseDate?.toISOString().slice(0, 10) ?? null,
    status: order.status as PurchaseStatus,
    recipient: masked
      ? {
          name: conceal(order.recipientName),
          phone: conceal(order.recipientPhone),
          address: conceal(order.recipientAddress),
        }
      : { name: order.recipientName, phone: order.recipientPhone, address: order.recipientAddress },
    recipientMasked: masked,
    freightAmount: order.freightAmount.toFixed(2),
    goodsAmount: cost.goodsAmount,
    discountAmount: cost.discountAmount,
    totalCost: cost.totalCost,
    remark: masked ? null : order.remark,
    createdBy: order.createdBy,
    placedAt: order.placedAt?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    items: lines.map((line, index) => ({
      id: line.id,
      productId: line.productId,
      lineNo: line.lineNo,
      sku: line.skuSnapshot ?? line.product.sku,
      name: line.nameSnapshot ?? line.product.name,
      unit: line.unitSnapshot ?? line.product.unit,
      quantity: line.quantity,
      receivedQuantity: line.receiptItem_productId.reduce((sum, row) => sum + row.quantity, 0),
      unitPrice: line.unitPrice.toFixed(2),
      discountAmount: line.discountAmount.toFixed(2),
      lineNet: cost.items[index]!.lineNet,
      freightAllocated: line.freightAllocated?.toFixed(2) ?? null,
      landedUnitCost: line.landedUnitCost?.toFixed(4) ?? null,
    })),
  };
}
function auditState(order: PurchaseOrderData) {
  return {
    status: order.status,
    warehouseId: order.warehouseId,
    totalCost: order.totalCost,
    items: order.items.map((row) => ({
      id: row.id,
      productId: row.productId,
      quantity: row.quantity,
      unitPrice: row.unitPrice,
      discountAmount: row.discountAmount,
      freightAllocated: row.freightAllocated,
      landedUnitCost: row.landedUnitCost,
    })),
  };
}
function conflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    // Other unique constraints must not be mislabeled as a duplicate order number.
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
    if (
      (Array.isArray(target) && target.includes('order_no')) ||
      target === 'purchase_orders_tenant_id_order_no_key'
    )
      throw new BusinessException('PURCHASE_ORDER_NO_ALREADY_EXISTS');
  }
  throw error;
}
@Injectable()
export class PurchaseOrdersService {
  constructor(private readonly contexts: TenantContextService) {}
  private async find(tx: Prisma.TransactionClient, tenantId: string, id: string) {
    const order = await tx.purchaseOrder.findUnique({
      where: { tenantId_id: { tenantId, id } },
      include,
    });
    if (!order) throw new BusinessException('NOT_FOUND');
    return order;
  }
  private async lock(tx: Prisma.TransactionClient, tenantId: string, id: string) {
    await tx.$queryRaw`SELECT id FROM purchase_orders WHERE tenant_id=${tenantId}::uuid AND id=${id}::uuid FOR UPDATE`;
    return this.find(tx, tenantId, id);
  }
  private async validateReferences(
    tx: Prisma.TransactionClient,
    tenantId: string,
    warehouseId: string,
    productIds: string[],
  ) {
    const warehouse = await tx.warehouse.findUnique({
      where: { tenantId_id: { tenantId, id: warehouseId } },
    });
    const ids = productIds.map((id) => id.toLowerCase());
    if (new Set(ids).size !== ids.length) throw new BusinessException('BUSINESS_VALIDATION_FAILED');
    const products = await tx.product.findMany({
      where: { tenantId, id: { in: ids } },
      select: { id: true, sku: true, name: true, unit: true, isActive: true },
    });
    // Missing/foreign references are indistinguishable. Only own inactive records get a validation error.
    if (!warehouse || products.length !== ids.length) throw new BusinessException('NOT_FOUND');
    if (!warehouse.isActive || products.some((row) => !row.isActive))
      throw new BusinessException('BUSINESS_VALIDATION_FAILED');
    return new Map(products.map((row) => [row.id, row]));
  }
  private async audit(
    tx: Prisma.TransactionClient,
    context: TenantContext,
    action: string,
    result: PurchaseOrderData,
    requestId: string,
    before?: PurchaseOrderData,
  ) {
    await tx.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorId: context.userId,
        action,
        objectType: 'purchase_order',
        objectId: result.id,
        metadata: {
          requestId,
          ...(before ? { before: auditState(before) } : {}),
          after: auditState(result),
        },
      },
    });
  }
  async list(context: TenantContext, query: PurchaseListQueryDto) {
    const skip = (query.page - 1) * query.pageSize;
    if (!Number.isSafeInteger(skip) || skip > 2147483647)
      throw new BusinessException('BAD_REQUEST');
    return this.contexts.run(context, 'purchase:read', false, async (tx, current) => {
      const where: Prisma.PurchaseOrderWhereInput = { tenantId: current.tenantId };
      if (query.status) where.status = query.status;
      if (query.platform) where.platform = query.platform;
      if (query.warehouseId) where.warehouseId = query.warehouseId;
      if (query.search) {
        const search = { contains: literal(query.search), mode: 'insensitive' as const };
        where.OR = [
          { orderNo: search },
          { platformOrderNo: search },
          { supplierName: search },
          {
            purchaseOrderItem_purchaseOrderId: {
              some: { OR: [{ skuSnapshot: search }, { nameSnapshot: search }] },
            },
          },
        ];
      }
      const total = await tx.purchaseOrder.count({ where });
      const orders = await tx.purchaseOrder.findMany({
        where,
        include,
        skip,
        take: query.pageSize,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      return new PageResult(
        orders.map((order) => mapOrder(order, current.role)),
        { page: query.page, pageSize: query.pageSize, total },
      );
    });
  }
  async detail(context: TenantContext, id: string) {
    return this.contexts.run(context, 'purchase:read', false, async (tx, current) =>
      mapOrder(await this.find(tx, current.tenantId, id), current.role),
    );
  }
  async create(context: TenantContext, dto: CreatePurchaseDto, requestId: string) {
    try {
      return await this.contexts.run(context, 'purchase:write', true, async (tx, current) => {
        purchaseCost(
          dto.items.map((row) => ({ ...row, discountAmount: row.discountAmount ?? '0.00' })),
          dto.freightAmount ?? '0.00',
        );
        const products = await this.validateReferences(
          tx,
          current.tenantId,
          dto.warehouseId,
          dto.items.map((row) => row.productId),
        );
        const order = await tx.purchaseOrder.create({
          data: {
            tenantId: current.tenantId,
            createdBy: current.userId,
            orderNo: dto.orderNo ?? 'PO-' + randomUUID().replaceAll('-', ''),
            warehouseId: dto.warehouseId,
            platform: dto.platform,
            platformOrderNo: dto.platformOrderNo ?? null,
            supplierName: dto.supplierName ?? null,
            purchaseDate: new Date(dto.purchaseDate + 'T00:00:00.000Z'),
            recipientName: dto.recipient.name,
            recipientPhone: dto.recipient.phone,
            recipientAddress: dto.recipient.address,
            freightAmount: dto.freightAmount ?? '0.00',
            remark: dto.remark ?? null,
          },
          select: { id: true },
        });
        // Explicit child writes avoid Prisma nested-create ambiguity for shared composite tenant keys.
        await tx.purchaseOrderItem.createMany({
          data: dto.items.map((line, index) => {
            const p = products.get(line.productId.toLowerCase())!;
            return {
              tenantId: current.tenantId,
              purchaseOrderId: order.id,
              productId: p.id,
              lineNo: index + 1,
              skuSnapshot: p.sku,
              nameSnapshot: p.name,
              unitSnapshot: p.unit,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              discountAmount: line.discountAmount ?? '0.00',
            };
          }),
        });
        const result = mapOrder(await this.find(tx, current.tenantId, order.id), current.role);
        await this.audit(tx, current, 'PURCHASE_ORDER_CREATED', result, requestId);
        return result;
      });
    } catch (error: unknown) {
      return conflict(error);
    }
  }
  async update(context: TenantContext, id: string, dto: UpdatePurchaseDto, requestId: string) {
    if (!fields.some((field) => dto[field] !== undefined))
      throw new BusinessException('BAD_REQUEST');
    try {
      return await this.contexts.run(context, 'purchase:write', true, async (tx, current) => {
        const order = await this.lock(tx, current.tenantId, id);
        if (order.status !== 'DRAFT') throw new BusinessException('STATUS_CONFLICT');
        if (
          (await tx.package.count({
            where: { tenantId: current.tenantId, purchaseOrderId: id },
          })) ||
          (await tx.receipt.count({ where: { tenantId: current.tenantId, purchaseOrderId: id } }))
        )
          throw new BusinessException('STATUS_CONFLICT');
        const old = order.purchaseOrderItem_purchaseOrderId;
        const items =
          dto.items?.map((row) => ({
            ...row,
            productId: row.productId.toLowerCase(),
            discountAmount: row.discountAmount ?? '0.00',
          })) ??
          old.map((row) => ({
            productId: row.productId,
            quantity: row.quantity,
            unitPrice: row.unitPrice.toFixed(2),
            discountAmount: row.discountAmount.toFixed(2),
          }));
        purchaseCost(items, dto.freightAmount ?? order.freightAmount);
        const warehouseId = dto.warehouseId ?? order.warehouseId;
        const products = await this.validateReferences(
          tx,
          current.tenantId,
          warehouseId,
          items.map((row) => row.productId),
        );
        const before = mapOrder(order, current.role);
        const data = {
          orderNo: dto.orderNo ?? order.orderNo,
          warehouseId,
          platform: dto.platform ?? order.platform,
          platformOrderNo:
            dto.platformOrderNo === undefined ? order.platformOrderNo : dto.platformOrderNo,
          supplierName: dto.supplierName === undefined ? order.supplierName : dto.supplierName,
          purchaseDate: dto.purchaseDate
            ? new Date(dto.purchaseDate + 'T00:00:00.000Z')
            : order.purchaseDate,
          recipientName: dto.recipient?.name ?? order.recipientName,
          recipientPhone: dto.recipient?.phone ?? order.recipientPhone,
          recipientAddress: dto.recipient?.address ?? order.recipientAddress,
          freightAmount: new Prisma.Decimal(dto.freightAmount ?? order.freightAmount),
          remark: dto.remark === undefined ? order.remark : dto.remark,
        };
        const sameFields = Object.entries(data).every(([key, value]) => {
          if (key === 'freightAmount') return data.freightAmount.equals(order.freightAmount);
          if (key === 'purchaseDate')
            return data.purchaseDate?.getTime() === order.purchaseDate?.getTime();
          return value === order[key as keyof typeof order];
        });
        const sameLines =
          !dto.items ||
          (items.length === old.length &&
            items.every((row, index) => {
              const previous = old[index]!;
              return (
                row.productId === previous.productId &&
                row.quantity === previous.quantity &&
                new Prisma.Decimal(row.unitPrice).equals(previous.unitPrice) &&
                new Prisma.Decimal(row.discountAmount).equals(previous.discountAmount)
              );
            }));
        if (sameFields && sameLines) return before;
        if (dto.items) {
          // Remove only explicitly removed, unused DRAFT lines. Kept SKUs retain their line UUIDs.
          await tx.purchaseOrderItem.deleteMany({
            where: {
              tenantId: current.tenantId,
              purchaseOrderId: id,
              productId: { notIn: items.map((row) => row.productId) },
            },
          });
          // Clear positions before reordering, preserving the unique line-position constraint.
          await tx.purchaseOrderItem.updateMany({
            where: { tenantId: current.tenantId, purchaseOrderId: id },
            data: { lineNo: null },
          });
          for (const [index, line] of items.entries()) {
            const p = products.get(line.productId)!;
            const values = {
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              discountAmount: line.discountAmount,
              lineNo: index + 1,
              skuSnapshot: p.sku,
              nameSnapshot: p.name,
              unitSnapshot: p.unit,
              freightAllocated: null,
              landedUnitCost: null,
            };
            await tx.purchaseOrderItem.upsert({
              where: {
                tenantId_purchaseOrderId_productId: {
                  tenantId: current.tenantId,
                  purchaseOrderId: id,
                  productId: p.id,
                },
              },
              create: {
                ...values,
                tenantId: current.tenantId,
                purchaseOrderId: id,
                productId: p.id,
              },
              update: values,
            });
          }
        }
        const result = mapOrder(
          await tx.purchaseOrder.update({
            where: { tenantId_id: { tenantId: current.tenantId, id } },
            data,
            include,
          }),
          current.role,
        );
        await this.audit(tx, current, 'PURCHASE_ORDER_UPDATED', result, requestId, before);
        return result;
      });
    } catch (error: unknown) {
      return conflict(error);
    }
  }
  async place(context: TenantContext, id: string, requestId: string) {
    return this.contexts.run(context, 'purchase:write', true, async (tx, current) => {
      const order = await this.lock(tx, current.tenantId, id);
      if (order.status === 'PLACED') return mapOrder(order, current.role);
      if (order.status !== 'DRAFT') throw new BusinessException('STATUS_CONFLICT');
      if (
        (await tx.receipt.count({ where: { tenantId: current.tenantId, purchaseOrderId: id } })) ||
        (await tx.package.count({ where: { tenantId: current.tenantId, purchaseOrderId: id } }))
      )
        throw new BusinessException('STATUS_CONFLICT');
      if (
        !order.purchaseDate ||
        !order.recipientName ||
        !order.recipientPhone ||
        !order.recipientAddress
      )
        throw new BusinessException('BUSINESS_VALIDATION_FAILED');
      const lines = order.purchaseOrderItem_purchaseOrderId;
      const products = await this.validateReferences(
        tx,
        current.tenantId,
        order.warehouseId,
        lines.map((row) => row.productId),
      );
      const cost = purchaseCost(lines, order.freightAmount),
        before = mapOrder(order, current.role);
      for (const [index, line] of lines.entries()) {
        const p = products.get(line.productId)!;
        await tx.purchaseOrderItem.update({
          where: { tenantId_id: { tenantId: current.tenantId, id: line.id } },
          data: {
            freightAllocated: cost.items[index]!.freightAllocated,
            landedUnitCost: cost.items[index]!.landedUnitCost,
            skuSnapshot: p.sku,
            nameSnapshot: p.name,
            unitSnapshot: p.unit,
          },
        });
      }
      const result = mapOrder(
        await tx.purchaseOrder.update({
          where: { tenantId_id: { tenantId: current.tenantId, id } },
          data: { status: 'PLACED', placedAt: new Date() },
          include,
        }),
        current.role,
      );
      await this.audit(tx, current, 'PURCHASE_ORDER_PLACED', result, requestId, before);
      return result;
    });
  }
  async cancel(context: TenantContext, id: string, requestId: string) {
    return this.contexts.run(context, 'purchase:write', true, async (tx, current) => {
      const order = await this.lock(tx, current.tenantId, id);
      if (order.status === 'CANCELLED') return mapOrder(order, current.role);
      if (
        !['DRAFT', 'PLACED'].includes(order.status) ||
        (await tx.receipt.count({ where: { tenantId: current.tenantId, purchaseOrderId: id } })) ||
        order.purchaseOrderItem_purchaseOrderId.some((row) => row.receiptItem_productId.length)
      )
        throw new BusinessException('STATUS_CONFLICT');
      const before = mapOrder(order, current.role);
      const result = mapOrder(
        await tx.purchaseOrder.update({
          where: { tenantId_id: { tenantId: current.tenantId, id } },
          data: { status: 'CANCELLED' },
          include,
        }),
        current.role,
      );
      await this.audit(tx, current, 'PURCHASE_ORDER_CANCELLED', result, requestId, before);
      return result;
    });
  }
}
