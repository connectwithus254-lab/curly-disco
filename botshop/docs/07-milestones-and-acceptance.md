# 07 — MVP Milestones & Acceptance Criteria

Every milestone is a **vertical slice**: it is runnable (`pnpm dev`), testable (`pnpm test`),
demoable end-to-end, and leaves `main` deployable. Estimates are for a small focused team; the
order is chosen so the riskiest integrations (multi-bot webhooks, tenancy, payments) land first.

## Milestone overview

| # | Milestone | Outcome (demo) | Depends on |
|---|---|---|---|
| M0 | Foundation | Repo scaffold, DB + migrations + seed, auth, tenants/RBAC, RLS, audit, health, CI, compose | — |
| M1 | Shop + bot provisioning + `/start` | Seller signs up, completes wizard steps 1–3, pastes a bot token, customer sends `/start` and sees menu/rules/language | M0 |
| M2 | Catalog + storefront browsing + cart | Products/categories in panel (CRUD, CSV, media); customers browse and fill a cart; web preview simulator | M1 |
| M3 | Orders + crypto payments | Checkout, order state machine, gateway adapter (NOWPayments sandbox + mock), IPN inbox, payment state machine, expiry, polling, reconciliation, digital auto-delivery, order management + staff notifications | M2 |
| M4 | Ledger + billing + pricing | Plans (Starter/Growth/Pro/Agency), trial, subscriptions, invoices, merchant platform balance & top-ups, transaction fee accrual, limits/overage, customer balance mode, admin plan editor | M3 |
| M5 | Referrals | Platform affiliate + shop customer programs, links, attribution, qualification, commission ledger with holds/reversals, anti-abuse, bot screen, admin defaults (10%) | M4 |
| M6 | Automation engine | Outbox → rules → runs; actions (message/media, wait, tag, notify staff, coupon, state update, webhook); abandoned checkout; templates; run logs; rule builder UI | M3 |
| M7 | Support + admin dashboard + analytics | Tickets via bot ↔ panel; admin overview, tenants, payments review, reconciliation, referral flags, impersonation, feature flags; analytics; broadcasts | M4–M6 |
| M8 | Hardening & launch | Monitoring/alerts, backups + restore drill, load tests, security review, i18n polish, docs & deployment guides, Telegram Mini App shell (optional) | all |

## Acceptance criteria

### Global (apply to every milestone)

* `pnpm lint && pnpm typecheck && pnpm test` pass in CI; coverage on `packages/core` ≥ 80 % lines
  for state machines, ledger, referrals, payments.
* No secrets in git (gitleaks CI job); `.env.example` complete.
* Every new table has `tenant_id` + RLS policy (migration lint test enumerates tables and fails on
  a missing policy).
* Every mutating endpoint writes an audit log entry (route test harness asserts it).
* OpenAPI document validates and matches implemented routes (contract test).
* Docs updated: README setup, module README, runbook entry if operational behaviour changed.

### M0 — Foundation

* [ ] `pnpm install && pnpm db:migrate && pnpm db:seed && pnpm dev` starts api, worker, web locally with embedded Postgres (no Docker) **or** `docker compose up` with Postgres.
* [ ] Signup creates user + tenant (owner) + `trialing` subscription on the default plan; login/logout/me work; sessions revocable; password reset flow works (console email adapter).
* [ ] RBAC matrix enforced on a sample of routes; tests cover owner/admin/staff/viewer/no-member/platform-admin.
* [ ] Tenant isolation test suite: two tenants, all seeded resources; cross-tenant reads/writes via API → 404; via repository with wrong context → 0 rows / RLS error.
* [ ] Audit logs written for every mutation with redacted secrets.
* [ ] `/healthz`, `/readyz`, `/metrics` respond; structured logs include `request_id` & `tenant_id`.
* [ ] CI pipeline green on push; single Docker image builds for `api` and `worker` roles.

### M1 — Shop + bot provisioning + `/start`

* [ ] Wizard steps `identity`, `category`, `bot` persist and validate; wizard state reload-safe.
* [ ] Submitting a valid bot token: `getMe` verified, token stored encrypted (`token_last4` visible only), webhook set with secret, `bots.status = active`, `getWebhookInfo` displayed. Invalid token → clear error, nothing stored. Same bot in another tenant → `conflict`.
* [ ] `POST /telegram/:botId` rejects wrong secret (401) and never enqueues; duplicate `update_id` is ignored; ack latency p95 < 100 ms under 200 rps synthetic load.
* [ ] Customer `/start` → customer upserted, language screen (if >1 language) then main menu; `Rules` shows policies; `Language` switch persists; deep-link `r_<code>` stored for later attribution; `s_<code>` links staff.
* [ ] Outbound sender honours per-chat/per-bot rate limits and `retry_after`; `403 blocked` marks customer `blocked_bot`.
* [ ] Fake Telegram API server used in tests; `/start` flow test asserts exact text + keyboard.
* [ ] Web preview endpoint renders `menu`, `rules`, `language` screens identical to the bot output (snapshot test shared by both paths).

### M2 — Catalog + browsing + cart

* [ ] Category/product CRUD with i18n fields, variants, stock modes, media upload (re-encoded), digital item bulk upload (encrypted, masked listing), CSV import with row errors, export.
* [ ] Plan product limit enforced (`plan_limit_reached`) — configurable in seed.
* [ ] Bot: categories → products (pagination) → product detail with photo (file_id cached per bot after first send), qty/variant, add to cart, buy now; cart edit; state survives restarts.
* [ ] Preview simulator in the panel walks the same screens with clickable buttons.
* [ ] Callback forgery tests: product from another shop, malformed ids → "expired button", no leak.

### M3 — Orders + crypto payments

* [ ] Checkout FSM (address for physical, shipping method, coupon, payment method, confirm) with `/cancel` and expiry; policies acceptance gate configurable.
* [ ] Order creation reserves stock/digital items atomically; concurrent purchases of the last unit → exactly one succeeds.
* [ ] Payment created via adapter (mock in tests, NOWPayments sandbox in staging) with `pay_address`, exact `pay_amount`, `expires_at`; payment screen shows QR + countdown; "Change asset" cancels old and creates new payment idempotently.
* [ ] IPN endpoint: invalid signature → 401 and no change; valid → stored raw, deduped, provider re-fetched, transition applied; replay N times → one transition, one `order.paid`.
* [ ] Payment state machine tests cover: happy path, underpaid (each policy), overpaid (each policy), expired then late payment (revive / review), failed/reorg, cancel, manual resolutions with audit.
* [ ] Order `paid` **only** from `payment.confirmed` (or `settled` per config), ledger debit, or owner manual mark with reason. Test asserts `detected`/`confirming` never mark paid.
* [ ] Expiry job: payment TTL and order hold behave as configured; stock released on order expiry; reconciliation job flags a mismatch when the mock provider disagrees.
* [ ] Digital products delivered automatically on `paid` (spoiler-wrapped), pool empty → `fulfillment_status = failed` + staff alert + retry endpoint.
* [ ] Panel: orders list/detail/transitions (`acknowledge`, `ship`, `deliver`, `complete`, `cancel`), invalid transitions → `invalid_transition`; refunds tracked.
* [ ] Staff Telegram notifications for new order / paid / underpaid / expired with action buttons.
* [ ] Customer: order history, order detail with status timeline, payment status refresh.

### M4 — Ledger + billing + pricing

* [ ] Double-entry ledger: unbalanced journal rejected by trigger; `balance_cached` = Σ entries under concurrent journals (test with 50 parallel top-ups); negative balance rejected unless allowed.
* [ ] Admin can create/edit/publish plans (monthly/annual price, limits, bot limits, automation limits, transaction fee %, features, trial days, discounts, overage mode) without code changes; seed contains **placeholder** prices clearly labelled.
* [ ] Subscription lifecycle tests: trial → active (paid from balance) / past_due → grace → suspended → reactivation; suspended shop bots show the unavailable screen; panel read-only.
* [ ] Merchant top-up via platform gateway (mock/sandbox): min amount from settings (example $10); confirmed → balance credited exactly once; underpaid top-up credited for received amount if policy allows.
* [ ] Transaction fee accrued per paid order at the plan's rate; included in the next invoice; waived/reversed on refund before settlement; fee statement endpoint matches ledger.
* [ ] Limits: product/bot/rule/order quotas enforced per plan with `block` / `soft` / `charge` behaviour; usage endpoint accurate.
* [ ] Customer balance mode per shop: top-up flow in bot, pay order from balance (atomic debit + order paid), insufficient balance handled; statement visible to staff.
* [ ] Invoices: numbered, line items, pay-from-balance or crypto payment; PDF optional (deferred).

### M5 — Referrals

* [ ] Platform affiliate program: signup with code attributes referral; commission (default 10 %, admin-configurable) on referred merchant top-ups after `hold_days`; credited to referrer's platform balance via ledger; visible in panel.
* [ ] Shop program: `/start r_<code>` attribution; qualification on first confirmed top-up/paid order ≥ min; commission credited to referrer's shop balance (or coupon per config); bot referral screen shows link/stats.
* [ ] Abuse tests: self-referral (same tg id / user / tenant) rejected; second attribution attempt ignored; referral by blocked user rejected; refund during hold → commission rejected; refund after payout → reversal journal; caps enforced; velocity flag → admin review queue.
* [ ] Commission state machine tests; `referrals.release` job idempotent.

### M6 — Automation engine

* [ ] Outbox dispatcher publishes each `domain_event` exactly once to rules/notifications/webhooks (crash mid-batch → resumed without duplicates; test kills worker between commit and publish).
* [ ] Rules evaluate conditions against event payload/customer/order; per-customer run limits, cooldowns and plan quotas enforced; disabled rule cancels waiting runs.
* [ ] Actions implemented and tested: `send_message`, `send_media`, `wait`, `add_tag`/`remove_tag`, `notify_staff`, `issue_coupon`, `update_order_status` (safe subset), `set_customer_field`, `call_webhook` (signed, SSRF-guarded, retried), `create_ticket`, `stop_if`.
* [ ] Abandoned checkout detection job (configurable idle window) emits `checkout.abandoned` once per cart; template rule sends reminder → coupon; converts stop the run.
* [ ] Run/step logs visible in panel; dry-run endpoint returns evaluation trace.
* [ ] Rule builder UI with templates; validation errors surfaced inline.

### M7 — Support + admin + analytics

* [ ] Customer "Write to support" creates ticket, staff notified, replies delivered via bot in both directions with media; statuses per state machine; ticket linked to order when opened from order screen.
* [ ] Admin dashboard: overview KPIs, tenants (suspend/unsuspend/impersonate with banner + audit), payments review queue & manual resolutions, reconciliation runs, referral flags review, plan/discount/settings editors, bot fleet health, job health, feature flags, cross-tenant audit log.
* [ ] Analytics endpoints and panel charts (GMV, orders, paid rate, AOV, funnel, top products, payment asset mix) match SQL fixtures.
* [ ] Broadcasts to opt-in segments with throttling and per-plan quota.

### M8 — Hardening & launch

* [ ] Prometheus metrics + alert rules (webhook lag, payment mismatches, IPN signature failures, queue failures, bot errors, charge failures) documented; ops Telegram alert channel wired.
* [ ] Backup job + restore drill script executed and documented with timings (RPO/RTO met).
* [ ] Load test: 500 rps webhook ingestion for 5 minutes on a 2-vCPU box with p95 ack < 150 ms and no lost updates; 1,000 bots provisioned in a fleet test.
* [ ] Security checklist walkthrough (threat model T1–T26) with evidence links; dependency audit clean; ZAP baseline clean.
* [ ] Deployment guide (compose + managed Postgres), env reference, runbooks, merchant-facing docs (how to get a token, how to connect NOWPayments, wrong-network deposits).
* [ ] i18n: bot and panel fully translatable; at least EN complete, second language scaffolded.

## Test matrix (what kind of test lives where)

| Area | Unit (pure) | Integration (real Postgres) | E2E-ish |
|---|---|---|---|
| State machines (payment, order, referral, subscription, run) | ✅ exhaustive transition tables | ✅ service-level with history rows | — |
| Tenant isolation & permissions | ✅ authz matrix | ✅ RLS + API cross-tenant | — |
| Telegram | ✅ screen renderers (snapshots) | ✅ webhook ingestion, dedupe, FSM | ✅ fake Bot API server flows (`/start` → buy → pay) |
| Payments | ✅ adapter mapping, signature verification vectors | ✅ IPN inbox, idempotency, concurrency, expiry, reconciliation | ✅ mock gateway scenario scripts |
| Ledger & billing | ✅ journal builders, proration, limits | ✅ triggers, concurrency, cycles | — |
| Referrals | ✅ rules, commission math | ✅ attribution/qualification/reversal scenarios | — |
| Automation | ✅ condition evaluator, DSL validation | ✅ outbox exactly-once, waits, retries | ✅ abandoned-checkout scenario |
| Web | ✅ component tests for wizard validation | — | Playwright smoke (later) |

## Definition of done (per feature)

Code + tests + migration (+ RLS) + OpenAPI + audit + docs + feature flag (if risky) + dashboard
metric (if operational) + reviewed against the threat model table.
