/**
 * Telegram webhook receiver (docs/01-architecture.md §webhook fleet).
 *
 * Contract with Telegram: answer 200 fast, or Telegram retries (and we get duplicates).
 * Therefore: verify secret -> insert deduped row -> enqueue -> 200.
 * The queue is what protects us from slow handlers, and the unique index
 * telegram_updates(bot_id, update_id) is what protects us from retries.
 */
import type { FastifyInstance } from 'fastify';
import { safeEqual } from '@botshop/core';
import * as repo from '@botshop/db/repos';
import type { RouteDeps } from './types.ts';

const SECRET_HEADER = 'x-telegram-bot-api-secret-token';

export async function registerTelegramRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  const { db, config, rateLimiter } = deps;

  app.post('/telegram/:botId', async (request, reply) => {
    const { botId } = request.params as { botId: string };
    const providedSecret = request.headers[SECRET_HEADER];
    if (typeof providedSecret !== 'string') {
      // 403 here is deliberate: Telegram will keep retrying, which surfaces the misconfiguration.
      return reply.code(403).send({ ok: false, error: 'missing secret token' });
    }

    // Cross-tenant lookup by design: Telegram does not know our tenant ids, and the webhook
    // secret is the credential that authorises this call.
    const bot = await db.withPlatform(async (tx) => repo.getBot(tx, botId));
    if (!bot || bot.status === 'revoked') {
      return reply.code(404).send({ ok: false, error: 'unknown bot' });
    }
    if (!safeEqual(bot.webhook_secret, providedSecret)) {
      return reply.code(403).send({ ok: false, error: 'bad secret token' });
    }

    rateLimiter.check(`bot:${botId}`, 'telegram-inbound', 600, 60_000);

    const body = request.body as { update_id?: number } | undefined;
    const updateId = body?.update_id;
    if (typeof updateId !== 'number') {
      return reply.code(400).send({ ok: false, error: 'update_id missing' });
    }

    const inserted = await db.withPlatform(
      async (tx) =>
        repo.insertTelegramUpdate(tx, {
          tenantId: bot.tenant_id,
          botId,
          updateId,
          payload: body,
        }),
      { actorRole: 'system' },
    );

    if (!inserted.inserted) {
      // Duplicate delivery — acknowledged, never processed twice.
      return reply.code(200).send({ ok: true, duplicate: true });
    }

    if (deps.enqueueTelegramUpdate) {
      await deps.enqueueTelegramUpdate({ tenantId: bot.tenant_id, botId, updateId });
    } else {
      return reply.code(503).send({ ok: false, error: 'worker unavailable, retry' });
    }

    return reply.code(200).send({ ok: true });
  });

  /** Convenience for operators: is the webhook correctly registered for this bot? */
  app.get('/api/v1/system/telegram/health', async (_request, reply) => {
    return reply.send({
      mode: config.telegram.mode,
      webhookEnabled: config.telegram.webhookEnabled,
      pollingEnabled: config.telegram.pollingEnabled,
      publicBaseUrl: config.publicBaseUrl,
    });
  });
}
