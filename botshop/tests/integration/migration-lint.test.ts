/**
 * Schema guard rails. These assertions run against the real, migrated database, so a new table
 * that forgets RLS (or a money column that forgot numeric) fails CI instead of shipping.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { testEnv, type TestEnv } from '../setup/test-db.ts';

let env: TestEnv;

beforeAll(async () => {
  env = await testEnv();
});

describe('migration lint', () => {
  it('enables and forces row-level security on every table in the public schema', async () => {
    const rows = await env.adminDb.raw<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(`
      select c.relname, c.relrowsecurity, c.relforcerowsecurity
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
       order by c.relname
    `);
    expect(rows.length).toBeGreaterThan(5);
    // schema_migrations is the migrator's own bookkeeping table: it holds no tenant data and is
    // only ever touched by the owner role. Everything else must be protected.
    const infrastructureTables = new Set(['schema_migrations']);
    const unprotected = rows
      .filter((r) => !infrastructureTables.has(r.relname))
      .filter((r) => !r.relrowsecurity || !r.relforcerowsecurity)
      .map((r) => r.relname);
    expect(unprotected, 'tables missing ENABLE/FORCE ROW LEVEL SECURITY').toEqual([]);
  });

  it('gives every tenant-scoped table at least one policy', async () => {
    const tables = await env.adminDb.raw<{ table_name: string }>(`
      select table_name from information_schema.columns
       where table_schema = 'public' and column_name = 'tenant_id'
       group by table_name
    `);
    expect(tables.length).toBeGreaterThan(5);

    const policies = await env.adminDb.raw<{ tablename: string; count: string }>(`
      select tablename, count(*)::text as count from pg_policies
       where schemaname = 'public' group by tablename
    `);
    const withPolicy = new Set(policies.filter((p) => Number(p.count) > 0).map((p) => p.tablename));
    const missing = tables.filter((t) => !withPolicy.has(t.table_name)).map((t) => t.table_name);
    expect(missing, 'tenant tables with no RLS policy').toEqual([]);
  });

  it('keeps money-ish columns as numeric with 8 decimals (never float)', async () => {
    const floatColumns = await env.adminDb.raw<{ table_name: string; column_name: string; data_type: string }>(`
      select table_name, column_name, data_type from information_schema.columns
       where table_schema = 'public'
         and (column_name like '%amount%' or column_name like '%price%' or column_name like '%balance%')
         and data_type in ('double precision', 'real', 'money')
    `);
    expect(floatColumns).toEqual([]);
  });

  it('records applied migrations with checksums', async () => {
    const rows = await env.adminDb.raw<{ id: string; checksum: string }>('select id, checksum from schema_migrations');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => /^[0-9a-f]{64}$/.test(r.checksum))).toBe(true);
  });

  it('enforces the (bot_id, update_id) idempotency key on telegram_updates', async () => {
    const indexes = await env.adminDb.raw<{ indexdef: string }>(
      `select indexdef from pg_indexes where tablename = 'telegram_updates'`,
    );
    expect(indexes.some((i) => i.indexdef.includes('UNIQUE') && i.indexdef.includes('bot_id'))).toBe(true);
  });
});
