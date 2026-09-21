# Start here — from nothing to a working Telegram shop bot

This is the plain-language guide: where to put things, what to type, what to configure, and what you
should see afterwards. No prior DevOps knowledge assumed.

**What you need**

| Thing | Needed for | Cost | Notes |
|---|---|---|---|
| A computer with Node 22+ | Path A (try it locally) | free | <https://nodejs.org> — LTS installer |
| A server (VPS), 1 vCPU / 1 GB | Path B (real, always-on) | ~$5/month | Hetzner, DigitalOcean, Contabo, Linode… Ubuntu 22.04/24.04 |
| A domain name | Path B with webhooks | ~$10/year | Optional — without it you use polling mode |
| Telegram account | always | free | you create the bot in @BotFather in 2 minutes |

**You do NOT need**: Docker experience, a database, a payment provider, or any crypto knowledge for
this phase. The platform includes its own database setup.

---

## Pick your path

| | Path A — try it on your computer | Path B — put it on a server | Path C — this workspace |
|---|---|---|---|
| Time | 5 minutes | 20–30 minutes | instant |
| Reachable from the internet | no | yes | only for you, from Arena |
| Real Telegram bot | possible but fiddly | yes, properly | no (offline demo) |
| Data survives reboot | yes (local folder) | yes (Docker volume) | no |
| Best for | learning the product, demos | actually running a shop | a first look right now |

---

## Path A — run it on your own computer

### A1. Install Node.js

Download and install the **LTS** version from <https://nodejs.org>. Verify in a terminal:

```bash
node -v      # expect v22.x or higher
npm -v       # expect 10.x or higher
```

### A2. Get the code onto your machine

Either clone the repository:

```bash
git clone <your-repo-url> botshop-repo
cd botshop-repo/botshop
```

…or download the folder as a ZIP from GitHub and unzip it, then open a terminal in the `botshop`
folder (the one containing `package.json`).

> **Where does this go?** Anywhere you like: `~/work/botshop`, `C:\Users\you\botshop`, … The folder
> *is* the application. Its database will be created inside it at `botshop/.cache/pgdata`.

### A3. Start everything with one command

```bash
npm install      # first time only, downloads dependencies (1–2 min)
npm run dev
```

**What you should see** (the exact wording may differ slightly):

```
[dev] starting embedded PostgreSQL on port 54329 (data: .../botshop/.cache/pgdata)
✓ applied 0002_tenant_defaults.sql
reset complete (2 migrations applied, demo data seeded)
[dev] starting API + worker
[botshop] ready { url: 'http://localhost:3000', env: 'development', telegramMode: 'fake', ... }

[dev] ready:
  panel   http://localhost:3000
  login   owner@kesi.test / demo-password-123
  telegram mode: fake (nothing leaves this machine)
```

Leave that window running — it *is* the server. (Stop it later with `Ctrl+C`.)

### A4. Open the panel and sign in

Open <http://localhost:3000> in your browser. Sign in:

```
owner@kesi.test
demo-password-123
```

**What you should see:** a dark dashboard with *Your shop* (Kesi Crafts, KES, English + Kiswahili) and
*Bot* (no bot connected yet).

### A5. Walk the wizard

Click **Setup wizard** in the top bar and go through the six steps:

| Step | What to fill in | Notes |
|---|---|---|
| 1 · Business identity | name, category, currency, country, timezone, contact | currency/country are free text — set what your customers use |
| 2 · Languages | default language + which ones are enabled | customers get a picker if you enable more than one |
| 3 · Policies & support | rules, refund policy, delivery policy, support hours, **staff chat id** | staff chat id is optional — see the box below |
| 4 · Connect bot | a Telegram bot token (see A6) | in local demo mode any token shaped `123456789:AA…` is accepted |
| 5 · Preview | click *Main menu*, *Rules*, … | this is the **real** rendering code, not a mock-up |
| 6 · Launch | click **Launch shop** | it checks prerequisites and tells you what is missing |

> **Staff chat id** — where customer messages get forwarded. For a personal chat, message
> [@userinfobot](https://t.me/userinfobot) and it replies with your numeric id. For a group, add
> [@RawDataBot](https://t.me/RawDataBot) to the group; the id looks like `-1001234567890`. Add your
> shop bot to that same group so it is allowed to send there.

### A6. (Optional) use a real bot from your computer

Real bots don't need a public URL if you use **polling** — the platform asks Telegram for new
messages instead of Telegram calling you.

1. In Telegram, open [@BotFather](https://t.me/BotFather) → `/newbot` → follow prompts → copy the
   token (looks like `8123456789:AAF…`).
2. Stop the server (`Ctrl+C`) and start it again in live mode:

   ```bash
   TELEGRAM_MODE=live TELEGRAM_POLLING=true npm run dev
   ```

3. In the panel: wizard step 4 → paste the token → **Mode: Polling** → *Connect bot*.
4. Open your bot in Telegram and send `/start`.

**What you should see:** the bot replies `🌐 Please choose your language:` with English / Kiswahili
buttons. Tap one — the same message is edited into the main menu (`👋 Welcome to …!`). Send it any
text and it will reply with the support screen; if you set a staff chat id, that text is forwarded
to the group.

> On Windows PowerShell, set the variables like this instead:
> ```powershell
> $env:TELEGRAM_MODE="live"; $env:TELEGRAM_POLLING="true"; npm run dev
> ```

---

## Path B — put it on a server (the real deployment)

This is what you use for a shop that must stay online. You'll need SSH access to the server.

### B0. Point your domain at the server (if you have one)

In your domain registrar's DNS panel, add an **A record**:

```
Type: A    Name: shop    Value: <your server's public IP>    TTL: 3600
```

That makes `shop.yourdomain.com` point to the server. Wait a few minutes; you can check with
`ping shop.yourdomain.com` (it should answer with your server's IP).

If you don't have a domain: skip this, answer `none` in the next step, and use polling mode.

### B1. Put the code on the server

SSH into the server, then:

```bash
sudo mkdir -p /opt/botshop && sudo chown "$USER" /opt/botshop
git clone <your-repo-url> /tmp/botshop-src
cp -r /tmp/botshop-src/botshop/* /opt/botshop/     # or upload a ZIP and unpack it here
cd /opt/botshop
```

> **Where things go on the server**
>
> | What | Where | Why |
> |---|---|---|
> | Application code | `/opt/botshop` | any folder works; keep it in one place |
> | Your settings + secrets | `/opt/botshop/.env` | created for you by the next command; never share or commit it |
> | Database files | Docker volume `botshop_db-data` | managed by Docker, survives restarts, not a file you edit |
> | TLS certificates | Docker volumes `botshop_caddy-data` / `_config` | issued automatically for your domain |
> | Backups you create | `/opt/botshop/backups/` | your choice of folder; see B6 |

### B2. One command to set it up

```bash
bash scripts/quickstart-vps.sh
```

It asks one question (your domain, or `none`), then it will:

1. install Docker + Compose if they are missing;
2. generate strong random secrets and write them to `.env` with `chmod 600`;
3. build the container and start the stack (first build: 3–6 minutes);
4. wait for the health check and print every URL and path.

**What you should see at the end:**

```
Done — here is where everything lives
  Panel              https://shop.yourdomain.com
  Health check       https://shop.yourdomain.com/healthz
  Project files      /opt/botshop
  Secrets            /opt/botshop/.env                (chmod 600 — back it up, never commit it)
  Database data      Docker volume "botshop_db-data"  (persists across restarts)
```

Open the panel URL. You should see the BotShop sign-in page. `curl https://shop.yourdomain.com/healthz`
should answer `{"ok":true,"db":"up",...}`.

> **If the certificate isn't ready yet**, Caddy logs it in `docker compose logs caddy`. It needs
> ports 80 and 443 open and DNS pointing at the server. Until then, `https://…` won't respond.

### B3. Create your real account

There are **no default logins in production** (the seed accounts are dev-only). On the panel:

1. Click **Create a workspace** → business name, your name, your email, a password (10+ characters).
2. You are now the **owner** of that workspace and land in the setup wizard.

### B4. Connect your real bot

1. [@BotFather](https://t.me/BotFather) → `/newbot` → name it → copy the token.
2. Wizard step 4 → paste the token → **Mode: Webhook** → *Connect bot*.
   The platform verifies the token with Telegram, encrypts it, and registers
   `https://shop.yourdomain.com/telegram/<bot id>` with a per-bot secret.
3. **No domain (answered `none` earlier)?** Choose **Mode: Polling** instead and make sure
   `TELEGRAM_POLLING=true` is in `.env` (the quickstart already set this).

### B5. Prove it works

Send `/start` to your bot in Telegram.

| You should see in Telegram | Meaning |
|---|---|
| `🌐 Please choose your language:` + buttons | ingestion, worker, storage and rendering all work |
| Tapping a language edits that same message into the menu | callback handling + in-place editing work |
| `📜 Rules` shows what you typed in wizard step 3 | your data reached the bot |
| Sending free text replies with the support screen | support routing works (and forwards to the staff chat if set) |

Then check the panel: **Dashboard** should show customers ≥ 1, updates and replies in the last 24 h.
The **Preview** tab can simulate `/start`, `/rules`, `l:set:sw` without touching Telegram.

### B6. Back it up (do this today, not later)

The database *is* your product state. One command makes a restorable dump:

```bash
mkdir -p /opt/botshop/backups
docker compose exec -T db pg_dump -U postgres -Fc botshop > /opt/botshop/backups/botshop-$(date +%F).dump
```

Restore into a fresh database:

```bash
docker compose exec -T db pg_restore -U postgres -d botshop --clean < /opt/botshop/backups/botshop-2026-09-21.dump
```

Add a nightly cron entry (`crontab -e`):

```cron
15 2 * * * cd /opt/botshop && docker compose exec -T db pg_dump -U postgres -Fc botshop > /opt/botshop/backups/botshop-$(date +\%F).dump
```

Also copy **`.env`** to a password manager. Without `ENCRYPTION_KEYS` from that file, the stored bot
tokens cannot be decrypted.

### B7. Updating later

```bash
cd /opt/botshop
git pull                       # or re-upload changed files
docker compose up -d --build   # rebuilds, runs new migrations on start, restarts
```

Migrations are forward-only and checksummed, so a bad upgrade fails loudly instead of half-applying.

---

## Path C — the workspace preview (what's running right now in Arena)

Nothing to install. Open the live preview panel from this chat and sign in with
`owner@kesi.test / demo-password-123`.

Differences from a real deployment: `TELEGRAM_MODE=fake`, so no messages leave the machine — every
"send" is captured and displayed in the panel's **Preview → Offline transport log**. That makes it
safe for exploring: connect a bot with any token shaped `123456789:AA…`, click through the wizard,
simulate updates, watch the dashboard counters move. Nothing here survives a restart.

---

## How to configure it

Two layers: **things you change in the browser** (day-to-day, no restart) and **things in `.env`**
(infrastructure, restart required).

### In the browser (no restart)

| What | Where | Effect |
|---|---|---|
| Business name, description, category | Wizard step 1 | The bot's greeting and shop screen |
| Currency, timezone, country | Wizard step 1 | Shown in the shop screen; used by pricing later |
| Languages | Wizard step 2 | Which languages the picker offers; default for new customers |
| Rules / refund / delivery policies | Wizard step 3 | The `📜 Rules` screen |
| Support hours, contact email | Wizard step 3 | The `💬 Support` screen |
| Staff chat id | Wizard step 3 | Where customer messages are forwarded |
| Bot token / mode | Wizard step 4 | Which bot serves the shop, webhook or polling |
| Launch / suspend | Wizard step 6 | Whether the shop is live for customers |

### In `.env` (edit file, then `docker compose up -d`)

| Variable | Plain meaning | Default | Change it when… |
|---|---|---|---|
| `PUBLIC_BASE_URL` | the exact public https address of the panel | `http://localhost:3000` | always, for a real deployment (must match your domain) |
| `PUBLIC_DOMAIN` | domain Caddy gets a certificate for | — | when using the `edge` profile |
| `TELEGRAM_MODE` | `fake` = offline demo, `live` = real Telegram | `fake` in dev, `live` in prod | set `live` when connecting a real bot |
| `TELEGRAM_POLLING` | `true` = the app asks Telegram for updates (no domain needed) | `true` if no domain | when you have no public HTTPS URL |
| `TELEGRAM_API_ROOT` | alternative Bot API server | unset | self-hosted Bot API / the local fake server |
| `DATABASE_URL` | app connection **as the restricted role** | compose: `botshop_app` | never point this at the owner role — it disables row-level security bypass-proofing |
| `DATABASE_ADMIN_URL` | owner connection for migrations/jobs | compose: `postgres` | managed databases: your admin connection string |
| `APP_DB_PASSWORD` | password for the restricted role | generated | rotate periodically |
| `POSTGRES_PASSWORD` | database superuser password | generated | rotate periodically (then update both URLs) |
| `ENCRYPTION_KEYS` | master keys that encrypt stored bot tokens | generated | rotate by adding `k2:…` and setting the active id |
| `ENCRYPTION_ACTIVE_KEY_ID` | which key new secrets are written with | `k1` | during rotation |
| `APP_PORT` | host port the app listens on | `3000` | if 3000 is taken, or behind another proxy |
| `SESSION_TTL_HOURS` | how long a panel login lasts | `336` (14 days) | stricter security: `24` |
| `TELEGRAM_SENDS_PER_MINUTE` | per-bot reply budget | `20` | more traffic (Telegram allows ~30/s) |
| `LOG_LEVEL` | log verbosity: `info`, `warn`, `debug` | `info` | debugging: `debug` |
| `RUN_MIGRATIONS` | apply migrations at container start | `true` | `false` if you run migrations from CI |
| `SEED_ON_BOOT` | create the demo workspace on start | `false` | `true` only in demos — never on a real shop |

Generate a key yourself if you ever need one:

```bash
node -e "console.log('k1:'+require('crypto').randomBytes(32).toString('hex'))"
```

---

## What to expect (and what not to expect yet)

**Working today (M1)**

- Panel accounts per workspace, with roles defined (`owner`, `admin`, `staff`, `viewer`) and enforced
  server-side — the UI for inviting teammates arrives with the admin milestone.
- Shop setup wizard, launch checks, audit log of every change.
- Bot: `/start`, language selection (EN/SW/RU), shop info, rules, support, help, in-place navigation,
  free-text forwarding to your staff chat, deep-link payload capture.
- Ingestion you can trust: duplicate Telegram deliveries are ignored, forged webhooks are rejected,
  every inbound update is stored and its status tracked.
- Offline preview so you can see exactly what customers see before going live.

**Not built yet — the wizard and bot say so rather than pretending**

| Missing | Milestone |
|---|---|
| Products, categories, cart, checkout, orders | M2–M3 |
| Crypto payments (address per order, confirmations, under/overpay handling, reconciliation) | M3 |
| Plans, subscriptions, transaction fees, customer balances/top-ups | M4 |
| Referral links + commissions | M5 |
| Automation rules ("when payment confirmed → send this, wait, tag customer") | M6 |
| Broadcasts, analytics, support tickets, admin console | M7 |

So today this is a **working storefront shell**: it proves onboarding, multilingual bot UX and
telegram plumbing end to end. Payments are the next slice — they need your decision on custody
(merchant's own gateway vs platform-managed) before I build them.

---

## When something looks wrong

| Symptom | Likely cause | Fix |
|---|---|---|
| Panel won't load at all | stack not running / wrong URL | `docker compose ps`, then `docker compose logs -f app` |
| `503` on `/healthz`, logs say `db: down` | wrong `POSTGRES_PASSWORD` vs `DATABASE_*_URL`, or DB still starting | check `.env` consistency, then `docker compose restart app` |
| Login says *Incorrect email or password* | account created in a different workspace, or wrong password | use the workspace slug field; re-create the workspace if needed |
| `403 CSRF check failed` in an API script | missing CSRF header | read the `bs_csrf` cookie and send it as `X-CSRF-Token` |
| Bot does not answer `/start` | wrong mode, dead webhook, or token rotated in BotFather | panel → bot → **Run health check**; check `getWebhookInfo`; use polling if unsure |
| Webhook 403 `missing secret token` | Telegram wasn't told the secret, or another service overwrote the webhook | *Run health check* re-registers it |
| `https://` certificate errors | DNS not pointing yet, or port 80/443 blocked | `docker compose logs caddy`, verify the A record and firewall |
| `ENCRYPTION_KEYS is required` on boot | `.env` missing/lost | regenerate **and reconnect bots** (old tokens are unrecoverable without the old key) |
| Bot stops replying under load | per-bot send budget hit | raise `TELEGRAM_SENDS_PER_MINUTE` (Telegram's own limit is ~30 msg/s) |
| Local port 54329 already in use | an old dev database is still running | `DEV_DB_PORT=54399 npm run dev`, or stop the other process |

**Useful commands**

```bash
docker compose ps                     # what's running
docker compose logs -f app            # app + worker logs
docker compose logs -f caddy          # TLS / proxy logs
docker compose restart app            # after editing .env
docker compose exec db psql -U postgres -d botshop    # poke the database directly
docker compose down && docker compose up -d --build   # clean restart after an update
```

---

## Suggested order of work from here

1. **Today** — Path A on your laptop, get comfortable with the wizard and the bot screens (offline).
2. **Tomorrow** — Path B on a cheap VPS with a domain, connect your real bot, send `/start` from your
   phone, set up the nightly backup cron.
3. **Then** — tell me which of these you want next, and I'll build it as the next vertical slice:
   - products + cart + checkout (the shop becomes useful),
   - crypto payments with a gateway adapter (needs the custody decision),
   - plans/subscriptions + referrals (the money the platform itself earns).
