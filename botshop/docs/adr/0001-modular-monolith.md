# ADR-0001 — Modular monolith with `api` and `worker` roles

**Status:** accepted · **Date:** 2026-09-21

## Context
The product spans identity, bot fleet, catalog, orders, payments, ledger, billing, referrals,
automation, support and admin. Many of the state changes are money-adjacent and must be atomic
with the events they emit. The team is small and the traffic per merchant is low but the number
of merchants (and bots) is potentially large.

## Decision
One TypeScript codebase, one Docker image, two process roles (`api`, `worker`). Domain modules
live in `packages/core` with explicit public APIs; cross-module access to tables is forbidden by
lint rules. Communication between modules is either a direct call to a public service function
(same transaction) or a domain event through the transactional outbox.

## Consequences
* (+) Single ACID transaction for state change + outbox + job enqueue.
* (+) Simple ops, simple local dev, simple testing.
* (−) Requires discipline on module boundaries (enforced by lint + code review).
* Natural later extractions: `payments` (compliance isolation), `bots` (fleet throughput).
