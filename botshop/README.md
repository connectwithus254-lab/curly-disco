# BotShop

A multi-tenant SaaS platform that lets non-technical sellers run a complete Telegram storefront:
a questionnaire-style setup wizard, a customer-facing bot, a seller control panel, and — as the
milestones land — crypto checkout, subscriptions, referrals and an automation engine.

The platform is infrastructure only: it never owns merchants' goods and, by default, never holds
their money (merchants bring their own payment gateway — see `docs/adr/0003`).

> **Status: M1 delivered and tested** — shop onboarding, bot connection, Telegram ingestion with
> idempotency, customer menu screens in 3 languages, panel + preview simulator, RLS, audit logs.
> Payments, catalog, orders, subscriptions and referrals are designed (`docs/`) and scheduled
> (M2–M8 in `docs/07-milestones-and-acceptance.md`).

**New here? Read [docs/START-HERE.md](docs/START-HERE.md)** — a plain-language, step-by-step guide:
where to put the code, what to configure, what you should see, and how to fix the usual problems.

---

## Quick start

```bash
cd botshop
npm install
npm run dev
```

That single command starts an embedded PostgreSQL, applies migrations, seeds a demo workspace and
serves the panel at <http://localhost:3000>. No Docker, no external services, no network access
required (demo Telegram mode captures outgoing messages instead of sending them).

Sign in with:

```
owner@kesi.test    / demo-password-123     (seller)
admin@botshop.test / demo-password-123     (platform admin, reserved for M7)
```

Then walk the wizard: **identity → languages → policies → connect bot → preview → launch**, and use
the **Preview** tab to simulate customer updates (`/start`, `/rules`, `l:set:sw`, …) and inspect what
the bot would send.

### Using a real Telegram bot

```bash
# No public URL needed (long polling):
TELEGRAM_MODE=live TELEGRAM_POLLING=true npm run dev
```

Create a bot with [@BotFather](https://t.me/BotFather), paste the token in wizard step 4, choose
*Polling*, then send `/start` to the bot from Telegram. For webhooks and production deployment see
**[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.

---

## What works today (M1)

**Seller side**
- Email/password signup and login (scrypt), session cookies, CSRF double-submit, per-IP rate limits.
- Workspace + shop creation, 6-step onboarding wizard, launch with explicit readiness checks.
- Bot connection: token format check → `getMe` verification → AES-256-GCM encryption → webhook
  registration (or polling), plus a health-check action and disconnect.
- Dashboard: customers, 24 h inbound/outbound counts, recent updates, recent audit entries.
- Preview simulator: renders the exact production screens and dry-runs updates without sending.

**Customer side (in the bot)**
- `/start` with deep-link payload capture, first-contact language picker (English, Kiswahili, Русский).
- Inline-keyboard menu: shop info, rules/policies, support, help; every screen edits in place.
- Free text is forwarded to the seller's staff chat with the customer's @username and id.

**Platform side**
- Postgres row-level security on every tenant table (`FORCE RLS`, `WITH CHECK`), application role
  `botshop_app` separated from the migration owner, plus a cross-tenant "platform door" that is
  explicit and audited.
- Telegram webhook: per-bot secret header (constant-time compare), dedupe on
  `(bot_id, update_id)`, fast 200 + queue (pg-boss), worker retries, per-bot send budget.
- Audit log on every mutation; `domain_events` transactional outbox; append-only style tables.
- Structured JSON logs with secret redaction, `/healthz`, graceful shutdown, migrations with
  checksums, seeds, and a Docker image + Compose stack.

**Tests: 58 passing** (34 unit, 24 integration against a real PostgreSQL). Highlights: cross-tenant
read/write attempts are rejected by RLS; forged webhooks are rejected; duplicate deliveries send
nothing twice; the bot token is absent from API responses and unreadable in the database; a viewer
rôle cannot mutate; every mutation is audited; money/state-machine code has its own unit tests.

---

## Repository layout

```
botshop/
├── apps/api/                  API + worker + seller panel
│   ├── src/app.ts             Fastify assembly (security headers, CSRF, actor resolution)
│   ├── src/routes/            auth, shops (wizard), bots, telegram webhook, preview, dashboard
│   ├── src/worker.ts          pg-boss consumer: update → screens → effects
│   ├── src/polling.ts         getUpdates fallback for bots without a public URL
│   └── public/                dependency-free SPA (index.html, app.css, app.js)
├── packages/
│   ├── shared/                roles, error model, slug/token helpers
│   ├── core/                  crypto (envelope encryption), passwords, money, state machines
│   ├── db/                    pool + withTenant/withPlatform, SQL migrations, repos, seed
│   └── telegram/              i18n, pure screen renderers, transports, update dispatcher
├── tests/                     unit + integration suites, test DB harness
├── docs/                      design set (see below) + DEPLOYMENT.md
├── scripts/                   dev.mjs, db.mjs, docker entrypoint, app-password setup
└── Dockerfile, docker-compose.yml, docker/Caddyfile, .github/workflows/ci.yml
```

## Architecture in one paragraph

A modular monolith on Node 22/TypeScript. Postgres is the single source of truth *and* the
infrastructure: row-level security for tenant isolation, pg-boss for jobs, a `domain_events`
outbox, and the double-entry ledger (M4). One Docker image runs two roles — `api` (HTTP + Telegram
webhook + payment IPNs) and `worker` (jobs) — so "state changed, event emitted, job queued" is a
single transaction, which is what money code needs. Telegram screens are pure renderers shared by
the live bot and the panel preview, so a preview can never drift from production. Full reasoning in
`docs/01-architecture.md` and the ADRs.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | embedded Postgres + migrate + seed + API/worker |
| `npm run db:up` / `db:migrate` / `db:reset` | database lifecycle |
| `npm test` / `test:unit` / `test:integration` | test suites |
| `npm run typecheck` | strict TypeScript across the workspace |

## Design documents

| Document | Contents |
|---|---|
| `docs/00-overview.md` | goals, scope, open questions |
| `docs/01-architecture.md` | components, processes, queues, multi-tenancy, Telegram router |
| `docs/02-data-model.md` | ERDs, constraints, indexes, RLS, ledger, retention |
| `docs/03-api-contract.md` | REST conventions, endpoints, webhooks, error codes |
| `docs/04-telegram-conversation-map.md` | screen map, FSM, callback scheme, i18n |
| `docs/05-state-machines.md` | payment, order, referral/commission, subscription, automation |
| `docs/06-threat-model.md` | assets, STRIDE analysis, controls, verification tests |
| `docs/07-milestones-and-acceptance.md` | M0–M8 with acceptance criteria and test matrix |
| `docs/08-first-slice.md` | the slice that is implemented above |
| `docs/DEPLOYMENT.md` | how to deploy and operate it |
| `docs/adr/0001…0006` | decisions: modular monolith, Postgres-only infrastructure, BYO gateway custody, data-access approach (raw SQL migrations now, Drizzle later), webhook fleet, shared renderers |
