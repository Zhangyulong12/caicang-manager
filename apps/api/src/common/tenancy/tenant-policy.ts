import {
  TENANT_PERMISSIONS,
  TENANT_ROLES,
  type TenantPermission,
  type TenantRole,
} from '@caicang/api-contract';
import { BusinessException } from '../errors.js';

const ROLE_PERMISSIONS: Readonly<Record<TenantRole, readonly TenantPermission[]>> = Object.freeze({
  OWNER: TENANT_PERMISSIONS,
  ADMIN: TENANT_PERMISSIONS,
  BUYER: Object.freeze([
    'reports:read',
    'tenant:read',
    'products:read',
    'products:write',
    'warehouses:read',
    'purchase:write',
    'purchase:read',
    'packages:read',
    'packages:write',
    'packages:lookup',
  ] as const),
  WAREHOUSE: Object.freeze([
    'tenant:read',
    'products:read',
    'receiving:confirm',
    'warehouses:read',
    'outbound:write',
    'inventory:write',
    'purchase:read',
    'packages:read',
    'packages:lookup',
  ] as const),
  VIEWER: Object.freeze([
    'reports:read',
    'tenant:read',
    'products:read',
    'warehouses:read',
    'purchase:read',
    'packages:read',
  ] as const),
});

export function tenantRole(role: string): TenantRole {
  if (!TENANT_ROLES.includes(role as TenantRole)) throw new BusinessException('FORBIDDEN');
  return role as TenantRole;
}
export function permissionsFor(role: TenantRole): readonly TenantPermission[] {
  return ROLE_PERMISSIONS[role];
}
export function assertPermission(role: TenantRole, permission: TenantPermission): void {
  if (!permissionsFor(role).includes(permission)) throw new BusinessException('FORBIDDEN');
}
/** Ownership transfer is deliberately outside the general member editing endpoint. */
export function assertMemberManagement(
  actor: TenantRole,
  existing: TenantRole | undefined,
  assigned: TenantRole | undefined,
): void {
  if (existing === 'OWNER' || assigned === 'OWNER') throw new BusinessException('FORBIDDEN');
  if (actor === 'OWNER') return;
  const ordinary = ['BUYER', 'WAREHOUSE', 'VIEWER'];
  if (
    actor !== 'ADMIN' ||
    (existing !== undefined && !ordinary.includes(existing)) ||
    (assigned !== undefined && !ordinary.includes(assigned))
  )
    throw new BusinessException('FORBIDDEN');
}
