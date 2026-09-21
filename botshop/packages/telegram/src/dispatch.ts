/**
 * Update -> effects dispatcher.
 *
 * Deliberately side-effect free: it takes an update plus already-loaded shop/customer context
 * and returns the list of things the worker should send. This is what makes the Telegram
 * behaviour unit-testable without a network or a database, and reusable by the dry-run
 * endpoint that powers the web preview simulator.
 */
import { t, normalizeLocale, type Locale } from './i18n.ts';
import {
  isLanguageCallback,
  renderByCallback,
  renderHelp,
  renderLanguagePicker,
  renderMainMenu,
  renderRules,
  renderSupport,
  CB,
  type RenderedScreen,
  type ScreenContext,
} from './screens.ts';

export interface IncomingUpdate {
  update_id: number;
  message?: {
    message_id: number;
    date: number;
    chat: { id: number; type: string };
    from?: { id: number; is_bot: boolean; first_name: string; username?: string; language_code?: string };
    text?: string;
  };
  callback_query?: {
    id: string;
    from: { id: number; is_bot: boolean; first_name: string; username?: string; language_code?: string };
    message?: { message_id: number; chat: { id: number; type: string } };
    data?: string;
  };
}

export type Effect =
  | { kind: 'send'; chat_id: number; text: string; parse_mode: 'Markdown'; reply_markup: RenderedScreen['reply_markup'] }
  | {
      kind: 'edit';
      chat_id: number;
      message_id: number;
      text: string;
      parse_mode: 'Markdown';
      reply_markup: RenderedScreen['reply_markup'];
    }
  | { kind: 'answer_callback'; callback_query_id: string; text?: string }
  | { kind: 'notify_staff'; text: string }
  | { kind: 'set_customer_locale'; locale: Locale };

export interface DispatchCustomer {
  telegramUserId: number;
  locale: Locale | null;
  isNew: boolean;
}

export interface DispatchOutcome {
  effects: Effect[];
  /** Screen the user ends up on (for logging/analytics/preview). */
  screen: string;
  locale: Locale;
  /** True when the shop is not usable (suspended/not launched). */
  blocked: boolean;
}

const SUPPORTED_COMMANDS = ['/start', '/help', '/rules', '/language', '/shop', '/menu'];

function asSend(chatId: number, screen: RenderedScreen): Effect {
  return { kind: 'send', chat_id: chatId, text: screen.text, parse_mode: screen.parse_mode, reply_markup: screen.reply_markup };
}

function asEdit(chatId: number, messageId: number, screen: RenderedScreen): Effect {
  return {
    kind: 'edit',
    chat_id: chatId,
    message_id: messageId,
    text: screen.text,
    parse_mode: screen.parse_mode,
    reply_markup: screen.reply_markup,
  };
}

export function dispatchUpdate(update: IncomingUpdate, ctx: ScreenContext, customer: DispatchCustomer): DispatchOutcome {
  const effects: Effect[] = [];

  /* ------------------------------------------------------ callback queries */
  if (update.callback_query) {
    const cq = update.callback_query;
    const data = cq.data ?? '';
    const chatId = cq.message?.chat.id;
    const messageId = cq.message?.message_id;
    let locale = customer.locale ?? ctx.shop.defaultLocale;

    let screen: RenderedScreen | null = null;

    if (isLanguageCallback(data)) {
      const chosen = normalizeLocale(data.split(':')[2], ctx.shop.defaultLocale);
      locale = chosen;
      screen = renderMainMenu(ctx, locale);
      effects.push({ kind: 'set_customer_locale', locale });
      effects.push({ kind: 'answer_callback', callback_query_id: cq.id, text: t(locale, 'start.language_set').replace(/^✅\s*/, '') });
    } else {
      screen = renderByCallback(data, ctx, locale);
      effects.push({ kind: 'answer_callback', callback_query_id: cq.id });
    }

    if (!screen) {
      return { effects, screen: 'unknown', locale, blocked: false };
    }
    // Edit in place; fall back to a new message when the original message is too old to edit.
    if (chatId !== undefined && messageId !== undefined) {
      effects.push(asEdit(chatId, messageId, screen));
    } else if (chatId !== undefined) {
      effects.push(asSend(chatId, screen));
    }
    return { effects, screen: screen.screen, locale, blocked: false };
  }

  /* -------------------------------------------------------------- messages */
  const msg = update.message;
  if (!msg || !msg.from) return { effects, screen: 'ignored', locale: ctx.shop.defaultLocale, blocked: false };
  if (msg.from.is_bot) return { effects, screen: 'ignored', locale: ctx.shop.defaultLocale, blocked: false };

  const chatId = msg.chat.id;
  const text = (msg.text ?? '').trim();
  const detectedLocale = normalizeLocale(customer.locale ?? msg.from.language_code, ctx.shop.defaultLocale);
  const [command, ...args] = text.split(/\s+/);
  const payload = args[0] ?? '';

  // First contact: offer the language picker when the shop supports more than one language.
  if (command === '/start') {
    if (customer.isNew && ctx.shop.supportedLocales.length > 1) {
      effects.push(asSend(chatId, renderLanguagePicker(ctx, detectedLocale)));
      return { effects, screen: 'language_picker', locale: detectedLocale, blocked: false };
    }
    // Deep links: r_ referral, p_ product, c_ category, o_ order, s_ staff. Captured for later
    // milestones; M1 acknowledges and shows the menu (see docs/04, §deep links).
    const screen = renderMainMenu(ctx, detectedLocale);
    effects.push(asSend(chatId, screen));
    return { effects, screen: payload ? `main_menu:${payload.slice(0, 2)}` : 'main_menu', locale: detectedLocale, blocked: false };
  }

  switch (command) {
    case '/help': {
      effects.push(asSend(chatId, renderHelp(ctx, detectedLocale)));
      return { effects, screen: 'help', locale: detectedLocale, blocked: false };
    }
    case '/rules': {
      effects.push(asSend(chatId, renderRules(ctx, detectedLocale)));
      return { effects, screen: 'rules', locale: detectedLocale, blocked: false };
    }
    case '/language': {
      effects.push(asSend(chatId, renderLanguagePicker(ctx, detectedLocale)));
      return { effects, screen: 'language_picker', locale: detectedLocale, blocked: false };
    }
    case '/shop':
    case '/menu': {
      effects.push(asSend(chatId, renderMainMenu(ctx, detectedLocale)));
      return { effects, screen: 'main_menu', locale: detectedLocale, blocked: false };
    }
    default:
      break;
  }

  if (command.startsWith('/')) {
    const unknown = SUPPORTED_COMMANDS.includes(command);
    effects.push(asSend(chatId, renderMainMenu(ctx, detectedLocale)));
    return { effects, screen: unknown ? 'main_menu' : 'unknown_command', locale: detectedLocale, blocked: false };
  }

  /* ------------------------------------------- free text = customer -> staff */
  if (text.length > 0) {
    if (text.length > 3500) {
      effects.push(asSend(chatId, renderHelp(ctx, detectedLocale)));
      return { effects, screen: 'help', locale: detectedLocale, blocked: false };
    }
    effects.push({
      kind: 'notify_staff',
      text: t(detectedLocale, 'staff.new_message', {
        username: msg.from.username ?? msg.from.first_name,
        userId: msg.from.id,
        text,
      }),
    });
    effects.push(asSend(chatId, renderSupport(ctx, detectedLocale)));
    return { effects, screen: 'support', locale: detectedLocale, blocked: false };
  }

  effects.push(asSend(chatId, renderMainMenu(ctx, detectedLocale)));
  return { effects, screen: 'main_menu', locale: detectedLocale, blocked: false };
}

export { CB };
