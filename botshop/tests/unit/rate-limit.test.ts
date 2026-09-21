import { describe, expect, it } from 'vitest';
import { ApiProblem } from '@botshop/shared';
import { createRateLimiter } from '../../apps/api/src/rate-limit.ts';

describe('rate limiter', () => {
  it('allows up to the limit inside the window and then rejects with 429', () => {
    const limiter = createRateLimiter();
    for (let i = 0; i < 5; i += 1) {
      expect(() => limiter.check('1.2.3.4', 'login', 5, 60_000)).not.toThrow();
    }
    try {
      limiter.check('1.2.3.4', 'login', 5, 60_000);
      throw new Error('expected the sixth attempt to be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiProblem);
      expect((error as ApiProblem).status).toBe(429);
      expect((error as ApiProblem).code).toBe('rate_limited');
    }
  });

  it('counts each action and each ip separately', () => {
    const limiter = createRateLimiter();
    for (let i = 0; i < 5; i += 1) limiter.check('1.1.1.1', 'login', 5, 60_000);
    expect(() => limiter.check('1.1.1.1', 'signup', 5, 60_000)).not.toThrow();
    expect(() => limiter.check('2.2.2.2', 'login', 5, 60_000)).not.toThrow();
  });

  it('forgets attempts once the window has passed', () => {
    const limiter = createRateLimiter();
    for (let i = 0; i < 3; i += 1) limiter.check('9.9.9.9', 'login', 3, 20);
    expect(() => limiter.check('9.9.9.9', 'login', 3, 20)).toThrow();
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(() => limiter.check('9.9.9.9', 'login', 3, 20)).not.toThrow();
        resolve();
      }, 40);
    });
  });

  it('can be disabled for test harnesses', () => {
    const limiter = createRateLimiter({ disabled: true });
    for (let i = 0; i < 100; i += 1) limiter.check('1.2.3.4', 'login', 1, 60_000);
  });
});
