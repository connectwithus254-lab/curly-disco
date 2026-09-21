# ADR-0005 — Telegram: webhook fleet router with per-chat ordering

**Status:** accepted · **Date:** 2026-09-21

## Context
Thousands of merchant bots must be served by a small number of processes. Long polling scales
per process and cannot be load balanced; per-bot processes are wasteful.

## Decision
Every bot gets a webhook `https://<host>/telegram/<bot_id>` with a per-bot `secret_token`. The
route validates the secret, deduplicates by `(bot_id, update_id)`, enqueues a job and acknowledges
immediately. Workers process updates under a Postgres advisory lock keyed by `(bot_id, chat_id)` so
conversation state is never raced. `Bot` instances (grammY) are cached per bot with pre-seeded
`botInfo`. Outbound messages go through a queue with per-bot and per-chat token buckets.

## Consequences
* (+) Horizontal scaling of both ingestion and processing; no lost updates on deploys (Telegram
  retries until 200, and we only 200 after the job is committed).
* (+) Update payload retained briefly for replay/debugging.
* (−) Requires a public HTTPS endpoint even in staging (tunnel for local manual tests; the fake
  Bot API server covers automated tests).
