/**
 * Tiny forward-only SQL migrator.
 *  - files live in ./migrations/0001_*.sql, applied in filename order
 *  - each migration runs in its own transaction and is recorded with a checksum
 *  - a changed checksum on an applied migration is a hard error (no silent drift)
 * Migrations connect as the database owner, which bypasses RLS on purpose.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = join(here, 'migrations');

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export async function migrate(databaseUrl: string, log: (msg: string) => void = () => {}): Promise<MigrationResult> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const applied: string[] = [];
  const skipped: string[] = [];
  try {
    // The ledger is owned by the migrator, not by any single migration, so a fresh database
    // (or one whose public schema was just reset) can bootstrap itself.
    await pool.query(`
      create table if not exists schema_migrations (
        id text primary key,
        checksum text not null,
        applied_at timestamptz not null default now()
      )
    `);

    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const { rows } = await pool.query<{ checksum: string }>('select checksum from schema_migrations where id = $1', [
        file,
      ]);
      const existing = rows[0];
      if (existing) {
        if (existing.checksum !== checksum) {
          throw new Error(
            `migration ${file} was modified after being applied (checksum mismatch). ` +
              `Create a new migration instead of editing an applied one.`,
          );
        }
        skipped.push(file);
        continue;
      }
      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query(sql);
        await client.query('insert into schema_migrations (id, checksum) values ($1, $2)', [file, checksum]);
        await client.query('commit');
        applied.push(file);
        log(`applied ${file}`);
      } catch (error) {
        await client.query('rollback');
        throw new Error(`migration ${file} failed: ${(error as Error).message}`);
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }
  return { applied, skipped };
}

/** Dev/test only: drops and recreates the public schema, then re-grants the app role. */
export async function resetSchema(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    // Both schemas belong to the application; dropping `app` as well guarantees a true clean
    // slate, so re-running migrations can never collide with a previous function signature.
    await pool.query('drop schema if exists public cascade');
    await pool.query('drop schema if exists app cascade');
    await pool.query('create schema public');
    // The role is created by migration 0001, but a reset can run before that migration exists.
    await pool.query(`
      do $$
      begin
        if not exists (select 1 from pg_roles where rolname = 'botshop_app') then
          create role botshop_app login password 'botshop_app';
        end if;
      end $$;
    `);
    await pool.query('grant usage on schema public to botshop_app');
  } finally {
    await pool.end();
  }
}
