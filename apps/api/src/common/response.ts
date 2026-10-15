import {
  Injectable,
  type NestInterceptor,
  type ExecutionContext,
  type CallHandler,
} from '@nestjs/common';
import type { Pagination } from '@caicang/api-contract';
import { map, type Observable } from 'rxjs';
import type { ApiRequest } from './request-context.js';

export class PageResult<T> {
  constructor(
    readonly data: T[],
    readonly pagination: Pagination,
  ) {}
}
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<ApiRequest>();
    return next
      .handle()
      .pipe(
        map((value: unknown) =>
          value instanceof PageResult
            ? { data: value.data, pagination: value.pagination, requestId: request.requestId }
            : { data: value ?? null, requestId: request.requestId },
        ),
      );
  }
}
