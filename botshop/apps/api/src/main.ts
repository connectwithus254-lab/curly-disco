/**
 * Entry point. One process runs both roles (api + worker) in the M1 slice; the same image can be
 * deployed as `ROLE=api` and `ROLE=worker` later without code changes (docs/01-architecture.md).
 */
import { createDb } from '@botshop/db';
import { startWorker, QUEUE_TELEGRAM_UPDATE, type TelegramUpdateJob } from './worker.ts';
import { loadConfig } from './config.ts';
import { AuthService } from './auth.ts';
import { buildApp } from './app.ts';
import { createRateLimiter } from './rate-limit.ts';
import { startPolling } from './polling.ts';

async function main(): Promise<void> {
  const config = loadConfig();
  const log = (line: string, extra?: Record<string, unknown>) => console.log(`[botshop] ${line}`, extra ?? '');

  const db = createDb({ connectionString: config.databaseUrl, applicationName: `botshop-${process.env.ROLE ?? 'all'}` });
  const auth = new AuthService(db, {
    sessionTtlHours: config.sessionTtlHours,
    secureCookies: config.cookieSecure,
  });
  const rateLimiter = createRateLimiter();

  // pg-boss owns its own schema and needs DDL rights, so it connects with the admin URL.
  // No tenant data is ever read through this connection.
  let worker: Awaited<ReturnType<typeof startWorker>> | null = null;
  let enqueue: ((job: TelegramUpdateJob) => Promise<void>) | undefined;
  if (config.env !== 'test') {
    worker = await startWorker({ db, config, log });
    enqueue = async (job: TelegramUpdateJob) => {
      await worker!.boss.send(QUEUE_TELEGRAM_UPDATE, job, { retryLimit: 5, retryDelay: 5, expireInSeconds: 300 });
    };
  }

  const app = await buildApp({ db, auth, config, rateLimiter, ...(enqueue ? { enqueueTelegramUpdate: enqueue } : {}) });
  await app.listen({ port: config.port, host: config.host });

  const polling =
    config.telegram.mode === 'live' && config.telegram.pollingEnabled && enqueue
      ? startPolling({ db, config, enqueueTelegramUpdate: enqueue, log })
      : null;

  log('ready', {
    url: config.publicBaseUrl,
    env: config.env,
    telegramMode: config.telegram.mode,
    polling: Boolean(polling),
    webhookPath: '/telegram/:botId',
  });

  const shutdown = async (signal: string): Promise<void> => {
    log(`received ${signal}, shutting down`);
    polling?.stop();
    await app.close();
    if (worker) await worker.stop();
    await db.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('[botshop] fatal', error);
  process.exit(1);
});
