/**
 * Minimal i18n for bot surfaces. Locale files are plain maps so a shop owner can be given
 * a locale override later without shipping code (docs/04-telegram-conversation-map.md §i18n).
 */
export const SUPPORTED_LOCALES = ['en', 'sw', 'ru'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

const en = {
  'menu.shop': '🛍 Shop',
  'menu.orders': '📦 My orders',
  'menu.profile': '👤 Profile',
  'menu.support': '💬 Support',
  'menu.rules': '📜 Rules',
  'menu.language': '🌐 Language',
  'menu.balance': '💰 Balance',
  'menu.referrals': '🎁 Invite & earn',
  'menu.help': 'ℹ️ Help',
  'menu.back': '⬅️ Back',
  'menu.home': '🏠 Main menu',

  'welcome.default': 'Welcome to {shop}! Choose an option below.',

  'start.greeting': '👋 Welcome to *{shop}*!',
  'start.subtitle': 'Browse, order and pay right here in Telegram.',
  'start.choose_language': '🌐 Please choose your language:',
  'start.language_set': '✅ Language set to English.',

  'shop.title': '🛍 *{shop}*',
  'shop.about': 'About',
  'shop.currency': 'Currency',
  'shop.catalog_soon': 'The catalog is being filled in. Please check back soon.',
  'shop.contact': 'Contact',
  'shop.hours': 'Support hours',

  'rules.title': '📜 *Rules & policies*',
  'rules.empty': 'The seller has not published rules yet.',

  'support.title': '💬 *Support*',
  'support.hint': 'Write your question here and the seller will reply in this chat.',
  'support.hours': 'Support hours: {hours}',

  'help.title': 'ℹ️ *How this bot works*',
  'help.body':
    '• Use the buttons to move around — no commands to memorise.\n' +
    '• /start always brings you back to the main menu.\n' +
    '• Payment is confirmed automatically; you will get a confirmation message here.',
  'help.commands': 'Commands: /start — main menu',

  'error.generic': '⚠️ Something went wrong. Please try again in a moment.',
  'error.not_found': '🤔 That item is no longer available.',
  'error.bot_inactive': '🚧 This shop is not available right now.',

  'staff.new_message': '📨 New message from @{username} (id {userId}):\n\n{text}',
};

const sw = {
  ...en,
  'menu.shop': '🛍 Duka',
  'menu.orders': '📦 Oda zangu',
  'menu.profile': '👤 Wasifu',
  'menu.support': '💬 Msaada',
  'menu.rules': '📜 Masharti',
  'menu.language': '🌐 Lugha',
  'menu.balance': '💰 Salio',
  'menu.referrals': '🎁 Alika na upate',
  'menu.help': 'ℹ️ Msaada',
  'menu.back': '⬅️ Nyuma',
  'menu.home': '🏠 Menyu kuu',
  'welcome.default': 'Karibu {shop}! Chagua kipengele hapa chini.',
  'start.greeting': '👋 Karibu *{shop}*!',
  'start.subtitle': 'Nunua, agiza na lipa hapa hapa Telegram.',
  'start.choose_language': '🌐 Tafadhali chagua lugha yako:',
  'start.language_set': '✅ Lugha imewekwa kuwa Kiswahili.',
  'shop.title': '🛍 *{shop}*',
  'shop.about': 'Kuhusu',
  'shop.currency': 'Sarafu',
  'shop.catalog_soon': 'Orodha ya bidhaa inaandaliwa. Tafadhali angalia tena hivi karibuni.',
  'shop.contact': 'Wasiliana',
  'shop.hours': 'Saa za msaada',
  'rules.title': '📜 *Masharti na sera*',
  'rules.empty': 'Muuzaji hajatuma masharti bado.',
  'support.title': '💬 *Msaada*',
  'support.hint': 'Andika swali lako hapa na muuzaji atajibu kwenye gumzo hili.',
  'support.hours': 'Saa za msaada: {hours}',
  'help.title': 'ℹ️ *Jinsi boti hii inavyofanya kazi*',
  'help.body':
    '• Tumia vitufe kusonga — hakuna amri za kukumbuka.\n' +
    '• /start hukurudisha kwenye menyu kuu.\n' +
    '• Malipo yanathibitishwa kiotomatiki; utapata ujumbe hapa.',
  'help.commands': 'Amri: /start — menyu kuu',
  'error.generic': '⚠️ Kuna hitilafu. Tafadhali jaribu tena.',
  'error.not_found': '🤔 Bidhaa hiyo haipatikani tena.',
  'error.bot_inactive': '🚧 Duka hili halipatikani kwa sasa.',
  'staff.new_message': '📨 Ujumbe mpya kutoka @{username} (id {userId}):\n\n{text}',
};

const ru = {
  ...en,
  'menu.shop': '🛍 Магазин',
  'menu.orders': '📦 Мои заказы',
  'menu.profile': '👤 Профиль',
  'menu.support': '💬 Поддержка',
  'menu.rules': '📜 Правила',
  'menu.language': '🌐 Язык',
  'menu.balance': '💰 Баланс',
  'menu.referrals': '🎁 Приглашай и зарабатывай',
  'menu.help': 'ℹ️ Помощь',
  'menu.back': '⬅️ Назад',
  'menu.home': '🏠 Главное меню',
  'welcome.default': 'Добро пожаловать в {shop}! Выберите пункт ниже.',
  'start.greeting': '👋 Добро пожаловать в *{shop}*!',
  'start.subtitle': 'Смотрите, заказывайте и платите прямо в Telegram.',
  'start.choose_language': '🌐 Пожалуйста, выберите язык:',
  'start.language_set': '✅ Язык переключён на русский.',
  'shop.title': '🛍 *{shop}*',
  'shop.about': 'О магазине',
  'shop.currency': 'Валюта',
  'shop.catalog_soon': 'Каталог ещё наполняется. Загляните позже.',
  'shop.contact': 'Контакт',
  'shop.hours': 'Часы поддержки',
  'rules.title': '📜 *Правила и политики*',
  'rules.empty': 'Продавец пока не опубликовал правила.',
  'support.title': '💬 *Поддержка*',
  'support.hint': 'Напишите вопрос здесь — продавец ответит в этом чате.',
  'support.hours': 'Часы поддержки: {hours}',
  'help.title': 'ℹ️ *Как работает этот бот*',
  'help.body':
    '• Перемещайтесь кнопками — команды запоминать не нужно.\n' +
    '• /start всегда возвращает в главное меню.\n' +
    '• Оплата подтверждается автоматически, вы получите сообщение здесь.',
  'help.commands': 'Команды: /start — главное меню',
  'error.generic': '⚠️ Что-то пошло не так. Попробуйте ещё раз.',
  'error.not_found': '🤔 Этот товар больше недоступен.',
  'error.bot_inactive': '🚧 Магазин сейчас недоступен.',
  'staff.new_message': '📨 Новое сообщение от @{username} (id {userId}):\n\n{text}',
};

export type MessageKey = keyof typeof en;

const CATALOGS: Record<Locale, Record<MessageKey, string>> = { en, sw, ru };

export function normalizeLocale(input: string | null | undefined, fallback: Locale = 'en'): Locale {
  if (!input) return fallback;
  const short = input.toLowerCase().split(/[-_]/)[0];
  return (SUPPORTED_LOCALES as readonly string[]).includes(short!) ? (short as Locale) : fallback;
}

export function t(locale: Locale, key: MessageKey, vars: Record<string, string | number> = {}): string {
  const template = CATALOGS[locale]?.[key] ?? CATALOGS.en[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_m, name: string) =>
    name in vars ? String(vars[name]) : `{${name}}`,
  );
}

export function translator(locale: Locale) {
  return (key: MessageKey, vars?: Record<string, string | number>) => t(locale, key, vars);
}
