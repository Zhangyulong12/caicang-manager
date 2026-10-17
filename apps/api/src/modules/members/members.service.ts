import { Injectable } from '@nestjs/common';
import type { MemberData } from '@caicang/api-contract';
import { Prisma } from '../../generated/prisma/client.js';
import { BusinessException } from '../../common/errors.js';
import { PageResult } from '../../common/response.js';
import type { PaginationQueryDto } from '../../common/pagination.dto.js';
import { TenantContextService, type TenantContext } from '../../common/tenancy/tenant-context.js';
import { mapMembership } from '../../common/tenancy/tenant.mapping.js';
import { assertMemberManagement, tenantRole } from '../../common/tenancy/tenant-policy.js';
import type { AddMemberDto, UpdateMemberDto } from './member.dto.js';

const memberSelect = {
  id: true,
  tenantId: true,
  userId: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { id: true, email: true, displayName: true, isActive: true } },
} satisfies Prisma.TenantMembershipSelect;
type MemberRecord = Prisma.TenantMembershipGetPayload<{ select: typeof memberSelect }>;
const mapMember = (member: MemberRecord): MemberData => ({
  ...mapMembership(member),
  user: { ...member.user },
});

@Injectable()
export class MembersService {
  constructor(private readonly contexts: TenantContextService) {}
  async list(context: TenantContext, query: PaginationQueryDto): Promise<PageResult<MemberData>> {
    const skip = (query.page - 1) * query.pageSize;
    if (!Number.isSafeInteger(skip) || skip > 2147483647)
      throw new BusinessException('BAD_REQUEST');
    return this.contexts.run(context, 'members:read', false, async (tx, current) => {
      const where = { tenantId: current.tenantId };
      const total = await tx.tenantMembership.count({ where });
      const members = await tx.tenantMembership.findMany({
        where,
        select: memberSelect,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip,
        take: query.pageSize,
      });
      return new PageResult(members.map(mapMember), {
        page: query.page,
        pageSize: query.pageSize,
        total,
      });
    });
  }
  async add(context: TenantContext, dto: AddMemberDto, requestId: string): Promise<MemberData> {
    try {
      return await this.contexts.run(context, 'members:manage', true, async (tx, current) => {
        assertMemberManagement(current.role, undefined, dto.role);
        const rows = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM users WHERE lower(btrim(email)) = ${dto.email} AND is_active = true FOR SHARE`;
        const user = rows[0];
        if (!user) throw new BusinessException('NOT_FOUND');
        const existing = await tx.tenantMembership.findUnique({
          where: { tenantId_userId: { tenantId: current.tenantId, userId: user.id } },
          select: { id: true },
        });
        if (existing) throw new BusinessException('MEMBER_ALREADY_EXISTS');
        const member = await tx.tenantMembership.create({
          data: { tenantId: current.tenantId, userId: user.id, role: dto.role, isActive: true },
          select: memberSelect,
        });
        await tx.auditLog.create({
          data: {
            tenantId: current.tenantId,
            actorId: current.userId,
            action: 'MEMBER_ADDED',
            objectType: 'tenant_membership',
            objectId: member.id,
            metadata: { requestId, after: { role: member.role, isActive: member.isActive } },
          },
        });
        return mapMember(member);
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new BusinessException('MEMBER_ALREADY_EXISTS');
      throw error;
    }
  }
  async update(
    context: TenantContext,
    membershipId: string,
    dto: UpdateMemberDto,
    requestId: string,
  ): Promise<MemberData> {
    if (dto.role === undefined && dto.isActive === undefined)
      throw new BusinessException('BAD_REQUEST');
    return this.contexts.run(context, 'members:manage', true, async (tx, current) => {
      const where = { tenantId_id: { tenantId: current.tenantId, id: membershipId } };
      const existing = await tx.tenantMembership.findUnique({ where, select: memberSelect });
      if (!existing) throw new BusinessException('NOT_FOUND');
      assertMemberManagement(current.role, tenantRole(existing.role), dto.role);
      if (dto.isActive === true && !existing.user.isActive)
        throw new BusinessException('RESOURCE_CONFLICT');
      const role = dto.role ?? existing.role;
      const isActive = dto.isActive ?? existing.isActive;
      if (role === existing.role && isActive === existing.isActive) return mapMember(existing);
      const member = await tx.tenantMembership.update({
        where,
        data: { role, isActive },
        select: memberSelect,
      });
      await tx.auditLog.create({
        data: {
          tenantId: current.tenantId,
          actorId: current.userId,
          action: 'MEMBER_UPDATED',
          objectType: 'tenant_membership',
          objectId: member.id,
          metadata: {
            requestId,
            before: { role: existing.role, isActive: existing.isActive },
            after: { role: member.role, isActive: member.isActive },
          },
        },
      });
      return mapMember(member);
    });
  }
}
