/**
 * Telegram transport abstraction.
 *
 * Two implementations:
 *  - HttpTransport : real Bot API through grammy's Api (works against api.telegram.org, or any
 *                    Bot API compatible server via apiRoot — used by scripts/fake-telegram.mjs)
 *  - FakeTransport : in-memory capture, no network at all (offline dev + tests)
 * Both satisfy the same interface, so the worker never knows which one it holds.
 */
import { Api } from 'grammy';
import type { InlineKeyboardMarkup } from './screens.ts';

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

export interface SendMessageParams {
  chat_id: number | string;
  text: string;
  parse_mode?: 'Markdown' | 'MarkdownV2' | 'HTML';
  reply_markup?: InlineKeyboardMarkup;
  link_preview_options?: { is_disabled?: boolean };
}

export interface EditMessageParams extends SendMessageParams {
  message_id: number;
}

export interface SentMessage {
  message_id: number;
  chat_id: number | string;
}

export interface TelegramTransport {
  readonly kind: 'http' | 'fake';
  getMe(): Promise<TelegramUser>;
  setWebhook(url: string, secretToken: string): Promise<boolean>;
  deleteWebhook(): Promise<boolean>;
  sendMessage(params: SendMessageParams): Promise<SentMessage>;
  editMessageText(params: EditMessageParams): Promise<SentMessage>;
  answerCallbackQuery(id: string, text?: string): Promise<boolean>;
  /** Long-polling mode only; webhook deployments never call this. */
  getUpdates?(offset: number, timeoutSeconds: number): Promise<IncomingUpdateLike[]>;
  /** Only meaningful for the fake transport / fake Bot API server. */
  outbox(): Promise<CapturedCall[]>;
}

/** Minimal structural type so this package does not depend on the dispatcher module. */
export interface IncomingUpdateLike {
  update_id: number;
}

export interface CapturedCall {
  method: string;
  params: Record<string, unknown>;
  at: string;
}

export class TelegramApiError extends Error {
  constructor(
    message: string,
    readonly method: string,
    readonly description?: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

export class HttpTransport implements TelegramTransport {
  readonly kind = 'http' as const;
  private readonly api: Api;

  constructor(token: string, apiRoot?: string) {
    this.api = new Api(token);
    if (apiRoot) {
      // Allows pointing at a self-hosted Bot API server or the local fake server.
      (this.api as unknown as { config: { use: (o: Record<string, unknown>) => void } }).config.use({ apiRoot });
    }
  }

  async getMe(): Promise<TelegramUser> {
    const me = await this.api.getMe();
    return { id: me.id, is_bot: me.is_bot, first_name: me.first_name, username: me.username };
  }

  async setWebhook(url: string, secretToken: string): Promise<boolean> {
    return this.api.setWebhook(url, {
      secret_token: secretToken,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: true,
    });
  }

  async deleteWebhook(): Promise<boolean> {
    return this.api.deleteWebhook({ drop_pending_updates: false });
  }

  async sendMessage(params: SendMessageParams): Promise<SentMessage> {
    const res = await this.api.sendMessage(params.chat_id, params.text, {
      parse_mode: params.parse_mode,
      reply_markup: params.reply_markup,
      link_preview_options: params.link_preview_options ?? { is_disabled: true },
    });
    return { message_id: res.message_id, chat_id: res.chat.id };
  }

  async editMessageText(params: EditMessageParams): Promise<SentMessage> {
    const res = await this.api.editMessageText(params.chat_id, params.message_id, params.text, {
      parse_mode: params.parse_mode,
      reply_markup: params.reply_markup,
      link_preview_options: { is_disabled: true },
    });
    // grammy returns either a Message or true when content is unchanged.
    if (typeof res === 'boolean' || !('message_id' in res)) {
      return { message_id: params.message_id, chat_id: params.chat_id };
    }
    return { message_id: res.message_id, chat_id: params.chat_id };
  }

  async answerCallbackQuery(id: string, text?: string): Promise<boolean> {
    return this.api.answerCallbackQuery(id, text ? { text } : undefined);
  }

  async getUpdates(offset: number, timeoutSeconds: number): Promise<IncomingUpdateLike[]> {
    const updates = await this.api.getUpdates({
      offset,
      timeout: timeoutSeconds,
      allowed_updates: ['message', 'callback_query'],
    });
    return updates as unknown as IncomingUpdateLike[];
  }

  async outbox(): Promise<CapturedCall[]> {
    return [];
  }
}

/**
 * In-memory transport for offline development and tests.
 * Records every call so tests can assert on user-visible behaviour, and the web preview
 * can show "what the bot would have sent".
 */
export class FakeTransport implements TelegramTransport {
  readonly kind = 'fake' as const;
  private readonly calls: CapturedCall[] = [];
  private messageId = 1000;
  private readonly botUsername: string;

  constructor(
    private readonly options: { botId?: number; username?: string } = {},
  ) {
    this.botUsername = options.username ?? 'botshop_demo_bot';
  }

  private record(method: string, params: Record<string, unknown>): void {
    this.calls.push({ method, params, at: new Date().toISOString() });
    if (this.calls.length > 500) this.calls.shift();
  }

  async getMe(): Promise<TelegramUser> {
    this.record('getMe', {});
    return {
      id: this.options.botId ?? 123456789,
      is_bot: true,
      first_name: 'BotShop Demo',
      username: this.botUsername,
    };
  }

  async setWebhook(url: string, secretToken: string): Promise<boolean> {
    this.record('setWebhook', { url, secret_token: `${secretToken.slice(0, 4)}…` });
    return true;
  }

  async deleteWebhook(): Promise<boolean> {
    this.record('deleteWebhook', {});
    return true;
  }

  async sendMessage(params: SendMessageParams): Promise<SentMessage> {
    this.record('sendMessage', params as unknown as Record<string, unknown>);
    return { message_id: ++this.messageId, chat_id: params.chat_id };
  }

  async editMessageText(params: EditMessageParams): Promise<SentMessage> {
    this.record('editMessageText', params as unknown as Record<string, unknown>);
    return { message_id: params.message_id, chat_id: params.chat_id };
  }

  async answerCallbackQuery(id: string, text?: string): Promise<boolean> {
    this.record('answerCallbackQuery', { callback_query_id: id, text });
    return true;
  }

  async outbox(): Promise<CapturedCall[]> {
    return [...this.calls];
  }

  clear(): void {
    this.calls.length = 0;
  }
}
