import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

const envPath = fileURLToPath(new URL('../../../../.env', import.meta.url));
if (existsSync(envPath)) loadEnvFile(envPath);

export function databaseUrl(): string {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error('缺少 DATABASE_URL，请先运行 pnpm db:up');
  const parsed = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('DATABASE_URL 必须使用 PostgreSQL');
  }
  return value;
}

export function apiPort(): number {
  const port = Number(process.env.API_PORT ?? '3000');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('API_PORT 无效');
  return port;
}

export function webOrigins(): string[] {
  return (process.env.WEB_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((value) => value.trim());
}
