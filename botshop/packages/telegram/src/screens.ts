/**
 * Screen renderers (ADR-0006). Pure functions: shop context + locale -> text + keyboard.
 * The Telegram bot and the web preview simulator both call these, so "preview" is literally
 * the same rendering code that production uses.
 */
import type { InlineKeyboardButton, InlineKeyboardMarkup } from 'grammy/types';
import { t, type Locale } from './i18n.ts';

// Re-exported so the rest of the codebase depends on the bot package, not on grammy directly.
export type { InlineKeyboardButton, InlineKeyboardMarkup };

export interface ScreenContext {
  shop: {
    name: string;
    description: string | null;
    category: string | null;
    currency: string;
    contactEmail: string | null;
    contactPhone: string | null;
    supportHours: string | null;
    defaultLocale: Locale;
    supportedLocales: Locale[];
    rulesMd: string | null;
  };
  botUsername: string | null;
  /** Feature flags per shop; milestones flip these on (M2 catalog, M3 orders, M5 referrals). */
  features: { catalog: boolean; orders: boolean; referrals: boolean };
}

export interface RenderedScreen {
  screen: ScreenId;
  text: string;
  parse_mode: 'Markdown';
  reply_markup: InlineKeyboardMarkup;
  /** Locale used, so callers can persist it. */
  locale: Locale;
}

export type ScreenId =
  | 'main_menu'
  | 'language_picker'
  | 'shop_about'
  | 'rules'
  | 'support'
  | 'help'
  | 'orders_coming_soon';

const btn = (text: string, callback_data: string): InlineKeyboardButton => ({ text, callback_data } as InlineKeyboardButton);
const backHome = (locale: Locale): InlineKeyboardMarkup => ({
  inline_keyboard: [[btn(t(locale, 'menu.home'), 'm:home')]],
});

/** Callback-data router table; the only place prefixes are defined. */
export const CB = {
  home: 'm:home',
  language: 'm:lang',
  shop: 'sh:about',
  rules: 'rl:rules',
  support: 'su:support',
  help: 'm:help',
  orders: 'o:list',
  profile: 'pr:me',
  referrals: 'rf:me',
  languageSet: (code: Locale) => `l:set:${code}`,
} as const;

export function renderMainMenu(ctx: ScreenContext, locale: Locale): RenderedScreen {
  const rows: InlineKeyboardButton[][] = [];
  if (ctx.features.catalog) rows.push([btn(t(locale, 'menu.shop'), CB.shop)]);
  if (ctx.features.orders) rows.push([btn(t(locale, 'menu.orders'), CB.orders)]);
  rows.push([btn(t(locale, 'menu.rules'), CB.rules), btn(t(locale, 'menu.support'), CB.support)]);
  const second: InlineKeyboardButton[] = [btn(t(locale, 'menu.help'), CB.help)];
  if (ctx.shop.supportedLocales.length > 1) second.push(btn(t(locale, 'menu.language'), CB.language));
  rows.push(second);
  if (ctx.features.referrals) rows.push([btn(t(locale, 'menu.referrals'), CB.referrals)]);

  const text = [
    t(locale, 'start.greeting', { shop: ctx.shop.name }),
    ctx.shop.description ? `\n${ctx.shop.description}` : '',
    '',
    t(locale, 'welcome.default', { shop: ctx.shop.name }),
  ]
    .filter((line) => line !== '')
    .join('\n');

  return { screen: 'main_menu', text, parse_mode: 'Markdown', reply_markup: { inline_keyboard: rows }, locale };
}

export function renderLanguagePicker(ctx: ScreenContext, locale: Locale): RenderedScreen {
  const labels: Record<Locale, string> = { en: '🇬🇧 English', sw: '🇰🇪 Kiswahili', ru: '🇷🇺 Русский' };
  return {
    screen: 'language_picker',
    text: t(locale, 'start.choose_language'),
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: ctx.shop.supportedLocales.map((code) => [btn(labels[code] ?? code, CB.languageSet(code))]),
    },
    locale,
  };
}

export function renderShopAbout(ctx: ScreenContext, locale: Locale): RenderedScreen {
  const about = ctx.shop.description ?? t(locale, 'shop.catalog_soon');
  const lines = [
    t(locale, 'shop.title', { shop: ctx.shop.name }),
    '',
    about,
    ctx.shop.category ? `${t(locale, 'shop.about')}: ${ctx.shop.category}` : '',
    `${t(locale, 'shop.currency')}: ${ctx.shop.currency}`,
    ctx.shop.contactEmail ? `${t(locale, 'shop.contact')}: ${ctx.shop.contactEmail}` : '',
    ctx.shop.supportHours ? `${t(locale, 'shop.hours')}: ${ctx.shop.supportHours}` : '',
    '',
    !ctx.features.catalog ? t(locale, 'shop.catalog_soon') : '',
  ].filter((l) => l !== '');
  return {
    screen: 'shop_about',
    text: lines.join('\n'),
    parse_mode: 'Markdown',
    reply_markup: backHome(locale),
    locale,
  };
}

export function renderRules(ctx: ScreenContext, locale: Locale): RenderedScreen {
  const body = ctx.shop.rulesMd?.trim();
  return {
    screen: 'rules',
    text: body ? `${t(locale, 'rules.title')}\n\n${body}` : t(locale, 'rules.empty'),
    parse_mode: 'Markdown',
    reply_markup: backHome(locale),
    locale,
  };
}

export function renderSupport(ctx: ScreenContext, locale: Locale): RenderedScreen {
  const lines = [t(locale, 'support.title'), '', t(locale, 'support.hint')];
  if (ctx.shop.supportHours) lines.push('', t(locale, 'support.hours', { hours: ctx.shop.supportHours }));
  if (ctx.shop.contactEmail) lines.push(`${t(locale, 'shop.contact')}: ${ctx.shop.contactEmail}`);
  return { screen: 'support', text: lines.join('\n'), parse_mode: 'Markdown', reply_markup: backHome(locale), locale };
}

export function renderHelp(ctx: ScreenContext, locale: Locale): RenderedScreen {
  return {
    screen: 'help',
    text: [t(locale, 'help.title'), '', t(locale, 'help.body'), '', t(locale, 'help.commands')].join('\n'),
    parse_mode: 'Markdown',
    reply_markup: backHome(locale),
    locale,
  };
}

export function renderPlanningScreen(screen: ScreenId, ctx: ScreenContext, locale: Locale, messageKey: string): RenderedScreen {
  return {
    screen,
    text: messageKey,
    parse_mode: 'Markdown',
    reply_markup: backHome(locale),
    locale,
  };
}

/** Renders a screen by callback data. Returns null for unknown payloads. */
export function renderByCallback(data: string, ctx: ScreenContext, locale: Locale): RenderedScreen | null {
  switch (data) {
    case CB.home:
    case 'm':
      return renderMainMenu(ctx, locale);
    case CB.language:
      return renderLanguagePicker(ctx, locale);
    case CB.shop:
      return renderShopAbout(ctx, locale);
    case CB.rules:
      return renderRules(ctx, locale);
    case CB.support:
      return renderSupport(ctx, locale);
    case CB.help:
      return renderHelp(ctx, locale);
    case CB.orders:
      return renderPlanningScreen('orders_coming_soon', ctx, locale, '🧾 Order history arrives in the next release.');
    case CB.profile:
    case CB.referrals:
      return renderPlanningScreen('orders_coming_soon', ctx, locale, '🎁 This section arrives in the next release.');
    default:
      return null;
  }
}

export function isLanguageCallback(data: string): boolean {
  return data.startsWith('l:set:');
}
