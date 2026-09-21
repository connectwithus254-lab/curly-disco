# ADR-0004 — Drizzle ORM with SQL migrations

**Status:** accepted · **Date:** 2026-09-21

## Context
Financial and multi-tenant code needs precise control over SQL: `numeric` money columns,
`SET LOCAL` for RLS context, advisory locks, `FOR UPDATE SKIP LOCKED`, partial unique indexes,
deferred constraint triggers. Candidates: Prisma 7, Drizzle, Kysely.

## Decision
Drizzle ORM (`drizzle-orm` + `drizzle-kit` for SQL migrations). RLS policies and roles live in
hand-written SQL migrations generated alongside schema changes; a test enumerates tables and
fails when a `tenant_id` table lacks a policy.

## Consequences
* (+) Type-safe queries that read like SQL; no per-request transaction plumbing fight.
* (+) Migrations are plain SQL — reviewable, DBA-friendly.
* (−) Relational convenience is lower than Prisma; we write explicit joins (acceptable).
* Alternative retained: Prisma 7 — viable if the team strongly prefers it; would use interactive
  transactions per request for RLS context.
