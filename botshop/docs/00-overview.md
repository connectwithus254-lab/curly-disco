# 00 — Overview, Scope, Assumptions

## 1. What we are building

A multi-tenant SaaS ("the platform") where a **seller** (merchant) answers a short questionnaire,
connects a Telegram bot token from @BotFather, uploads products, picks a storefront template,
configures policies and payments, previews the bot, and launches a working 24/7 Telegram shop.

The platform is **infrastructure-as-a-service** for Telegram sellers:

* bot hosting & provisioning (webhook fleet, one process serves thousands of bots),
* storefront templates and a Telegram customer journey,
* seller control panel (web) and platform admin dashboard,
* product / order / customer management,
* crypto payments through a **gateway adapter** (reference: NOWPayments; alternatives below),
* configurable subscriptions, setup fees and transaction fees,
* referral / affiliate engine (platform-level and shop-level),
* event-driven automation engine,
* audit logs, security controls, backups, monitoring, tests.

## 2. Personas

| Persona | Surface | Goals |
|---|---|---|
| **Platform admin / finance / support** | Admin dashboard | Configure plans, fees, referral defaults, gateway defaults; manage tenants; reconcile payments; handle abuse |
| **Seller (tenant owner)** | Seller control panel (web), optional Telegram notifications | Launch and run a shop with zero code; see orders, money, customers |
| **Seller staff** (manager / support / viewer) | Seller control panel | Fulfil orders, answer tickets, edit catalog within role limits |
| **Customer** | The seller's Telegram bot | Browse, buy, pay in crypto, track orders, get support, refer friends |
| **Affiliate** (a seller referring sellers, or a customer referring customers) | Panel or bot | Get a link, see qualified referrals and commissions |

## 3. Money flows (three strictly separated domains)

1. **Customer → Merchant (order payments).** Default custody model is **BYO gateway**: each
   merchant connects *their own* gateway account (API key + IPN secret). Customer crypto goes
   straight to the merchant's gateway wallet. The platform never touches these funds.
2. **Merchant → Platform (billing).** Subscriptions, setup fees, transaction fees and overages are
   billed to the merchant's **platform balance**, which the merchant tops up in crypto through the
   *platform's* gateway account (example minimum top-up: $10 — configurable).
3. **Internal ledgers.** Double-entry ledger for: customer shop balances (optional "top-up then buy"
   mode per shop), merchant platform balances, referral commissions payable, fee receivables.
   Balances are never edited directly; every change is a balanced journal.

> An optional **platform-managed payments** mode (platform gateway receives customer funds and pays
> merchants out) is designed for but *not* in MVP, because it makes the platform a custodian with
> significant regulatory burden. See ADR-0003.

## 4. Glossary

| Term | Meaning |
|---|---|
| Tenant | The billing / isolation unit. Owns shops, bots, staff, subscription, platform balance |
| Shop | A storefront configuration (catalog, policies, branding, template). Served by one bot |
| Bot | A Telegram bot (token owned by the seller) attached to exactly one shop |
| Template | A versioned preset of menu structure, tone, checkout options, enabled modules, sample data |
| Payment | A single payment request against a payable (order, top-up, invoice) at a gateway |
| Top-up ("replenishment") | Crediting a ledger balance (customer shop balance or merchant platform balance) |
| Program (referral) | A configured referral scheme: platform affiliate (seller→seller) or shop program (customer→customer) |
| Rule (automation) | Trigger event + conditions + ordered actions |
| Outbox / domain event | Event row written in the same DB transaction as the state change; drives automation, notifications, webhooks |

## 5. Assumptions (to be confirmed — the referenced PDF/screenshots were not received)

| # | Assumption | Impact if wrong |
|---|---|---|
| A1 | The screenshots showing BTC / ETH / LTC / USDT-TRC20 and a **$10 minimum top-up** describe a *balance top-up* flow (customers top up a shop balance and/or merchants top up their platform balance). Both are supported; per-order invoices are also supported. | Only changes which flow is enabled by default in templates |
| A2 | "10% referral replenishment commission" = 10% of the referred party's *credited top-ups*, paid to the referrer as ledger credit. Modelled as `commission_basis = topup`, default 10%, admin-configurable. | Just a different default `commission_basis` |
| A3 | Sellers are non-technical; the control panel is web-first (a Telegram Mini App version can reuse the same API later). | None architecturally |
| A4 | Digital goods (keys, accounts, files) with auto-delivery are a first-class use case alongside physical goods. | Template defaults only |
| A5 | Fiat via Telegram Payments / Stars is out of MVP scope but the payment adapter interface accommodates it. | None |
| A6 | Primary reference gateway is NOWPayments (supports the four example assets, IPN webhooks, sandbox). Adapter pattern keeps this swappable (Crypto Pay API / BTCPay Server / Coinbase Commerce). | Adapter implementation order only |
| A7 | Product working name "BotShop Studio" / package scope `@botshop/*` is a placeholder. | Rename |

## 6. Explicit non-goals for MVP

* Custodying customer funds or paying merchants out (see §3).
* Implementing blockchain scanning, HD wallets, or key management ourselves.
* Fiat card payments, KYC flows, tax calculation, shipping-carrier integrations.
* Native mobile apps.
* Multi-level (>1 tier) referral trees (schema allows it; logic deferred).

## 7. Open questions for the product owner

1. Please attach the PDF (screenshots, brand, target market/languages, any hard requirements).
2. Custody model: confirm **BYO gateway per merchant** as MVP default (ADR-0003).
3. Which referral level do the screenshots show — customer→customer inside a shop, seller→seller on
   the platform, or both? (Both are designed; defaults differ.)
4. Repository layout: keep the platform in `botshop/` next to the existing project, or make it the
   repository root?
5. Preferred gateway if not NOWPayments; do you already have an account/sandbox?
6. Primary UI languages for the bot and panel (English assumed; i18n is built in from day one).
