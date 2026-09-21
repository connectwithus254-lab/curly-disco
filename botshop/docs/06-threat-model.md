# 06 — Security & Threat Model

## 1. Assets and trust boundaries

| Asset | Why it matters |
|---|---|
| Telegram bot tokens | Full control of a merchant's bot and its customers' chats |
| Gateway credentials (API keys, IPN secrets) | Ability to create/see payments; IPN secret forgery = fake "paid" |
| Ledger balances & payment states | Direct financial loss for merchants/platform |
| Customer PII (Telegram ids, names, phones, addresses, purchase history) | Privacy / legal exposure; phishing fuel |
| Digital goods payloads (keys, credentials) | Merchant inventory theft |
| Tenant data (catalog, orders, analytics) | Confidentiality between competing merchants |
| Admin access | Everything above, across all tenants |
| Availability of webhook ingestion | Every merchant's shop goes dark if it fails |

Trust boundaries: Internet ↔ edge proxy; Telegram/gateway webhooks ↔ API; API ↔ Postgres (RLS);
worker ↔ external APIs; staff/admin browsers ↔ API; merchant-configured outgoing webhooks
(untrusted destinations).

## 2. Actors

External attacker · malicious customer (custom Telegram client, forged callbacks) · malicious or
compromised merchant · malicious staff member of a merchant · compromised gateway/Telegram account
· insider platform admin · automated abuse (sybil referrals, invoice spam).

## 3. Threats and controls (STRIDE-organised)

| # | Threat | Category | Controls | Verified by |
|---|---|---|---|---|
| T1 | Cross-tenant data access via IDOR (guessing ids in API or callback data) | Info disclosure / Tampering | `tenant_id` scoping in every repository call + **Postgres RLS** (`FORCE ROW LEVEL SECURITY`, app role `NOBYPASSRLS`); handlers re-authorise ownership (order↔customer, product↔shop) | Integration tests: cross-tenant read/write attempts return 404/0 rows through API and repository; RLS test connecting as app role with wrong context |
| T2 | Bot token / gateway secret theft from DB dump, logs, API responses | Info disclosure | AES-256-GCM envelope encryption with `key_id` (rotation supported); decrypt only in memory at use; never returned by API (`token_last4` only); pino redaction paths; DB backups encrypted; secrets absent from `audit_logs` (redaction of known keys) | Unit tests for crypto round-trip & redaction; grep-CI for secret patterns in logs |
| T3 | Forged Telegram updates to `/telegram/:botId` | Spoofing | Per-bot random `secret_token` checked with constant-time compare; unknown bot id → 404; body limit; updates from unexpected chat types ignored (`allowed_updates`) | Test: missing/wrong secret → 401, no side effects |
| T4 | Forged or replayed payment webhooks (fake "paid") | Spoofing / Tampering | Signature verification per provider over the **raw body**; dedupe by provider event id / body hash; **re-fetch payment from provider API before applying**; amount + asset + network + `provider_payment_id` must match our record; state monotonicity | Tests: bad signature → 401 & no state change; replay → single transition; webhook claiming `finished` while provider says `waiting` → ignored + alert |
| T5 | Marking orders paid on unconfirmed / underpaid / wrong-asset payments | Tampering / financial | Order → `paid` only from `payment.confirmed` (confirmations ≥ required per asset, amount ≥ expected − tolerance); underpaid path never marks paid without explicit policy/owner action; manual "mark paid" restricted to owner, requires reason, audited, emits distinct `payment_method=manual` | State-machine unit tests; integration test with mock gateway sequences |
| T6 | Double-crediting balances (duplicate IPN, concurrent workers, retries) | Tampering / financial | Ledger journals with `UNIQUE(idempotency_key)`; `SELECT … FOR UPDATE` on payment row; pg-boss singleton keys per payment; balance updates inside the same tx; deferred trigger enforcing balanced journals | Concurrency test: N parallel applies of same webhook → exactly one journal |
| T7 | Referral fraud: self-referral, sybil accounts, refund-after-commission | Abuse / financial | Identity checks (same tg id/user/tenant), first-touch immutability, `min_qualifying_amount`, `hold_days` before approval, reversal on refund, caps per referral/month, velocity flags (> N attributions/day), IP/UA & payment-address similarity flags → admin review queue; commissions only on confirmed money | Unit tests per rule; scenario tests (refund during hold → rejected; after payout → reversed) |
| T8 | Account takeover (credential stuffing, session theft, password reset abuse) | Spoofing | Argon2id, breached-password check (optional), per-IP + per-account login throttling, session cookie `httpOnly/Secure/SameSite=Lax`, session rotation on login, revocation list, TOTP 2FA (mandatory for platform roles, optional for merchants), reset tokens single-use & short TTL, email notifications on new device | Tests: lockout after N failures; reset token reuse fails |
| T9 | Privilege escalation (staff → owner; merchant → platform admin; API key scope bypass) | Elevation | Central `authorize(actor, action, resource)` (RBAC matrix in `packages/core/authz`), route-level guards + service-level checks, API key scopes enforced, admin routes require `platform_role` + 2FA + separate cookie path | Permission matrix tests for every route (allowed/denied per role) |
| T10 | SSRF via merchant-configured webhooks / media import URLs | Tampering | Outgoing HTTP through a single client: DNS resolution → reject private/link-local/loopback/metadata ranges (re-checked after redirects), HTTPS only, 5 s timeout, 1 MB response cap, no credentials forwarding | Unit tests with malicious URLs (`169.254.169.254`, `localhost`, DNS rebinding stub) |
| T11 | Injection: SQL, HTML parse-mode injection in Telegram messages, template injection | Tampering | Parameterised queries only (Drizzle); all user/merchant text HTML-escaped; merchant templates sanitised to an allow-list of tags; template variables escaped; Zod validation everywhere; CSP on panel | Tests with payloads (`<b>`, `</code>`, `{{}}`) |
| T12 | Telegram flood / DoS (mass `/start`, callback spam, giant updates) | DoS | Fast-ack webhook with queueing; per-user throttles; body size limits; per-bot worker fairness (round-robin by bot); Telegram `max_connections` tuning; suspicious users auto-muted | Load test (autocannon) on webhook path; throttle tests |
| T13 | "Denial of wallet": invoice creation spam costs merchants gateway fees / address exhaustion | DoS / financial | Per-customer open-invoice cap (3), cooldown (60 s), daily cap; captcha-like friction after threshold; merchant alert | Tests for limits |
| T14 | Malicious merchants running scams on platform bots | Repudiation / reputation | ToS + prohibited goods policy in onboarding; admin suspend + bot webhook removal; abuse report link in every shop's Rules screen; velocity monitoring of refunds/disputes; optional KYC-lite before higher plan tiers | Admin suspend test → bot answers "unavailable" |
| T15 | Secrets leaking via logs, error messages, stack traces | Info disclosure | pino redaction; generic error bodies with `request_id`; Sentry scrubbing; no secrets in URLs | Tests asserting redaction |
| T16 | Supply-chain compromise (npm) | Tampering | Lockfile committed, `pnpm audit` + Dependabot/Renovate, pinned major versions, minimal deps, provenance checks, CI runs with no network for tests | CI |
| T17 | Backup exposure / loss | Info disclosure / availability | Encrypted backups, separate credentials, off-site copy, restore drill script (`infra/scripts/restore-drill.sh`) monthly, PITR via WAL | Drill log |
| T18 | Insider / admin abuse (reading tenant data, impersonation) | Repudiation | Impersonation is explicit, time-boxed, banner-visible, logged with `impersonator_id`; sensitive reads (digital item reveal, secret reveal) audited; least-privilege platform roles (`support` cannot touch money) | Audit tests |
| T19 | Customer PII handling (GDPR-like requests, retention) | Privacy | Data minimisation (no phone unless checkout requires), erasure endpoint (anonymise, keep financial facts), retention purges, per-shop data export | Erasure test |
| T20 | Chain reorgs / double-spend / wrong network deposits | Financial | Rely on gateway confirmation policy + our `required_confirmations` per asset; `failed` on provider reorg; memo/network shown prominently; wrong-network funds are provider-side recovery (documented for merchants) | State tests |
| T21 | Gateway compromise or outage | Availability / financial | Circuit breaker + retries with jitter; queued invoice creation with customer-facing "try again"; reconciliation catches divergence; ability to disable a provider platform-wide via feature flag | Chaos test with mock gateway errors |
| T22 | Race between expiry and detection | Financial | Expiry job re-checks provider before expiring; late payments handled by `late_payment` path, never silently dropped | Tests |
| T23 | Idempotency-key confusion across tenants/users | Tampering | Keys scoped by `(tenant_id, key)` + request hash comparison | Tests |
| T24 | Web app attacks: XSS, CSRF, clickjacking, open redirects | Tampering | React escaping + strict CSP (`default-src 'self'`), CSRF double-submit + Origin check, `frame-ancestors 'none'`, redirect allow-list, `Referrer-Policy`, `HSTS` | ZAP baseline scan in CI (later) |
| T25 | Malicious uploads (media, CSV) | Tampering | MIME sniffing, size caps, image re-encoding via `sharp`, CSV parsed with hard row/size limits, files served from separate origin/CDN with `Content-Disposition` | Tests |
| T26 | Forged callback data (custom client) | Tampering | Callback handlers validate format and re-authorise ownership; no trust in client-supplied prices/quantities (server recomputes from DB) | Tests with crafted callbacks |

## 4. Authentication & authorisation model

* **Roles (tenant):** `owner` (billing, gateway secrets, bot tokens, staff, danger zone),
  `admin` (everything except billing & secrets reveal), `staff` (orders, tickets, customers,
  catalog edits), `viewer` (read-only).
* **Roles (platform):** `admin` (all), `finance` (billing, payments, reconciliation, no
  impersonation), `support` (read tenants, impersonate with consent flag, no money actions).
* Authorisation is a single pure function over `(actor, action, resource)`; routes declare the
  required action; services call it again (defence in depth).
* API keys are tenant-bound with explicit scopes; never granted `billing` or `secrets`.

## 5. Secrets management

| Secret | Storage | Rotation |
|---|---|---|
| Master data-encryption key(s) | env `BOTSHOP_MASTER_KEYS` (dev) / KMS or Vault (prod); `key_id` on every ciphertext | Add new key id, re-encrypt lazily, retire old |
| Bot tokens, gateway credentials, webhook secrets, digital item payloads, TOTP secrets | encrypted columns (`*_enc` + `key_id`) | Via re-encryption job |
| Telegram webhook secret per bot | hash only (verification), plaintext regenerated on rotate | `reset-webhook` |
| Session tokens, API keys, invitation/reset tokens | hash only (SHA-256) | N/A |
| Outgoing webhook signing secrets | encrypted | endpoint-level rotate |
| Provider platform credentials | env / secret manager, never DB | manual |

No secrets in the repo: `.env.example` documents keys; CI secret scanning (gitleaks) blocks
commits.

## 6. Logging, audit & monitoring for security

* Audit every mutation with actor, before/after (redacted), ip, user agent, request id;
  append-only table.
* Security events emitted as metrics/alerts: signature failures, RLS denials, login failures,
  admin impersonations, manual payment overrides, ledger adjustments, referral flags.
* Anomaly checks (daily): orders marked paid manually per tenant, mismatch counts, sudden
  referral spikes, balance drift.

## 7. Backups & disaster recovery

* RPO ≤ 15 min (WAL archiving), RTO ≤ 2 h (documented restore runbook + drill).
* Nightly logical dump for portability; weekly restore into a scratch DB with integrity checks
  (ledger balance = Σ entries; orders `paid` ⇒ confirmed payment exists).
* Object storage versioning; Telegram `file_id` cache is disposable.
* Runbooks: lost DB, leaked master key (rotate + re-encrypt + revoke bot tokens via merchants),
  gateway incident, Telegram outage (queue drains later), suspected compromised admin account.

## 8. Compliance notes (not legal advice)

* Default custody model keeps the platform out of the funds flow between customers and merchants
  (BYO gateway) — this materially reduces money-transmission exposure but does not eliminate
  obligations around ToS, sanctions and prohibited goods. Get jurisdiction-specific counsel before
  launching any platform-managed payout mode.
* Provide merchants with a data-processing addendum; the platform processes customer PII on
  their behalf. Offer export & erasure tooling.
* Keep transaction records (payments, ledgers) immutable for the statutory period.


---

## Addendum — session transport and CSRF (implemented in the first slice)

Two session transports are supported, because one of them is impossible in some browser contexts:

| Transport | When it is used | CSRF defence |
|---|---|---|
| `bs_session` cookie (httpOnly, SameSite=Lax) | normal deployment: the panel is opened as the top-level page of our own origin | required: session-bound token, double-submit pair, or same-site Origin (see `checkCsrf`) |
| `Authorization: Bearer <session token>` | embedded/third-party contexts where the browser refuses to store cookies (preview iframes, strict privacy modes) | **not applicable**: a browser never attaches an Authorization header by itself, and a cross-site page cannot read our response (no CORS allowance) nor the localStorage token, so it cannot forge one |

Trade-off, stated explicitly: a bearer token lives in `localStorage` for the fallback path, so a
successful XSS in the panel would expose it (an httpOnly cookie would not). That risk is held down
by `script-src 'self'` (no inline or third-party scripts, set globally), rendering every API value
through `textContent`, and never injecting HTML. The cookie path remains the default wherever the
browser allows it, so a real deployment gets the stronger transport.
