import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const mode = process.argv[2];
if (!['api', 'migrate'].includes(mode)) throw new Error('Invalid production entry mode');
const readSecret = async (name) => {
  const path = process.env[name];
  if (!path?.startsWith('/run/secrets/')) throw new Error('Missing secret file: ' + name);
  const value = (await readFile(path, 'utf8')).trim();
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(value)) throw new Error('Invalid secret format: ' + name);
  return value;
};
const password = await readSecret(mode === 'api' ? 'APP_PASSWORD_FILE' : 'OWNER_PASSWORD_FILE');
const user = mode === 'api' ? 'caicang_app' : 'caicang_owner';
const database = process.env.POSTGRES_DB ?? 'caicang';
if (!/^[a-z][a-z0-9_]{0,62}$/.test(database)) throw new Error('Invalid database name');
const url = new URL('postgresql://postgres:5432/' + database);
url.username = user;
url.password = password;
url.searchParams.set('schema', 'public');
const env = { ...process.env, NODE_ENV: 'production', DATABASE_URL: url.toString() };
if (mode === 'api') env.JWT_ACCESS_SECRET = await readSecret('JWT_SECRET_FILE');
const cwd = mode === 'api' ? '/app' : '/workspace/apps/api';
const args =
  mode === 'api' ? ['dist/main.js'] : ['node_modules/prisma/build/index.js', 'migrate', 'deploy'];
const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
const scrub = (value) =>
  value
    .replaceAll(password, '[REDACTED]')
    .replaceAll(url.toString(), '[REDACTED_DATABASE_URL]')
    .replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, '[REDACTED_DATABASE_URL]');
for (const stream of [child.stdout, child.stderr])
  stream.on('data', (chunk) => process.stdout.write(scrub(chunk.toString())));
process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('SIGINT', () => child.kill('SIGINT'));
child.on('error', () => {
  process.stderr.write('Production child process failed\n');
  process.exit(1);
});
child.on('close', async (code) => {
  if (code !== 0 || mode === 'api') {
    process.exit(code ?? 1);
    return;
  }
  const { Client } = createRequire('/workspace/apps/api/package.json')('pg');
  const db = new Client({ connectionString: url.toString() });
  try {
    await db.connect();
    await db.query(`GRANT USAGE ON SCHEMA public TO caicang_app;
    GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO caicang_app;
    GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO caicang_app;
    ALTER DEFAULT PRIVILEGES FOR ROLE caicang_owner IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO caicang_app;
    ALTER DEFAULT PRIVILEGES FOR ROLE caicang_owner IN SCHEMA public GRANT USAGE,SELECT ON SEQUENCES TO caicang_app;
    REVOKE ALL ON TABLE _prisma_migrations FROM caicang_app;
    REVOKE UPDATE,DELETE,TRUNCATE ON stock_movements,audit_logs FROM caicang_app;`);
    console.log('Migration and runtime grants completed');
  } catch (error) {
    console.error(
      'Migration runtime grants failed:',
      typeof error?.code === 'string' && /^[A-Z0-9]{5}$/.test(error.code)
        ? error.code
        : 'DATABASE_ERROR',
    );
    process.exitCode = 1;
  } finally {
    await db.end();
  }
});
