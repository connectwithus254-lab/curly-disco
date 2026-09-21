import { describe, expect, it } from 'vitest';
import { dispatchUpdate, type IncomingUpdate, type ScreenContext } from '@botshop/telegram';

const ctx: ScreenContext = {
  shop: {
    name: 'Kesi Crafts',
    description: 'Handmade jewellery from Nairobi.',
    category: 'Handmade & Accessories',
    currency: 'KES',
    contactEmail: 'hello@kesi.test',
    contactPhone: '+254700000000',
    supportHours: 'Mon–Sat 09:00–18:00',
    defaultLocale: 'en',
    supportedLocales: ['en', 'sw'],
    rulesMd: 'We ship within 3 working days.',
  },
  botUsername: 'kesi_crafts_bot',
  features: { catalog: false, orders: false, referrals: false },
};

function startUpdate(text = '/start', payload?: string): IncomingUpdate {
  return {
    update_id: 1,
    message: {
      message_id: 10,
      date: 1_700_000_000,
      chat: { id: 555, type: 'private' },
      from: { id: 555, is_bot: false, first_name: 'Amina', username: 'amina', language_code: 'en' },
      text: payload ? `${text} ${payload}` : text,
    },
  };
}

function callback(data: string): IncomingUpdate {
  return {
    update_id: 2,
    callback_query: {
      id: 'cb-1',
      from: { id: 555, is_bot: false, first_name: 'Amina' },
      message: { message_id: 10, chat: { id: 555, type: 'private' } },
      data,
    },
  };
}

describe('telegram dispatch', () => {
  it('offers the language picker on first contact when the shop is multilingual', () => {
    const result = dispatchUpdate(startUpdate(), ctx, { telegramUserId: 555, locale: null, isNew: true });
    expect(result.screen).toBe('language_picker');
    const send = result.effects[0];
    expect(send?.kind).toBe('send');
    if (send?.kind === 'send') {
      expect(send.text).toContain('choose your language');
      expect(
        send.reply_markup.inline_keyboard.flat().map((b) => ('callback_data' in b ? b.callback_data : null)),
      ).toEqual(['l:set:en', 'l:set:sw']);
    }
  });

  it('shows the main menu to a returning customer, with the shop name and no language detour', () => {
    const result = dispatchUpdate(startUpdate('/start'), ctx, { telegramUserId: 555, locale: 'en', isNew: false });
    expect(result.screen).toBe('main_menu');
    const send = result.effects[0];
    if (send?.kind === 'send') {
      expect(send.text).toContain('Kesi Crafts');
      const rows = send.reply_markup.inline_keyboard;
      expect(rows.length).toBeGreaterThan(0);
      // Catalog and orders are M2/M3 features and must not be promised yet.
      expect(JSON.stringify(rows)).not.toContain('sh:about');
      expect(JSON.stringify(rows)).toContain('rl:rules');
    }
  });

  it('still accepts /start deep links and acknowledges them', () => {
    const result = dispatchUpdate(startUpdate('/start', 'r_ABC123'), ctx, {
      telegramUserId: 555,
      locale: 'en',
      isNew: false,
    });
    expect(result.screen).toBe('main_menu:r_');
  });

  it('edits the existing message when a menu button is pressed', () => {
    const result = dispatchUpdate(callback('rl:rules'), ctx, { telegramUserId: 555, locale: 'en', isNew: false });
    expect(result.screen).toBe('rules');
    expect(result.effects.map((e) => e.kind)).toEqual(['answer_callback', 'edit']);
    const edit = result.effects[1];
    if (edit?.kind === 'edit') {
      expect(edit.message_id).toBe(10);
      expect(edit.text).toContain('We ship within 3 working days.');
    }
  });

  it('persists the chosen language and re-renders the menu in that language', () => {
    const result = dispatchUpdate(callback('l:set:sw'), ctx, { telegramUserId: 555, locale: 'en', isNew: false });
    expect(result.effects.some((e) => e.kind === 'set_customer_locale' && e.locale === 'sw')).toBe(true);
    const edit = result.effects.find((e) => e.kind === 'edit');
    if (edit?.kind === 'edit') expect(edit.text).toContain('Karibu');
  });

  it('falls back to English for unsupported locales', () => {
    const result = dispatchUpdate(callback('l:set:de'), ctx, { telegramUserId: 555, locale: 'en', isNew: false });
    expect(result.effects.some((e) => e.kind === 'set_customer_locale' && e.locale === 'en')).toBe(true);
  });

  it('answers unknown callbacks without sending a broken screen', () => {
    const result = dispatchUpdate(callback('zz:unknown'), ctx, { telegramUserId: 555, locale: 'en', isNew: false });
    expect(result.screen).toBe('unknown');
    expect(result.effects.map((e) => e.kind)).toEqual(['answer_callback']);
  });

  it('routes free text to staff and tells the customer what happens next', () => {
    const result = dispatchUpdate(startUpdate('Do you deliver to Mombasa?'), ctx, {
      telegramUserId: 555,
      locale: 'en',
      isNew: false,
    });
    const kinds = result.effects.map((e) => e.kind);
    expect(kinds).toEqual(['notify_staff', 'send']);
    const notify = result.effects[0];
    if (notify?.kind === 'notify_staff') {
      expect(notify.text).toContain('@amina');
      expect(notify.text).toContain('Mombasa');
    }
    expect(result.screen).toBe('support');
  });

  it('ignores bot senders and updates with no actor', () => {
    const fromBot = startUpdate();
    fromBot.message!.from!.is_bot = true;
    expect(dispatchUpdate(fromBot, ctx, { telegramUserId: 1, locale: null, isNew: false }).screen).toBe('ignored');
    expect(dispatchUpdate({ update_id: 9 }, ctx, { telegramUserId: 1, locale: null, isNew: false }).screen).toBe('ignored');
  });

  it('answers unknown commands with the menu instead of silence', () => {
    const result = dispatchUpdate(startUpdate('/nonsense'), ctx, { telegramUserId: 555, locale: 'en', isNew: false });
    expect(result.screen).toBe('unknown_command');
    expect(result.effects[0]?.kind).toBe('send');
  });
});
