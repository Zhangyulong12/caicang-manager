import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { Request, Response, NextFunction } from 'express';
import type { SafeLogger } from './logging.js';
import type { ApiErrorCode } from '@caicang/api-contract';

export interface ApiRequest extends Request {
  requestId: string;
  errorCode?: ApiErrorCode;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const resolveRequestId = (value: unknown): string =>
  typeof value === 'string' && uuid.test(value) ? value.toLowerCase() : randomUUID();
export function requestContext(logger: SafeLogger) {
  return (request: ApiRequest, response: Response, next: NextFunction): void => {
    const incoming = request.headers['x-request-id'];
    request.requestId = resolveRequestId(incoming);
    response.setHeader('X-Request-Id', request.requestId);
    response.setHeader('Cache-Control', 'no-store');
    const started = performance.now();
    response.once('finish', () =>
      logger.request({
        requestId: request.requestId,
        method: /^[A-Z]{1,16}$/.test(request.method) ? request.method : 'OTHER',
        statusCode: response.statusCode,
        durationMs: Math.round(performance.now() - started),
        ...(request.errorCode ? { errorCode: request.errorCode } : {}),
      }),
    );
    next();
  };
}
