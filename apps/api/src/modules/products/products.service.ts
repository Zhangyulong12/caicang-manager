import { Injectable } from '@nestjs/common';
import type { ProductData } from '@caicang/api-contract';
import { Prisma, type Product } from '../../generated/prisma/client.js';
import { BusinessException } from '../../common/errors.js';
import { PageResult } from '../../common/response.js';
import { TenantContextService, type TenantContext } from '../../common/tenancy/tenant-context.js';
import type { CreateProductDto, UpdateProductDto, ProductListQueryDto } from './product.dto.js';

const fields = [
  'name',
  'sku',
  'specification',
  'unit',
  'barcode',
  'referencePurchasePrice',
  'isActive',
  'remark',
] as const;
const mapProduct = (product: Product): ProductData => ({
  id: product.id,
  tenantId: product.tenantId,
  name: product.name,
  sku: product.sku,
  specification: product.specification,
  unit: product.unit,
  barcode: product.barcode,
  referencePurchasePrice: product.referencePurchasePrice?.toFixed(2) ?? null,
  isActive: product.isActive,
  remark: product.remark,
  createdAt: product.createdAt.toISOString(),
  updatedAt: product.updatedAt.toISOString(),
});
const auditState = (product: ProductData) => ({
  sku: product.sku,
  barcode: product.barcode,
  referencePurchasePrice: product.referencePurchasePrice,
  isActive: product.isActive,
});
const literalSearch = (value: string) => value.replace(/[\\%_]/g, '\\$&');

/** Recognize only known product unique constraints; never expose driver messages/SQL/values. */
function uniqueConflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    const meta = error.meta as
      | {
          target?: unknown;
          driverAdapterError?: { cause?: { constraint?: { index?: unknown; fields?: unknown } } };
        }
      | undefined;
    const constraint = meta?.driverAdapterError?.cause?.constraint;
    const target = meta?.target ?? constraint?.index ?? constraint?.fields;
    if (
      (Array.isArray(target) && target.includes('sku')) ||
      target === 'products_tenant_id_sku_key'
    )
      throw new BusinessException('PRODUCT_SKU_ALREADY_EXISTS');
    if (
      (Array.isArray(target) && target.includes('barcode')) ||
      target === 'products_tenant_id_barcode_key'
    )
      throw new BusinessException('PRODUCT_BARCODE_ALREADY_EXISTS');
  }
  throw error;
}

@Injectable()
export class ProductsService {
  constructor(private readonly contexts: TenantContextService) {}
  async list(context: TenantContext, query: ProductListQueryDto): Promise<PageResult<ProductData>> {
    const skip = (query.page - 1) * query.pageSize;
    if (!Number.isSafeInteger(skip) || skip > 2147483647)
      throw new BusinessException('BAD_REQUEST');
    return this.contexts.run(context, 'products:read', false, async (tx, current) => {
      const where: Prisma.ProductWhereInput = { tenantId: current.tenantId };
      if (query.isActive !== undefined) where.isActive = query.isActive;
      if (query.unit !== undefined) where.unit = query.unit;
      if (query.hasBarcode !== undefined) where.barcode = query.hasBarcode ? { not: null } : null;
      if (query.search !== undefined) {
        const search = { contains: literalSearch(query.search), mode: 'insensitive' as const };
        where.OR = [
          { name: search },
          { sku: search },
          { barcode: search },
          { specification: search },
        ];
      }
      const total = await tx.product.count({ where });
      const products = await tx.product.findMany({
        where,
        skip,
        take: query.pageSize,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      return new PageResult(products.map(mapProduct), {
        page: query.page,
        pageSize: query.pageSize,
        total,
      });
    });
  }
  async detail(context: TenantContext, id: string): Promise<ProductData> {
    return this.contexts.run(context, 'products:read', false, async (tx, current) => {
      const product = await tx.product.findUnique({
        where: { tenantId_id: { tenantId: current.tenantId, id } },
      });
      if (!product) throw new BusinessException('NOT_FOUND');
      return mapProduct(product);
    });
  }
  async lookup(context: TenantContext, code: string): Promise<ProductData[]> {
    return this.contexts.run(context, 'products:read', false, async (tx, current) => {
      const matches = await tx.product.findMany({
        where: {
          tenantId: current.tenantId,
          isActive: true,
          OR: [{ sku: code }, { barcode: code }],
        },
        orderBy: { id: 'asc' },
        take: 2,
      });
      return matches.map(mapProduct);
    });
  }
  async create(
    context: TenantContext,
    dto: CreateProductDto,
    requestId: string,
  ): Promise<ProductData> {
    try {
      return await this.contexts.run(context, 'products:write', true, async (tx, current) => {
        const product = await tx.product.create({
          data: {
            tenantId: current.tenantId,
            name: dto.name,
            sku: dto.sku,
            specification: dto.specification ?? null,
            unit: dto.unit ?? '件',
            barcode: dto.barcode ?? null,
            referencePurchasePrice:
              dto.referencePurchasePrice == null
                ? null
                : new Prisma.Decimal(dto.referencePurchasePrice),
            isActive: dto.isActive ?? true,
            remark: dto.remark ?? null,
          },
        });
        const result = mapProduct(product);
        await tx.auditLog.create({
          data: {
            tenantId: current.tenantId,
            actorId: current.userId,
            action: 'PRODUCT_CREATED',
            objectType: 'product',
            objectId: product.id,
            metadata: { requestId, after: auditState(result) },
          },
        });
        return result;
      });
    } catch (error: unknown) {
      return uniqueConflict(error);
    }
  }
  async update(
    context: TenantContext,
    id: string,
    dto: UpdateProductDto,
    requestId: string,
  ): Promise<ProductData> {
    if (!fields.some((field) => dto[field] !== undefined))
      throw new BusinessException('BAD_REQUEST');
    try {
      return await this.contexts.run(context, 'products:write', true, async (tx, current) => {
        const where = { tenantId_id: { tenantId: current.tenantId, id } };
        const existing = await tx.product.findUnique({ where });
        if (!existing) throw new BusinessException('NOT_FOUND');
        const before = mapProduct(existing);
        const next: ProductData = {
          ...before,
          name: dto.name ?? before.name,
          sku: dto.sku ?? before.sku,
          unit: dto.unit ?? before.unit,
          specification: dto.specification === undefined ? before.specification : dto.specification,
          barcode: dto.barcode === undefined ? before.barcode : dto.barcode,
          referencePurchasePrice:
            dto.referencePurchasePrice === undefined
              ? before.referencePurchasePrice
              : dto.referencePurchasePrice === null
                ? null
                : new Prisma.Decimal(dto.referencePurchasePrice).toFixed(2),
          isActive: dto.isActive ?? before.isActive,
          remark: dto.remark === undefined ? before.remark : dto.remark,
        };
        const changedFields = fields.filter((field) => before[field] !== next[field]);
        if (!changedFields.length) return before;
        // Write master data only: no cascading changes to purchase items, receipts or inventory.
        const updated = await tx.product.update({
          where,
          data: {
            name: next.name,
            sku: next.sku,
            specification: next.specification,
            unit: next.unit,
            barcode: next.barcode,
            referencePurchasePrice:
              next.referencePurchasePrice === null
                ? null
                : new Prisma.Decimal(next.referencePurchasePrice),
            isActive: next.isActive,
            remark: next.remark,
          },
        });
        const result = mapProduct(updated);
        await tx.auditLog.create({
          data: {
            tenantId: current.tenantId,
            actorId: current.userId,
            action: 'PRODUCT_UPDATED',
            objectType: 'product',
            objectId: id,
            metadata: {
              requestId,
              changedFields,
              before: auditState(before),
              after: auditState(result),
            },
          },
        });
        return result;
      });
    } catch (error: unknown) {
      return uniqueConflict(error);
    }
  }
}
