/**
 * Repository layer. All tenant-scoped functions take a `Tx` that already carries the tenant
 * context (see Db.withTenant), so RLS is the backstop if a query ever forgets its tenant filter.
 */
import type { Tx } from './index.ts';

export interface TenantRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  created_at: Date;
}

export interface UserRow {
  id: string;
  tenant_id: string;
  email: string;
  name: string;
  role: 'owner' | 'admin' | 'staff' | 'viewer';
  status: string;
  password_hash?: string;
  last_login_at: Date | null;
}

export interface ShopRow {
  id: string;
  tenant_id: string;
  slug: string;
  name: string;
  description: string | null;
  category: string | null;
  country: string | null;
  currency: string;
  timezone: string;
  default_locale: string;
  supported_locales: string[];
  contact_email: string | null;
  contact_phone: string | null;
  support_hours: string | null;
  support_chat_id: string | null;
  rules_md: string | null;
  refund_policy_md: string | null;
  delivery_policy_md: string | null;
  brand_color: string | null;
  onboarding_step: number;
  onboarding_completed_at: Date | null;
  status: string;
}

export interface BotRow {
  id: string;
  tenant_id: string;
  shop_id: string;
  telegram_bot_id: string | null;
  username: string | null;
  display_name: string | null;
  token_ciphertext: string;
  token_key_id: string;
  token_last4: string;
  webhook_secret: string;
  webhook_url: string | null;
  mode: 'webhook' | 'polling';
  status: 'pending' | 'verifying' | 'active' | 'error' | 'revoked';
  last_error: string | null;
}

export interface AuditEntry {
  tenantId: string | null;
  actorType: 'user' | 'platform_admin' | 'system' | 'customer' | 'api_key';
  actorId?: string | null;
  actorLabel?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}

/* ------------------------------------------------------------------ tenants */

export async function findTenantBySlug(tx: Tx, slug: string): Promise<TenantRow | null> {
  return tx.queryOne<TenantRow>('select * from tenants where lower(slug) = lower($1)', [slug]);
}

export async function createTenant(tx: Tx, name: string, slug: string): Promise<TenantRow> {
  return (await tx.queryOne<TenantRow>('insert into tenants (name, slug) values ($1, $2) returning *', [
    name,
    slug,
  ]))!;
}

/* -------------------------------------------------------------------- users */

export async function createUser(
  tx: Tx,
  input: { tenantId: string; email: string; passwordHash: string; name: string; role: UserRow['role'] },
): Promise<UserRow> {
  return (await tx.queryOne<UserRow>(
    `insert into users (tenant_id, email, password_hash, name, role)
     values ($1, $2, $3, $4, $5) returning *`,
    [input.tenantId, input.email, input.passwordHash, input.name, input.role],
  ))!;
}

export async function listUsers(tx: Tx): Promise<UserRow[]> {
  return tx.query<UserRow>('select id, tenant_id, email, name, role, status, last_login_at from users order by created_at');
}

export async function updateUserRole(tx: Tx, userId: string, role: UserRow['role']): Promise<UserRow | null> {
  return tx.queryOne<UserRow>('update users set role = $2 where id = $1 returning *', [userId, role]);
}

export async function countOwners(tx: Tx): Promise<number> {
  const row = await tx.queryOne<{ count: string }>("select count(*)::text as count from users where role = 'owner'");
  return Number(row?.count ?? '0');
}

/* ------------------------------------------------------------------- shops */

export interface ShopInput {
  slug: string;
  name: string;
  description?: string | null;
  category?: string | null;
  country?: string | null;
  currency?: string;
  timezone?: string;
  default_locale?: string;
  supported_locales?: string[];
  contact_email?: string | null;
  contact_phone?: string | null;
  support_hours?: string | null;
  support_chat_id?: string | null;
  rules_md?: string | null;
  refund_policy_md?: string | null;
  delivery_policy_md?: string | null;
  brand_color?: string | null;
}

export async function createShop(tx: Tx, input: ShopInput & { tenantId?: string }): Promise<ShopRow> {
  return (await tx.queryOne<ShopRow>(
    `insert into shops (
       tenant_id, slug, name, description, category, country, currency, timezone, default_locale, supported_locales,
       contact_email, contact_phone, support_hours, support_chat_id, rules_md, refund_policy_md,
       delivery_policy_md, brand_color
     ) values (coalesce($1, app.current_tenant()), $2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     returning *`,
    [
      input.tenantId ?? null,
      input.slug,
      input.name,
      input.description ?? null,
      input.category ?? null,
      input.country ?? null,
      input.currency ?? 'USD',
      input.timezone ?? 'UTC',
      input.default_locale ?? 'en',
      input.supported_locales ?? ['en'],
      input.contact_email ?? null,
      input.contact_phone ?? null,
      input.support_hours ?? null,
      input.support_chat_id ?? null,
      input.rules_md ?? null,
      input.refund_policy_md ?? null,
      input.delivery_policy_md ?? null,
      input.brand_color ?? null,
    ],
  ))!;
}

const SHOP_PATCHABLE = [
  'name',
  'description',
  'category',
  'country',
  'currency',
  'timezone',
  'default_locale',
  'supported_locales',
  'contact_email',
  'contact_phone',
  'support_hours',
  'support_chat_id',
  'rules_md',
  'refund_policy_md',
  'delivery_policy_md',
  'brand_color',
  'onboarding_step',
  'status',
] as const;

/** Whitelisted patch: only known columns can be updated, values are bound parameters. */
export async function updateShop(tx: Tx, shopId: string, patch: Record<string, unknown>): Promise<ShopRow | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const key of SHOP_PATCHABLE) {
    if (patch[key] !== undefined) {
      values.push(patch[key]);
      sets.push(`${key} = $${values.length}`);
    }
  }
  if (sets.length === 0) return getShop(tx, shopId);
  values.push(shopId);
  return tx.queryOne<ShopRow>(`update shops set ${sets.join(', ')} where id = $${values.length} returning *`, values);
}

export async function getShop(tx: Tx, shopId: string): Promise<ShopRow | null> {
  return tx.queryOne<ShopRow>('select * from shops where id = $1', [shopId]);
}

export async function listShops(tx: Tx): Promise<ShopRow[]> {
  return tx.query<ShopRow>('select * from shops order by created_at');
}

export async function completeOnboarding(tx: Tx, shopId: string): Promise<ShopRow | null> {
  return tx.queryOne<ShopRow>(
    `update shops set onboarding_completed_at = now(), onboarding_step = 6, status = 'active'
     where id = $1 returning *`,
    [shopId],
  );
}

/* -------------------------------------------------------------------- bots */

export async function createBot(
  tx: Tx,
  input: {
    shopId: string;
    tokenCiphertext: string;
    tokenKeyId: string;
    tokenLast4: string;
    webhookSecret: string;
    mode?: 'webhook' | 'polling';
  },
): Promise<BotRow> {
  return (await tx.queryOne<BotRow>(
    `insert into bots (shop_id, token_ciphertext, token_key_id, token_last4, webhook_secret, mode, status)
     values ($1, $2, $3, $4, $5, $6, 'verifying') returning *`,
    [
      input.shopId,
      input.tokenCiphertext,
      input.tokenKeyId,
      input.tokenLast4,
      input.webhookSecret,
      input.mode ?? 'webhook',
    ],
  ))!;
}

export async function markBotVerified(
  tx: Tx,
  botId: string,
  info: { telegramBotId: string; username: string; displayName: string; webhookUrl: string | null },
): Promise<BotRow | null> {
  return tx.queryOne<BotRow>(
    `update bots
        set telegram_bot_id = $2, username = $3, display_name = $4, webhook_url = $5,
            status = 'active', last_error = null, last_checked_at = now()
      where id = $1 returning *`,
    [botId, info.telegramBotId, info.username, info.displayName, info.webhookUrl],
  );
}

export async function markBotError(tx: Tx, botId: string, error: string): Promise<BotRow | null> {
  return tx.queryOne<BotRow>(
    `update bots set status = 'error', last_error = $2, last_checked_at = now() where id = $1 returning *`,
    [botId, error.slice(0, 500)],
  );
}

export async function listBots(tx: Tx): Promise<BotRow[]> {
  return tx.query<BotRow>('select * from bots order by created_at');
}

export async function getBot(tx: Tx, botId: string): Promise<BotRow | null> {
  return tx.queryOne<BotRow>('select * from bots where id = $1', [botId]);
}

/* ------------------------------------------------ telegram ingestion/limits */

export async function insertTelegramUpdate(
  tx: Tx,
  input: { tenantId: string; botId: string; updateId: number; payload: unknown },
): Promise<{ inserted: boolean; id: number | null }> {
  const row = await tx.queryOne<{ id: string }>(
    `insert into telegram_updates (tenant_id, bot_id, update_id, payload)
     values ($1, $2, $3, $4::jsonb)
     on conflict (bot_id, update_id) do nothing
     returning id`,
    [input.tenantId, input.botId, input.updateId, JSON.stringify(input.payload)],
  );
  return { inserted: row !== null, id: row ? Number(row.id) : null };
}

export async function markUpdate(
  tx: Tx,
  input: { botId: string; updateId: number; status: 'processed' | 'failed' | 'skipped'; error?: string },
): Promise<void> {
  await tx.execute(
    `update telegram_updates set status = $3, processed_at = now(), error = $4
      where bot_id = $1 and update_id = $2`,
    [input.botId, input.updateId, input.status, input.error ?? null],
  );
}

export async function recordOutboundMessage(
  tx: Tx,
  input: {
    tenantId: string;
    botId: string;
    chatId: bigint | number;
    method: string;
    payload: unknown;
    status: 'sent' | 'failed';
    providerMessageId?: number | null;
    error?: string | null;
  },
): Promise<void> {
  await tx.execute(
    `insert into outbound_messages (tenant_id, bot_id, chat_id, method, payload, status, attempts, provider_message_id, error, sent_at)
     values ($1,$2,$3,$4,$5::jsonb,$6,1,$7,$8, case when $6 = 'sent' then now() else null end)`,
    [
      input.tenantId,
      input.botId,
      input.chatId,
      input.method,
      JSON.stringify(input.payload),
      input.status,
      input.providerMessageId ?? null,
      input.error ?? null,
    ],
  );
}

export async function countOutboundLastMinute(tx: Tx, botId: string): Promise<number> {
  const row = await tx.queryOne<{ count: string }>(
    `select count(*)::text as count from outbound_messages
      where bot_id = $1 and created_at > now() - interval '1 minute'`,
    [botId],
  );
  return Number(row?.count ?? '0');
}

/* --------------------------------------------------------------- customers */

export interface CustomerRow {
  id: string;
  tenant_id: string;
  bot_id: string;
  telegram_user_id: string;
  chat_id: string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  locale: string | null;
  state: Record<string, unknown>;
  blocked_at: Date | null;
}

export async function upsertCustomer(
  tx: Tx,
  input: {
    tenantId: string;
    botId: string;
    telegramUserId: number;
    chatId: number;
    username?: string | null;
    firstName?: string | null;
    lastName?: string | null;
  },
): Promise<{ customer: CustomerRow; isNew: boolean }> {
  const existing = await tx.queryOne<CustomerRow>(
    'select * from customers where bot_id = $1 and telegram_user_id = $2',
    [input.botId, input.telegramUserId],
  );
  if (existing) {
    const updated = await tx.queryOne<CustomerRow>(
      `update customers
          set last_seen_at = now(), username = coalesce($2, username), first_name = coalesce($3, first_name),
              last_name = coalesce($4, last_name), chat_id = $5
        where id = $1 returning *`,
      [existing.id, input.username ?? null, input.firstName ?? null, input.lastName ?? null, input.chatId],
    );
    return { customer: updated ?? existing, isNew: false };
  }
  const created = await tx.queryOne<CustomerRow>(
    `insert into customers (tenant_id, bot_id, telegram_user_id, chat_id, username, first_name, last_name)
     values ($1,$2,$3,$4,$5,$6,$7) returning *`,
    [
      input.tenantId,
      input.botId,
      input.telegramUserId,
      input.chatId,
      input.username ?? null,
      input.firstName ?? null,
      input.lastName ?? null,
    ],
  );
  return { customer: created!, isNew: true };
}

export async function setCustomerLocale(tx: Tx, customerId: string, locale: string): Promise<void> {
  await tx.execute('update customers set locale = $2 where id = $1', [customerId, locale]);
}

export async function listCustomers(tx: Tx, limit = 50): Promise<CustomerRow[]> {
  return tx.query<CustomerRow>('select * from customers order by last_seen_at desc limit $1', [limit]);
}

export async function countCustomers(tx: Tx): Promise<number> {
  const row = await tx.queryOne<{ count: string }>('select count(*)::text as count from customers');
  return Number(row?.count ?? '0');
}

/* ------------------------------------------------------------------ audit */

export async function writeAudit(tx: Tx, entry: AuditEntry): Promise<void> {
  await tx.execute(
    `insert into audit_logs (tenant_id, actor_type, actor_id, actor_label, action, entity_type, entity_id, before, after, ip, user_agent)
     values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11)`,
    [
      entry.tenantId,
      entry.actorType,
      entry.actorId ?? null,
      entry.actorLabel ?? null,
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      entry.before === undefined ? null : JSON.stringify(entry.before),
      entry.after === undefined ? null : JSON.stringify(entry.after),
      entry.ip ?? null,
      entry.userAgent ?? null,
    ],
  );
}

export async function listAudit(tx: Tx, limit = 50): Promise<Record<string, unknown>[]> {
  return tx.query('select * from audit_logs order by created_at desc limit $1', [limit]);
}

/* ----------------------------------------------------------- domain events */

export async function emitEvent(
  tx: Tx,
  input: { tenantId: string; aggregateType: string; aggregateId?: string | null; eventType: string; payload?: unknown },
): Promise<void> {
  await tx.execute(
    `insert into domain_events (tenant_id, aggregate_type, aggregate_id, event_type, payload)
     values ($1,$2,$3,$4,$5::jsonb)`,
    [input.tenantId, input.aggregateType, input.aggregateId ?? null, input.eventType, JSON.stringify(input.payload ?? {})],
  );
}
