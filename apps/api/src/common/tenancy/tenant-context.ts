import { Injectable, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { TenantPermission, TenantRole } from '@caicang/api-contract';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AuthRequest } from '../../modules/auth/access-token.guard.js';
import { BusinessException } from '../errors.js';
import { assertPermission, permissionsFor, tenantRole } from './tenant-policy.js';

export interface TenantContext {
  readonly tenantId: string;
  readonly userId: string;
  readonly membershipId: string;
  readonly role: TenantRole;
  readonly permissions: readonly TenantPermission[];
}
export interface TenantRequest extends AuthRequest {
  tenantContext?: TenantContext;
}
@Injectable()
export class TenantContextService {
  constructor(private readonly prisma: PrismaService) {}
  async resolve(
    userId: string,
    tenantId: string,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<TenantContext> {
    const membership = await db.tenantMembership.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
      select: { id: true, role: true, isActive: true, user: { select: { isActive: true } } },
    });
    if (!membership?.isActive || !membership.user.isActive)
      throw new BusinessException('FORBIDDEN');
    const role = tenantRole(membership.role);
    return Object.freeze({
      tenantId,
      userId,
      membershipId: membership.id,
      role,
      permissions: Object.freeze([...permissionsFor(role)]),
    });
  }
  async run<T>(
    context: TenantContext,
    permission: TenantPermission,
    write: boolean,
    operation: (tx: Prisma.TransactionClient, current: TenantContext) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      // All tenant membership readers/writers share this lock hierarchy: tenant, then membership.
      if (write)
        await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${context.tenantId}::uuid FOR UPDATE`;
      else
        await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${context.tenantId}::uuid FOR SHARE`;
      const current = await this.resolve(context.userId, context.tenantId, tx);
      assertPermission(current.role, permission);
      return operation(tx, current);
    });
  }
}
export const CurrentTenant = createParamDecorator(
  (_data: unknown, execution: ExecutionContext): TenantContext => {
    const context = execution.switchToHttp().getRequest<TenantRequest>().tenantContext;
    if (!context) throw new BusinessException('FORBIDDEN');
    return context;
  },
);
