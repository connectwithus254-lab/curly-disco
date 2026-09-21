/**
 * Configuration. Fail fast at boot on anything security-relevant: a misconfigured encryption
 * keyring or a missing webhook base URL must never degrade silently.
 */
import { KeyRing } from '@botshop/core';

export interface AppConfig {
  env: 'development' | 'test' | 'production';
  port: number;
  host: string;
  databaseUrl: string;
  databaseAdminUrl: string;
  publicBaseUrl: string;
  cookieSecure: boolean;
  sessionTtlHours: number;
  keyRing: KeyRing;
  telegram: {
    /** 'fake' keeps everything offline (dev/demo); 'live' calls the real Bot API. */
    mode: 'fake' | 'live';
    /** Alternative Bot API root (self-hosted Bot API server or the local fake server). */
    apiRoot?: string;
    /** Polling mode: no public URL needed. Good for a quick trial on an office laptop. */
    pollingEnabled: boolean;
    webhookEnabled: boolean;
  };
  limits: {
    telegramSendsPerMinutePerBot: number;
    jsonBodyLimitBytes: number;
  };
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = (env.NODE_ENV ?? 'development') as AppConfig['env'];
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error(`NODE_ENV must be development | test | production, got "${nodeEnv}"`);
  }

  const keyRing = KeyRing.fromEnv(env);
  const publicBaseUrl = (env.PUBLIC_BASE_URL ?? `http://localhost:${env.PORT ?? 3000}`).replace(/\/$/, '');
  if (nodeEnv === 'production' && !publicBaseUrl.startsWith('https://')) {
    throw new Error('PUBLIC_BASE_URL must be https:// in production (Telegram requires TLS for webhooks)');
  }
  if (nodeEnv === 'production' && env.ALLOW_INSECURE_DEFAULTS === 'true') {
    throw new Error('ALLOW_INSECURE_DEFAULTS must not be set in production');
  }

  const telegramMode = (env.TELEGRAM_MODE ?? (nodeEnv === 'production' ? 'live' : 'fake')) as 'fake' | 'live';
  if (!['fake', 'live'].includes(telegramMode)) throw new Error('TELEGRAM_MODE must be fake | live');

  return {
    env: nodeEnv,
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '0.0.0.0',
    databaseUrl:
      env.DATABASE_URL ??
      'postgres://botshop_app:botshop_app@127.0.0.1:54329/botshop',
    databaseAdminUrl:
      env.DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres@127.0.0.1:54329/botshop',
    publicBaseUrl,
    cookieSecure: publicBaseUrl.startsWith('https://'),
    sessionTtlHours: Number(env.SESSION_TTL_HOURS ?? 24 * 14),
    keyRing,
    telegram: {
      mode: telegramMode,
      ...(env.TELEGRAM_API_ROOT ? { apiRoot: env.TELEGRAM_API_ROOT } : {}),
      pollingEnabled: bool(env.TELEGRAM_POLLING, telegramMode === 'live'),
      webhookEnabled: bool(env.TELEGRAM_WEBHOOK_ENABLED, true),
    },
    limits: {
      telegramSendsPerMinutePerBot: Number(env.TELEGRAM_SENDS_PER_MINUTE ?? 20),
      jsonBodyLimitBytes: Number(env.JSON_BODY_LIMIT_BYTES ?? 256 * 1024),
    },
  };
}
