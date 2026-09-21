import type { Db } from '@botshop/db';
import type { AuthService } from '../auth.ts';
import type { AppConfig } from '../config.ts';

export interface RateLimiter {
  /** Sliding-window counter keyed by ip+action; throws a 429 ApiError when exceeded. */
  check(ip: string | undefined, action: string, limit: number, windowMs: number): void;
}

export interface RouteDeps {
  db: Db;
  auth: AuthService;
  config: AppConfig;
  rateLimiter: RateLimiter;
  enqueueTelegramUpdate?: (job: { tenantId: string; botId: string; updateId: number }) => Promise<void>;
}
