import type { MembershipData, TenantData } from '@caicang/api-contract';
import type { Tenant, TenantMembership } from '../../generated/prisma/client.js';
import { tenantRole } from './tenant-policy.js';

export const mapTenant = (tenant: Tenant): TenantData => ({
  id: tenant.id,
  name: tenant.name,
  createdAt: tenant.createdAt.toISOString(),
  updatedAt: tenant.updatedAt.toISOString(),
});
export const mapMembership = (member: TenantMembership): MembershipData => ({
  id: member.id,
  tenantId: member.tenantId,
  userId: member.userId,
  role: tenantRole(member.role),
  isActive: member.isActive,
  createdAt: member.createdAt.toISOString(),
  updatedAt: member.updatedAt.toISOString(),
});
