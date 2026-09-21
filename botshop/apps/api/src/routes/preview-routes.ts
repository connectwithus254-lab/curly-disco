/**
 * Preview simulator.
 *
 * Sellers must be able to see exactly what their customers will see, before anything goes live.
 * Because the Telegram screens are pure renderers (ADR-0006), the preview calls the same code
 * that production calls — a preview can therefore never drift from reality.
 *
 * All routes here are read-only dry runs: `simulate` returns the effects that WOULD be produced
 * without sending anything.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ERRORS, isUuid } from '@botshop/shared';
import {
  normalizeLocale,
  renderByCallback,
  renderMainMenu,
  dispatchUpdate,
  type IncomingUpdate,
  type ScreenContext,
  type InlineKeyboardButton,
} from '@botshop/telegram';
import * as repo from '@botshop/db/repos';
import { authorize, requireActor, type RequestWithActor } from '../auth.ts';
import { fakeOutbox } from '../telegram-transport.ts';
import type { RouteDeps } from './types.ts';

const renderSchema = z.object({
  shopId: z.string().uuid(),
  locale: z.string().min(2).max(8).optional(),
  callbackData: z.string().max(64).optional(),
});

const simulateSchema = z.object({
  shopId: z.string().uuid(),
  locale: z.string().min(2).max(8).optional(),
  text: z.string().max(4096).optional(),
  callbackData: z.string().max(64).optional(),
  telegramUserId: z.number().int().optional(),
});

export async function registerPreviewRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  const { db, config } = deps;

  const contextFor = async (shop: repo.ShopRow, bot: repo.BotRow | null): Promise<ScreenContext> => ({
    shop: {
      name: shop.name,
      description: shop.description,
      category: shop.category,
      currency: shop.currency,
      contactEmail: shop.contact_email,
      contactPhone: shop.contact_phone,
      supportHours: shop.support_hours,
      defaultLocale: normalizeLocale(shop.default_locale),
      supportedLocales: shop.supported_locales.map((l) => normalizeLocale(l)),
      rulesMd: shop.rules_md,
    },
    botUsername: bot?.username ?? null,
    features: { catalog: false, orders: false, referrals: false },
  });

  app.post('/api/v1/preview/render', async (request: RequestWithActor, reply) => {
    const actor = requireActor(request);
    authorize(actor, 'read');
    const body = renderSchema.parse(request.body ?? {});

    const result = await db.withTenant(
      actor.tenantId,
      async (tx) => {
        const shop = await repo.getShop(tx, body.shopId);
        if (!shop) throw ERRORS.notFound('Shop not found');
        const bot = (await repo.listBots(tx)).find((b) => b.shop_id === shop.id) ?? null;
        const ctx = await contextFor(shop, bot);
        const locale = normalizeLocale(body.locale ?? shop.default_locale, normalizeLocale(shop.default_locale));
        const screen = body.callbackData ? renderByCallback(body.callbackData, ctx, locale) : renderMainMenu(ctx, locale);
        return { screen, bot };
      },
      { actorRole: actor.role },
    );

    if (!result.screen) throw ERRORS.notFound('Unknown screen');
    return reply.send({
      preview: {
        text: result.screen.text,
        keyboard: result.screen.reply_markup.inline_keyboard.map((row: InlineKeyboardButton[]) =>
          row.map((b: InlineKeyboardButton) => ({
            text: b.text,
            callbackData: 'callback_data' in b ? (b.callback_data ?? null) : null,
          })),
        ),
      },
      botUsername: result.bot?.username ?? null,
      mode: config.telegram.mode,
    });
  });

  /** Dry run: shows what the bot would reply, without contacting Telegram. */
  app.post('/api/v1/preview/simulate', async (request: RequestWithActor, reply) => {
    const actor = requireActor(request);
    authorize(actor, 'read');
    const body = simulateSchema.parse(request.body ?? {});
    if (!body.text && !body.callbackData) throw ERRORS.validation('Provide text or callbackData');

    const result = await db.withTenant(
      actor.tenantId,
      async (tx) => {
        const shop = await repo.getShop(tx, body.shopId);
        if (!shop) throw ERRORS.notFound('Shop not found');
        const bot = (await repo.listBots(tx)).find((b) => b.shop_id === shop.id) ?? null;
        const ctx = await contextFor(shop, bot);
        const locale = normalizeLocale(body.locale ?? shop.default_locale, normalizeLocale(shop.default_locale));
        const telegramUserId = body.telegramUserId ?? 999000001;
        const update: IncomingUpdate = body.callbackData
          ? {
              update_id: 0,
              callback_query: {
                id: 'preview',
                from: { id: telegramUserId, is_bot: false, first_name: 'Preview' },
                message: { message_id: 1, chat: { id: telegramUserId, type: 'private' } },
                data: body.callbackData,
              },
            }
          : {
              update_id: 0,
              message: {
                message_id: 1,
                date: Math.floor(Date.now() / 1000),
                chat: { id: telegramUserId, type: 'private' },
                from: { id: telegramUserId, is_bot: false, first_name: 'Preview', language_code: locale },
                text: body.text!,
              },
            };

        const outcome = dispatchUpdate(update, ctx, {
          telegramUserId,
          locale,
          // The preview always behaves like an existing customer so the language picker does not
          // hijack the first screen the seller wanted to inspect.
          isNew: false,
        });
        return { outcome, bot };
      },
      { actorRole: actor.role },
    );

    return reply.send({
      screen: result.outcome.screen,
      locale: result.outcome.locale,
      effects: result.outcome.effects,
      note: 'Dry run — nothing was sent to Telegram.',
    });
  });

  /** What the bot actually sent through the offline transport (fake mode only). */
  app.get('/api/v1/preview/outbox', async (request: RequestWithActor, reply) => {
    const actor = requireActor(request);
    authorize(actor, 'read');
    const query = request.query as { botId?: string };
    if (!query.botId || !isUuid(query.botId)) throw ERRORS.validation('botId is required');
    const transport = fakeOutbox(query.botId);
    if (!transport) {
      return reply.send({ mode: config.telegram.mode, calls: [] });
    }
    const calls = await transport.outbox();
    return reply.send({ mode: config.telegram.mode, calls: calls.slice(-50).reverse() });
  });
}
