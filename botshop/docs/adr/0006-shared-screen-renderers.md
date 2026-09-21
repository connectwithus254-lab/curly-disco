# ADR-0006 — Pure screen renderers shared by the bot and the web preview

**Status:** accepted · **Date:** 2026-09-21

## Context
The wizard promises "preview the result". A preview that is a separate re-implementation of the
bot UI drifts immediately.

## Decision
Storefront screens are pure functions `(screen, state, locale, shopConfig) → {text, keyboard,
media}` in `packages/telegram/screens`. grammY handlers call them and send/edit messages; the API
exposes `GET /shops/:id/preview/:screen`, and the web app renders the same output in a
Telegram-styled simulator where inline buttons post the callback data back to the preview endpoint.

## Consequences
* (+) Preview == production by construction; snapshot tests cover both.
* (+) Renderers are trivially unit-testable and i18n-checkable.
* (−) Handlers must keep side effects (DB writes, sends) outside renderers — a healthy constraint.
