import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { OutboundOrderData, OutboundItemData } from '@caicang/api-contract';
import { Prisma } from '../../generated/prisma/client.js';
import { BusinessException } from '../../common/errors.js';
import { PageResult } from '../../common/response.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { TenantContextService, type TenantContext } from '../../common/tenancy/tenant-context.js';
import type {
  CreateOutboundOrderDto,
  OutboundOrderListQueryDto,
  ShipOutboundOrderDto,
  UpdateOutboundOrderDto,
} from './outbound.dto.js';

// Independent precision so cost intermediates never round before the snapshot is taken.
const Decimal = Prisma.Decimal.clone({ precision: 60, rounding: Prisma.Decimal.ROUND_HALF_UP });
// LIKE wildcards stay literal so a search term cannot broaden the result set.
const literal = (value: string) => value.replace(/[\\%_]/g, '\\$&');
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
/** 只写日期时，上界补到当天 23:59:59.999Z，避免"选了今天却查不到今天的出库单"。 */
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
const outboundNo = () =>
  'OUT-' +
  new Date().toISOString().slice(0, 10).replaceAll('-', '') +
  '-' +
  randomBytes(5).toString('hex').toUpperCase();

const orderInclude = {
  warehouse: { select: { name: true } },
  createdByMembership: { select: { user: { select: { displayName: true } } } },
  shippedByMembership: { select: { user: { select: { displayName: true } } } },
  outboundOrderItem_outboundOrderId: {
    // Stable product order keeps balance locks consistent between concurrent shipments.
    orderBy: [{ productId: 'asc' }],
    include: { product: { select: { sku: true, name: true, unit: true } } },
  },
} satisfies Prisma.OutboundOrderInclude;
type OrderRow = Prisma.OutboundOrderGetPayload<{ include: typeof orderInclude }>;
/** `warehouseId:productId` → 当前可出库数量。 */
type Availability = ReadonlyMap<string, number>;
const availabilityKey = (warehouseId: string, productId: string) => warehouseId + ':' + productId;

function mapOrder(
  row: OrderRow,
  role: TenantContext['role'],
  available: Availability,
): OutboundOrderData {
  const items: OutboundItemData[] = row.outboundOrderItem_outboundOrderId.map((item) => {
    const unitCost = item.shippedUnitCost === null ? null : new Decimal(item.shippedUnitCost);
    return {
      id: item.id,
      productId: item.productId,
      sku: item.product.sku,
      name: item.product.name,
      unit: item.product.unit,
      quantity: item.quantity,
      shippedUnitCost: unitCost ? unitCost.toFixed(4) : null,
      lineCost: unitCost ? unitCost.mul(item.quantity).toFixed(4) : null,
      availableQuantity: available.get(availabilityKey(row.warehouseId, item.productId)) ?? 0,
    };
  });
  return {
    id: row.id,
    tenantId: row.tenantId,
    outboundNo: row.outboundNo,
    status: row.status as OutboundOrderData['status'],
    warehouseId: row.warehouseId,
    warehouseName: row.warehouse.name,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    customerAddress: row.customerAddress,
    carrierCode: row.carrierCode,
    trackingNo: row.trackingNo,
    // Same rule as receipts and packages: the viewer role never sees free-text notes.
    remark: role === 'VIEWER' ? null : row.remark,
    createdBy: row.createdBy,
    createdByName: row.createdByMembership.user.displayName,
    shippedBy: row.shippedBy,
    shippedByName: row.shippedByMembership?.user.displayName ?? null,
    confirmOperationId: row.confirmOperationId,
    shippedAt: row.shippedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
    totalCost: items
      .reduce(
        (sum, item) => (item.lineCost === null ? sum : sum.plus(item.lineCost)),
        new Decimal(0),
      )
      .toFixed(4),
    items,
  };
}
/** Stable canonical payload of the shipping facts only; derived fields are excluded. */
function shipHash(id: string, dto: ShipOutboundOrderDto): string {
  const payload = {
    outboundOrderId: id.toLowerCase(),
    carrierCode: dto.carrierCode?.trim() || null,
    trackingNo: dto.trackingNo?.trim() || null,
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

@Injectable()
export class OutboundOrdersService {
  constructor(
    private readonly contexts: TenantContextService,
    private readonly prisma: PrismaService,
  ) {}

  private async find(tx: Prisma.TransactionClient, tenantId: string, id: string) {
    const row = await tx.outboundOrder.findUnique({
      where: { tenantId_id: { tenantId, id } },
      include: orderInclude,
    });
    if (!row) throw new BusinessException('NOT_FOUND');
    return row;
  }
  private async findByOperation(
    tx: Prisma.TransactionClient,
    tenantId: string,
    clientOperationId: string,
  ) {
    return tx.outboundOrder.findUnique({
      where: { tenantId_confirmOperationId: { tenantId, confirmOperationId: clientOperationId } },
      include: orderInclude,
    });
  }
  private replay(row: OrderRow, hash: string, available: Availability, context: TenantContext) {
    // Same operation id with a different payload must never be treated as a retry.
    if (row.confirmRequestHash?.trim() !== hash)
      throw new BusinessException('IDEMPOTENCY_CONFLICT', {
        clientOperationId: row.confirmOperationId,
      });
    return mapOrder(row, context.role, available);
  }
  /** 一次性取出这一页/这一单涉及的商品当前可出库数量，避免逐行查询。 */
  private async availability(
    tx: Prisma.TransactionClient,
    tenantId: string,
    rows: readonly { warehouseId: string; productIds: readonly string[] }[],
  ): Promise<Availability> {
    const warehouseIds = [...new Set(rows.map((row) => row.warehouseId))];
    const productIds = [...new Set(rows.flatMap((row) => row.productIds))];
    if (warehouseIds.length === 0 || productIds.length === 0) return new Map();
    const balances = await tx.stockBalance.findMany({
      where: { tenantId, warehouseId: { in: warehouseIds }, productId: { in: productIds } },
      select: { warehouseId: true, productId: true, quantityOnHand: true },
    });
    return new Map(
      balances.map((row) => [availabilityKey(row.warehouseId, row.productId), row.quantityOnHand]),
    );
  }
  private async availabilityOf(
    tx: Prisma.TransactionClient,
    tenantId: string,
    row: OrderRow,
  ): Promise<Availability> {
    return this.availability(tx, tenantId, [
      {
        warehouseId: row.warehouseId,
        productIds: row.outboundOrderItem_outboundOrderId.map((item) => item.productId),
      },
    ]);
  }
  /** 商品必须属于当前商家；不检查 isActive——停售商品可能仍有库存需要清出去。 */
  private async productsOf(
    tx: Prisma.TransactionClient,
    tenantId: string,
    items: readonly { productId: string }[],
  ) {
    const ids = [...new Set(items.map((item) => item.productId.toLowerCase()))];
    const products = await tx.product.findMany({
      where: { tenantId, id: { in: ids } },
      select: { id: true },
    });
    if (products.length !== ids.length)
      throw new BusinessException('BUSINESS_VALIDATION_FAILED', { field: 'items' });
  }
  private async warehouseOf(tx: Prisma.TransactionClient, tenantId: string, id: string) {
    const warehouse = await tx.warehouse.findUnique({
      where: { tenantId_id: { tenantId, id } },
      select: { id: true },
    });
    if (!warehouse) throw new BusinessException('NOT_FOUND');
  }
  /** Locks the draft row so two concurrent PATCH / ship calls cannot both act on DRAFT. */
  private async lockOrder(tx: Prisma.TransactionClient, tenantId: string, id: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM outbound_orders
      WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`;
    if (!rows[0]) throw new BusinessException('NOT_FOUND');
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

  async create(context: TenantContext, dto: CreateOutboundOrderDto, requestId: string) {
    return this.contexts.run(context, 'outbound:write', true, async (tx, current) => {
      await this.warehouseOf(tx, current.tenantId, dto.warehouseId);
      await this.productsOf(tx, current.tenantId, dto.items);
      const items = [...dto.items]
        .map((item) => ({ productId: item.productId.toLowerCase(), quantity: item.quantity }))
        .sort((a, b) => a.productId.localeCompare(b.productId));
      const created = await tx.outboundOrder.create({
        data: {
          tenantId: current.tenantId,
          outboundNo: outboundNo(),
          status: 'DRAFT',
          warehouseId: dto.warehouseId,
          customerName: dto.customerName ?? null,
          customerPhone: dto.customerPhone ?? null,
          customerAddress: dto.customerAddress ?? null,
          carrierCode: dto.carrierCode ?? null,
          trackingNo: dto.trackingNo ?? null,
          remark: dto.remark?.trim() || null,
          createdBy: current.userId,
          outboundOrderItem_outboundOrderId: { create: items },
        },
        select: { id: true, outboundNo: true, warehouseId: true },
      });
      await tx.auditLog.create({
        data: {
          tenantId: current.tenantId,
          actorId: current.userId,
          action: 'OUTBOUND_DRAFT_CREATED',
          objectType: 'outbound_order',
          objectId: created.id,
          metadata: {
            requestId,
            outboundNo: created.outboundNo,
            warehouseId: created.warehouseId,
            items,
          },
        },
      });
      const row = await this.find(tx, current.tenantId, created.id);
      return mapOrder(row, current.role, await this.availabilityOf(tx, current.tenantId, row));
    });
  }

  async update(context: TenantContext, id: string, dto: UpdateOutboundOrderDto, requestId: string) {
    const provided = Object.keys(dto).filter(
      (key) => dto[key as keyof UpdateOutboundOrderDto] !== undefined,
    );
    if (provided.length === 0)
      throw new BusinessException('BUSINESS_VALIDATION_FAILED', { field: 'body' });
    return this.contexts.run(context, 'outbound:write', true, async (tx, current) => {
      await this.lockOrder(tx, current.tenantId, id);
      const existing = await this.find(tx, current.tenantId, id);
      // A shipped order is a ledger fact; its lines and recipient must stay as shipped.
      if (existing.status !== 'DRAFT')
        throw new BusinessException('STATUS_CONFLICT', { status: existing.status });
      if (dto.warehouseId) await this.warehouseOf(tx, current.tenantId, dto.warehouseId);
      if (dto.items) await this.productsOf(tx, current.tenantId, dto.items);

      const data: Prisma.OutboundOrderUpdateInput = {};
      if (dto.warehouseId !== undefined)
        data.warehouse = {
          connect: { tenantId_id: { tenantId: current.tenantId, id: dto.warehouseId } },
        };
      if (dto.customerName !== undefined) data.customerName = dto.customerName;
      if (dto.customerPhone !== undefined) data.customerPhone = dto.customerPhone;
      if (dto.customerAddress !== undefined) data.customerAddress = dto.customerAddress;
      if (dto.carrierCode !== undefined) data.carrierCode = dto.carrierCode;
      if (dto.trackingNo !== undefined) data.trackingNo = dto.trackingNo;
      if (dto.remark !== undefined) data.remark = dto.remark?.trim() || null;
      if (Object.keys(data).length > 0)
        await tx.outboundOrder.update({
          where: { tenantId_id: { tenantId: current.tenantId, id } },
          data,
        });
      if (dto.items) {
        const items = [...dto.items]
          .map((item) => ({
            tenantId: current.tenantId,
            productId: item.productId.toLowerCase(),
            quantity: item.quantity,
          }))
          .sort((a, b) => a.productId.localeCompare(b.productId));
        await tx.outboundOrderItem.deleteMany({
          where: { tenantId: current.tenantId, outboundOrderId: id },
        });
        await tx.outboundOrderItem.createMany({
          data: items.map((item) => ({ ...item, outboundOrderId: id })),
        });
      }
      await tx.auditLog.create({
        data: {
          tenantId: current.tenantId,
          actorId: current.userId,
          action: 'OUTBOUND_DRAFT_UPDATED',
          objectType: 'outbound_order',
          objectId: id,
          metadata: {
            requestId,
            outboundNo: existing.outboundNo,
            fields: provided,
            ...(dto.items
              ? {
                  items: dto.items.map((item) => ({
                    productId: item.productId,
                    quantity: item.quantity,
                  })),
                }
              : {}),
          },
        },
      });
      const row = await this.find(tx, current.tenantId, id);
      return mapOrder(row, current.role, await this.availabilityOf(tx, current.tenantId, row));
    });
  }

  /**
   * 确认发货：一个事务内锁单 → 锁余额 → 校库存 → 扣减 + 快照成本 + 写流水 + 改状态 + 审计。
   * 任一步抛出异常，Prisma 事务整体回滚，库存、流水、审计都不会留下半条记录。
   */
  async ship(context: TenantContext, id: string, dto: ShipOutboundOrderDto, requestId: string) {
    const operationId = dto.clientOperationId.toLowerCase(),
      hash = shipHash(id, dto);
    try {
      return await this.contexts.run(context, 'outbound:write', true, async (tx, current) => {
        const known = await this.findByOperation(tx, current.tenantId, operationId);
        if (known) {
          // Reusing an operation id on another order would silently answer with the wrong order.
          if (known.id !== id)
            throw new BusinessException('IDEMPOTENCY_CONFLICT', {
              clientOperationId: known.confirmOperationId,
              outboundOrderId: known.id,
            });
          return {
            created: false,
            data: this.replay(
              known,
              hash,
              await this.availabilityOf(tx, current.tenantId, known),
              current,
            ),
          };
        }

        await this.lockOrder(tx, current.tenantId, id);
        // A concurrent retry may have committed while this request waited for the order lock.
        const raced = await this.findByOperation(tx, current.tenantId, operationId);
        if (raced) {
          if (raced.id !== id)
            throw new BusinessException('IDEMPOTENCY_CONFLICT', {
              clientOperationId: raced.confirmOperationId,
              outboundOrderId: raced.id,
            });
          return {
            created: false,
            data: this.replay(
              raced,
              hash,
              await this.availabilityOf(tx, current.tenantId, raced),
              current,
            ),
          };
        }

        const order = await this.find(tx, current.tenantId, id);
        // Requirement: a shipped or cancelled order can never be shipped again, even with a new id.
        if (order.status !== 'DRAFT')
          throw new BusinessException('STATUS_CONFLICT', { status: order.status });
        if (order.outboundOrderItem_outboundOrderId.length === 0)
          throw new BusinessException('BUSINESS_VALIDATION_FAILED', { field: 'items' });

        const customerName = order.customerName?.trim(),
          customerPhone = order.customerPhone?.trim(),
          customerAddress = order.customerAddress?.trim();
        // 没有收件人、电话、地址的"发货"不是发货，只能在草稿阶段存在。
        for (const [field, value] of [
          ['customerName', customerName],
          ['customerPhone', customerPhone],
          ['customerAddress', customerAddress],
        ] as const)
          if (!value) throw new BusinessException('BUSINESS_VALIDATION_FAILED', { field });

        const lines = order.outboundOrderItem_outboundOrderId;
        const balances = new Map<string, { quantity_on_hand: number; total_cost: string }>();
        const shortages: {
          productId: string;
          sku: string;
          requestedQuantity: number;
          availableQuantity: number;
        }[] = [];
        // Items are already sorted by product id, so concurrent shipments take locks in one order.
        for (const line of lines) {
          const balance = await this.lockBalance(
            tx,
            current.tenantId,
            order.warehouseId,
            line.productId,
          );
          balances.set(line.productId, balance);
          if (balance.quantity_on_hand < line.quantity)
            shortages.push({
              productId: line.productId,
              sku: line.product.sku,
              requestedQuantity: line.quantity,
              availableQuantity: balance.quantity_on_hand,
            });
        }
        // Check every line before writing anything: the response then names all offending SKUs at once.
        if (shortages.length > 0)
          throw new BusinessException('OUT_OF_STOCK', {
            warehouseId: order.warehouseId,
            shortages,
          });

        const shippedAt = new Date(),
          snapshots: {
            outboundItemId: string;
            productId: string;
            quantity: number;
            unitCost: string;
            lineCost: string;
          }[] = [];
        for (const line of lines) {
          const balance = balances.get(line.productId)!;
          const beforeQty = balance.quantity_on_hand,
            beforeCost = new Decimal(balance.total_cost);
          // Moving weighted average at the moment of shipping, quantised to the stored scale.
          const unitCost =
            beforeQty > 0 ? beforeCost.div(beforeQty).toDecimalPlaces(4) : new Decimal(0);
          // Shipping the whole remaining stock clears the cost pool exactly, so no residue is left
          // behind on a row with zero quantity.
          const costDelta = (
            line.quantity === beforeQty ? beforeCost.neg() : unitCost.mul(line.quantity).neg()
          ).toDecimalPlaces(4);
          const afterQty = beforeQty - line.quantity;
          let afterCost = beforeCost.plus(costDelta);
          // Rounding-up averages may overshoot by a hair; never let the cost pool go negative.
          if (afterCost.lt(0)) afterCost = new Decimal(0);
          const appliedDelta = afterCost.minus(beforeCost);

          await tx.stockBalance.update({
            where: {
              tenantId_warehouseId_productId: {
                tenantId: current.tenantId,
                warehouseId: order.warehouseId,
                productId: line.productId,
              },
            },
            data: { quantityOnHand: afterQty, totalCost: afterCost },
          });
          await tx.outboundOrderItem.update({
            where: { tenantId_id: { tenantId: current.tenantId, id: line.id } },
            data: { shippedUnitCost: unitCost },
          });
          await tx.stockMovement.create({
            data: {
              tenantId: current.tenantId,
              warehouseId: order.warehouseId,
              productId: line.productId,
              sourceType: 'OUTBOUND',
              sourceItemId: line.id,
              quantityDelta: -line.quantity,
              costDelta: appliedDelta,
              quantityBefore: beforeQty,
              quantityAfter: afterQty,
              totalCostBefore: beforeCost,
              totalCostAfter: afterCost,
              createdBy: current.userId,
            },
          });
          snapshots.push({
            outboundItemId: line.id,
            productId: line.productId,
            quantity: line.quantity,
            unitCost: unitCost.toFixed(4),
            lineCost: unitCost.mul(line.quantity).toFixed(4),
          });
        }

        await tx.outboundOrder.update({
          where: { tenantId_id: { tenantId: current.tenantId, id } },
          data: {
            status: 'SHIPPED',
            shippedBy: current.userId,
            shippedAt,
            confirmOperationId: operationId,
            confirmRequestHash: hash,
            ...(dto.carrierCode === undefined ? {} : { carrierCode: dto.carrierCode }),
            ...(dto.trackingNo === undefined ? {} : { trackingNo: dto.trackingNo }),
            ...(dto.remark === undefined ? {} : { remark: dto.remark?.trim() || null }),
          },
        });
        await tx.auditLog.create({
          data: {
            tenantId: current.tenantId,
            actorId: current.userId,
            action: 'OUTBOUND_SHIPPED',
            objectType: 'outbound_order',
            objectId: id,
            metadata: {
              requestId,
              outboundNo: order.outboundNo,
              warehouseId: order.warehouseId,
              totalQuantity: snapshots.reduce((sum, line) => sum + line.quantity, 0),
              totalCost: snapshots
                .reduce((sum, line) => sum.plus(line.lineCost), new Decimal(0))
                .toFixed(4),
              items: snapshots,
            },
          },
        });

        const row = await this.find(tx, current.tenantId, id);
        return {
          created: true,
          data: mapOrder(row, current.role, await this.availabilityOf(tx, current.tenantId, row)),
        };
      });
    } catch (error) {
      // Defence in depth: two requests may both pass the pre-lock check and race on the unique key.
      if (
        [
          'outbound_orders_tenant_id_confirm_operation_id_key',
          'tenant_id,confirm_operation_id',
        ].includes(uniqueConstraint(error) ?? '')
      ) {
        const existing = await this.prisma.outboundOrder.findUnique({
          where: {
            tenantId_confirmOperationId: {
              tenantId: context.tenantId,
              confirmOperationId: operationId,
            },
          },
          include: orderInclude,
        });
        if (existing) {
          if (existing.id !== id)
            throw new BusinessException('IDEMPOTENCY_CONFLICT', {
              clientOperationId: existing.confirmOperationId,
              outboundOrderId: existing.id,
            });
          return {
            created: false,
            data: this.replay(
              existing,
              hash,
              await this.availability(this.prisma, context.tenantId, [
                {
                  warehouseId: existing.warehouseId,
                  productIds: existing.outboundOrderItem_outboundOrderId.map(
                    (item) => item.productId,
                  ),
                },
              ]),
              context,
            ),
          };
        }
      }
      throw error;
    }
  }

  async cancel(context: TenantContext, id: string, requestId: string) {
    return this.contexts.run(context, 'outbound:write', true, async (tx, current) => {
      await this.lockOrder(tx, current.tenantId, id);
      const order = await this.find(tx, current.tenantId, id);
      // Stock only ever moves on ship, so cancelling a draft is a pure status change.
      if (order.status === 'SHIPPED')
        throw new BusinessException('STATUS_CONFLICT', { status: 'SHIPPED' });
      if (order.status === 'CANCELLED')
        return {
          cancelled: false,
          order: mapOrder(
            order,
            current.role,
            await this.availabilityOf(tx, current.tenantId, order),
          ),
        };
      await tx.outboundOrder.update({
        where: { tenantId_id: { tenantId: current.tenantId, id } },
        data: { status: 'CANCELLED' },
      });
      await tx.auditLog.create({
        data: {
          tenantId: current.tenantId,
          actorId: current.userId,
          action: 'OUTBOUND_CANCELLED',
          objectType: 'outbound_order',
          objectId: id,
          metadata: {
            requestId,
            outboundNo: order.outboundNo,
            warehouseId: order.warehouseId,
            stockTouched: false,
          },
        },
      });
      const row = await this.find(tx, current.tenantId, id);
      return {
        cancelled: true,
        order: mapOrder(row, current.role, await this.availabilityOf(tx, current.tenantId, row)),
      };
    });
  }

  async list(context: TenantContext, query: OutboundOrderListQueryDto) {
    const skip = (query.page - 1) * query.pageSize;
    if (!Number.isSafeInteger(skip) || skip > 2147483647)
      throw new BusinessException('BAD_REQUEST');
    return this.contexts.run(context, 'products:read', false, async (tx, current) => {
      const where: Prisma.OutboundOrderWhereInput = { tenantId: current.tenantId };
      if (query.warehouseId) where.warehouseId = query.warehouseId;
      if (query.status) where.status = query.status;
      if (query.productId)
        where.outboundOrderItem_outboundOrderId = { some: { productId: query.productId } };
      const from = instant(query.from, 'from', false),
        to = instant(query.to, 'to', true);
      if (from && to && from.getTime() > to.getTime())
        throw new BusinessException('BUSINESS_VALIDATION_FAILED', {
          field: 'from',
          reason: 'RANGE_REVERSED',
        });
      if (from || to)
        where.createdAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
      if (query.search) {
        const search = { contains: literal(query.search), mode: 'insensitive' as const };
        where.OR = [
          { outboundNo: search },
          { trackingNo: search },
          { customerName: search },
          { customerPhone: search },
        ];
      }
      const total = await tx.outboundOrder.count({ where });
      const rows = await tx.outboundOrder.findMany({
        where,
        include: orderInclude,
        skip,
        take: query.pageSize,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      const available = await this.availability(
        tx,
        current.tenantId,
        rows.map((row) => ({
          warehouseId: row.warehouseId,
          productIds: row.outboundOrderItem_outboundOrderId.map((item) => item.productId),
        })),
      );
      return new PageResult(
        rows.map((row) => mapOrder(row, current.role, available)),
        { page: query.page, pageSize: query.pageSize, total },
      );
    });
  }

  async detail(context: TenantContext, id: string) {
    return this.contexts.run(context, 'products:read', false, async (tx, current) => {
      const row = await this.find(tx, current.tenantId, id);
      return mapOrder(row, current.role, await this.availabilityOf(tx, current.tenantId, row));
    });
  }
}
