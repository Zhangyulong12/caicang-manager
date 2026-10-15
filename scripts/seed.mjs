import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { seedDatabase } from '../apps/api/dist/database/seed.js';

loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
await seedDatabase(process.env.DATABASE_URL);
