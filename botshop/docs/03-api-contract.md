# 03 — API Contract

Base URL: `/api/v1`. JSON only. OpenAPI 3.1 is generated from the Zod schemas and served at
`/api/docs` (Swagger UI) and `/api/openapi.json`.

## 1. Conventions

| Topic | Rule |
|---|---|
| Auth (panel) | Session cookie `bs_session` (httpOnly, Secure, SameSite=Lax). State-changing requests must carry `X-CSRF-Token` (double-submit; token from `GET /auth/csrf`) **and** an `Origin` matching the allow-list |
| Auth (integrations) | `Authorization: Bearer bsk_<prefix>.<secret>` API key (tenant-bound, scoped, hashed at rest) |
| Tenant selection | `X-Tenant-Id: <uuid>` header for session users (validated against membership). API keys are tenant-bound; header ignored. Platform-admin routes live under `/admin` and require `platform_role` + 2FA |
| Idempotency | `Idempotency-Key` header honoured on all `POST` that create money-relevant resources (orders, payments, top-ups, refunds, ledger adjustments, subscriptions). Stored 24 h per tenant; replay returns the original response; mismatched body → `409 idempotency_conflict` |
| Pagination | Cursor based: `?limit=50&cursor=...` → `{ data: [...], meta: { next_cursor } }` |
| Filtering/sorting | Whitelisted query params per resource, e.g. `?status=paid&placed_after=...&sort=-placed_at` |
| Errors | `{ "error": { "code": "validation_failed", "message": "...", "details": [...], "request_id": "..." } }`. Codes: `unauthenticated`, `forbidden`, `not_found`, `validation_failed`, `conflict`, `idempotency_conflict`, `rate_limited`, `plan_limit_reached`, `invalid_transition`, `gateway_error`, `internal` |
| Rate limits | Per IP (auth endpoints 10/min), per session/API key (600/min), per tenant for heavy endpoints (import, broadcasts). `429` with `Retry-After` |
| Versioning | URL prefix; additive changes only within `v1` |
| Money | Amounts are decimal **strings** (`"12.50"`), never numbers |
| IDs | UUID strings; Telegram callbacks use base64url-compressed ids (see doc 04) |
| Audit | Every mutating request writes an `audit_logs` row with before/after (secrets redacted) |

## 2. Endpoint catalog

### 2.1 Auth & account

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/signup` | `{email, password, name, locale?, referral_code?, tenant_name?}` → creates user + tenant (owner) + trial subscription; attributes platform referral if code valid |
| POST | `/auth/login` | `{email, password, totp_code?}` → `mfa_required` step if 2FA enabled |
| POST | `/auth/logout` | revokes session |
| GET | `/auth/me` | user, memberships, current tenant, permissions |
| GET | `/auth/csrf` | CSRF token |
| POST | `/auth/password/forgot` · `/auth/password/reset` | tokenised email flow |
| POST | `/auth/2fa/setup` · `/auth/2fa/enable` · `/auth/2fa/disable` | TOTP; recovery codes returned once |
| POST | `/auth/telegram` | Telegram Login Widget payload (hash verified) → sign in / link |
| GET/POST/DELETE | `/sessions` | list & revoke sessions |

### 2.2 Tenants, members, API keys

| Method | Path | Notes |
|---|---|---|
| GET | `/tenants` | tenants the user belongs to |
| GET/PATCH | `/tenant` | current tenant (name, billing email, settings) |
| GET | `/tenant/members` · POST `/tenant/invitations` · PATCH/DELETE `/tenant/members/:userId` | RBAC: owner/admin only |
| POST | `/invitations/:token/accept` | |
| GET/POST/DELETE | `/tenant/api-keys` | secret shown once; scopes `catalog:read|write`, `orders:read|write`, `customers:read`, `webhooks:manage` |
| GET | `/tenant/usage` | counters vs plan limits |

### 2.3 Shops, onboarding, templates, bots

| Method | Path | Notes |
|---|---|---|
| GET | `/templates` | storefront templates (key, version, description, defaults, sample catalog) |
| GET/POST | `/shops` · GET/PATCH/DELETE `/shops/:shopId` | plan bot/shop limit enforced (`plan_limit_reached`) |
| GET | `/shops/:shopId/onboarding` | wizard state: steps, completion, blockers |
| PUT | `/shops/:shopId/onboarding/:step` | steps: `identity`, `category`, `products`, `payments`, `behavior`, `support`, `policies`, `branding`, `locale`, `marketing`, `preview`, `launch`. Body validated per step |
| GET | `/shops/:shopId/preview/:screen?state=...&locale=..` | renders screen `{text, keyboard, media}` via the shared renderer |
| POST | `/shops/:shopId/launch` · `/shops/:shopId/pause` · `/shops/:shopId/resume` | launch checklist enforced |
| POST | `/shops/:shopId/bots` | `{token}` → `getMe`, uniqueness check, encrypt, `setWebhook` with secret; returns bot (never the token) |
| GET | `/bots/:botId` · POST `/bots/:botId/verify` · POST `/bots/:botId/rotate-token` · POST `/bots/:botId/reset-webhook` · DELETE `/bots/:botId` | `webhook_info`, last error, pending updates |
| POST | `/bots/:botId/test-message` | sends `/start` experience to the linked staff Telegram account |
| GET/PUT | `/shops/:shopId/messages` | message template overrides per locale |
| GET/PUT | `/shops/:shopId/policies` · `/shops/:shopId/branding` · `/shops/:shopId/support-config` · `/shops/:shopId/checkout-config` | same data as wizard steps, editable later |

### 2.4 Catalog & media

| Method | Path | Notes |
|---|---|---|
| GET/POST | `/shops/:shopId/categories` · GET/PATCH/DELETE `/categories/:id` · POST `/shops/:shopId/categories/reorder` | |
| GET/POST | `/shops/:shopId/products` · GET/PATCH/DELETE `/products/:id` · POST `/products/:id/duplicate` | plan product limit enforced |
| GET/POST/PATCH/DELETE | `/products/:id/variants[/:variantId]` | |
| GET/POST | `/products/:id/digital-items` (bulk `{items: string[]}`) · DELETE `/digital-items/:id` · GET `/products/:id/digital-items/stats` | payloads encrypted; listing shows masked values |
| POST | `/products/:id/inventory` | `{delta, reason}` → inventory movement |
| POST | `/shops/:shopId/products/import` (multipart CSV) · GET `/shops/:shopId/products/import/:jobId` · GET `/shops/:shopId/products/export` | async job with row-level errors |
| POST | `/media` (multipart) · GET `/media/:id` · DELETE `/media/:id` | type/size validated; image re-encoded |

### 2.5 Customers

| Method | Path | Notes |
|---|---|---|
| GET | `/shops/:shopId/customers?q=&tag=&status=` | search by name/username/phone/tg id |
| GET/PATCH | `/customers/:id` | tags, notes, block/unblock, marketing opt-in |
| GET | `/customers/:id/timeline` | orders, payments, tickets, automation runs, events |
| GET | `/customers/:id/balance` · POST `/customers/:id/balance/adjust` `{amount, reason}` | ledger journal `manual_adjustment`; owner/admin only; audited |
| POST | `/customers/:id/message` | staff → customer via bot (creates outbound message) |
| POST | `/customers/:id/erase` | GDPR-style erasure (anonymise PII, keep financial records) |

### 2.6 Orders, coupons, shipping, refunds

| Method | Path | Notes |
|---|---|---|
| GET | `/shops/:shopId/orders?status=&payment_status=&q=&from=&to=` | |
| GET | `/orders/:id` | items, payments, events, customer, addresses, digital deliveries (masked) |
| POST | `/orders/:id/transition` | `{event: "acknowledge" \| "ship" \| "deliver" \| "complete" \| "cancel" \| "mark_paid_manual", data?}` → guarded by state machine; `mark_paid_manual` needs owner role + reason + creates `payment_method=manual` record |
| PATCH | `/orders/:id` | `internal_note`, `tracking_info` |
| POST | `/orders/:id/payments` | create a fresh payment for an unpaid order (change asset) — cancels previous open payment |
| POST | `/orders/:id/refunds` · PATCH `/refunds/:id` | manual crypto refund tracking or balance credit |
| POST | `/orders/:id/fulfil-digital` | retry digital delivery when pool was empty |
| GET/POST | `/shops/:shopId/coupons` · GET/PATCH/DELETE `/coupons/:id` | |
| GET/POST | `/shops/:shopId/shipping-methods` · PATCH/DELETE `/shipping-methods/:id` | |

### 2.7 Payments & gateway configuration

| Method | Path | Notes |
|---|---|---|
| GET/PUT | `/shops/:shopId/payment-gateway` | provider, credentials (write-only; response shows `key_last4`), enabled assets, TTL, under/overpayment policies |
| POST | `/shops/:shopId/payment-gateway/test` | validates credentials against provider (`status`, available currencies, min amounts) |
| GET | `/payment-gateway/providers` | supported providers & their asset/network matrix |
| GET | `/shops/:shopId/payments?status=&purpose=` · GET `/payments/:id` | events, transactions, raw webhook refs |
| POST | `/payments/:id/recheck` | force a provider poll now |
| POST | `/payments/:id/resolve` | `{action: "accept_underpaid" \| "credit_balance" \| "mark_refunded" \| "cancel", reason}` — manual resolution; owner/admin; audited |
| GET | `/shops/:shopId/reconciliation?from=&to=` | mismatch list & run history |

### 2.8 Billing (merchant ↔ platform)

| Method | Path | Notes |
|---|---|---|
| GET | `/billing/plans` | public plans (prices, limits, features, trial) |
| GET | `/billing/subscription` · POST `/billing/subscription` `{plan_id, interval, discount_code?}` · POST `/billing/subscription/cancel` · POST `/billing/subscription/resume` | upgrades prorate; downgrades apply at period end |
| GET | `/billing/invoices` · GET `/billing/invoices/:id` · POST `/billing/invoices/:id/pay` | pay from balance or create a crypto payment |
| GET | `/billing/balance` | platform balance, pending top-ups, ledger statement |
| POST | `/billing/topups` `{amount, asset, network}` · GET `/billing/topups/:id` | min amount from platform settings (example $10) |
| GET | `/billing/fees?from=&to=` | transaction fee accruals per order |
| GET | `/billing/usage` | limits & counters |

### 2.9 Referrals

| Method | Path | Notes |
|---|---|---|
| GET | `/referrals/affiliate` | my platform affiliate link/code, stats, commissions, balance credited |
| GET | `/referrals/affiliate/commissions` | ledger of commissions (status, hold_until) |
| GET/PUT | `/shops/:shopId/referral-program` | enable + configure the shop's customer program (rate, basis, min amount, hold days, caps) |
| GET | `/shops/:shopId/referrals?status=` | referrals inside the shop, fraud flags |
| POST | `/referrals/:id/review` | `{decision: "approve" \| "reject", reason}` for flagged referrals |

### 2.10 Automation & webhooks

| Method | Path | Notes |
|---|---|---|
| GET | `/automation/catalog` | event types with payload schema; action types with param schema; condition operators |
| GET | `/automation/templates` | rule presets (abandoned checkout, post-purchase thank-you, delivery follow-up, win-back, low stock alert) |
| GET/POST | `/shops/:shopId/automation/rules` · GET/PATCH/DELETE `/automation/rules/:id` · POST `/automation/rules/:id/toggle` | plan rule limit enforced |
| POST | `/automation/rules/:id/dry-run` | `{sample_event}` → evaluation trace, no side effects |
| GET | `/shops/:shopId/automation/runs?rule_id=&status=` · GET `/automation/runs/:id` · POST `/automation/runs/:id/cancel` | |
| GET/POST | `/tenant/webhooks` · PATCH/DELETE `/webhooks/:id` · POST `/webhooks/:id/test` · GET `/webhooks/:id/deliveries` · POST `/webhook-deliveries/:id/redeliver` | outgoing webhooks signed `X-BotShop-Signature: t=..,v1=hmac_sha256` |
| GET/POST | `/shops/:shopId/broadcasts` · POST `/broadcasts/:id/schedule` · POST `/broadcasts/:id/cancel` | opt-in segments only |

### 2.11 Support

| Method | Path | Notes |
|---|---|---|
| GET | `/shops/:shopId/tickets?status=&assigned=` · GET `/tickets/:id` | |
| POST | `/tickets/:id/messages` | staff reply → delivered via bot |
| PATCH | `/tickets/:id` | status, priority, assignee |

### 2.12 Analytics & audit

| Method | Path | Notes |
|---|---|---|
| GET | `/shops/:shopId/analytics/overview?range=7d` | GMV, orders, paid rate, AOV, new customers, active carts, top products |
| GET | `/shops/:shopId/analytics/funnel` | start → catalog → cart → checkout → paid |
| GET | `/shops/:shopId/analytics/payments` | by asset, underpaid/expired rates, median confirmation time |
| GET | `/tenant/audit-logs?entity_type=&actor=&from=` | |

### 2.13 Platform admin (`/admin/*`, `platform_role` required, 2FA enforced)

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/overview` | MRR, active tenants, GMV, payments health, queue health, bot errors |
| GET/PATCH | `/admin/tenants[/:id]` · POST `/admin/tenants/:id/suspend` · `/unsuspend` · `/impersonate` | impersonation creates a time-boxed session flagged in audit + banner |
| GET/POST/PATCH | `/admin/plans[/:id]` · POST `/admin/plans/:id/publish` | versioned; existing subscriptions keep their version until migrated |
| GET/POST/PATCH | `/admin/discounts` | |
| GET/PATCH | `/admin/settings` | default referral rate (10%), min top-up ($10), platform gateway config, supported assets, fee defaults, trial days, grace days |
| GET/PATCH | `/admin/referral-program` | platform affiliate program config |
| GET | `/admin/payments?status=review` · POST `/admin/payments/:id/resolve` | cross-tenant payment review |
| GET | `/admin/reconciliation/runs` · POST `/admin/reconciliation/run` | |
| GET | `/admin/referrals/flags` · POST `/admin/referrals/:id/review` | |
| GET | `/admin/bots?status=error` | fleet health |
| GET/PATCH | `/admin/feature-flags` | |
| GET | `/admin/jobs` · POST `/admin/jobs/:name/retry-failed` | pg-boss visibility |
| GET | `/admin/audit-logs` | cross-tenant |

### 2.14 Inbound webhooks (no session; verified by secret/signature)

| Method | Path | Verification |
|---|---|---|
| POST | `/telegram/:botId` | `X-Telegram-Bot-Api-Secret-Token` equals bot secret (constant-time compare); body size ≤ 1 MB; always `200` after dedupe+enqueue (or `401` on bad secret) |
| POST | `/webhooks/payments/:provider/:gatewayConfigId` | provider signature (NOWPayments: `x-nowpayments-sig` HMAC-SHA512 over sorted JSON with IPN secret; Crypto Pay: `crypto-pay-api-signature` HMAC-SHA256 keyed by SHA256(token); BTCPay: `BTCPay-Sig` HMAC-SHA256). Raw body kept for verification; stored in `payment_webhook_events`; `200` on accepted/duplicate, `401` on bad signature |

### 2.15 Ops

`GET /healthz` (liveness), `GET /readyz` (DB + queue), `GET /metrics` (Prometheus; protected by
network policy or bearer token).

## 3. Automation DSL (stored in `automation_rules.conditions/actions`)

```jsonc
{
  "trigger_event": "checkout.abandoned",
  "conditions": {
    "all": [
      { "field": "cart.total", "op": ">=", "value": "20" },
      { "field": "customer.tags", "op": "not_contains", "value": "vip" },
      { "field": "customer.orders_count", "op": "==", "value": 0 }
    ]
  },
  "actions": [
    { "type": "wait", "params": { "duration": "PT1H" } },
    { "type": "send_message", "params": { "template_key": "abandoned_1", "buttons": [{ "text": "Resume checkout", "screen": "checkout" }] } },
    { "type": "wait", "params": { "duration": "PT23H" } },
    { "type": "issue_coupon", "params": { "type": "percent", "value": "10", "expires_in": "P3D", "var": "coupon" } },
    { "type": "send_message", "params": { "template_key": "abandoned_2", "vars": { "code": "{{coupon.code}}" } } },
    { "type": "add_tag", "params": { "tag": "winback_sent" } },
    { "type": "notify_staff", "params": { "channel": "telegram", "text": "Win-back sent to {{customer.display_name}}" } },
    { "type": "call_webhook", "params": { "endpoint_id": "…", "include": ["customer", "cart"] } }
  ]
}
```

* **Events:** `customer.created`, `customer.tagged`, `cart.abandoned`, `checkout.abandoned`,
  `order.created`, `order.paid`, `order.processing`, `order.shipped`, `order.delivered`,
  `order.completed`, `order.cancelled`, `order.expired`, `order.refunded`, `payment.created`,
  `payment.detected`, `payment.confirmed`, `payment.underpaid`, `payment.expired`,
  `payment.failed`, `topup.credited`, `subscription.trial_started`, `subscription.trial_ending`,
  `subscription.activated`, `subscription.past_due`, `subscription.suspended`,
  `subscription.cancelled`, `referral.attributed`, `referral.qualified`,
  `referral.commission_approved`, `ticket.created`, `ticket.replied`, `ticket.resolved`,
  `product.out_of_stock`, `digital_pool.low`.
* **Actions:** `send_message`, `send_media`, `wait` (duration or `until` time-of-day in shop TZ),
  `add_tag`, `remove_tag`, `notify_staff` (telegram/email/panel), `issue_coupon`,
  `update_order_status` (only safe transitions: `acknowledge`, `complete`), `set_customer_field`,
  `call_webhook`, `create_ticket`, `stop_if` (condition), `stop`.
* **Operators:** `==, !=, >, >=, <, <=, in, not_in, contains, not_contains, exists, matches`.
* **Guards:** `max_runs_per_customer`, `cooldown_seconds`, plan monthly run quota, per-run step
  cap (25), `wait` cap (30 days), message actions respect customer block/opt-out state.

## 4. Gateway adapter interface (internal contract)

```ts
interface CryptoGatewayAdapter {
  readonly provider: 'nowpayments' | 'cryptopay' | 'btcpay' | 'mock';
  verifyCredentials(creds: Credentials): Promise<{ ok: boolean; assets: AssetInfo[]; error?: string }>;
  listAssets(creds: Credentials): Promise<AssetInfo[]>;            // asset, network, min_amount, required_confirmations
  estimate(creds, { priceAmount, priceCurrency, asset, network }): Promise<{ payAmount: Decimal; rate: Decimal }>;
  createPayment(creds, req: CreatePaymentRequest): Promise<ProviderPayment>;  // idempotent by req.idempotencyKey
  getPayment(creds, providerPaymentId: string): Promise<ProviderPayment>;      // used after every webhook and by pollers
  verifyWebhook(creds, rawBody: Buffer, headers: Headers): { valid: boolean; eventId?: string };
  parseWebhook(rawBody: Buffer): { providerPaymentId: string; status: ProviderStatus; ... };
  mapStatus(p: ProviderPayment): NormalizedPaymentUpdate;                       // → detected/confirming/confirmed/settled/underpaid/expired/failed + amounts + confirmations + txs
}
```
