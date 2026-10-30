import { createApplication } from './bootstrap.js';
import { ConfigService } from './config/env.js';
import { formatBootstrapFailure, safeFailureMetadata } from './common/logging.js';

try {
  const app = await createApplication();
  const config = app.get(ConfigService).values;
  await app.listen(config.port, config.host);
} catch (error: unknown) {
  process.stderr.write(
    JSON.stringify({ ...formatBootstrapFailure(error), diagnostic: safeFailureMetadata(error) }) +
      '\n',
  );
  process.exit(1);
}
