import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));

export async function startTestApi(t, options = {}) {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  const child = spawn(process.execPath, [options.entry ?? 'apps/api/dist/main.js'], {
    cwd: projectRoot,
    env: { ...process.env, ...options.env, API_PORT: String(port) },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (data) => {
      output = (output + data.toString()).slice(-4000);
      options.onOutput?.(data.toString());
    });
  }
  t.after(async () => {
    if (child.exitCode !== null && child.exitCode !== 0) {
      t.diagnostic(`API exited with code ${child.exitCode}: ${output}`);
    }
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
  });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      assert.fail(`API exited during startup: ${output}`);
    }
    try {
      const response = await fetch(`${base}/api/v1/health`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return base;
    } catch {
      /* Retry while the test server starts. */
    }
    await delay(100);
  }
  assert.fail(`API did not become ready: ${output}`);
}
