/**
 * Per-bot transport resolution.
 *
 * In `fake` mode nothing touches the network: every bot gets an in-process FakeTransport whose
 * call log is visible in the web panel (the "Preview" tab). In `live` mode we decrypt the
 * stored token and talk to api.telegram.org (or TELEGRAM_API_ROOT, e.g. a local Bot API server).
 *
 * Decrypted tokens never leave this module: callers receive a transport, not a token.
 */
import { KeyRing } from '@botshop/core';
import { FakeTransport, HttpTransport, type TelegramTransport } from '@botshop/telegram';
import type { BotRow } from '@botshop/db/repos';

export interface TransportOptions {
  mode: 'fake' | 'live';
  apiRoot?: string;
  keyRing: KeyRing;
}

const fakeTransports = new Map<string, FakeTransport>();

export function resolveTransport(bot: Pick<BotRow, 'id' | 'token_ciphertext' | 'username'>, options: TransportOptions): TelegramTransport {
  if (options.mode === 'fake') {
    let transport = fakeTransports.get(bot.id);
    if (!transport) {
      transport = new FakeTransport({ username: bot.username ?? 'botshop_demo_bot' });
      fakeTransports.set(bot.id, transport);
    }
    return transport;
  }
  const token = options.keyRing.decrypt(bot.token_ciphertext);
  return new HttpTransport(token, options.apiRoot);
}

/** Reads a bot token for a one-off validation call without handing it to any other layer. */
export function withDecryptedToken<T>(bot: Pick<BotRow, 'token_ciphertext'>, keyRing: KeyRing, fn: (token: string) => T): T {
  return fn(keyRing.decrypt(bot.token_ciphertext));
}

export function fakeOutbox(botId: string) {
  return fakeTransports.get(botId) ?? null;
}
