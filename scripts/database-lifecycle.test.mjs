import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { projectRoot, startTestApi } from './api-test-server.mjs';

const dockerBin = path.join(
  process.env.LOCALAPPDATA,
  'Programs',
  'DockerDesktop',
  'resources',
  'bin',
);
const childEnv = { ...process.env, PATH: `${dockerBin}${path.delimiter}${process.env.PATH}` };
const runFile = promisify(execFile);

function docker(args) {
  return execFileSync('docker.exe', args, {
    cwd: projectRoot,
    env: childEnv,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10000,
  }).trim();
}

async function runScript(name) {
  const result = await runFile(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(projectRoot, 'scripts', name)],
    {
      cwd: projectRoot,
      env: childEnv,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 150000,
    },
  );
  return result.stdout;
}

function identity() {
  const container = JSON.parse(docker(['inspect', 'caicang-postgres']))[0];
  const volume = container.Mounts.find((mount) => mount.Destination === '/var/lib/postgresql/data');
  return {
    containerId: container.Id,
    volumeName: volume.Name,
    clusterId: docker([
      'exec',
      'caicang-postgres',
      'psql',
      '-U',
      'caicang',
      '-d',
      'caicang',
      '-Atc',
      'SELECT system_identifier FROM pg_control_system();',
    ]),
    envHash: createHash('sha256')
      .update(readFileSync(path.join(projectRoot, '.env')))
      .digest('hex'),
  };
}

test('database stop/start retains data and API health reflects live connectivity', async (t) => {
  await runScript('verify-db.ps1');
  const before = identity();
  const base = await startTestApi(t);
  try {
    await runScript('db-stop.ps1');
    assert.equal(
      docker(['inspect', 'caicang-postgres', '--format', '{{.State.Status}}']),
      'exited',
    );
    await t.test('database unavailable returns a sanitized 503 response', async () => {
      const response = await fetch(`${base}/api/v1/health`, { signal: AbortSignal.timeout(10000) });
      assert.equal(response.status, 503);
      const body = await response.json();
      assert.equal(body.error.code, 'DATABASE_UNAVAILABLE');
      assert.ok(body.requestId);
      assert.equal(JSON.stringify(body).includes('postgresql://'), false);
    });
  } finally {
    // Restore the originally running database even if stop/check partially fails.
    await runScript('db-up.ps1');
  }
  await runScript('verify-db.ps1');
  await t.test(
    'restart preserves container, volume, database cluster and local credentials',
    () => {
      assert.deepEqual(identity(), before);
    },
  );
  await t.test('running API reconnects without a process restart', async () => {
    const response = await fetch(`${base}/api/v1/health`, { signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.database, 'reachable');
  });
});
