/**
 * In-process sliding-window rate limiter.
 *
 * Scope note (documented, not accidental): this protects a single API process. Once the API runs
 * on multiple replicas, move these counters to Postgres or Redis — the interface stays the same.
 */
import { ERRORS } from '@botshop/shared';
import type { RateLimiter } from './routes/types.ts';

interface Bucket {
  hits: number[];
}

export function createRateLimiter(): RateLimiter & { prune: () => void } {
  const buckets = new Map<string, Bucket>();

  const prune = (): void => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      bucket.hits = bucket.hits.filter((t) => now - t < 5 * 60_000);
      if (bucket.hits.length === 0) buckets.delete(key);
    }
  };

  return {
    check(ip, action, limit, windowMs) {
      const key = `${action}:${ip ?? 'unknown'}`;
      const now = Date.now();
      const bucket = buckets.get(key) ?? { hits: [] };
      bucket.hits = bucket.hits.filter((t) => now - t < windowMs);
      if (bucket.hits.length >= limit) {
        buckets.set(key, bucket);
        throw ERRORS.rateLimited(`Too many attempts for ${action}; try again shortly`);
      }
      bucket.hits.push(now);
      buckets.set(key, bucket);
      if (buckets.size > 10_000) prune();
    },
    prune,
  };
}
