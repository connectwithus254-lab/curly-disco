#!/bin/sh
# Container entrypoint: migrate, then run the requested role.
#   CMD api    -> HTTP API + in-process worker (single image, default for small deployments)
#   CMD worker -> background worker only (scale this separately later)
set -e

if [ -z "${DATABASE_ADMIN_URL:-}" ]; then
  echo "[entrypoint] DATABASE_ADMIN_URL is required (owner role, used for migrations and pg-boss)" >&2
  exit 1
fi
if [ -z "${DATABASE_URL:-}" ]; then
  echo "[entrypoint] DATABASE_URL is required (botshop_app role, RLS-enforced)" >&2
  exit 1
fi

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "[entrypoint] applying migrations…"
  npx tsx packages/db/src/cli.ts migrate
  if [ -n "${APP_DB_PASSWORD:-}" ]; then
    echo "[entrypoint] setting the application role password from APP_DB_PASSWORD…"
    node scripts/set-app-password.mjs
  fi
  if [ "${SEED_ON_BOOT:-false}" = "true" ]; then
    echo "[entrypoint] seeding demo data…"
    npx tsx packages/db/src/cli.ts seed
  fi
fi

case "${1:-api}" in
  api)
    exec npx tsx apps/api/src/main.ts
    ;;
  worker)
    echo "[entrypoint] worker-only mode is not split out yet in M1; running the combined role."
    exec npx tsx apps/api/src/main.ts
    ;;
  *)
    exec "$@"
    ;;
esac
