# BotShop runtime image.
#
# M1 keeps the runtime simple and honest: TypeScript is executed by tsx rather than compiled
# ahead of time, so the image ships the source plus dependencies. A bundled build step
# (esbuild → dist/) is scheduled for the hardening milestone; it does not change this file's
# contract (one image, two roles: api and worker).
FROM node:22-bookworm-slim AS deps
WORKDIR /app
ENV npm_config_update_notifier=false
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/telegram/package.json packages/telegram/package.json
RUN npm ci

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates tini curl \
 && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
COPY types ./types
RUN chmod +x scripts/*.mjs && chown -R node:node /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/healthz || exit 1
ENTRYPOINT ["/usr/bin/tini", "--", "/app/scripts/docker-entrypoint.sh"]
CMD ["api"]
