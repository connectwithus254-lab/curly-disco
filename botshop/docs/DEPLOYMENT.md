# Deploying BotShop

There are four ways to run what exists today, from "click it in the browser" to "your own VPS with
TLS and a real Telegram bot". Pick the one you need; they all run the same code.

| # | Where | Good for | Time | Real Telegram? |
|---|-------|----------|------|----------------|
| 0 | This workspace preview | clicking through the product right now | 0 min | no (offline demo mode) |
| 1 | Your laptop / any Linux box (`npm run dev`) | development, demos, trying seller flows | 2 min | optional (polling) |
| 2 | Your VPS with Docker Compose + Caddy | a real, public deployment | 15 min | yes (webhook) |
| 3 | Managed Postgres + PaaS (Fly/Railway/Render) | scaling later, no server admin | 30 min | yes |

---

## 0 · The preview already running in this workspace

`npm run dev` is running here on port 3000 and is exposed to you as a live preview. It uses an
**embedded PostgreSQL** and **demo Telegram mode**, so nothing leaves the sandbox — the bot's
outgoing messages are captured in memory and shown in the panel.

Sign in with the seeded workspace:

```
owner@kesi.test / demo-password-123
```

Then: **Setup wizard** → steps 1–3 (identity, languages, policies) → step 4 connect a bot (demo mode
accepts any token shaped `123456789:AA…`) → step 5 preview the screens → step 6 launch.
**Preview** tab simulates customer updates and shows exactly what the bot would send.

---

## 1 · Run it locally

Requirements: Node 22+ (no Docker, no Postgres install needed).

```bash
cd botshop
npm install
npm run dev
```

What `npm run dev` does:

1. starts an embedded PostgreSQL 18 on port **54329**, data in `botshop/.cache/pgdata`;
2. **resets** the schema, applies migrations and seeds the demo workspace (set `RESET=false` to skip);
3. generates a development encryption key if `ENCRYPTION_KEYS` is unset;
4. starts the API + worker on <http://localhost:3000>.

Other useful commands:

```bash
npm run db:up        # just the database (leave running)
npm run db:migrate   # apply pending migrations
npm run db:reset     # drop schema, migrate, reseed
npm test             # unit + integration suites (integration boots its own PostgreSQL)
npm run typecheck
```

**Using a real Telegram bot without a public URL** — polling mode:

```bash
TELEGRAM_MODE=live TELEGRAM_POLLING=true npm run dev
```

Create the bot with [@BotFather](https://t.me/BotFather) (`/newbot`), paste the token in wizard step
4 and choose **Polling**; no domain or TLS is needed because the worker long-polls `getUpdates`.

---

## 2 · VPS deployment with Docker Compose (recommended for going live)

> Prefer a guided walkthrough with expected output at every step? See
> **[START-HERE.md](START-HERE.md)**. The short version is one command:
> `bash scripts/quickstart-vps.sh` — it installs Docker, asks for your domain, generates secrets,
> builds and starts the stack, then prints every URL and path.

Requirements: a small VPS (1 vCPU / 1 GB is enough for the first shops), Docker + Compose, and a
domain pointing at the server.

```bash
git clone <your-repo> botshop && cd botshop
cp .env.example .env
```

Edit `.env` — the minimum set for production:

```ini
NODE_ENV=production
PUBLIC_BASE_URL=https://shop.example.com     # must be https, Telegram requires it
PUBLIC_DOMAIN=shop.example.com               # used by Caddy

POSTGRES_PASSWORD=<long random>              # database superuser
APP_DB_PASSWORD=<long random>                # the RLS-enforcing app role

# Generate: node -e "console.log('k1:'+require('crypto').randomBytes(32).toString('hex'))"
ENCRYPTION_KEYS=k1:<64 hex chars>
ENCRYPTION_ACTIVE_KEY_ID=k1

TELEGRAM_MODE=live
TELEGRAM_POLLING=false
SEED_ON_BOOT=false                            # keep false in production
```

Start it (the `edge` profile adds Caddy, which obtains the TLS certificate automatically):

```bash
docker compose --profile edge up -d --build
docker compose logs -f app                    # watch migrations + startup
curl -fsS https://shop.example.com/healthz    # {"ok":true,"db":"up",...}
```

The container entrypoint runs migrations before the API starts, then sets the `botshop_app`
password from `APP_DB_PASSWORD`. Then create your seller account through `https://shop.example.com/`
→ *Create a workspace*, and connect the bot in wizard step 4 with mode **Webhook**.

If you already terminate TLS elsewhere (nginx, Traefik, Cloudflare Tunnel), drop `--profile edge`,
publish the app port (`APP_PORT=3000`) and keep `PUBLIC_BASE_URL` pointing at your public HTTPS URL.

### First-run checklist

```bash
curl -fsS $PUBLIC_BASE_URL/healthz                     # db up
curl -s  https://api.telegram.org/bot<TOKEN>/getWebhookInfo   # url must equal $PUBLIC_BASE_URL/telegram/<bot id>
```

Send `/start` to your bot from Telegram — the language picker (or main menu) must appear. If it
does not, see *Troubleshooting* below.

---

## 3 · Managed Postgres + PaaS

Any Postgres 16+ works (Neon, Supabase, RDS, Cloud SQL). Two roles are required:

```sql
-- run once, as an admin
create role botshop_app login password '<strong password>';
create database botshop owner postgres;
```

Set `DATABASE_ADMIN_URL` to an **owner/admin** connection (migrations create schema objects, RLS
policies, triggers and the pg-boss schema) and `DATABASE_URL` to the **`botshop_app`** connection
(tenant data, RLS enforced). The app refuses to boot in production with a non-HTTPS public base URL.

Deploy the Docker image to Fly.io / Railway / Render / ECS as a single service with a persistent
health check on `/healthz`. If the platform cannot run a scheduled migration step, run
`docker compose run --rm app api` style one-off tasks or `npx tsx packages/db/src/cli.ts migrate`
from CI before releasing.

---

## Going live with a real Telegram bot

1. **@BotFather** → `/newbot` → copy the token.
2. Panel → Setup wizard → step 4 → paste the token → mode **Webhook** (or **Polling** if you have no
   public HTTPS).
3. The platform calls `getMe`, encrypts the token (AES-256-GCM), generates a per-bot webhook secret,
   and registers `PUBLIC_BASE_URL/telegram/<botId>` with that secret.
4. Telegram then delivers every update to us; the webhook verifies
   `X-Telegram-Bot-Api-Secret-Token`, dedupes on `(bot_id, update_id)` and queues the update.
5. Set a **staff chat id** in wizard step 3 if you want customer messages forwarded to your team.

Webhooks require **HTTPS on port 443, 88, 8443 or a valid certificate**; polling has no such
requirement. Both paths share the same dedupe/queue/reply pipeline, so behaviour is identical.

---

## Operations

**Migrations** run automatically in Docker (`RUN_MIGRATIONS=true`). They are forward-only and
checksummed: editing an applied file fails loudly, so add a new migration instead.

**Backups** — the database is the whole product state:

```bash
docker compose exec db pg_dump -U postgres -Fc botshop > botshop-$(date +%F).dump   # nightly via cron
docker compose exec -T db pg_restore -U postgres -d botshop --clean < backup.dump   # restore drill
```

Target RPO ≤ 15 min (enable WAL archiving or managed PITR), RTO ≤ 2 h. Test a restore monthly —
an untested backup is not a backup.

**Secret rotation** — encryption keys are addressed by id: add `k2:<hex>` to `ENCRYPTION_KEYS`, set
`ENCRYPTION_ACTIVE_KEY_ID=k2`, restart. New writes use `k2`; existing ciphertext still decrypts with
`k1`. Re-encrypt at leisure, then remove `k1`.

**Scaling** — one process currently runs both roles. When traffic grows, run more API replicas behind
the load balancer (session cookies are stateless; only the in-process rate limiter is per-replica —
move it to Postgres/Redis first) and split the worker via the `worker` entrypoint.

**Observability** — structured JSON logs with `reqId`, secret redaction, and `/healthz` for liveness.
Every panel mutation writes an `audit_logs` row; `domain_events` is the outbox that automation and
webhooks will consume in M6.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Webhook returns `403 missing secret token` | Telegram was not told the secret, or another server overwrote the webhook | Panel → bot → *Run health check* (re-registers the webhook) |
| `403 CSRF check failed` from a script | missing `X-CSRF-Token` or `Origin` header | send the `bs_csrf` cookie value in `X-CSRF-Token` |
| Bot never replies, `getWebhookInfo` shows no URL | `PUBLIC_BASE_URL` is http or unreachable | use HTTPS + a public hostname, or switch the bot to polling |
| `ENCRYPTION_KEYS is required` on boot | keyring not set | generate one (see `.env.example`) |
| `role "botshop_app" does not exist` | migrations never ran | `npm run db:migrate` (or `RUN_MIGRATIONS=true`) |
| Embedded Postgres won't start locally | port 54329 busy | `DEV_DB_PORT=54399 npm run dev` |
| `telegram send rate limit exceeded` in logs | per-bot send budget | raise `TELEGRAM_SENDS_PER_MINUTE` (respect Telegram's ~30 msg/s) |

---

## Security checklist before real money moves

- [ ] `ENCRYPTION_KEYS` generated on the server, never committed; `.env` is git-ignored.
- [ ] `APP_DB_PASSWORD` set; `DATABASE_URL` uses `botshop_app` (not the owner) so RLS applies.
- [ ] `PUBLIC_BASE_URL` is HTTPS; `NODE_ENV=production` (boot fails otherwise).
- [ ] Database not exposed publicly; firewall allows 80/443 only.
- [ ] Backups scheduled **and** restore tested.
- [ ] `SEED_ON_BOOT=false` and seeded demo credentials rotated/removed.
- [ ] Checkout/payment milestone (M3) adds gateway IPN verification before this goes live for sales.
