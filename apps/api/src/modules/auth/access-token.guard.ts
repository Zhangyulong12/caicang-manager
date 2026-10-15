import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PublicUser } from '@caicang/api-contract';
import type { ApiRequest } from '../../common/request-context.js';
import { BusinessException } from '../../common/errors.js';
import { AuthService } from './auth.service.js';
import { PUBLIC_ROUTE } from './public.decorator.js';

interface AuthRequest extends ApiRequest {
  currentUser?: PublicUser;
}
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const header = request.headers.authorization;
    if (!header) throw new BusinessException('UNAUTHENTICATED');
    const count = request.rawHeaders.filter(
      (v, i) => i % 2 === 0 && v.toLowerCase() === 'authorization',
    ).length;
    const match =
      header.length <= 4096
        ? header.match(/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i)
        : null;
    if (count !== 1 || !match?.[1]) throw new BusinessException('INVALID_ACCESS_TOKEN');
    request.currentUser = await this.auth.authenticate(match[1]);
    return true;
  }
}
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): PublicUser => {
    const user = context.switchToHttp().getRequest<AuthRequest>().currentUser;
    if (!user) throw new BusinessException('UNAUTHENTICATED');
    return user;
  },
);
