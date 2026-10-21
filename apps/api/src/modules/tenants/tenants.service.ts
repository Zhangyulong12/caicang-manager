import { Injectable } from '@nestjs/common';
import type { CreatedTenantData, CurrentTenantData, TenantChoiceData } from '@caicang/api-contract';
import type { PaginationQueryDto } from '../../common/pagination.dto.js';
import { PageResult } from '../../common/response.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { BusinessException } from '../../common/errors.js';
import { TenantContextService, type TenantContext } from '../../common/tenancy/tenant-context.js';
import { mapTenant, mapMembership } from '../../common/tenancy/tenant.mapping.js';
import type { CreateTenantDto } from './tenant.dto.js';

@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contexts: TenantContextService,
  ) {}
  async list(userId: string, query: PaginationQueryDto): Promise<PageResult<TenantChoiceData>> {
    const skip = (query.page - 1) * query.pageSize;
    if (!Number.isSafeInteger(skip) || skip > 2147483647)
      throw new BusinessException('BAD_REQUEST');
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR SHARE`;
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { isActive: true },
        });
        if (!user?.isActive) throw new BusinessException('UNAUTHENTICATED');
        const where = { userId, isActive: true };
        const total = await tx.tenantMembership.count({ where });
        const memberships = await tx.tenantMembership.findMany({
          where,
          skip,
          take: query.pageSize,
          include: { tenant: true },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        });
        return new PageResult(
          memberships.map((membership) => ({
            tenant: mapTenant(membership.tenant),
            membership: mapMembership(membership),
          })),
          { page: query.page, pageSize: query.pageSize, total },
        );
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async create(
    userId: string,
    dto: CreateTenantDto,
    requestId: string,
  ): Promise<CreatedTenantData> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR SHARE`;
      const user = await tx.user.findUnique({ where: { id: userId }, select: { isActive: true } });
      if (!user?.isActive) throw new BusinessException('UNAUTHENTICATED');
      const tenant = await tx.tenant.create({ data: { name: dto.name } });
      const membership = await tx.tenantMembership.create({
        data: { tenantId: tenant.id, userId, role: 'OWNER', isActive: true },
      });
      const warehouse = await tx.warehouse.create({
        data: { tenantId: tenant.id, code: 'DEFAULT', name: '默认仓库', isActive: true },
      });
      await tx.auditLog.create({
        data: {
          tenantId: tenant.id,
          actorId: userId,
          action: 'TENANT_CREATED',
          objectType: 'tenant',
          objectId: tenant.id,
          metadata: {
            requestId,
            ownerMembershipId: membership.id,
            defaultWarehouseId: warehouse.id,
          },
        },
      });
      return {
        tenant: mapTenant(tenant),
        membership: mapMembership(membership),
        defaultWarehouse: {
          id: warehouse.id,
          tenantId: warehouse.tenantId,
          code: warehouse.code,
          name: warehouse.name,
          isActive: warehouse.isActive,
          createdAt: warehouse.createdAt.toISOString(),
          updatedAt: warehouse.updatedAt.toISOString(),
        },
      };
    });
  }
  async current(context: TenantContext): Promise<CurrentTenantData> {
    return this.contexts.run(context, 'tenant:read', false, async (tx, current) => {
      const tenant = await tx.tenant.findUnique({ where: { id: current.tenantId } });
      const membership = await tx.tenantMembership.findUnique({
        where: { tenantId_id: { tenantId: current.tenantId, id: current.membershipId } },
      });
      if (!tenant || !membership) throw new BusinessException('FORBIDDEN');
      return {
        tenant: mapTenant(tenant),
        membership: mapMembership(membership),
        permissions: [...current.permissions],
      };
    });
  }
}
