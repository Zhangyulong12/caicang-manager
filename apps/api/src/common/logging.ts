import { Injectable, type LoggerService } from '@nestjs/common';
import { API_ERROR_CODES, type ApiErrorCode } from '@caicang/api-contract';
import { resolveRequestId } from './request-context.js';

const sensitiveKey =
  /password|passwd|pwd|token|authorization|cookie|secret|address|recipient|phone|email|databaseurl|connectionstring/i;
export function redactSensitive(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[REDACTED]';
  if (value instanceof Error) return '[REDACTED_ERROR]';
  if (Array.isArray(value)) return value.slice(0, 100).map((v) => redactSensitive(v, depth + 1));
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 100)
        .map(([key, v]) => [
          key,
          sensitiveKey.test(key.replace(/[^a-z]/gi, ''))
            ? '[REDACTED]'
            : redactSensitive(v, depth + 1),
        ]),
    );
  return value;
}
/** Never writes free text, payloads, headers, exception messages or stacks. */
@Injectable()
export class SafeLogger implements LoggerService {
  private framework(level: string, context?: unknown): void {
    const allowed = [
      'NestFactory',
      'InstanceLoader',
      'RoutesResolver',
      'RouterExplorer',
      'NestApplication',
      'ExceptionHandler',
      'ExceptionsHandler',
      'ThrottlerGuard',
    ];
    this.write({
      level,
      event: 'framework',
      context: typeof context === 'string' && allowed.includes(context) ? context : 'application',
    });
  }
  log(_message: unknown, context?: unknown): void {
    this.framework('info', context);
  }
  error(_message: unknown, _stack?: unknown, context?: unknown): void {
    this.framework('error', context);
  }
  warn(_message: unknown, context?: unknown): void {
    this.framework('warn', context);
  }
  debug(_message: unknown, context?: unknown): void {
    this.framework('debug', context);
  }
  verbose(_message: unknown, context?: unknown): void {
    this.framework('trace', context);
  }
  fatal(_message: unknown, context?: unknown): void {
    this.framework('fatal', context);
  }
  request(fields: {
    requestId: string;
    method: string;
    statusCode: number;
    durationMs: number;
    errorCode?: ApiErrorCode;
  }): void {
    this.write({
      level: 'info',
      event: 'http_request',
      requestId: resolveRequestId(fields.requestId),
      method: /^[A-Z]{1,16}$/.test(fields.method) ? fields.method : 'OTHER',
      statusCode:
        Number.isInteger(fields.statusCode) && fields.statusCode >= 100 && fields.statusCode <= 599
          ? fields.statusCode
          : 500,
      durationMs: Number.isFinite(fields.durationMs) ? Math.max(0, fields.durationMs) : 0,
      errorCode:
        fields.errorCode && API_ERROR_CODES.includes(fields.errorCode)
          ? fields.errorCode
          : undefined,
    });
  }
  private write(fields: Record<string, unknown>): void {
    process.stdout.write(JSON.stringify({ timestamp: new Date().toISOString(), ...fields }) + '\n');
  }
}
