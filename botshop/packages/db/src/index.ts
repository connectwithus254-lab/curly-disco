/**
 * Database access layer.
 *
 * Rules enforced here (docs/02-data-model.md, docs/06-threat-model.md T1):
 *  - Tenant data is ONLY reachable through `withTenant`, which sets `app.tenant_id` for the
 *    duration of a transaction so Postgres RLS can do its job.
 *  - Platform-admin access is a separate, explicitly named door (`withPlatform`) and is audited.
 *  - No query helper ever interpolates identifiers; values are always bound parameters.
 */
import { Pool, type PoolClient, type QueryResultRow } from 'pg';

export interface DbConfig {
  connectionString: string;
  max?: number;
  applicationName?: string;
}

export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<R[]>;
  queryOne<R extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<R | null>;
}

export class Db {
  readonly pool: Pool;

  constructor(config: DbConfig) {
    this.pool = new Pool({
      connectionString: config.connectionString,
      max: config.max ?? 10,
      application_name: config.applicationName ?? 'botshop',
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }

  get connectionString(): string {
    return this.pool.options.connectionString as string;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  /** Unscoped query — migrations, health checks, and auth lookups only. */
  async raw<R extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<R[]> {
    const res = await this.pool.query<R>(sql, params as never);
    return res.rows;
  }

  /**
   * Runs `fn` inside a transaction with the tenant context set, so RLS restricts every query.
   * `role` is exposed to policies/triggers via app.actor_role.
   */
  async withTenant<T>(
    tenantId: string,
    fn: (tx: Tx) => Promise<T>,
    opts: { actorRole?: string } = {},
  ): Promise<T> {
    return this.transaction(async (client) => {
      await client.query('select set_config($1, $2, true)', ['app.tenant_id', tenantId]);
      await client.query('select set_config($1, $2, true)', ['app.actor_role', opts.actorRole ?? 'system']);
      return fn(new Tx(client));
    });
  }

  /**
   * Platform-admin / background-job access across tenants.
   * Callers must already have authenticated a platform admin or be trusted infrastructure code.
   */
  async withPlatform<T>(fn: (tx: Tx) => Promise<T>, opts: { actorRole?: string } = {}): Promise<T> {
    return this.transaction(async (client) => {
      await client.query('select set_config($1, $2, true)', ['app.platform', 'on']);
      await client.query('select set_config($1, $2, true)', ['app.actor_role', opts.actorRole ?? 'platform']);
      return fn(new Tx(client));
    });
  }

  private async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await fn(client);
      await client.query('commit');
      return result;
    } catch (error) {
      try {
        await client.query('rollback');
      } catch {
        /* connection already broken */
      }
      throw error;
    } finally {
      client.release();
    }
  }
}

export class Tx implements Queryable {
  constructor(private readonly client: PoolClient) {}

  async query<R extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<R[]> {
    const res = await this.client.query<R>(sql, params as never);
    return res.rows;
  }

  async queryOne<R extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<R | null> {
    const rows = await this.query<R>(sql, params);
    return rows.length > 0 ? rows[0]! : null;
  }

  async execute(sql: string, params: unknown[] = []): Promise<number> {
    const res = await this.client.query(sql, params as never);
    return res.rowCount ?? 0;
  }
}

export function createDb(config: DbConfig): Db {
  return new Db(config);
}
