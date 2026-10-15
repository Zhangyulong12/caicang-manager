import { createApplication } from './bootstrap.js';
import { ConfigService } from './config/env.js';

try {
  const app = await createApplication();
  const config = app.get(ConfigService).values;
  await app.listen(config.port, config.host);
} catch (error: unknown) {
  const configuration =
    error instanceof Error && /^Invalid configuration: [A-Z_]+$/.test(error.message)
      ? error.message
      : 'API startup failed';
  process.stderr.write(
    JSON.stringify({ event: 'bootstrap_failed', message: configuration }) + '\n',
  );
  process.exit(1);
}
