# ADR-0002 — Postgres-only infrastructure for MVP (pg-boss, outbox, RLS)

**Status:** accepted · **Date:** 2026-09-21

## Context
Queues, schedulers and caches are usually Redis/RabbitMQ. Each extra system adds ops burden,
another failure mode, and breaks transactional guarantees between "state changed" and "job/event
enqueued". The dev sandbox also has no Docker.

## Decision
Use PostgreSQL for data, job queue (pg-boss), scheduling (pg-boss cron/deferred jobs), transactional
outbox (`domain_events`) and tenant isolation (RLS). Redis is optional and only for caching /
distributed rate limiting once measured throughput requires it.

## Consequences
* (+) Exactly-once-ish semantics via one transaction; trivial local/dev/test setup
  (`embedded-postgres`).
* (+) One backup/restore story covers jobs and events too.
* (−) Throughput ceiling of a Postgres-backed queue (thousands of jobs/s) — far above MVP needs;
  migration path to BullMQ/Redis is behind a thin `JobQueue` interface.
