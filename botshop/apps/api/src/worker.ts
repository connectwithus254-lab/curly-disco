/**
 * Worker: consumes Telegram updates and turns them into bot replies.
 *
 * Pipeline (docs/01-architecture.md §webhook fleet):
 *   1. webhook route dedupes on (bot_id, update_id) and enqueues a job  [api role]
 *   2. this worker loads tenant context, upserts the customer, and runs the pure dispatcher
 *   3. effects are applied through the transport AFTER the DB transaction commits
 *   4. every outbound call is recorded, per-bot rate limited, and audited
 *
 * Delivery is at-least-once, so every step is idempotent: the update row is the unit of work
 * and its status is only advanced on success.
 */
import { PgBoss } from 'pg-boss';
import { normalizeLocale, type Locale, type ScreenContext } from '@botshop/telegram';
import { dispatchUpdate, type Effect, type IncomingUpdate } from '@botshop/telegram';
import type { Db, Tx } from '@botshop/db';
import * as repo from '@botshop/db/repos';
import type { AppConfig } from './config.ts';
import { resolveTransport } from './telegram-transport.ts';

export const QUEUE_TELEGRAM_UPDATE = 'telegram.update';
export const QUEUE_WEBHOOK_DISPATCH = 'webhook.dispatch';

export interface TelegramUpdateJob {
  tenantId: string;
  botId: string;
  updateId: number;
}

export interface WorkerDeps {
  db: Db;
  config: AppConfig;
  log: (line: string, extra?: Record<string, unknown>) => void;
}

export async function startWorker(deps: WorkerDeps): Promise<{ boss: PgBoss; stop: () => Promise<void> }> {
  const boss = new PgBoss({
    connectionString: deps.config.databaseAdminUrl,
    schema: 'pgboss',
    application_name: 'botshop-worker',
  });
  boss.on('error', (error: unknown) => deps.log('pg-boss error', { error: String(error) }));
  await boss.start();
  await boss.createQueue(QUEUE_TELEGRAM_UPDATE);

  await boss.work<TelegramUpdateJob>(
    QUEUE_TELEGRAM_UPDATE,
    { batchSize: 1 },
    async (jobs: { data: TelegramUpdateJob }[]) => {
      for (const job of jobs) {
        await handleTelegramUpdate(deps, job.data);
      }
    },
  );

  return {
    boss,
    stop: async () => {
      await boss.stop({ graceful: true, timeout: 10_000 });
    },
  };
}

/** Loads everything the dispatcher needs and returns the shop screen context. */
export async function buildScreenContext(_tx: Tx, shop: repo.ShopRow, bot: repo.BotRow): Promise<ScreenContext> {
  return {
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
    botUsername: bot.username,
    // Feature flags flip on as milestones land; M1 ships the menu, rules, support and i18n.
    features: { catalog: false, orders: false, referrals: false },
  };
}

export async function handleTelegramUpdate(deps: WorkerDeps, job: TelegramUpdateJob): Promise<void> {
  const { db, config } = deps;
  const outcome = await db.withTenant(
    job.tenantId,
    async (tx) => {
      const bot = await repo.getBot(tx, job.botId);
      if (!bot) return { status: 'skipped' as const, reason: 'bot_not_found', effects: [] as Effect[] };

      const updateRow = await tx.queryOne<{ payload: IncomingUpdate; status: string }>(
        'select payload, status from telegram_updates where bot_id = $1 and update_id = $2',
        [job.botId, job.updateId],
      );
      if (!updateRow) return { status: 'skipped' as const, reason: 'update_row_missing', effects: [] as Effect[] };
      if (updateRow.status === 'processed') return { status: 'skipped' as const, reason: 'already_processed', effects: [] as Effect[] };

      const shop = await repo.getShop(tx, bot.shop_id);
      if (!shop) return { status: 'skipped' as const, reason: 'shop_missing', effects: [] as Effect[] };

      const update = updateRow.payload;
      const from = update.message?.from ?? update.callback_query?.from;
      const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
      if (!from || chatId === undefined) {
        await repo.markUpdate(tx, { botId: job.botId, updateId: job.updateId, status: 'skipped', error: 'no actor' });
        return { status: 'skipped' as const, reason: 'no_actor', effects: [] as Effect[] };
      }

      const { customer, isNew } = await repo.upsertCustomer(tx, {
        tenantId: job.tenantId,
        botId: job.botId,
        telegramUserId: from.id,
        chatId,
        username: from.username ?? null,
        firstName: from.first_name ?? null,
      });

      const screenContext = await buildScreenContext(tx, shop, bot);
      const result = dispatchUpdate(update, screenContext, {
        telegramUserId: from.id,
        locale: (customer.locale as Locale | null) ?? null,
        isNew,
      });

      for (const localeEffect of result.effects.filter((e) => e.kind === 'set_customer_locale')) {
        if (localeEffect.kind === 'set_customer_locale') {
          await repo.setCustomerLocale(tx, customer.id, localeEffect.locale);
        }
      }

      // The update is marked processed in the same transaction as the customer/locale writes,
      // so a crash before sending simply leaves it queued for a retry (at-least-once + idempotent).
      await repo.markUpdate(tx, { botId: job.botId, updateId: job.updateId, status: 'processed' });

      return {
        status: 'processed' as const,
        reason: null,
        effects: result.effects,
        context: {
          tenantId: job.tenantId,
          botId: job.botId,
          shopId: shop.id,
          supportChatId: shop.support_chat_id ? Number(shop.support_chat_id) : null,
          bot,
          screen: result.screen,
          locale: result.locale,
        },
      };
    },
    { actorRole: 'system' },
  );

  if (outcome.status !== 'processed' || !('context' in outcome) || !outcome.context) {
    deps.log('update skipped', { botId: job.botId, updateId: job.updateId, reason: outcome.reason });
    return;
  }

  const { context } = outcome;
  const transport = resolveTransport(context.bot, {
    mode: config.telegram.mode,
    apiRoot: config.telegram.apiRoot,
    keyRing: config.keyRing,
  });

  // Per-bot send budget protects the bot from Telegram flood limits (and from a runaway loop).
  const budget = await db.withTenant(job.tenantId, async (tx) =>
    repo.countOutboundLastMinute(tx, job.botId),
  );
  if (budget > config.limits.telegramSendsPerMinutePerBot) {
    deps.log('send budget exceeded, deferring', { botId: job.botId, budget });
    throw new Error('telegram send rate limit exceeded; retrying later');
  }

  for (const effect of outcome.effects) {
    await applyEffect(deps, effect, context, transport);
  }

  await db.withTenant(job.tenantId, async (tx) => {
    await repo.emitEvent(tx, {
      tenantId: job.tenantId,
      aggregateType: 'bot',
      aggregateId: job.botId,
      eventType: 'telegram.update.processed',
      payload: { updateId: job.updateId, screen: context.screen, locale: context.locale },
    });
  });
}

type EffectContext = {
  tenantId: string;
  botId: string;
  shopId: string;
  supportChatId: number | null;
  bot: repo.BotRow;
  screen: string;
  locale: string;
};

async function applyEffect(
  deps: WorkerDeps,
  effect: Effect,
  context: EffectContext,
  transport: ReturnType<typeof resolveTransport>,
): Promise<void> {
  const { db } = deps;
  try {
    if (effect.kind === 'send' || effect.kind === 'edit') {
      const params = {
        chat_id: effect.chat_id,
        text: effect.text,
        parse_mode: effect.parse_mode,
        reply_markup: effect.reply_markup,
      };
      const sent =
        effect.kind === 'send'
          ? await transport.sendMessage(params)
          : await transport.editMessageText({ ...params, message_id: effect.message_id });
      await db.withTenant(context.tenantId, async (tx) => {
        await repo.recordOutboundMessage(tx, {
          tenantId: context.tenantId,
          botId: context.botId,
          chatId: effect.chat_id,
          method: effect.kind === 'send' ? 'sendMessage' : 'editMessageText',
          payload: { text: effect.text, buttons: countButtons(effect.reply_markup) },
          status: 'sent',
          providerMessageId: sent.message_id,
        });
      });
      return;
    }

    if (effect.kind === 'answer_callback') {
      await transport.answerCallbackQuery(effect.callback_query_id, effect.text);
      return;
    }

    if (effect.kind === 'notify_staff') {
      if (!context.supportChatId) return;
      await transport.sendMessage({ chat_id: context.supportChatId, text: effect.text, parse_mode: undefined });
      await db.withTenant(context.tenantId, async (tx) => {
        await repo.recordOutboundMessage(tx, {
          tenantId: context.tenantId,
          botId: context.botId,
          chatId: context.supportChatId!,
          method: 'sendMessage',
          payload: { kind: 'staff_notification' },
          status: 'sent',
        });
      });
      return;
    }

    // set_customer_locale was already applied inside the transaction.
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.log('effect failed', { botId: context.botId, kind: effect.kind, error: message });
    const chatId = 'chat_id' in effect ? effect.chat_id : null;
    await db.withTenant(context.tenantId, async (tx) => {
      await repo.recordOutboundMessage(tx, {
        tenantId: context.tenantId,
        botId: context.botId,
        chatId: chatId ?? 0,
        method: effect.kind,
        payload: { error: true },
        status: 'failed',
        error: message,
      });
    });
    // Send failures (blocked user, deleted message) are terminal for that effect, but a failed
    // *edit* falls back to a fresh message so the user is never left staring at a stale screen.
    if (effect.kind === 'edit' && chatId) {
      try {
        await transport.sendMessage({
          chat_id: chatId,
          text: effect.text,
          parse_mode: effect.parse_mode,
          reply_markup: effect.reply_markup,
        });
      } catch (fallbackError) {
        deps.log('fallback send failed', { botId: context.botId, error: String(fallbackError) });
      }
    }
  }
}

function countButtons(markup: { inline_keyboard: unknown[][] } | undefined): number {
  if (!markup) return 0;
  return markup.inline_keyboard.reduce((acc, row) => acc + row.length, 0);
}
