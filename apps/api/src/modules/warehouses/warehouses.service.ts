import { Injectable } from '@nestjs/common';
import type { WarehouseData } from '@caicang/api-contract';
import { Prisma } from '../../generated/prisma/client.js';
import { BusinessException } from '../../common/errors.js';
import { PageResult } from '../../common/response.js';
import type { PaginationQueryDto } from '../../common/pagination.dto.js';
import { TenantContextService, type TenantContext } from '../../common/tenancy/tenant-context.js';
import type { CreateWarehouseDto } from './warehouse.dto.js';

// Select only public warehouse master data, never the existing full address column.
const select = {
  id: true,
  tenantId: true,
  name: true,
  code: true,
  remark: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.WarehouseSelect;
type PublicWarehouse = Prisma.WarehouseGetPayload<{ select: typeof select }>;
const mapWarehouse = (warehouse: PublicWarehouse): WarehouseData => ({
  id: warehouse.id,
  tenantId: warehouse.tenantId,
  name: warehouse.name,
  code: warehouse.code,
  remark: warehouse.remark,
  isActive: warehouse.isActive,
  createdAt: warehouse.createdAt.toISOString(),
  updatedAt: warehouse.updatedAt.toISOString(),
});

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
      (Array.isArray(target) && target.includes('tenant_id') && target.includes('code')) ||
      target === 'warehouses_tenant_id_code_key'
    )
      throw new BusinessException('WAREHOUSE_CODE_ALREADY_EXISTS');
  }
  throw error;
}

@Injectable()
export class WarehousesService {
  constructor(private readonly contexts: TenantContextService) {}

  async list(
    context: TenantContext,
    query: PaginationQueryDto,
  ): Promise<PageResult<WarehouseData>> {
    const skip = (query.page - 1) * query.pageSize;
    if (!Number.isSafeInteger(skip) || skip > 2147483647)
      throw new BusinessException('BAD_REQUEST');
    return this.contexts.run(context, 'warehouses:read', false, async (tx, current) => {
      const where = { tenantId: current.tenantId };
      const total = await tx.warehouse.count({ where });
      const warehouses = await tx.warehouse.findMany({
        where,
        select,
        skip,
        take: query.pageSize,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      return new PageResult(warehouses.map(mapWarehouse), {
        page: query.page,
        pageSize: query.pageSize,
        total,
      });
    });
  }

  async create(
    context: TenantContext,
    dto: CreateWarehouseDto,
    requestId: string,
  ): Promise<WarehouseData> {
    try {
      return await this.contexts.run(context, 'warehouses:write', true, async (tx, current) => {
        const warehouse = await tx.warehouse.create({
          data: {
            tenantId: current.tenantId,
            name: dto.name,
            code: dto.code,
            remark: dto.remark ?? null,
          },
          select,
        });
        await tx.auditLog.create({
          data: {
            tenantId: current.tenantId,
            actorId: current.userId,
            action: 'WAREHOUSE_CREATED',
            objectType: 'warehouse',
            objectId: warehouse.id,
            metadata: { requestId, code: warehouse.code },
          },
        });
        return mapWarehouse(warehouse);
      });
    } catch (error: unknown) {
      return uniqueConflict(error);
    }
  }
}
