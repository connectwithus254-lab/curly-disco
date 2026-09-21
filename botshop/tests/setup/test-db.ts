/**
 * Integration-test harness: one embedded PostgreSQL instance, migrated and seeded once,
 * shared by every integration test file (see vitest.config.ts → singleFork).
 *
 * Nothing here reaches the network: Telegram runs in fake mode and there is no pg-boss.
 */
import EmbeddedPostgres from 'embedded-postgres';
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KeyRing } from '@botshop/core';
import { createDb, type Db } from '@botshop/db';
import { migrate, resetSchema } from '@botshop/db/migrate';
import { seed } from '@botshop/db/seed';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const TEST_DB_PORT = Number(process.env.TEST_DB_PORT ?? 54331);
export const TEST_ADMIN_URL = `postgres://postgres:postgres@127.0.0.1:${TEST_DB_PORT}/botshop`;
export const TEST_APP_URL = `postgres://botshop_app:botshop_app@127.0.0.1:${TEST_DB_PORT}/botshop`;

export interface TestEnv {
  db: Db;
  adminDb: Db;
  keyRing: KeyRing;
  tenantId: string;
  ownerEmail: string;
  ownerPassword: string;
}

let envPromise: Promise<TestEnv> | null = null;

export const TEST_ENCRYPTION_KEYS = `test:${'a'.repeat(63)}1`;

export function testEnv(): Promise<TestEnv> {
  envPromise ??= boot();
  return envPromise;
}

async function boot(): Promise<TestEnv> {
  await mkdir(join(root, '.cache'), { recursive: true });
  const pg = new EmbeddedPostgres({
    databaseDir: join(root, '.cache', 'pg-test'),
    user: 'postgres',
    password: 'postgres',
    port: TEST_DB_PORT,
    persistent: true,
  });

  try {
    await pg.initialise();
  } catch {
    /* data directory already initialised */
  }
  try {
    await pg.start();
  } catch {
    /* a server is already listening on the test port */
  }
  try {
    await pg.createDatabase('botshop');
  } catch {
    /* database exists */
  }

  await resetSchema(TEST_ADMIN_URL);
  const migration = await migrate(TEST_ADMIN_URL);
  if (migration.applied.length === 0 && migration.skipped.length === 0) {
    throw new Error('no migrations found — is packages/db/src/migrations present?');
  }

  const keyRing = new KeyRing({ test: 'a'.repeat(63) + '1' }, 'test');
  const adminDb = createDb({ connectionString: TEST_ADMIN_URL, applicationName: 'botshop-test-admin' });
  const seeded = await seed(adminDb, {
    ownerEmail: 'owner@test.local',
    ownerPassword: 'test-password-123',
    platformAdminEmail: 'admin@test.local',
    platformAdminPassword: 'test-password-123',
    keyRing,
  });

  const db = createDb({ connectionString: TEST_APP_URL, applicationName: 'botshop-test-app' });
  return {
    db,
    adminDb,
    keyRing,
    tenantId: seeded.tenantId,
    ownerEmail: seeded.ownerEmail,
    ownerPassword: seeded.ownerPassword,
  };
}
