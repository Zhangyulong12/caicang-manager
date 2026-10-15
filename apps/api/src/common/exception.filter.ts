import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import type { ApiErrorCode, ApiErrorResponse } from '@caicang/api-contract';
import { Prisma } from '../generated/prisma/client.js';
import { BusinessException, ERRORS } from './errors.js';
import { redactSensitive } from './logging.js';
import type { ApiRequest } from './request-context.js';

const httpCodes: Record<number, ApiErrorCode> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'RESOURCE_CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'BUSINESS_VALIDATION_FAILED',
  429: 'RATE_LIMITED',
  503: 'SERVICE_UNAVAILABLE',
};
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<ApiRequest>();
    this.respond(exception, request, response);
  }

  /** Also used for unmatched routes outside Nest's global prefix. */
  respond(exception: unknown, request: ApiRequest, response: Response): void {
    if (response.headersSent) {
      response.end();
      return;
    }
    let code: ApiErrorCode = 'INTERNAL_ERROR';
    let details: Record<string, unknown> = {};
    if (exception instanceof BusinessException) {
      code = exception.code;
      details = redactSensitive(exception.details) as Record<string, unknown>;
    } else if (exception instanceof HttpException)
      code = httpCodes[exception.getStatus()] ?? 'INTERNAL_ERROR';
    else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      code =
        exception.code === 'P2002' || exception.code === 'P2003'
          ? 'RESOURCE_CONFLICT'
          : exception.code === 'P2025'
            ? 'NOT_FOUND'
            : exception.code === 'P2024'
              ? 'DATABASE_UNAVAILABLE'
              : 'INTERNAL_ERROR';
    } else if (exception && typeof exception === 'object' && 'type' in exception) {
      if (exception.type === 'entity.parse.failed') code = 'BAD_REQUEST';
      if (exception.type === 'entity.too.large') code = 'PAYLOAD_TOO_LARGE';
    }
    request.errorCode = code;
    const body: ApiErrorResponse = {
      error: { code, message: ERRORS[code].message, details },
      requestId: request.requestId,
    };
    response.status(ERRORS[code].status).json(body);
  }
}
