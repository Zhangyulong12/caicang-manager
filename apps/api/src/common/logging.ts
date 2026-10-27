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

/** Startup-only diagnostics. HTTP/framework free-text logging stays disabled. */
export function formatBootstrapFailure(
  error: unknown,
  environment: NodeJS.ProcessEnv = process.env,
): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    event: 'bootstrap_failed',
    message:
      error instanceof Error && /^Invalid configuration: [A-Z_]+$/.test(error.message)
        ? error.message
        : 'API startup failed',
  };
  if ((environment.NODE_ENV ?? 'development') !== 'development' || !(error instanceof Error))
    return entry;

  const secrets = new Set<string>();
  for (const [key, value] of Object.entries(environment)) {
    if (!value) continue;
    if (sensitiveKey.test(key.replace(/[^a-z]/gi, ''))) secrets.add(value);
    if (/url|connectionstring/i.test(key)) {
      try {
        const password = new URL(value).password;
        if (password) {
          secrets.add(password);
          secrets.add(decodeURIComponent(password));
        }
      } catch {
        // Invalid configuration must not make the diagnostic formatter throw.
      }
    }
  }
  for (const value of [...secrets]) {
    try {
      secrets.add(encodeURIComponent(value));
    } catch {
      // A malformed Unicode value is still masked in its original form.
    }
  }
  const scrub = (value: string, limit: number): string => {
    let safe = value;
    for (const secret of [...secrets].sort((a, b) => b.length - a.length))
      safe = safe.replaceAll(secret, '[REDACTED]');
    safe = safe
      .replace(
        /\b(?:https?|postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|rediss?|sqlserver):\/\/[^\s"'<>]+/gi,
        '[REDACTED_URL]',
      )
      .replace(/\bBearer\s+[^\s"',;]+/gi, 'Bearer [REDACTED]')
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_TOKEN]')
      .replace(
        /(\b[\w-]*(?:password|passwd|pwd|token|authorization|cookie|secret|recipient|address|phone|email)[\w-]*["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/gi,
        '$1[REDACTED]',
      )
      .replace(
        /(\b[\w-]*(?:password|passwd|pwd|token|authorization|cookie|secret|recipient|address|phone|email)[\w-]*["']?\s*[:=]\s*)[^\r\n]+/gi,
        '$1[REDACTED]',
      );
    return safe.length > limit ? safe.slice(0, limit) + '[TRUNCATED]' : safe;
  };
  const describe = (current: Error, depth = 0): Record<string, unknown> => ({
    name: scrub(current.name, 128),
    message: scrub(current.message, 4096),
    stack: typeof current.stack === 'string' ? scrub(current.stack, 16384) : undefined,
    code:
      'code' in current && typeof current.code === 'string' ? scrub(current.code, 64) : undefined,
    cause:
      depth < 2 && current.cause instanceof Error ? describe(current.cause, depth + 1) : undefined,
  });
  entry.exception = describe(error);
  return entry;
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
