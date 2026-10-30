import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute, dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { productionApiUrl } from './mobile-production-config.mjs';
const args = process.argv.slice(2),
  option = (name) => {
    const i = args.indexOf('--' + name);
    return i < 0 ? undefined : args[i + 1];
  };
const target = option('directory'),
  domain = option('domain'),
  email = option('email'),
  release = option('release-tag');
if (!target || !domain || !email || !release)
  throw new Error(
    'Use --directory <NEW-private-directory-outside-repository> --domain <approved-domain> --email <certificate-contact> --release-tag <reviewed-image-tag>',
  );
productionApiUrl('https://' + domain + '/api/v1');
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\w[\w.-]{0,127}$/.test(release))
  throw new Error('Invalid certificate contact or image tag');
const root = fileURLToPath(new URL('../', import.meta.url)),
  directory = resolve(target),
  within = relative(root, directory);
if (!within || (!(within === '..' || within.startsWith('..' + sep)) && !isAbsolute(within)))
  throw new Error('Production secrets must be outside the repository');
await mkdir(dirname(directory), { recursive: true });
await mkdir(directory, { mode: 0o700 });
if (process.platform === 'win32') {
  const run = promisify(execFile),
    account = (await run('whoami')).stdout.trim();
  await run(
    'icacls',
    [
      directory,
      '/inheritance:r',
      '/grant:r',
      account + ':(OI)(CI)F',
      '/grant:r',
      '*S-1-5-18:(OI)(CI)F',
    ],
    { windowsHide: true },
  );
}
const secrets = join(directory, 'secrets');
await mkdir(secrets, { mode: 0o700 });
// Parent directories are private. Bind-mounted secret files are readable by the authorized
// postgres/app container users; Compose controls which service receives each file.
for (const name of ['owner_password', 'app_password', 'jwt_secret'])
  await writeFile(join(secrets, name), randomBytes(48).toString('hex'), {
    flag: 'wx',
    mode: 0o444,
  });
const envFile = join(directory, '.env.production.local');
await writeFile(
  envFile,
  `COMPOSE_PROJECT_NAME=caicang-production\nRELEASE_TAG=${release}\nSITE_DOMAIN=${domain}\nACME_EMAIL=${email}\nSECRETS_DIR=${secrets.replaceAll('\\', '/')}\nPOSTGRES_DB=caicang\nPUBLIC_REGISTRATION_ENABLED=false\nPUBLIC_BIND_ADDRESS=127.0.0.1\nHTTP_PORT=80\nHTTPS_PORT=443\nPROXY_SUBNET=172.30.35.0/29\nPROXY_IP=172.30.35.2\nAPI_PROXY_IP=172.30.35.3\n`,
  { flag: 'wx', mode: 0o600 },
);
console.log(
  'Independent production configuration prepared: ' +
    envFile +
    '\nPublic binding and registration remain disabled. No service was started or exposed.',
);
