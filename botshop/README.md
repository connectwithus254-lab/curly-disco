# BotShop Studio — Telegram Commerce Bot Platform (working name)

> Status: **design phase**. No implementation code yet — see `docs/` for the architecture,
> data model, API contract, state machines, threat model, milestone plan and acceptance criteria.

**Product promise:** *"Answer a few questions, connect your Telegram bot, and get a functioning
24/7 automated Telegram shop."*

BotShop Studio is a multi-tenant SaaS that lets non-technical sellers create and operate Telegram
commerce bots through a short onboarding wizard. The platform provides bot hosting/provisioning,
storefront templates, crypto payment integration (via reputable gateways — never home-grown chain
logic), automation, referrals, analytics, support tooling and merchant management. It does **not**
own or hold the goods sold by merchants and, in the default custody model, never holds merchant
customer funds either.

## Documentation map

| # | Document | What it answers |
|---|----------|-----------------|
| 0 | [docs/00-overview.md](docs/00-overview.md) | Scope, personas, glossary, assumptions, open questions |
| 1 | [docs/01-architecture.md](docs/01-architecture.md) | Recommended architecture, stack + alternatives, module boundaries, request flows, deployment |
| 2 | [docs/02-data-model.md](docs/02-data-model.md) | ERD, table catalog, tenancy/RLS strategy, ledger design, indexing |
| 3 | [docs/03-api-contract.md](docs/03-api-contract.md) | REST API contract, webhook endpoints, conventions, automation DSL |
| 4 | [docs/04-telegram-conversation-map.md](docs/04-telegram-conversation-map.md) | Customer bot screens, conversation FSM, callback-data scheme, deep links, staff notifications |
| 5 | [docs/05-state-machines.md](docs/05-state-machines.md) | Payment, order, referral, subscription, bot, automation-run and ticket state machines |
| 6 | [docs/06-threat-model.md](docs/06-threat-model.md) | Assets, actors, STRIDE threats, controls, secrets, backups/DR, compliance notes |
| 7 | [docs/07-milestones-and-acceptance.md](docs/07-milestones-and-acceptance.md) | Vertical-slice milestones, acceptance criteria, test matrix, definition of done |
| 8 | [docs/08-first-slice.md](docs/08-first-slice.md) | The smallest sensible first implementation slice (scope, layout, tasks, tests) |
| — | [docs/adr/](docs/adr/) | Architecture decision records |

## Repository note

This folder is intentionally self-contained (it will become a pnpm workspace with `apps/` and
`packages/`). The rest of the repository holds an unrelated project and is left untouched.
