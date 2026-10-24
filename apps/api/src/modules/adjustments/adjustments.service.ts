import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  ADJUSTMENT_REASON_DIRECTION,
  ADJUSTMENT_REASON_LABELS,
  type AdjustmentCostSource,
  type AdjustmentReason,
  type StockAdjustmentData,
} from '@caicang/api-contract';
import { Prisma } from '../../generated/prisma/client.js';
import { BusinessException } from '../../common/errors.js';
import { PageResult } from '../../common/response.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { TenantContextService, type TenantContext } from '../../common/tenancy/tenant-context.js';
import type { AdjustmentListQueryDto, CreateAdjustmentDto } from './adjustment.dto.js';

// 成本中间值用更高精度，落库前才量化到 NUMERIC(20,4)。
const Decimal = Prisma.Decimal.clone({ precision: 60, rounding: Prisma.Decimal.ROUND_HALF_UP });
const MAX_STORED_COST = new Decimal('9999999999999999.9999');
const MAX_QUANTITY = 2147483647;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const literal = (value: string) => value.replace(/[\\%_]/g, '\\$&');

const adjustmentInclude = {
  warehouse: { select: { name: true } },
  product: { select: { sku: true, name: true, unit: true } },
  createdByMembership: { select: { user: { select: { displayName: true, email: true } } } },
} satisfies Prisma.StockAdjustmentInclude;
type AdjustmentRow = Prisma.StockAdjustmentGetPayload<{ include: typeof adjustmentInclude }>;
const movementSelect = {
  quantityBefore: true,
  quantityAfter: true,
  costDelta: true,
  totalCostBefore: true,
  totalCostAfter: true,
} satisfies Prisma.StockMovementSelect;
type MovementFacts = Prisma.StockMovementGetPayload<{ select: typeof movementSelect }>;

/** 只把"这次调整是什么"纳入指纹；成本、余额等派生值不参与，保证重放能命中。 */
function requestHash(dto: CreateAdjustmentDto): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        warehouseId: dto.warehouseId.toLowerCase(),
        productId: dto.productId.toLowerCase(),
        quantityDelta: dto.quantityDelta,
        reason: dto.reason,
        remark: dto.remark?.trim() || null,
      }),
    )
    .digest('hex');
}
function adjustmentNo(): string {
  return (
    'ADJ-' +
    new Date().toISOString().slice(0, 10).replaceAll('-', '') +
    '-' +
    randomBytes(6).toString('hex').toUpperCase()
  );
}
function instant(value: string | undefined, endOfDay: boolean): Date | undefined {
  if (!value) return undefined;
  const text = DATE_ONLY.test(value)
    ? value + (endOfDay ? 'T23:59:59.999Z' : 'T00:00:00.000Z')
    : value;
  const date = new Date(text);
  if (Number.isNaN(date.getTime()))
    throw new BusinessException('VALIDATION_ERROR', { field: 'date' });
  return date;
}
function costSourceText(value: string | null): AdjustmentCostSource {
  return value === 'REFERENCE' || value === 'ZERO' ? value : 'AVERAGE';
}
function mapAdjustment(row: AdjustmentRow, movement?: MovementFacts | null): StockAdjustmentData {
  const unitCost = new Decimal(row.unitCostSnapshot);
  const before = movement?.quantityBefore ?? 0;
  const costDelta = movement
    ? new Decimal(movement.costDelta)
    : unitCost.mul(row.quantityDelta).toDecimalPlaces(4);
  return {
    id: row.id,
    tenantId: row.tenantId,
    // 老行没有单号（接口上线前没有写入入口），退回可读的 ID 前缀而不是空字符串。
    adjustmentNo:
      row.adjustmentNo ?? 'ADJ-' + row.id.replaceAll('-', '').slice(0, 12).toUpperCase(),
    warehouseId: row.warehouseId,
    warehouseName: row.warehouse.name,
    productId: row.productId,
    sku: row.product.sku,
    productName: row.product.name,
    unit: row.product.unit,
    quantityDelta: row.quantityDelta,
    quantityBefore: before,
    quantityAfter: movement?.quantityAfter ?? before + row.quantityDelta,
    reason: row.reason as AdjustmentReason,
    reasonLabel: ADJUSTMENT_REASON_LABELS[row.reason as AdjustmentReason] ?? row.reason,
    remark: row.remark,
    unitCost: unitCost.toFixed(4),
    costDelta: costDelta.toFixed(4),
    totalCostBefore: movement ? new Decimal(movement.totalCostBefore).toFixed(4) : '0.0000',
    totalCostAfter: movement ? new Decimal(movement.totalCostAfter).toFixed(4) : '0.0000',
    costSource: costSourceText(row.costSource),
    clientOperationId: row.clientOperationId,
    createdBy: row.createdBy,
    createdByName: row.createdByMembership.user.displayName || row.createdByMembership.user.email,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class AdjustmentsService {
  constructor(
    private readonly contexts: TenantContextService,
    private readonly prisma: PrismaService,
  ) {}

  private async findByOperation(
    tx: Prisma.TransactionClient,
    tenantId: string,
    clientOperationId: string,
  ) {
    return tx.stockAdjustment.findUnique({
      where: { tenantId_clientOperationId: { tenantId, clientOperationId } },
      include: adjustmentInclude,
    });
  }
  private async factsOf(
    tx: Prisma.TransactionClient,
    tenantId: string,
    adjustmentId: string,
  ): Promise<MovementFacts | null> {
    return tx.stockMovement.findFirst({
      where: { tenantId, sourceType: 'ADJUSTMENT', sourceItemId: adjustmentId },
      select: movementSelect,
    });
  }
  private async replay(
    tx: Prisma.TransactionClient,
    row: AdjustmentRow,
    hash: string,
  ): Promise<StockAdjustmentData> {
    // 同一操作号换内容不是重试，是两笔不同的调整，必须拒绝。
    if ((row.requestHash ?? '').trim() !== hash)
      throw new BusinessException('IDEMPOTENCY_CONFLICT', {
        clientOperationId: row.clientOperationId,
      });
    return mapAdjustment(row, await this.factsOf(tx, row.tenantId, row.id));
  }
  /** 先补行再锁行：唯一键是并发下的第一道闸，行锁保证读到的余额不会再被别人改。 */
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

  async create(context: TenantContext, dto: CreateAdjustmentDto, requestId: string) {
    const hash = requestHash(dto),
      operationId = dto.clientOperationId.toLowerCase(),
      delta = dto.quantityDelta,
      expected = ADJUSTMENT_REASON_DIRECTION[dto.reason];
    // 方向规则先于一切写操作：盘盈不能减，盘亏/损坏/丢失不能加。
    if (expected !== 0 && Math.sign(delta) !== expected)
      throw new BusinessException('ADJUSTMENT_REASON_MISMATCH', {
        reason: dto.reason,
        quantityDelta: delta,
      });

    return this.contexts.run(context, 'inventory:write', true, async (tx, current) => {
      const known = await this.findByOperation(tx, current.tenantId, operationId);
      if (known) return { created: false, data: await this.replay(tx, known, hash) };

      const warehouse = await tx.warehouse.findUnique({
        where: { tenantId_id: { tenantId: current.tenantId, id: dto.warehouseId } },
        select: { id: true },
      });
      if (!warehouse) throw new BusinessException('NOT_FOUND', { field: 'warehouseId' });
      const product = await tx.product.findUnique({
        where: { tenantId_id: { tenantId: current.tenantId, id: dto.productId } },
        select: { id: true, sku: true, referencePurchasePrice: true },
      });
      if (!product) throw new BusinessException('NOT_FOUND', { field: 'productId' });

      const balance = await this.lockBalance(tx, current.tenantId, dto.warehouseId, dto.productId);
      // 排队期间别人可能已经提交了同一个操作号。
      const raced = await this.findByOperation(tx, current.tenantId, operationId);
      if (raced) return { created: false, data: await this.replay(tx, raced, hash) };

      const beforeQty = balance.quantity_on_hand,
        beforeCost = new Decimal(balance.total_cost);
      let unitCost: Prisma.Decimal, costSource: AdjustmentCostSource, costDelta: Prisma.Decimal;

      if (delta > 0) {
        if (beforeQty > 0) {
          // 有库存时，盘盈沿用当前移动加权平均成本，不凭空改变均价。
          unitCost = beforeCost.div(beforeQty).toDecimalPlaces(4);
          costSource = 'AVERAGE';
        } else if (product.referencePurchasePrice !== null) {
          // 零库存盘盈没有均价可依，用商品参考进货价，并标记来源便于日后核对。
          unitCost = new Decimal(product.referencePurchasePrice).toDecimalPlaces(4);
          costSource = 'REFERENCE';
        } else {
          // 两者都没有：成本未知记 0，数量正确但账面价值不含这部分。
          unitCost = new Decimal(0);
          costSource = 'ZERO';
        }
        costDelta = unitCost.mul(delta).toDecimalPlaces(4);
      } else {
        const quantity = -delta;
        if (quantity > beforeQty)
          throw new BusinessException('OUT_OF_STOCK', {
            warehouseId: dto.warehouseId,
            productId: dto.productId,
            sku: product.sku,
            available: beforeQty,
            requested: quantity,
          });
        unitCost = beforeQty > 0 ? beforeCost.div(beforeQty).toDecimalPlaces(4) : new Decimal(0);
        costSource = 'AVERAGE';
        // 减到 0 必须把成本池清零，不给零数量行留尾差。
        costDelta = (
          quantity === beforeQty ? beforeCost.neg() : unitCost.mul(quantity).neg()
        ).toDecimalPlaces(4);
      }

      const afterQty = beforeQty + delta;
      let afterCost = beforeCost.plus(costDelta);
      // 四舍五入可能让成本池略低于 0，夹到 0；记账用夹取后的实际差额。
      if (afterCost.lt(0)) afterCost = new Decimal(0);
      const appliedDelta = afterCost.minus(beforeCost);
      if (afterQty > MAX_QUANTITY || !afterCost.isFinite() || afterCost.gt(MAX_STORED_COST))
        throw new BusinessException('BUSINESS_VALIDATION_FAILED', { field: 'quantityDelta' });

      const created = await tx.stockAdjustment.create({
        data: {
          tenantId: current.tenantId,
          warehouseId: dto.warehouseId,
          productId: dto.productId,
          quantityDelta: delta,
          reason: dto.reason,
          unitCostSnapshot: unitCost,
          clientOperationId: operationId,
          adjustmentNo: adjustmentNo(),
          remark: dto.remark?.trim() || null,
          requestHash: hash,
          costSource,
          createdBy: current.userId,
        },
        select: { id: true, adjustmentNo: true },
      });

      await tx.stockBalance.update({
        where: {
          tenantId_warehouseId_productId: {
            tenantId: current.tenantId,
            warehouseId: dto.warehouseId,
            productId: dto.productId,
          },
        },
        data: { quantityOnHand: afterQty, totalCost: afterCost },
      });
      await tx.stockMovement.create({
        data: {
          tenantId: current.tenantId,
          warehouseId: dto.warehouseId,
          productId: dto.productId,
          sourceType: 'ADJUSTMENT',
          sourceItemId: created.id,
          quantityDelta: delta,
          costDelta: appliedDelta,
          quantityBefore: beforeQty,
          quantityAfter: afterQty,
          totalCostBefore: beforeCost,
          totalCostAfter: afterCost,
          createdBy: current.userId,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: current.tenantId,
          actorId: current.userId,
          action: 'STOCK_ADJUSTED',
          objectType: 'stock_adjustment',
          objectId: created.id,
          // 备注可能含敏感信息，不进审计；这里只留可对账的结构化事实。
          metadata: {
            requestId,
            adjustmentNo: created.adjustmentNo,
            warehouseId: dto.warehouseId,
            productId: dto.productId,
            sku: product.sku,
            quantityDelta: delta,
            reason: dto.reason,
            unitCost: unitCost.toFixed(4),
            costDelta: appliedDelta.toFixed(4),
            quantityBefore: beforeQty,
            quantityAfter: afterQty,
            totalCostBefore: beforeCost.toFixed(4),
            totalCostAfter: afterCost.toFixed(4),
            costSource,
            clientOperationId: operationId,
          },
        },
      });

      const row = await tx.stockAdjustment.findUnique({
        where: { tenantId_id: { tenantId: current.tenantId, id: created.id } },
        include: adjustmentInclude,
      });
      if (!row) throw new BusinessException('INTERNAL_ERROR');
      return {
        created: true,
        data: mapAdjustment(row, {
          quantityBefore: beforeQty,
          quantityAfter: afterQty,
          costDelta: appliedDelta,
          totalCostBefore: beforeCost,
          totalCostAfter: afterCost,
        }),
      };
    });
  }

  async list(context: TenantContext, query: AdjustmentListQueryDto) {
    return this.contexts.run(context, 'products:read', false, async (tx, current) => {
      const from = instant(query.from, false),
        to = instant(query.to, true);
      if (from && to && from > to)
        throw new BusinessException('BUSINESS_VALIDATION_FAILED', { field: 'date' });
      const where: Prisma.StockAdjustmentWhereInput = { tenantId: current.tenantId };
      if (query.warehouseId) where.warehouseId = query.warehouseId;
      if (query.productId) where.productId = query.productId;
      if (query.reason) where.reason = query.reason;
      if (from || to)
        where.createdAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
      if (query.search?.trim()) {
        const search = literal(query.search.trim());
        where.OR = [
          { adjustmentNo: { contains: search, mode: 'insensitive' } },
          { product: { name: { contains: search, mode: 'insensitive' } } },
          { product: { sku: { contains: search, mode: 'insensitive' } } },
        ];
      }
      const total = await tx.stockAdjustment.count({ where });
      const rows = await tx.stockAdjustment.findMany({
        where,
        include: adjustmentInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      });
      // 前后余额在流水里，一次取回，避免 N+1。
      const movements = rows.length
        ? await tx.stockMovement.findMany({
            where: {
              tenantId: current.tenantId,
              sourceType: 'ADJUSTMENT',
              sourceItemId: { in: rows.map((row) => row.id) },
            },
            select: { sourceItemId: true, ...movementSelect },
          })
        : [];
      const byId = new Map(movements.map((row) => [row.sourceItemId, row]));
      return new PageResult(
        rows.map((row) => mapAdjustment(row, byId.get(row.id))),
        { page: query.page, pageSize: query.pageSize, total },
      );
    });
  }

  async detail(context: TenantContext, id: string) {
    return this.contexts.run(context, 'products:read', false, async (tx, current) => {
      const row = await tx.stockAdjustment.findUnique({
        where: { tenantId_id: { tenantId: current.tenantId, id } },
        include: adjustmentInclude,
      });
      if (!row) throw new BusinessException('NOT_FOUND');
      return mapAdjustment(row, await this.factsOf(tx, current.tenantId, row.id));
    });
  }
}
