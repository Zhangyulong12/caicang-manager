import { mkdir, access, readFile, writeFile, cp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { productionApiUrl, releaseManifest } from './mobile-production-config.mjs';
const args = process.argv.slice(2),
  option = (name) => args[args.indexOf('--' + name) + 1];
if (!args.includes('--api-base-url') || !args.includes('--output-dir'))
  throw new Error('Use --api-base-url https://approved-domain/api/v1 --output-dir <NEW-directory>');
const api = productionApiUrl(option('api-base-url')),
  output = resolve(option('output-dir'));
let exists = false;
try {
  await access(output);
  exists = true;
} catch {
  /* A new directory is required. */
}
if (exists) throw new Error('Output already exists; no test resources or APK will be replaced');
const root = fileURLToPath(new URL('../', import.meta.url)),
  stage = join(root, 'apps/mobile/node_modules/.cache/mobile-release-' + randomUUID(), 'src');
await mkdir(stage, { recursive: true });
await cp(join(root, 'apps/mobile/src'), stage, { recursive: true, errorOnExist: false });
const manifest = releaseManifest(JSON.parse(await readFile(join(stage, 'manifest.json'), 'utf8')));
await writeFile(join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2));
const child = spawn(
  process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  ['--filter', '@caicang/mobile', 'build:app', '--mode', 'production'],
  {
    cwd: root,
    env: { ...process.env, VITE_API_BASE_URL: api, UNI_INPUT_DIR: stage, UNI_OUTPUT_DIR: output },
    stdio: 'inherit',
    windowsHide: true,
    shell: process.platform === 'win32',
  },
);
const code = await new Promise((r, j) => {
  child.on('error', j);
  child.on('close', r);
});
if (code !== 0) throw new Error('Production App resource build failed');
const bundle = await readFile(join(output, 'app-service.js'), 'utf8');
if (!bundle.includes(api)) throw new Error('Built resources do not contain approved API address');
await writeFile(
  join(output, 'release-preparation.json'),
  JSON.stringify(
    {
      api,
      cleartextTraffic: false,
      signedApk: false,
      deviceAccepted: false,
      createdAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
console.log(
  'App resources prepared at ' +
    output +
    '; import into HBuilderX and review app identifier/signing. No APK was signed, installed or published.',
);
