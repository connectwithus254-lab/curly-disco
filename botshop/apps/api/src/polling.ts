/**
 * Long-polling fallback for Telegram updates.
 *
 * Why this exists: to test a real bot you normally need a public HTTPS URL for the webhook.
 * Polling lets you run the platform on a laptop or a private VPS and still receive updates,
 * with the same dedupe + queue path as the webhook (the transport differs, nothing else does).
 *
 * Enabled with TELEGRAM_MODE=live TELEGRAM_POLLING=true.
 */
import { HttpTransport } from '@botshop/telegram';
import type { IncomingUpdate } from '@botshop/telegram';
import type { Db } from '@botshop/db';
import * as repo from '@botshop/db/repos';
import type { AppConfig } from './config.ts';

export interface PollingDeps {
  db: Db;
  config: AppConfig;
  enqueueTelegramUpdate: (job: { tenantId: string; botId: string; updateId: number }) => Promise<void>;
  log: (line: string, extra?: Record<string, unknown>) => void;
}

export function startPolling(deps: PollingDeps): { stop: () => void } {
  const offsets = new Map<string, number>();
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      const bots = await deps.db.withPlatform(
        async (tx) => (await repo.listBots(tx)).filter((b) => b.status === 'active' && b.mode === 'polling'),
        { actorRole: 'system' },
      );
      for (const bot of bots) {
        try {
          const transport = new HttpTransport(deps.config.keyRing.decrypt(bot.token_ciphertext), deps.config.telegram.apiRoot);
          const offset = offsets.get(bot.id) ?? 0;
          const updates = (await transport.getUpdates(offset, 1)) as IncomingUpdate[];
          for (const update of updates) {
            offsets.set(bot.id, Math.max(offsets.get(bot.id) ?? 0, update.update_id + 1));
            const inserted = await deps.db.withPlatform(
              (tx) =>
                repo.insertTelegramUpdate(tx, {
                  tenantId: bot.tenant_id,
                  botId: bot.id,
                  updateId: update.update_id,
                  payload: update,
                }),
              { actorRole: 'system' },
            );
            if (inserted.inserted) {
              await deps.enqueueTelegramUpdate({ tenantId: bot.tenant_id, botId: bot.id, updateId: update.update_id });
            }
          }
        } catch (error) {
          deps.log('polling failed for bot', { botId: bot.id, error: (error as Error).message.slice(0, 200) });
        }
      }
    } catch (error) {
      deps.log('polling tick failed', { error: String(error) });
    } finally {
      if (!stopped) timer = setTimeout(tick, 1_500);
    }
  };

  timer = setTimeout(tick, 500);
  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
