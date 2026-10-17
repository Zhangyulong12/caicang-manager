import { Injectable } from '@nestjs/common';
import { existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { dirname, join, parse } from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

export interface Environment {
  nodeEnv: 'development' | 'test' | 'production';
  databaseUrl: string;
  port: number;
  host: string;
  origins: string[];
  swaggerEnabled: boolean;
  trustedProxies: string[];
  rateLimit: number;
  rateTtlMs: number;
  bodyLimitBytes: number;
  jwtAccessSecret: string;
  jwtAccessTtlSeconds: number;
  refreshTokenTtlSeconds: number;
}

export function validateEnvironment(source: NodeJS.ProcessEnv): Environment {
  const bad = (key: string): never => {
    throw new Error(`Invalid configuration: ${key}`);
  };
  const nodeEnv = source.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) bad('NODE_ENV');
  let db: URL;
  try {
    db = new URL(source.DATABASE_URL ?? '');
  } catch {
    return bad('DATABASE_URL');
  }
  if (
    !['postgres:', 'postgresql:'].includes(db.protocol) ||
    !db.hostname ||
    !db.username ||
    !db.password ||
    db.pathname.length < 2
  )
    bad('DATABASE_URL');
  const integer = (key: string, fallback: number, max: number): number => {
    const raw = source[key] ?? String(fallback);
    if (!/^\d+$/.test(raw)) return bad(key);
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 1 || value > max) return bad(key);
    return value;
  };
  const boolean = (key: string, fallback: boolean): boolean => {
    const value = source[key];
    if (value === undefined) return fallback;
    if (value !== 'true' && value !== 'false') return bad(key);
    return value === 'true';
  };
  const production = nodeEnv === 'production';
  const jwtAccessSecret = source.JWT_ACCESS_SECRET ?? '';
  if (
    Buffer.byteLength(jwtAccessSecret) < 32 ||
    /replace|changeme|placeholder/i.test(jwtAccessSecret)
  )
    bad('JWT_ACCESS_SECRET');
  const jwtAccessTtlSeconds = integer('JWT_ACCESS_TTL_SECONDS', 900, 900);
  if (jwtAccessTtlSeconds < 60) bad('JWT_ACCESS_TTL_SECONDS');
  const refreshTokenTtlSeconds = integer('REFRESH_TOKEN_TTL_SECONDS', 604800, 2592000);
  if (refreshTokenTtlSeconds < 3600) bad('REFRESH_TOKEN_TTL_SECONDS');
  const origins = (
    source.WEB_ORIGIN ?? (production ? '' : 'http://localhost:5173,http://localhost:5174')
  )
    .split(',')
    .map((v) => v.trim());
  if (
    !origins.length ||
    origins.some((value) => {
      try {
        const url = new URL(value);
        return (
          !['http:', 'https:'].includes(url.protocol) ||
          url.origin !== value ||
          Boolean(url.username || url.password) ||
          value.includes('*') ||
          (production && url.protocol !== 'https:')
        );
      } catch {
        return true;
      }
    })
  )
    bad('WEB_ORIGIN');
  const host = source.API_HOST ?? '0.0.0.0';
  if (!isIP(host)) bad('API_HOST');
  const swaggerEnabled = boolean('SWAGGER_ENABLED', !production);
  if (production && swaggerEnabled) bad('SWAGGER_ENABLED');
  const trustedProxies = source.TRUSTED_PROXIES
    ? source.TRUSTED_PROXIES.split(',').map((v) => v.trim())
    : [];
  for (const value of trustedProxies) {
    const parts = value.split('/');
    const version = isIP(parts[0] ?? '');
    if (
      !version ||
      parts.length > 2 ||
      (parts.length === 2 &&
        (!/^\d+$/.test(parts[1] ?? '') ||
          Number(parts[1]) < 1 ||
          Number(parts[1]) > (version === 4 ? 32 : 128)))
    )
      bad('TRUSTED_PROXIES');
  }
  return {
    nodeEnv: nodeEnv as Environment['nodeEnv'],
    databaseUrl: db.toString(),
    host,
    port: integer('API_PORT', 3000, 65535),
    origins: [...new Set(origins)],
    swaggerEnabled,
    trustedProxies,
    rateLimit: integer('RATE_LIMIT_LIMIT', 120, 10000),
    rateTtlMs: integer('RATE_LIMIT_TTL_MS', 60000, 3600000),
    bodyLimitBytes: integer('API_BODY_LIMIT_KB', 64, 1024) * 1024,
    jwtAccessSecret,
    jwtAccessTtlSeconds,
    refreshTokenTtlSeconds,
  };
}

function loadDevelopmentEnvironment(): void {
  if (process.env.NODE_ENV === 'production') return;
  let directory = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(directory, 'pnpm-workspace.yaml'))) {
    if (directory === parse(directory).root) return;
    directory = dirname(directory);
  }
  const envPath = join(directory, '.env');
  if (existsSync(envPath)) loadEnvFile(envPath);
  // Production mode must be explicitly supplied by the process, never activated by a local file.
  if (process.env.NODE_ENV === 'production') throw new Error('Invalid configuration: NODE_ENV');
  if (!process.env.JWT_ACCESS_SECRET) {
    const authPath = join(directory, '.env.auth.local');
    if (!existsSync(authPath)) {
      try {
        writeFileSync(authPath, `JWT_ACCESS_SECRET=${randomBytes(48).toString('hex')}\n`, {
          flag: 'wx',
          mode: 0o600,
        });
      } catch (error: unknown) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST'))
          throw new Error('Cannot prepare local authentication configuration', { cause: error });
      }
    }
    loadEnvFile(authPath);
  }
}
@Injectable()
export class ConfigService {
  readonly values: Environment;
  constructor() {
    loadDevelopmentEnvironment();
    this.values = validateEnvironment(process.env);
  }
}
