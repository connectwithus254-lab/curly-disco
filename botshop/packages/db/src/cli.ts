#!/usr/bin/env node
/**
 * Database CLI: migrate | seed | reset
 *
 * Migrations and seeding connect with DATABASE_ADMIN_URL (the owner role) because they create
 * schema objects and need to bypass RLS. The application itself must use DATABASE_URL
 * (the `botshop_app` role) so that row-level security is always enforced.
 */
import { KeyRing } from '@botshop/core';
import { createDb } from './index.ts';
import { migrate, resetSchema } from './migrate.ts';
import { seed } from './seed.ts';

const ADMIN_URL =
  process.env.DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres@127.0.0.1:54329/botshop';

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'migrate';
  switch (command) {
    case 'migrate': {
      const result = await migrate(ADMIN_URL, (msg) => console.log(`✓ ${msg}`));
      console.log(`migrations: ${result.applied.length} applied, ${result.skipped.length} already up to date`);
      break;
    }
    case 'seed': {
      const db = createDb({ connectionString: ADMIN_URL, applicationName: 'botshop-seed' });
      try {
        const result = await seed(db, {
          keyRing: process.env.ENCRYPTION_KEYS ? KeyRing.fromEnv() : undefined,
        });
        console.log('✓ seeded');
        console.log(`  tenant:         ${result.tenantId}`);
        console.log(`  shop:           ${result.shopId}`);
        console.log(`  owner login:    ${result.ownerEmail} / ${result.ownerPassword}`);
        console.log(`  platform login: ${result.platformAdminEmail} / ${result.platformAdminPassword}`);
      } finally {
        await db.close();
      }
      break;
    }
    case 'reset': {
      if (process.env.NODE_ENV === 'production') throw new Error('refusing to reset a production database');
      await resetSchema(ADMIN_URL);
      const result = await migrate(ADMIN_URL, (msg) => console.log(`✓ ${msg}`));
      const db = createDb({ connectionString: ADMIN_URL, applicationName: 'botshop-seed' });
      try {
        await seed(db, { keyRing: process.env.ENCRYPTION_KEYS ? KeyRing.fromEnv() : undefined });
      } finally {
        await db.close();
      }
      console.log(`reset complete (${result.applied.length} migrations applied, demo data seeded)`);
      break;
    }
    default:
      console.error(`unknown command "${command}" — use migrate | seed | reset`);
      process.exit(1);
  }
}

main().catch((error) => {
  console.error(`✗ ${(error as Error).message}`);
  process.exit(1);
});
