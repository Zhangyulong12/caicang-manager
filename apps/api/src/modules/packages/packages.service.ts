import { Injectable } from '@nestjs/common';
import type {
  PackageData,
  PackageLookupData,
  PackageReceivableData,
  PackageReceivableLineData,
  PackageStatus,
  PackageReceivingStatus,
  PurchaseStatus,
} from '@caicang/api-contract';
import { Prisma } from '../../generated/prisma/client.js';
import { BusinessException } from '../../common/errors.js';
import { PageResult } from '../../common/response.js';
import { TenantContextService, type TenantContext } from '../../common/tenancy/tenant-context.js';
import type {
  CreatePackageDto,
  UpdatePackageDto,
  ExpectedItemInputDto,
  PackageListQueryDto,
} from './package.dto.js';

// LIKE wildcards must stay literal so user input cannot broaden the search.
const literal = (value: string) => value.replace(/[\\%_]/g, '\\$&');

const include = {
  purchaseOrder: { select: { id: true, orderNo: true, status: true, warehouseId: true } },
  packageExpectedItem_purchaseOrderId: {
    // Follow the purchase order line order so list/detail output is stable for clients.
    orderBy: [{ purchaseOrderItem: { lineNo: 'asc' } }, { purchaseOrderItemId: 'asc' }],
    include: {
      purchaseOrderItem: {
        include: { product: { select: { sku: true, name: true, unit: true } } },
      },
    },
  },
  receipt_purchaseOrderId: {
    select: {
      receiptItem_purchaseOrderId: { select: { purchaseOrderItemId: true, quantity: true } },
    },
  },
} satisfies Prisma.PackageInclude;
type Package = Prisma.PackageGetPayload<{ include: typeof include }>;
const activeOrders = ['PLACED', 'PARTIAL_RECEIVED'];
const transitions: Readonly<Record<string, readonly string[]>> = {
  CREATED: ['IN_TRANSIT', 'ARRIVED', 'EXCEPTION'],
  IN_TRANSIT: ['ARRIVED', 'EXCEPTION'],
  ARRIVED: ['EXCEPTION'],
  EXCEPTION: ['IN_TRANSIT', 'ARRIVED'],
};
const planKey = (items: readonly ExpectedItemInputDto[]) =>
  JSON.stringify(
    items
      .map((row) => ({
        purchaseOrderItemId: row.purchaseOrderItemId.toLowerCase(),
        expectedQuantity: row.expectedQuantity,
      }))
      .sort((a, b) => a.purchaseOrderItemId.localeCompare(b.purchaseOrderItemId)),
  );
function mapPackage(row: Package, role: TenantContext['role']): PackageData {
  const received = new Map<string, number>();
  for (const receipt of row.receipt_purchaseOrderId)
    for (const item of receipt.receiptItem_purchaseOrderId)
      received.set(
        item.purchaseOrderItemId,
        (received.get(item.purchaseOrderItemId) ?? 0) + item.quantity,
      );
  const receivedQuantity = [...received.values()].reduce((sum, value) => sum + value, 0);
  const plan = row.packageExpectedItem_purchaseOrderId;
  let receivingStatus: PackageReceivingStatus = 'NOT_RECEIVED';
  if (row.receivingClosedAt) receivingStatus = 'RECEIVED';
  else if (receivedQuantity > 0)
    receivingStatus =
      plan.length > 0 &&
      plan.every((line) => (received.get(line.purchaseOrderItemId) ?? 0) >= line.expectedQuantity)
        ? 'RECEIVED'
        : 'PARTIAL_RECEIVED';
  return {
    id: row.id,
    tenantId: row.tenantId,
    purchaseOrderId: row.purchaseOrderId,
    purchaseOrderNo: row.purchaseOrder.orderNo,
    purchaseStatus: row.purchaseOrder.status as PurchaseStatus,
    warehouseId: row.purchaseOrder.warehouseId,
    carrierCode: row.carrierCode,
    trackingNo: row.trackingNo,
    status: row.status as PackageStatus,
    receivingStatus,
    hasReceipts: row.receipt_purchaseOrderId.length > 0,
    receivedQuantity,
    receivingClosedAt: row.receivingClosedAt?.toISOString() ?? null,
    remark: role === 'VIEWER' ? null : row.remark,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    expectedItems: plan.map((line) => ({
      id: line.id,
      purchaseOrderItemId: line.purchaseOrderItemId,
      productId: line.purchaseOrderItem.productId,
      sku: line.purchaseOrderItem.skuSnapshot ?? line.purchaseOrderItem.product.sku,
      name: line.purchaseOrderItem.nameSnapshot ?? line.purchaseOrderItem.product.name,
      unit: line.purchaseOrderItem.unitSnapshot ?? line.purchaseOrderItem.product.unit,
      orderedQuantity: line.purchaseOrderItem.quantity,
      expectedQuantity: line.expectedQuantity,
      receivedQuantity: received.get(line.purchaseOrderItemId) ?? 0,
    })),
  };
}
function auditState(row: PackageData) {
  // Logistics notes/tracking numbers may contain personal data; never copy them to audit metadata.
  return {
    purchaseOrderId: row.purchaseOrderId,
    status: row.status,
    expectedItems: row.expectedItems.map((item) => ({
      purchaseOrderItemId: item.purchaseOrderItemId,
      expectedQuantity: item.expectedQuantity,
    })),
  };
}
function conflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
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
      (Array.isArray(target) && target.includes('tracking_no')) ||
      (typeof target === 'string' &&
        ['packages_tenant_id_carrier_code_tracking_no_key', 'uq_pkg_tracking'].includes(target))
    )
      throw new BusinessException('PACKAGE_TRACKING_ALREADY_EXISTS');
  }
  throw error;
}
@Injectable()
export class PackagesService {
  constructor(private readonly contexts: TenantContextService) {}
  private async find(tx: Prisma.TransactionClient, tenantId: string, id: string) {
    const row = await tx.package.findUnique({ where: { tenantId_id: { tenantId, id } }, include });
    if (!row) throw new BusinessException('NOT_FOUND');
    return row;
  }
  private async lockOrder(tx: Prisma.TransactionClient, tenantId: string, id: string) {
    await tx.$queryRaw`SELECT id FROM purchase_orders WHERE tenant_id=${tenantId}::uuid AND id=${id}::uuid FOR UPDATE`;
    const order = await tx.purchaseOrder.findUnique({
      where: { tenantId_id: { tenantId, id } },
      select: { id: true, status: true },
    });
    if (!order) throw new BusinessException('NOT_FOUND');
    return order;
  }
  private async tracking(
    tx: Prisma.TransactionClient,
    tenantId: string,
    carrierCode: string,
    trackingNo: string,
    except?: string,
  ) {
    // Also detect legacy lower-case carrier codes; new input is always normalized.
    const duplicate = await tx.package.findFirst({
      where: {
        tenantId,
        carrierCode: { equals: carrierCode, mode: 'insensitive' },
        trackingNo,
        ...(except ? { id: { not: except } } : {}),
      },
      select: { id: true },
    });
    if (duplicate) throw new BusinessException('PACKAGE_TRACKING_ALREADY_EXISTS');
  }
  private async validatePlan(
    tx: Prisma.TransactionClient,
    tenantId: string,
    purchaseOrderId: string,
    items: ExpectedItemInputDto[],
    except?: string,
  ) {
    const ids = items.map((item) => item.purchaseOrderItemId.toLowerCase());
    if (new Set(ids).size !== ids.length) throw new BusinessException('BUSINESS_VALIDATION_FAILED');
    const lines = await tx.purchaseOrderItem.findMany({
      where: { tenantId, purchaseOrderId, id: { in: ids } },
      select: { id: true, quantity: true },
    });
    if (lines.length !== ids.length) throw new BusinessException('NOT_FOUND');
    const reserved = await tx.$queryRaw<{ id: string; quantity: string }[]>(Prisma.sql`
      SELECT purchase_order_item_id AS id,SUM(expected_quantity)::text AS quantity
      FROM package_expected_items WHERE tenant_id=${tenantId}::uuid AND purchase_order_id=${purchaseOrderId}::uuid
      ${except ? Prisma.sql`AND package_id<>${except}::uuid` : Prisma.empty}
      GROUP BY purchase_order_item_id`);
    const used = new Map(reserved.map((row) => [row.id, BigInt(row.quantity)]));
    const ordered = new Map(lines.map((row) => [row.id, BigInt(row.quantity)]));
    for (const item of items)
      if (
        (used.get(item.purchaseOrderItemId.toLowerCase()) ?? 0n) + BigInt(item.expectedQuantity) >
        ordered.get(item.purchaseOrderItemId.toLowerCase())!
      )
        throw new BusinessException('PACKAGE_EXPECTED_QTY_EXCEEDED');
  }
  private async audit(
    tx: Prisma.TransactionClient,
    context: TenantContext,
    action: string,
    after: PackageData,
    requestId: string,
    before?: PackageData,
    changedFields?: string[],
  ) {
    await tx.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorId: context.userId,
        action,
        objectType: 'package',
        objectId: after.id,
        metadata: {
          requestId,
          ...(before ? { before: auditState(before) } : {}),
          after: auditState(after),
          ...(changedFields ? { changedFields } : {}),
        },
      },
    });
  }
  async detail(context: TenantContext, id: string) {
    return this.contexts.run(context, 'packages:read', false, async (tx, current) =>
      mapPackage(await this.find(tx, current.tenantId, id), current.role),
    );
  }
  async list(context: TenantContext, query: PackageListQueryDto) {
    const skip = (query.page - 1) * query.pageSize;
    if (!Number.isSafeInteger(skip) || skip > 2147483647)
      throw new BusinessException('BAD_REQUEST');
    return this.contexts.run(context, 'packages:read', false, async (tx, current) => {
      const where: Prisma.PackageWhereInput = { tenantId: current.tenantId };
      if (query.purchaseOrderId) where.purchaseOrderId = query.purchaseOrderId;
      // Legacy rows may still hold lower-case carrier codes; compare case-insensitively.
      if (query.carrierCode) where.carrierCode = { equals: query.carrierCode, mode: 'insensitive' };
      if (query.status) where.status = query.status;
      if (query.hasReceipts !== undefined)
        where.receipt_purchaseOrderId = query.hasReceipts ? { some: {} } : { none: {} };
      if (query.search) {
        const search = { contains: literal(query.search), mode: 'insensitive' as const };
        // SKU/name match the package's own plan, so an unrelated box of the same order is not listed.
        where.OR = [
          { trackingNo: search },
          { carrierCode: search },
          { purchaseOrder: { orderNo: search } },
          {
            packageExpectedItem_purchaseOrderId: {
              some: {
                purchaseOrderItem: {
                  OR: [
                    { skuSnapshot: search },
                    { nameSnapshot: search },
                    { product: { sku: search } },
                    { product: { name: search } },
                  ],
                },
              },
            },
          },
        ];
      }
      const total = await tx.package.count({ where });
      const rows = await tx.package.findMany({
        where,
        include,
        skip,
        take: query.pageSize,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      return new PageResult(
        rows.map((row) => mapPackage(row, current.role)),
        { page: query.page, pageSize: query.pageSize, total },
      );
    });
  }
  async lookup(context: TenantContext, trackingNo: string): Promise<PackageLookupData[]> {
    return this.contexts.run(context, 'packages:lookup', false, async (tx, current) => {
      const rows = await tx.package.findMany({
        where: { tenantId: current.tenantId, trackingNo },
        include,
        orderBy: [{ carrierCode: 'asc' }, { id: 'asc' }],
      });
      return rows.map((row) => {
        const result = mapPackage(row, current.role);
        return {
          packageId: result.id,
          carrierCode: result.carrierCode,
          trackingNo: result.trackingNo,
          purchaseOrderId: result.purchaseOrderId,
          purchaseOrderNo: result.purchaseOrderNo,
          packageStatus: result.status,
          receivingStatus: result.receivingStatus,
          hasReceipts: result.hasReceipts,
          receivedQuantity: result.receivedQuantity,
        };
      });
    });
  }
  async receivable(context: TenantContext, id: string): Promise<PackageReceivableData> {
    return this.contexts.run(context, 'receiving:confirm', false, async (tx, current) => {
      const row = await this.find(tx, current.tenantId, id);
      const result = mapPackage(row, current.role);
      // Order-wide receipts include every package, so a sibling box cannot be received twice.
      const totals = await tx.$queryRaw<{ id: string; quantity: string }[]>(Prisma.sql`
        SELECT purchase_order_item_id AS id, SUM(quantity)::text AS quantity
        FROM receipt_items
        WHERE tenant_id=${current.tenantId}::uuid AND purchase_order_id=${row.purchaseOrderId}::uuid
        GROUP BY purchase_order_item_id`);
      const orderReceived = new Map(totals.map((line) => [line.id, BigInt(line.quantity)]));
      const packageReceived = new Map<string, number>();
      for (const receipt of row.receipt_purchaseOrderId)
        for (const item of receipt.receiptItem_purchaseOrderId)
          packageReceived.set(
            item.purchaseOrderItemId,
            (packageReceived.get(item.purchaseOrderItemId) ?? 0) + item.quantity,
          );
      const closed = row.receivingClosedAt !== null;
      const plan = row.packageExpectedItem_purchaseOrderId;
      const hasPlan = plan.length > 0;
      const clamp = (value: bigint) => {
        const parsed = Number(value);
        return Number.isSafeInteger(parsed) ? Math.max(0, parsed) : 0;
      };
      const withRemaining = (orderedQuantity: number, received: bigint) => {
        const orderRemainingQuantity = clamp(BigInt(orderedQuantity) - received);
        return {
          orderedQuantity,
          receivedQuantity: clamp(received),
          orderRemainingQuantity,
        };
      };
      const lines: PackageReceivableLineData[] = hasPlan
        ? plan.map((line) => {
            const orderedQuantity = line.purchaseOrderItem.quantity;
            const received = orderReceived.get(line.purchaseOrderItemId) ?? 0n;
            const inPackage = packageReceived.get(line.purchaseOrderItemId) ?? 0;
            const packageRemaining = Math.max(0, line.expectedQuantity - inPackage);
            const totals = withRemaining(orderedQuantity, received);
            return {
              purchaseOrderItemId: line.purchaseOrderItemId,
              productId: line.purchaseOrderItem.productId,
              sku: line.purchaseOrderItem.skuSnapshot ?? line.purchaseOrderItem.product.sku,
              name: line.purchaseOrderItem.nameSnapshot ?? line.purchaseOrderItem.product.name,
              unit: line.purchaseOrderItem.unitSnapshot ?? line.purchaseOrderItem.product.unit,
              ...totals,
              inPackagePlan: true,
              expectedQuantity: line.expectedQuantity,
              packageReceivedQuantity: inPackage,
              packageRemainingQuantity: packageRemaining,
              maxReceivableQuantity: closed
                ? 0
                : Math.min(packageRemaining, totals.orderRemainingQuantity),
            };
          })
        : (await this.orderLines(tx, current.tenantId, row.purchaseOrderId))
            .filter((line) => (orderReceived.get(line.id) ?? 0n) < BigInt(line.quantity))
            .map((line) => {
              const totals = withRemaining(line.quantity, orderReceived.get(line.id) ?? 0n);
              return {
                purchaseOrderItemId: line.id,
                productId: line.productId,
                sku: line.skuSnapshot ?? line.product.sku,
                name: line.nameSnapshot ?? line.product.name,
                unit: line.unitSnapshot ?? line.product.unit,
                ...totals,
                inPackagePlan: false,
                expectedQuantity: null,
                packageReceivedQuantity: packageReceived.get(line.id) ?? 0,
                packageRemainingQuantity: null,
                maxReceivableQuantity: closed ? 0 : totals.orderRemainingQuantity,
              };
            });
      return {
        packageId: result.id,
        purchaseOrderId: result.purchaseOrderId,
        purchaseOrderNo: result.purchaseOrderNo,
        purchaseStatus: result.purchaseStatus,
        packageStatus: result.status,
        receivingStatus: result.receivingStatus,
        hasPlan,
        receivingClosed: closed,
        receivedQuantity: result.receivedQuantity,
        lines,
      };
    });
  }
  async completeReceiving(context: TenantContext, id: string, requestId: string) {
    return this.contexts.run(context, 'receiving:confirm', true, async (tx, current) => {
      const initial = await this.find(tx, current.tenantId, id);
      // Same hierarchy as create/update: tenant, purchase order, then package.
      const order = await this.lockOrder(tx, current.tenantId, initial.purchaseOrderId);
      await tx.$queryRaw`SELECT id FROM packages WHERE tenant_id=${current.tenantId}::uuid AND id=${id}::uuid FOR UPDATE`;
      const row = await this.find(tx, current.tenantId, id),
        before = mapPackage(row, current.role);
      // Repeating the same close is a no-op so clients can retry safely.
      if (row.receivingClosedAt) return before;
      if (row.packageExpectedItem_purchaseOrderId.length)
        throw new BusinessException('STATUS_CONFLICT');
      if (order.status === 'CANCELLED') throw new BusinessException('STATUS_CONFLICT');
      await tx.package.update({
        where: { tenantId_id: { tenantId: current.tenantId, id } },
        data: { receivingClosedAt: new Date(), status: 'RECEIVED' },
      });
      const result = mapPackage(await this.find(tx, current.tenantId, id), current.role);
      await this.audit(tx, current, 'PACKAGE_RECEIVING_CLOSED', result, requestId, before, [
        'receivingClosedAt',
        'status',
      ]);
      return result;
    });
  }
  private orderLines(tx: Prisma.TransactionClient, tenantId: string, purchaseOrderId: string) {
    return tx.purchaseOrderItem.findMany({
      where: { tenantId, purchaseOrderId },
      orderBy: [{ lineNo: 'asc' }, { id: 'asc' }],
      include: { product: { select: { sku: true, name: true, unit: true } } },
    });
  }
  async create(
    context: TenantContext,
    purchaseOrderId: string,
    dto: CreatePackageDto,
    requestId: string,
  ) {
    try {
      return await this.contexts.run(context, 'packages:write', true, async (tx, current) => {
        const order = await this.lockOrder(tx, current.tenantId, purchaseOrderId);
        if (!activeOrders.includes(order.status)) throw new BusinessException('STATUS_CONFLICT');
        const items = dto.expectedItems ?? [];
        await this.validatePlan(tx, current.tenantId, purchaseOrderId, items);
        await this.tracking(tx, current.tenantId, dto.carrierCode, dto.trackingNo);
        const row = await tx.package.create({
          data: {
            tenantId: current.tenantId,
            purchaseOrderId,
            carrierCode: dto.carrierCode,
            trackingNo: dto.trackingNo,
            remark: dto.remark ?? null,
          },
          select: { id: true },
        });
        if (items.length)
          await tx.packageExpectedItem.createMany({
            data: items.map((item) => ({
              ...item,
              purchaseOrderItemId: item.purchaseOrderItemId.toLowerCase(),
              tenantId: current.tenantId,
              purchaseOrderId,
              packageId: row.id,
            })),
          });
        const result = mapPackage(await this.find(tx, current.tenantId, row.id), current.role);
        await this.audit(tx, current, 'PACKAGE_CREATED', result, requestId);
        return result;
      });
    } catch (error) {
      return conflict(error);
    }
  }
  async update(context: TenantContext, id: string, dto: UpdatePackageDto, requestId: string) {
    if (
      !['carrierCode', 'trackingNo', 'expectedItems', 'remark', 'purchaseOrderId', 'status'].some(
        (key) => dto[key as keyof UpdatePackageDto] !== undefined,
      )
    )
      throw new BusinessException('BAD_REQUEST');
    try {
      return await this.contexts.run(context, 'packages:write', true, async (tx, current) => {
        const initial = await this.find(tx, current.tenantId, id),
          targetId = dto.purchaseOrderId?.toLowerCase() ?? initial.purchaseOrderId;
        const orders = new Map<string, { id: string; status: string }>();
        // Stable parent order locks precede the package lock and match the future receiving hierarchy.
        for (const orderId of [...new Set([initial.purchaseOrderId, targetId])].sort())
          orders.set(orderId, await this.lockOrder(tx, current.tenantId, orderId));
        await tx.$queryRaw`SELECT id FROM packages WHERE tenant_id=${current.tenantId}::uuid AND id=${id}::uuid FOR UPDATE`;
        const row = await this.find(tx, current.tenantId, id),
          before = mapPackage(row, current.role);
        if (row.purchaseOrderId !== initial.purchaseOrderId)
          throw new BusinessException('STATUS_CONFLICT');
        const moved = targetId !== row.purchaseOrderId;
        if (moved && dto.expectedItems === undefined)
          throw new BusinessException('BUSINESS_VALIDATION_FAILED');
        const oldPlan = row.packageExpectedItem_purchaseOrderId.map((item) => ({
          purchaseOrderItemId: item.purchaseOrderItemId,
          expectedQuantity: item.expectedQuantity,
        }));
        const items = dto.expectedItems ?? oldPlan,
          planChanged = moved || planKey(items) !== planKey(oldPlan);
        const data = {
          purchaseOrderId: targetId,
          carrierCode: dto.carrierCode ?? row.carrierCode,
          trackingNo: dto.trackingNo ?? row.trackingNo,
          status: dto.status ?? row.status,
          remark: dto.remark === undefined ? row.remark : dto.remark,
        };
        const changedFields = Object.entries(data)
          .filter(([key, value]) => row[key as keyof typeof row] !== value)
          .map(([key]) => key);
        if (planChanged) changedFields.push('expectedItems');
        if (!changedFields.length) return before;
        const core = changedFields.some((key) => key !== 'remark');
        if (core) {
          if (
            before.hasReceipts ||
            row.receivingClosedAt ||
            ['PARTIAL_RECEIVED', 'RECEIVED'].includes(row.status)
          )
            throw new BusinessException('STATUS_CONFLICT');
          if ([...orders.values()].some((order) => !activeOrders.includes(order.status)))
            throw new BusinessException('STATUS_CONFLICT');
          if (data.status !== row.status && !transitions[row.status]?.includes(data.status))
            throw new BusinessException('STATUS_CONFLICT');
          if (!data.carrierCode || !data.trackingNo)
            throw new BusinessException('BUSINESS_VALIDATION_FAILED');
          await this.validatePlan(tx, current.tenantId, targetId, items, id);
          await this.tracking(tx, current.tenantId, data.carrierCode, data.trackingNo, id);
        }
        if (planChanged)
          await tx.packageExpectedItem.deleteMany({
            where: {
              tenantId: current.tenantId,
              packageId: id,
              ...(!moved
                ? {
                    purchaseOrderItemId: {
                      notIn: items.map((item) => item.purchaseOrderItemId.toLowerCase()),
                    },
                  }
                : {}),
            },
          });
        await tx.package.update({
          where: { tenantId_id: { tenantId: current.tenantId, id } },
          data,
        });
        if (planChanged)
          for (const item of items)
            await tx.packageExpectedItem.upsert({
              where: {
                tenantId_packageId_purchaseOrderItemId: {
                  tenantId: current.tenantId,
                  packageId: id,
                  purchaseOrderItemId: item.purchaseOrderItemId.toLowerCase(),
                },
              },
              create: {
                tenantId: current.tenantId,
                purchaseOrderId: targetId,
                packageId: id,
                purchaseOrderItemId: item.purchaseOrderItemId.toLowerCase(),
                expectedQuantity: item.expectedQuantity,
              },
              update: { expectedQuantity: item.expectedQuantity },
            });
        const result = mapPackage(await this.find(tx, current.tenantId, id), current.role);
        await this.audit(tx, current, 'PACKAGE_UPDATED', result, requestId, before, changedFields);
        return result;
      });
    } catch (error) {
      return conflict(error);
    }
  }
}
