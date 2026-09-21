# 08 — The Smallest Sensible First Implementation Slice

**Goal:** prove the riskiest architecture decisions end-to-end with real code before building
breadth: multi-tenant isolation with RLS, the multi-bot webhook router, per-chat ordered
processing, encrypted secrets, the shared screen renderer (bot = preview), and the test harness
(embedded Postgres + fake Telegram API). This is **M0 + the core of M1**.

## Demo script at the end of the slice

1. `pnpm install && pnpm dev` (embedded Postgres boots automatically; no Docker required).
2. Open the panel → sign up → tenant is created → wizard step 1 (business identity) → step 2
   (category) → step 3 (paste bot token).
3. Panel shows "Bot @your_bot is live" with webhook status.
4. In Telegram, send `/start` to the bot → language picker (if 2 languages configured) → main
   menu with 🛍 Shop, 🛒 Cart, 📦 Orders, 👤 Profile, 💬 Support, 📜 Rules, 🌐 Language.
   Rules and Language work; the others show a friendly "coming soon" placeholder.
5. Panel preview tab renders the same menu/rules screens (same renderer, snapshot-tested).
6. `pnpm test` runs: tenant isolation, RBAC, webhook secret, update idempotency, `/start` flow
   against the fake Telegram API, encryption round-trip, audit logging.

## Scope (in)

| Area | Deliverable |
|---|---|
| Workspace | `botshop/` pnpm workspace: `apps/api`, `apps/worker`, `apps/web`, `packages/{shared,db,core,telegram}`; strict TS, ESLint, Prettier, Vitest, `.env.example`, `infra/docker-compose.yml`, Dockerfile, GitHub Actions workflow |
| Database | Drizzle schema + SQL migrations for: `users, sessions, tenants, tenant_memberships, invitations, api_keys, plans, subscriptions (minimal), shops, bots, customers, conversation_states, telegram_updates, outbound_messages, domain_events, audit_logs, idempotency_keys, platform_settings`; RLS policies + roles; migration lint test; seed (platform admin, placeholder plans, demo tenant/shop) |
| Core | `db.withTenant()` context helper; `authz` matrix; `crypto` (AES-256-GCM envelope with key ids); `audit` middleware; `identity` (signup/login/logout/me/sessions, Argon2id); `tenancy` (tenant create, membership); `shops` (create, wizard steps `identity/category/bot`, policies/languages defaults from template); `bots` (connect: `getMe` → uniqueness → encrypt → `setWebhook` with secret → status; `getWebhookInfo` health; reset webhook; delete) |
| Telegram | Webhook route (secret check, size limit, dedupe insert, enqueue, 200); worker `telegram.update` consumer (advisory lock per chat, tenant context, `Bot` LRU with pre-seeded `botInfo`); `telegram.send` consumer with per-bot/per-chat token buckets and `retry_after`; storefront composer with `/start` (payload parsing: `r_`, `s_` stored), language selection, main menu, rules, placeholders; pure screen renderers + i18n (EN + one more locale scaffold); fake Bot API server for tests |
| Web | Vite React app: auth pages, wizard steps 1–3 with plain-language help, bot status page, preview panel (Telegram-styled renderer of `/shops/:id/preview/:screen`) |
| API | Routes for the above + `/healthz`, `/readyz`, `/metrics`, OpenAPI at `/api/docs` |
| Ops | pino logging with redaction, request ids, docker image with `ROLE`, compose with Caddy, README + local dev runbook |

## Scope (out — next slices)

Catalog, cart, checkout, payments, ledger, billing cycles, referral logic (only the `/start`
payload capture is included), automation execution (only the outbox table is created), support,
admin dashboard, analytics.

## Task breakdown

1. **Scaffold** workspace, tooling, CI, compose, Dockerfile, env handling (Zod-validated config).
2. **DB package**: schema, migrations, RLS helper, roles, seed, `test-db` helper booting
   `embedded-postgres` per test run (template DB cloned per test file for speed).
3. **Core primitives**: tenant context, authz, encryption, audit, error types, outbox writer,
   pg-boss bootstrap with typed job registry.
4. **Identity & tenancy**: signup (creates tenant + owner + trial subscription), login (Argon2id,
   throttled), sessions, `me`, CSRF; tests incl. permission matrix and isolation suite.
5. **Shops & wizard**: create shop from template, steps 1–3 persistence/validation, onboarding
   state endpoint, preview endpoint.
6. **Bots**: connect flow with Telegram client abstraction (real + fake), secret generation,
   webhook set/reset/delete, health poll job; tests for invalid token, duplicate bot, secret
   mismatch.
7. **Ingestion & processing**: webhook route, dedupe, queue, worker consumer, per-chat lock,
   `Bot` instance cache, outbound queue + sender with rate limiting; tests for idempotency and
   ordering.
8. **Storefront skeleton**: renderers (`menu`, `language`, `rules`, `placeholder`), i18n catalog,
   handlers for `/start`, callbacks `m`, `lang:*`, `rl`, `rla`; customer upsert; conversation
   state; tests with the fake Bot API (assert exact text/keyboard, edit-in-place behaviour).
9. **Web**: auth, wizard steps 1–3, bot status, preview simulator; dev proxy to API.
10. **Docs**: README (setup, scripts, env), architecture pointers, runbook (rotate master key,
    reset webhook), CONTRIBUTING (module rules).

## Exit criteria (subset of M0/M1 acceptance)

* Isolation, RBAC, webhook-secret, update-idempotency, `/start`-flow, encryption and audit tests
  pass in CI against real Postgres.
* A real Telegram bot (staging token) responds to `/start` through the deployed compose stack.
* Preview and live bot produce byte-identical menu/rules screens (shared snapshot).
* Zero secrets in the repo; bot token never appears in any API response or log line (test greps
  captured logs for the token).

## Sandbox note

This development sandbox has no Docker and cannot reach `apt` mirrors, Telegram or gateway APIs,
but can reach the npm registry. The slice is therefore designed to run fully offline: embedded
Postgres from npm, a fake Telegram Bot API server for tests and local demos, and a mock gateway
adapter. Real integrations are exercised in staging.
