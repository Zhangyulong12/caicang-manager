import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  stat,
  realpath,
  readdir,
  unlink,
} from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolve, dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { pipeline } from 'node:stream/promises';
const root = fileURLToPath(new URL('../', import.meta.url));
const [mode, ...args] = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf('--' + name);
  return index < 0 ? undefined : args[index + 1];
};
const envFile = option('env-file');
if (!['backup', 'restore', 'prune'].includes(mode) || !envFile)
  throw new Error('Use backup|restore|prune --env-file <independent-production-env>');
const envPath = await realpath(resolve(envFile));
if (envPath === join(root, '.env')) throw new Error('Development .env is not a production target');
const settings = parseEnv(await readFile(envPath, 'utf8'));
const project = settings.COMPOSE_PROJECT_NAME;
if (!project || !/^caicang-[a-z0-9_-]+$/.test(project) || project === 'caicang-manager-dev')
  throw new Error('Explicit independent caicang-* Compose project required');
const database = settings.POSTGRES_DB ?? 'caicang';
if (!/^[a-z][a-z0-9_]{0,62}$/.test(database)) throw new Error('Invalid database name');
const compose = [
  'compose',
  '--env-file',
  envPath,
  '-p',
  project,
  '-f',
  join(root, 'infra/production/compose.yml'),
];
async function docker(args, { input, output, text } = {}) {
  const child = spawn('docker', [...compose, ...args], {
    cwd: root,
    env: { ...process.env, ...settings },
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let out = '',
    error = '';
  child.stderr.on('data', (chunk) => {
    error = (error + chunk.toString()).slice(-4096);
  });
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              'Database command failed (raw SQL/row values withheld); exit=' +
                code +
                '; category=' +
                (/permission denied/i.test(error)
                  ? 'PERMISSION_DENIED'
                  : /authentication failed/i.test(error)
                    ? 'AUTHENTICATION_FAILED'
                    : /no space left/i.test(error)
                      ? 'DISK_FULL'
                      : /connection refused/i.test(error)
                        ? 'CONNECTION_REFUSED'
                        : 'PG_COMMAND_FAILED'),
            ),
          ),
    );
  });
  const streams = [];
  if (output)
    streams.push(pipeline(child.stdout, createWriteStream(output, { flags: 'wx', mode: 0o600 })));
  else
    child.stdout.on('data', (chunk) => {
      out += chunk.toString();
    });
  if (input) streams.push(pipeline(createReadStream(input), child.stdin));
  else child.stdin.end(text);
  await Promise.all([exited, ...streams]);
  return out;
}
const exec = ['exec', '-T', 'postgres'];
const sql = (database, query) =>
  docker(
    [
      ...exec,
      'psql',
      '-X',
      '-A',
      '-t',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'caicang_owner',
      '-d',
      database,
    ],
    { text: query },
  );
async function digest(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
if (mode === 'backup') {
  const directory = option('output-dir');
  if (!directory) throw new Error('Explicit --output-dir required');
  await mkdir(resolve(directory), { recursive: true, mode: 0o700 });
  const output = join(
    await realpath(resolve(directory)),
    `caicang-${database}-${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.dump`,
  );
  const part = output + '.part';
  await docker(
    [
      ...exec,
      'pg_dump',
      '-U',
      'caicang_owner',
      '-d',
      database,
      '--format=custom',
      '--no-owner',
      '--no-acl',
    ],
    { output: part },
  );
  await docker([...exec, 'pg_restore', '--list'], { input: part });
  await rename(part, output);
  const metadata = {
    format: 'pg_dump-custom',
    project,
    database,
    createdAt: new Date().toISOString(),
    sha256: await digest(output),
    bytes: (await stat(output)).size,
    serverVersion: (await sql(database, 'SHOW server_version;')).trim(),
    release: settings.RELEASE_TAG,
  };
  await writeFile(output + '.json', JSON.stringify(metadata, null, 2), { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ backup: output, ...metadata }));
} else if (mode === 'restore') {
  const file = option('backup'),
    target = option('target-database');
  if (!file || !target || !/^caicang_restore_[a-z0-9_]{8,40}$/.test(target))
    throw new Error('Restore requires --backup and a NEW caicang_restore_* --target-database');
  const archive = await realpath(resolve(file)),
    metadata = JSON.parse(await readFile(archive + '.json', 'utf8'));
  if (metadata.format !== 'pg_dump-custom' || metadata.sha256 !== (await digest(archive)))
    throw new Error('Backup integrity verification failed');
  const exists = (
    await sql('postgres', `SELECT 1 FROM pg_database WHERE datname='${target}';`)
  ).trim();
  if (exists) throw new Error('Restore target already exists; no overwrite or DROP is allowed');
  await sql('postgres', `CREATE DATABASE "${target}" OWNER caicang_owner;`);
  await docker(
    [
      ...exec,
      'pg_restore',
      '-U',
      'caicang_owner',
      '--dbname',
      target,
      '--no-owner',
      '--no-acl',
      '--single-transaction',
      '--exit-on-error',
    ],
    { input: archive },
  );
  // Historical migrations deliberately retain a NOT VALID legacy reason constraint.
  // Validate existing rows in the NEW restore target; never rewrite the source or its data.
  await sql(
    target,
    `DO $validation$
    DECLARE constraint_row record;
    BEGIN
      FOR constraint_row IN SELECT c.conname,t.relname FROM pg_constraint c
        JOIN pg_class t ON t.oid=c.conrelid
        WHERE NOT c.convalidated AND c.connamespace='public'::regnamespace
      LOOP
        EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I',constraint_row.relname,constraint_row.conname);
      END LOOP;
    END $validation$;`,
  );
  const facts = JSON.parse(
    (
      await sql(
        target,
        `SELECT json_build_object('migrations',(SELECT COUNT(*) FROM _prisma_migrations),'tenants',(SELECT COUNT(*) FROM tenants),'products',(SELECT COUNT(*) FROM products),'orders',(SELECT COUNT(*) FROM purchase_orders),'receipts',(SELECT COUNT(*) FROM receipts),'movements',(SELECT COUNT(*) FROM stock_movements),'negativeBalances',(SELECT COUNT(*) FROM stock_balances WHERE quantity_on_hand<0 OR total_cost<0),'invalidConstraints',(SELECT COUNT(*) FROM pg_constraint WHERE NOT convalidated AND connamespace='public'::regnamespace));`,
      )
    ).trim(),
  );
  if (Number(facts.negativeBalances) || Number(facts.invalidConstraints))
    throw new Error('Restored database requires integrity review; original database untouched');
  const verification = {
    restoredDatabase: target,
    project,
    sha256: metadata.sha256,
    verifiedAt: new Date().toISOString(),
    facts,
  };
  await writeFile(archive + '.verified.json', JSON.stringify(verification, null, 2), {
    mode: 0o600,
  });
  console.log(JSON.stringify(verification));
} else {
  const directory = option('output-dir');
  if (!directory) throw new Error('Explicit --output-dir required');
  const directoryPath = await realpath(resolve(directory));
  const days = Number(option('retention-days') ?? 14);
  if (!Number.isInteger(days) || days < 7 || days > 3650)
    throw new Error('Retention days must be 7..3650');
  const archives = [];
  for (const file of await readdir(directoryPath)) {
    if (!/^caicang-[a-z0-9_]+-[0-9TZ-]+-[a-f0-9]{8}\.dump$/.test(file)) continue;
    const path = await realpath(join(directoryPath, file));
    if (dirname(path) !== directoryPath || !path.startsWith(directoryPath + sep))
      throw new Error('Unsafe backup path');
    try {
      const meta = JSON.parse(await readFile(path + '.json', 'utf8'));
      if (
        meta.project === project &&
        meta.database === database &&
        meta.sha256 === (await digest(path))
      )
        archives.push({ path, meta });
    } catch {
      /* Unknown/incomplete archives are retained for operator review. */
    }
  }
  archives.sort((a, b) => b.meta.createdAt.localeCompare(a.meta.createdAt));
  const candidates = archives
    .slice(2)
    .filter((a) => Date.now() - Date.parse(a.meta.createdAt) > days * 86400000);
  if (args.includes('--apply')) {
    const latestVerified = await Promise.all(
      archives.slice(0, 2).map(async (a) => {
        try {
          return (
            JSON.parse(await readFile(a.path + '.verified.json', 'utf8')).sha256 === a.meta.sha256
          );
        } catch {
          return false;
        }
      }),
    );
    if (!latestVerified.includes(true))
      throw new Error('Keep a recent restore-verified backup before pruning');
    for (const a of candidates) {
      await unlink(a.path);
      await unlink(a.path + '.json');
      try {
        await unlink(a.path + '.verified.json');
      } catch {
        /* No verification file to remove. */
      }
    }
  }
  console.log(
    JSON.stringify({
      mode: args.includes('--apply') ? 'applied' : 'dry-run',
      keptNewestAtLeast: 2,
      retentionDays: days,
      candidates: candidates.map((a) => a.path),
    }),
  );
}
