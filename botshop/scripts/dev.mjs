#!/usr/bin/env node
/**
 * One-command local stack: embedded PostgreSQL + migrations + seed + API/worker.
 *
 *   npm run dev
 *
 * Why embedded Postgres: the M1 slice needs zero external services to be testable, so a
 * non-technical user (or CI) can run the whole platform with `npm install && npm run dev`.
 * In production you point DATABASE_URL/DATABASE_ADMIN_URL at a managed Postgres instead.
 */
import EmbeddedPostgres from 'embedded-postgres';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(root, '.cache', 'pgdata');
const PORT = Number(process.env.DEV_DB_PORT ?? 54329);
const DB_NAME = 'botshop';

const ADMIN_URL = `postgres://postgres:postgres@127.0.0.1:${PORT}/${DB_NAME}`;
const APP_URL = `postgres://botshop_app:botshop_app@127.0.0.1:${PORT}/${DB_NAME}`;

function run(command, args, env) {
  return new Promise((resolvePromise, reject) => {
    const child = execFile(command, args, { cwd: root, env: { ...process.env, ...env } }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${command} ${args.join(' ')} failed:\n${stderr || stdout}`));
      } else {
        process.stdout.write(stdout);
        resolvePromise();
      }
    });
    child.on('error', reject);
  });
}

async function main() {
  await mkdir(DATA_DIR, { recursive: true });

  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: 'postgres',
    password: 'postgres',
    port: PORT,
    persistent: true,
  });

  console.log(`[dev] starting embedded PostgreSQL on port ${PORT} (data: ${DATA_DIR})`);
  try {
    await pg.initialise();
  } catch (error) {
    if (!String(error).includes('already')) {
      // An existing data directory is fine — that is the point of `persistent: true`.
      console.log('[dev] initialise skipped:', String(error).split('\n')[0]);
    }
  }
  try {
    await pg.start();
  } catch (error) {
    console.log('[dev] start reported:', String(error).split('\n')[0], '(assuming a server is already running)');
  }
  try {
    await pg.createDatabase(DB_NAME);
  } catch {
    /* database already exists */
  }

  const encryptionKeys = process.env.ENCRYPTION_KEYS ?? `dev:${randomBytes(32).toString('hex')}`;
  const env = {
    NODE_ENV: 'development',
    DATABASE_URL: APP_URL,
    DATABASE_ADMIN_URL: ADMIN_URL,
    ENCRYPTION_KEYS: encryptionKeys,
    ENCRYPTION_ACTIVE_KEY_ID: encryptionKeys.split(':')[0],
    PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`,
    PORT: String(process.env.PORT ?? 3000),
    TELEGRAM_MODE: process.env.TELEGRAM_MODE ?? 'fake',
    TELEGRAM_POLLING: process.env.TELEGRAM_POLLING ?? (process.env.TELEGRAM_MODE === 'live' ? 'true' : 'false'),
    LOG_LEVEL: process.env.LOG_LEVEL ?? 'info',
  };

  if (process.env.RESET === 'false') {
    // Keep existing data: apply pending migrations only (additive, forward-only).
    console.log('[dev] applying pending migrations (RESET=false — your data is kept)…');
    await run('npx', ['tsx', 'packages/db/src/cli.ts', 'migrate'], env);
  } else {
    console.log('[dev] resetting schema, applying migrations and seeding demo data…');
    console.log('[dev] (set RESET=false to keep your data across restarts)');
    await run('npx', ['tsx', 'packages/db/src/cli.ts', 'reset'], env);
  }

  console.log('[dev] starting API + worker');
  const api = execFile('npx', ['tsx', 'apps/api/src/main.ts'], { cwd: root, env: { ...process.env, ...env } });
  api.stdout.pipe(process.stdout);
  api.stderr.pipe(process.stderr);

  const stop = async () => {
    console.log('\n[dev] shutting down…');
    api.kill('SIGTERM');
    try {
      await pg.stop();
    } catch {
      /* ignore */
    }
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  console.log(`
[dev] ready:
  panel   ${env.PUBLIC_BASE_URL}
  login   owner@kesi.test / demo-password-123
  admin   admin@botshop.test / demo-password-123
  telegram mode: ${env.TELEGRAM_MODE}${env.TELEGRAM_MODE === 'fake' ? ' (nothing leaves this machine)' : ''}
`);
}

main().catch((error) => {
  console.error('[dev] fatal:', error.message);
  process.exit(1);
});
