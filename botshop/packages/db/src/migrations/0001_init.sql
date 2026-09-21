-- BotShop M1 schema (docs/02-data-model.md).
-- Multi-tenancy model: shared schema + tenant_id on every tenant-owned row + Postgres RLS.
--   * The application connects as `botshop_app` (NOT the owner), so policies always apply.
--   * Migrations run as the database owner (superuser locally), which bypasses RLS.
--   * `app.platform` = 'on' is only ever set by platform-admin code paths, which are audited.
--
-- Every tenant-owned table gets: ENABLE + FORCE ROW LEVEL SECURITY, a USING policy with a
-- matching WITH CHECK, and is registered in tests/migration-lint.test.ts.

create extension if not exists pgcrypto;

create schema if not exists app;

create or replace function app.current_tenant() returns uuid
  language sql stable as $$
    select nullif(current_setting('app.tenant_id', true), '')::uuid
  $$;

create or replace function app.is_platform() returns boolean
  language sql stable as $$
    select coalesce(current_setting('app.platform', true), 'off') = 'on'
  $$;

create or replace function app.actor_role() returns text
  language sql stable as $$
    select coalesce(nullif(current_setting('app.actor_role', true), ''), 'system')
  $$;

create or replace function app.touch_updated_at() returns trigger
  language plpgsql as $$
  begin
    new.updated_at := now();
    return new;
  end
  $$;

-- ---------------------------------------------------------------- migrations

create table if not exists schema_migrations (
  id text primary key,
  checksum text not null,
  applied_at timestamptz not null default now()
);

-- ------------------------------------------------------------- platform side

create table platform_admins (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text not null,
  name text not null default 'Admin',
  role text not null check (role in ('admin', 'finance', 'support')),
  disabled_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index platform_admins_email_key on platform_admins (lower(email));
alter table platform_admins enable row level security;
alter table platform_admins force row level security;
create policy platform_admins_platform_only on platform_admins
  using (app.is_platform()) with check (app.is_platform());

-- ---------------------------------------------------------------- tenancy

create table tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  status text not null default 'active' check (status in ('active', 'suspended', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index tenants_slug_key on tenants (lower(slug));
create trigger tenants_touch before update on tenants for each row execute function app.touch_updated_at();
alter table tenants enable row level security;
alter table tenants force row level security;
create policy tenants_isolation on tenants
  using (id = app.current_tenant() or app.is_platform())
  with check (id = app.current_tenant() or app.is_platform());

create table users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  email text not null,
  password_hash text not null,
  name text not null default '',
  role text not null check (role in ('owner', 'admin', 'staff', 'viewer')),
  status text not null default 'active' check (status in ('active', 'invited', 'disabled')),
  last_login_at timestamptz,
  failed_logins int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index users_tenant_email_key on users (tenant_id, lower(email));
create index users_email_idx on users (lower(email));
create trigger users_touch before update on users for each row execute function app.touch_updated_at();
alter table users enable row level security;
alter table users force row level security;
create policy users_isolation on users
  using (tenant_id = app.current_tenant() or app.is_platform())
  with check (tenant_id = app.current_tenant() or app.is_platform());

-- Sessions are looked up before a tenant context exists, so authentication goes through a
-- SECURITY DEFINER function that can only ever return the row matching an exact token hash.
create table sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  ip text,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create unique index sessions_token_hash_key on sessions (token_hash);
create index sessions_user_idx on sessions (user_id);
alter table sessions enable row level security;
alter table sessions force row level security;
create policy sessions_isolation on sessions
  using (tenant_id = app.current_tenant() or app.is_platform())
  with check (tenant_id = app.current_tenant() or app.is_platform());

create or replace function app.authenticate_session(p_token_hash text)
returns table (session_id uuid, user_id uuid, tenant_id uuid, role text, email text, tenant_status text, user_status text)
  language sql security definer set search_path = public, pg_temp as $$
    select s.id, u.id, u.tenant_id, u.role, u.email, t.status, u.status
    from sessions s
    join users u on u.id = s.user_id
    join tenants t on t.id = u.tenant_id
    where s.token_hash = p_token_hash
      and s.expires_at > now()
  $$;

create or replace function app.lookup_login_candidates(p_email text)
returns table (user_id uuid, tenant_id uuid, tenant_slug text, password_hash text, role text, user_status text, tenant_status text)
  language sql security definer set search_path = public, pg_temp as $$
    select u.id, u.tenant_id, t.slug, u.password_hash, u.role, u.status, t.status
    from users u
    join tenants t on t.id = u.tenant_id
    where lower(u.email) = lower(p_email)
  $$;

create or replace function app.lookup_platform_admin(p_email text)
returns table (admin_id uuid, password_hash text, role text, disabled_at timestamptz)
  language sql security definer set search_path = public, pg_temp as $$
    select a.id, a.password_hash, a.role, a.disabled_at
    from platform_admins a
    where lower(a.email) = lower(p_email)
  $$;

-- ------------------------------------------------------------------- shops

create table shops (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  slug text not null,
  name text not null,
  description text,
  category text,
  country text,
  currency text not null default 'USD',
  timezone text not null default 'UTC',
  default_locale text not null default 'en',
  supported_locales text[] not null default array['en']::text[],
  contact_email text,
  contact_phone text,
  support_hours text,
  support_chat_id bigint,
  rules_md text,
  refund_policy_md text,
  delivery_policy_md text,
  brand_color text,
  onboarding_step int not null default 1,
  onboarding_completed_at timestamptz,
  status text not null default 'draft' check (status in ('draft', 'active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index shops_tenant_slug_key on shops (tenant_id, lower(slug));
create index shops_tenant_idx on shops (tenant_id);
create trigger shops_touch before update on shops for each row execute function app.touch_updated_at();
alter table shops enable row level security;
alter table shops force row level security;
create policy shops_isolation on shops
  using (tenant_id = app.current_tenant() or app.is_platform())
  with check (tenant_id = app.current_tenant() or app.is_platform());

-- -------------------------------------------------------------------- bots

create table bots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  shop_id uuid not null references shops (id) on delete cascade,
  telegram_bot_id bigint,
  username text,
  display_name text,
  token_ciphertext text not null,
  token_key_id text not null,
  token_last4 text not null,
  webhook_secret text not null,
  webhook_url text,
  mode text not null default 'webhook' check (mode in ('webhook', 'polling')),
  status text not null default 'pending' check (status in ('pending', 'verifying', 'active', 'error', 'revoked')),
  last_error text,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index bots_telegram_bot_id_key on bots (telegram_bot_id) where telegram_bot_id is not null;
create index bots_shop_idx on bots (shop_id);
create index bots_tenant_idx on bots (tenant_id);
create trigger bots_touch before update on bots for each row execute function app.touch_updated_at();
alter table bots enable row level security;
alter table bots force row level security;
create policy bots_isolation on bots
  using (tenant_id = app.current_tenant() or app.is_platform())
  with check (tenant_id = app.current_tenant() or app.is_platform());

-- --------------------------------------------------------------- customers

create table customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  bot_id uuid not null references bots (id) on delete cascade,
  telegram_user_id bigint not null,
  chat_id bigint not null,
  username text,
  first_name text,
  last_name text,
  locale text,
  state jsonb not null default '{}'::jsonb,
  last_seen_at timestamptz not null default now(),
  blocked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index customers_bot_user_key on customers (bot_id, telegram_user_id);
create index customers_tenant_idx on customers (tenant_id);
create trigger customers_touch before update on customers for each row execute function app.touch_updated_at();
alter table customers enable row level security;
alter table customers force row level security;
create policy customers_isolation on customers
  using (tenant_id = app.current_tenant() or app.is_platform())
  with check (tenant_id = app.current_tenant() or app.is_platform());

-- ----------------------------------------------------- telegram ingestion

create table telegram_updates (
  id bigserial primary key,
  tenant_id uuid not null references tenants (id) on delete cascade,
  bot_id uuid not null references bots (id) on delete cascade,
  update_id bigint not null,
  status text not null default 'queued' check (status in ('queued', 'processed', 'failed', 'skipped')),
  payload jsonb not null,
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
-- Idempotency: Telegram redelivers updates; this unique key is what makes ingestion safe.
create unique index telegram_updates_bot_update_key on telegram_updates (bot_id, update_id);
create index telegram_updates_status_idx on telegram_updates (status) where status = 'queued';
alter table telegram_updates enable row level security;
alter table telegram_updates force row level security;
create policy telegram_updates_isolation on telegram_updates
  using (tenant_id = app.current_tenant() or app.is_platform())
  with check (tenant_id = app.current_tenant() or app.is_platform());

create table outbound_messages (
  id bigserial primary key,
  tenant_id uuid not null references tenants (id) on delete cascade,
  bot_id uuid not null references bots (id) on delete cascade,
  chat_id bigint not null,
  method text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts int not null default 0,
  provider_message_id bigint,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index outbound_messages_bot_idx on outbound_messages (bot_id, created_at desc);
alter table outbound_messages enable row level security;
alter table outbound_messages force row level security;
create policy outbound_messages_isolation on outbound_messages
  using (tenant_id = app.current_tenant() or app.is_platform())
  with check (tenant_id = app.current_tenant() or app.is_platform());

-- ---------------------------------------------- domain events (transactional outbox)

create table domain_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  aggregate_type text not null,
  aggregate_id uuid,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  published_at timestamptz,
  created_at timestamptz not null default now()
);
create index domain_events_unpublished_idx on domain_events (created_at) where published_at is null;
create index domain_events_tenant_idx on domain_events (tenant_id, event_type);
alter table domain_events enable row level security;
alter table domain_events force row level security;
create policy domain_events_isolation on domain_events
  using (tenant_id = app.current_tenant() or app.is_platform())
  with check (tenant_id = app.current_tenant() or app.is_platform());

-- ---------------------------------------------------------------- auditing

create table audit_logs (
  id bigserial primary key,
  tenant_id uuid references tenants (id) on delete set null,
  actor_type text not null check (actor_type in ('user', 'platform_admin', 'system', 'customer', 'api_key')),
  actor_id uuid,
  actor_label text,
  action text not null,
  entity_type text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index audit_logs_tenant_created_idx on audit_logs (tenant_id, created_at desc);
create index audit_logs_entity_idx on audit_logs (entity_type, entity_id);
alter table audit_logs enable row level security;
alter table audit_logs force row level security;
create policy audit_logs_isolation on audit_logs
  using (tenant_id = app.current_tenant() or app.is_platform())
  with check (tenant_id = app.current_tenant() or app.is_platform() or tenant_id is null);

-- ------------------------------------------------------------ app role grants

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'botshop_app') then
    create role botshop_app login password 'botshop_app';
  end if;
end $$;

grant usage on schema public to botshop_app;
grant usage on schema app to botshop_app;
grant select, insert, update, delete on all tables in schema public to botshop_app;
grant usage, select on all sequences in schema public to botshop_app;
grant execute on all functions in schema app to botshop_app;
alter default privileges in schema public grant select, insert, update, delete on tables to botshop_app;
alter default privileges in schema public grant usage, select on sequences to botshop_app;
