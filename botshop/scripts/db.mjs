#!/usr/bin/env node
/**
 * Database helper for local work:
 *   npm run db:up      start embedded Postgres and keep it running
 *   npm run db:migrate apply pending migrations (via packages/db/src/cli.ts)
 *   npm run db:reset   drop schema, migrate, reseed
 * For production deployments use `npm run db:migrate` against the real DATABASE_ADMIN_URL.
 */
import EmbeddedPostgres from 'embedded-postgres';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.DEV_DB_PORT ?? 54329);

async function main() {
  const command = process.argv[2] ?? 'up';
  const pg = new EmbeddedPostgres({
    databaseDir: join(root, '.cache', 'pgdata'),
    user: 'postgres',
    password: 'postgres',
    port: PORT,
    persistent: true,
  });

  try {
    await pg.initialise();
  } catch {
    /* existing data directory */
  }
  await pg.start();
  try {
    await pg.createDatabase('botshop');
  } catch {
    /* exists */
  }
  console.log(`[db] PostgreSQL is up on port ${PORT}`);

  if (command === 'up') {
    console.log('[db] leave this process running; Ctrl+C to stop');
    const stop = async () => {
      await pg.stop();
      process.exit(0);
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    return;
  }
  await pg.stop();
}

main().catch((error) => {
  console.error('[db] fatal:', error.message);
  process.exit(1);
});
