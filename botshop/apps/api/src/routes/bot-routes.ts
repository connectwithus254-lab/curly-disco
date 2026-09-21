/**
 * Telegram bot connection routes.
 *
 * Flow (docs/07-milestones-and-acceptance.md M1):
 *   validate token shape -> getMe() against Telegram -> encrypt token -> setWebhook -> active
 * The plaintext token is never persisted, never logged, and never returned by the API.
 */
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { ERRORS } from '@botshop/shared';
import { FakeTransport, HttpTransport, type TelegramTransport } from '@botshop/telegram';
import * as repo from '@botshop/db/repos';
import { authorize, requireActor, type RequestWithActor } from '../auth.ts';
import { resolveTransport } from '../telegram-transport.ts';
import type { RouteDeps } from './types.ts';

const TELEGRAM_TOKEN_RE = /^\d{6,12}:[A-Za-z0-9_-]{30,}$/;

const connectSchema = z.object({
  shopId: z.string().uuid(),
  token: z.string().min(20).max(120),
  mode: z.enum(['webhook', 'polling']).default('webhook'),
});

function publicBot(bot: repo.BotRow) {
  return {
    id: bot.id,
    shopId: bot.shop_id,
    username: bot.username,
    displayName: bot.display_name,
    telegramBotId: bot.telegram_bot_id,
    status: bot.status,
    mode: bot.mode,
    webhookUrl: bot.webhook_url,
    tokenLast4: `…${bot.token_last4}`,
    lastError: bot.last_error,
  };
}

export async function registerBotRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  const { db, config } = deps;

  app.get('/api/v1/bots', async (request: RequestWithActor, reply) => {
    const actor = requireActor(request);
    authorize(actor, 'read');
    const bots = await db.withTenant(actor.tenantId, (tx) => repo.listBots(tx), { actorRole: actor.role });
    return reply.send({ bots: bots.map(publicBot) });
  });

  app.post('/api/v1/bots/connect', async (request: RequestWithActor, reply) => {
    const actor = requireActor(request);
    authorize(actor, 'write');
    const body = connectSchema.parse(request.body ?? {});
    if (!TELEGRAM_TOKEN_RE.test(body.token)) {
      throw ERRORS.validation('That does not look like a Telegram bot token (expected 123456:ABC-DEF…)');
    }

    // 1. Validate against Telegram BEFORE storing anything (getMe is the cheapest proof).
    //    The probe transport is built directly from the submitted token: it is not written
    //    anywhere until Telegram confirms the bot identity.
    const probe: TelegramTransport =
      config.telegram.mode === 'fake'
        ? new FakeTransport({ username: 'probe_bot' })
        : new HttpTransport(body.token, config.telegram.apiRoot);

    let me: { id: number; username?: string; first_name: string };
    try {
      me = await probe.getMe();
    } catch (error) {
      throw ERRORS.validation('Telegram rejected this token', { reason: (error as Error).message.slice(0, 200) });
    }

    const webhookSecret = randomBytes(24).toString('base64url').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
    const tokenCiphertext = config.keyRing.encrypt(body.token);

    const bot = await db.withTenant(
      actor.tenantId,
      async (tx) => {
        const shop = await repo.getShop(tx, body.shopId);
        if (!shop) throw ERRORS.notFound('Shop not found');

        const existing = (await repo.listBots(tx)).find((b) => b.shop_id === body.shopId && b.status !== 'revoked');
        if (existing) throw ERRORS.conflict('This shop already has a bot connected');

        const created = await repo.createBot(tx, {
          shopId: body.shopId,
          tokenCiphertext,
          tokenKeyId: config.keyRing.activeKeyId,
          tokenLast4: body.token.slice(-4),
          webhookSecret,
          mode: body.mode,
        });
        await repo.writeAudit(tx, {
          tenantId: actor.tenantId,
          actorType: 'user',
          actorId: actor.userId,
          action: 'bot.connect_requested',
          entityType: 'bot',
          entityId: created.id,
          after: { username: me.username, tokenLast4: `…${body.token.slice(-4)}` },
          ip: request.ip,
        });
        return created;
      },
      { actorRole: actor.role },
    );

    // 2. Register the webhook / prepare polling, then persist the verified identity.
    const webhookUrl =
      body.mode === 'webhook' ? `${config.publicBaseUrl}/telegram/${bot.id}` : null;
    let status: 'active' | 'error' = 'active';
    let lastError: string | null = null;
    try {
      const transport = resolveTransport(bot, {
        mode: config.telegram.mode,
        apiRoot: config.telegram.apiRoot,
        keyRing: config.keyRing,
      });
      if (body.mode === 'webhook') {
        await transport.setWebhook(webhookUrl!, webhookSecret);
      } else {
        await transport.deleteWebhook();
      }
    } catch (error) {
      status = 'error';
      lastError = (error as Error).message.slice(0, 300);
    }

    const finalBot = await db.withTenant(
      actor.tenantId,
      async (tx) => {
        const updated =
          status === 'active'
            ? await repo.markBotVerified(tx, bot.id, {
                telegramBotId: String(me.id),
                username: me.username ?? '',
                displayName: me.first_name,
                webhookUrl,
              })
            : await repo.markBotError(tx, bot.id, lastError ?? 'unknown error');
        await repo.writeAudit(tx, {
          tenantId: actor.tenantId,
          actorType: 'user',
          actorId: actor.userId,
          action: status === 'active' ? 'bot.connected' : 'bot.connect_failed',
          entityType: 'bot',
          entityId: bot.id,
          after: { status, webhookUrl },
        });
        if (status === 'active') {
          await repo.emitEvent(tx, {
            tenantId: actor.tenantId,
            aggregateType: 'bot',
            aggregateId: bot.id,
            eventType: 'bot.connected',
            payload: { username: me.username },
          });
        }
        return updated!;
      },
      { actorRole: actor.role },
    );

    return reply.code(201).send({ bot: publicBot(finalBot) });
  });

  app.post('/api/v1/bots/:botId/check', async (request: RequestWithActor, reply) => {
    const actor = requireActor(request);
    authorize(actor, 'write');
    const { botId } = request.params as { botId: string };

    const bot = await db.withTenant(actor.tenantId, (tx) => repo.getBot(tx, botId), { actorRole: actor.role });
    if (!bot) throw ERRORS.notFound('Bot not found');

    try {
      const transport = resolveTransport(bot, {
        mode: config.telegram.mode,
        apiRoot: config.telegram.apiRoot,
        keyRing: config.keyRing,
      });
      const me = await transport.getMe();
      if (bot.mode === 'webhook' && bot.webhook_url) {
        await transport.setWebhook(bot.webhook_url, bot.webhook_secret);
      }
      const updated = await db.withTenant(
        actor.tenantId,
        (tx) =>
          repo.markBotVerified(tx, botId, {
            telegramBotId: String(me.id),
            username: me.username ?? '',
            displayName: me.first_name,
            webhookUrl: bot.webhook_url,
          }),
        { actorRole: actor.role },
      );
      return reply.send({ bot: publicBot(updated!), healthy: true });
    } catch (error) {
      const message = (error as Error).message.slice(0, 300);
      const updated = await db.withTenant(actor.tenantId, (tx) => repo.markBotError(tx, botId, message), {
        actorRole: actor.role,
      });
      return reply.code(200).send({ bot: publicBot(updated!), healthy: false, error: message });
    }
  });

  app.post('/api/v1/bots/:botId/test-message', async (request: RequestWithActor, reply) => {
    const actor = requireActor(request);
    authorize(actor, 'write');
    const { botId } = request.params as { botId: string };
    const body = z.object({ chatId: z.number().int().optional(), text: z.string().max(500).optional() }).parse(request.body ?? {});

    const bot = await db.withTenant(actor.tenantId, (tx) => repo.getBot(tx, botId), { actorRole: actor.role });
    if (!bot) throw ERRORS.notFound('Bot not found');

    if (!body.chatId) throw ERRORS.validation('Provide the Telegram chat id to send the test to (message the bot first, or use your own user id)');
    const chatId: number = body.chatId;

    try {
      const transport = resolveTransport(bot, {
        mode: config.telegram.mode,
        apiRoot: config.telegram.apiRoot,
        keyRing: config.keyRing,
      });
      await transport.sendMessage({
        chat_id: chatId,
        text: body.text ?? '✅ BotShop test message — your bot is connected.',
      });
      await db.withTenant(
        actor.tenantId,
        (tx) =>
          repo.recordOutboundMessage(tx, {
            tenantId: actor.tenantId,
            botId,
            chatId,
            method: 'sendMessage',
            payload: { kind: 'test' },
            status: 'sent',
          }),
        { actorRole: actor.role },
      );
      return reply.send({ ok: true });
    } catch (error) {
      return reply.code(200).send({ ok: false, error: (error as Error).message.slice(0, 300) });
    }
  });

  app.delete('/api/v1/bots/:botId', async (request: RequestWithActor, reply) => {
    const actor = requireActor(request);
    authorize(actor, 'write');
    const { botId } = request.params as { botId: string };

    const bot = await db.withTenant(actor.tenantId, (tx) => repo.getBot(tx, botId), { actorRole: actor.role });
    if (!bot) throw ERRORS.notFound('Bot not found');

    if (bot.mode === 'webhook') {
      try {
        const transport = resolveTransport(bot, {
          mode: config.telegram.mode,
          apiRoot: config.telegram.apiRoot,
          keyRing: config.keyRing,
        });
        await transport.deleteWebhook();
      } catch {
        // Disconnecting must succeed locally even if Telegram is unreachable.
      }
    }

    await db.withTenant(
      actor.tenantId,
      async (tx) => {
        await tx.execute("update bots set status = 'revoked', webhook_url = null where id = $1", [botId]);
        await repo.writeAudit(tx, {
          tenantId: actor.tenantId,
          actorType: 'user',
          actorId: actor.userId,
          action: 'bot.disconnected',
          entityType: 'bot',
          entityId: botId,
          ip: request.ip,
        });
      },
      { actorRole: actor.role },
    );
    return reply.send({ ok: true });
  });
}
