import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isUUID } from 'class-validator';
import type { TenantPermission, TenantRole } from '@caicang/api-contract';
import { PUBLIC_ROUTE } from '../../modules/auth/public.decorator.js';
import { BusinessException } from '../errors.js';
import { TenantContextService, type TenantRequest } from './tenant-context.js';
import { GLOBAL_ACCOUNT, REQUIRED_PERMISSIONS, REQUIRED_ROLES } from './tenant.decorators.js';

function exempt(reflector: Reflector, context: ExecutionContext): boolean {
  const targets = [context.getHandler(), context.getClass()];
  return (
    reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, targets) === true ||
    reflector.getAllAndOverride<boolean>(GLOBAL_ACCOUNT, targets) === true
  );
}
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly contexts: TenantContextService,
  ) {}
  async canActivate(execution: ExecutionContext): Promise<boolean> {
    if (exempt(this.reflector, execution)) return true;
    const request = execution.switchToHttp().getRequest<TenantRequest>();
    if (!request.currentUser) throw new BusinessException('UNAUTHENTICATED');
    const tenantId = request.headers['x-tenant-id'];
    const count = request.rawHeaders.filter(
      (value, index) => index % 2 === 0 && value.toLowerCase() === 'x-tenant-id',
    ).length;
    if (count !== 1 || typeof tenantId !== 'string' || !isUUID(tenantId))
      throw new BusinessException('INVALID_TENANT_HEADER');
    request.tenantContext = await this.contexts.resolve(
      request.currentUser.id,
      tenantId.toLowerCase(),
    );
    return true;
  }
}
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(execution: ExecutionContext): boolean {
    if (exempt(this.reflector, execution)) return true;
    const context = execution.switchToHttp().getRequest<TenantRequest>().tenantContext;
    const targets = [execution.getHandler(), execution.getClass()];
    const roles = this.reflector.getAllAndOverride<TenantRole[]>(REQUIRED_ROLES, targets);
    const permissions = this.reflector.getAllAndOverride<TenantPermission[]>(
      REQUIRED_PERMISSIONS,
      targets,
    );
    if (
      !context ||
      (!roles?.length && !permissions?.length) ||
      (roles?.length && !roles.includes(context.role)) ||
      (permissions?.length && !permissions.every((value) => context.permissions.includes(value)))
    )
      throw new BusinessException('FORBIDDEN');
    return true;
  }
}
