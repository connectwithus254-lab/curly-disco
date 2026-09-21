# ADR-0003 — Custody model: merchants bring their own gateway account

**Status:** accepted (MVP) · **Date:** 2026-09-21

## Context
Two options for customer order payments: (A) the platform's gateway account receives all funds and
pays merchants out; (B) each merchant connects their own gateway account and receives funds
directly. Option A makes the platform a custodian / money transmitter with significant
regulatory, fraud and liability exposure; the brief positions the platform as infrastructure.

## Decision
Option B for MVP. Order payments are created with the **merchant's** gateway credentials
(encrypted at rest, decrypted only in memory). The platform's own gateway account is used only for
merchant billing (subscriptions, setup fees, transaction fees, balance top-ups). Transaction fees
are accrued per paid order and charged to the merchant's prepaid platform balance / invoice.

Option A ("platform-managed payments with payouts") is kept feasible by the adapter/ledger design
(`gateway_config.tenant_id = NULL` + `gateway_clearing` accounts + payouts table) but is not
built until legal review.

## Consequences
* (+) Platform never holds merchant customer funds; smaller compliance surface.
* (+) Merchants keep full control of their money; no payout delays.
* (−) Onboarding friction: the merchant must create a gateway account and paste API/IPN keys
  (mitigated with a guided step, credential test button and provider deep links).
* (−) Fee collection depends on merchant balance/invoicing (mitigated with prepaid balance,
  dunning and suspension).
