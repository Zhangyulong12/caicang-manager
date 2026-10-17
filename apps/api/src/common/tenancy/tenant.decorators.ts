import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiHeader, ApiSecurity } from '@nestjs/swagger';
import type { TenantPermission, TenantRole } from '@caicang/api-contract';

export const GLOBAL_ACCOUNT = Symbol('global-account');
export const REQUIRED_ROLES = Symbol('required-tenant-roles');
export const REQUIRED_PERMISSIONS = Symbol('required-tenant-permissions');
/** Only identity/account operations may opt out of merchant context. Never use on business routes. */
export const GlobalAccount = () => SetMetadata(GLOBAL_ACCOUNT, true);
export const Roles = (...roles: TenantRole[]) => SetMetadata(REQUIRED_ROLES, roles);
export const RequirePermissions = (...permissions: TenantPermission[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, permissions);
export const TenantEndpoint = (...roles: TenantRole[]) =>
  applyDecorators(
    Roles(...roles),
    ApiSecurity({ bearer: [], tenant: [] }),
    ApiHeader({
      name: 'X-Tenant-Id',
      required: true,
      description: '当前商家 UUID；服务端验证启用成员身份',
      schema: { type: 'string', format: 'uuid' },
    }),
  );
