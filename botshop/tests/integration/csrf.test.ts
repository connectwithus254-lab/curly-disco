/**
 * CSRF regression suite.
 *
 * History: the first version only accepted the double-submit cookie pair. In embedded/proxied
 * previews (iframe with third-party cookie restrictions, proxies that rewrite Host) the `bs_csrf`
 * cookie can be missing even though the session works, so *legitimate* panel requests were rejected
 * with "CSRF check failed". These tests pin the behaviour that must hold instead.
 */
import type { FastifyInstance } from 'fastify';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/api/src/app.ts';
import { AuthService } from '../../apps/api/src/auth.ts';
import { loadConfig } from '../../apps/api/src/config.ts';
import { createRateLimiter } from '../../apps/api/src/rate-limit.ts';
import { TestClient } from '../setup/client.ts';
import { TEST_ADMIN_URL, TEST_APP_URL, TEST_ENCRYPTION_KEYS, testEnv, type TestEnv } from '../setup/test-db.ts';

let env: TestEnv;
let app: FastifyInstance;

const HOST = 'panel.example.com';
const ORIGIN = `https://${HOST}`;

beforeAll(async () => {
  env = await testEnv();
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_APP_URL,
    DATABASE_ADMIN_URL: TEST_ADMIN_URL,
    ENCRYPTION_KEYS: TEST_ENCRYPTION_KEYS,
    ENCRYPTION_ACTIVE_KEY_ID: 'test',
    PUBLIC_BASE_URL: ORIGIN,
    TELEGRAM_MODE: 'fake',
  } as NodeJS.ProcessEnv);

  app = await buildApp({
    db: env.db,
    auth: new AuthService(env.db, { sessionTtlHours: 1, secureCookies: false }),
    config,
    rateLimiter: createRateLimiter(),
    serveStatic: false,
    logger: false,
  });
  await app.ready();
});

describe('CSRF protection', () => {
  it('accepts a same-site request that has no CSRF cookie (the embedded-preview case)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: env.ownerEmail, password: env.ownerPassword },
      headers: { origin: ORIGIN, host: HOST, 'content-type': 'application/json' },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).csrfToken).toBeTruthy();
  });

  it('accepts a same-site request when a proxy rewrote Host, via x-forwarded-host', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: env.ownerEmail, password: env.ownerPassword },
      headers: {
        origin: ORIGIN,
        host: 'localhost:3000',
        'x-forwarded-host': HOST,
        'content-type': 'application/json',
      },
    });
    expect(response.statusCode).toBe(200);
  });

  it('rejects a cross-site POST even when it carries cookies', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: env.ownerEmail, password: env.ownerPassword },
      headers: {
        origin: 'https://evil.example',
        host: HOST,
        cookie: 'bs_csrf=attacker-chosen-value-1234',
        'x-csrf-token': 'attacker-chosen-value-1234',
        'content-type': 'application/json',
      },
    });
    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body).error.code).toBe('csrf_failed');
  });

  it('rejects a mutation with no token, no session and no Origin (e.g. plain curl)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: env.ownerEmail, password: env.ownerPassword },
      headers: { host: HOST, 'content-type': 'application/json' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('accepts an authenticated mutation whose header matches the session-bound token, with no cookie', async () => {
    // 1. Log in like a browser that keeps cookies (capture the tokens from the body/cookies).
    const client = new TestClient(app);
    await client.bootstrap();
    const login = await client.post('/api/v1/auth/login', {
      email: env.ownerEmail,
      password: env.ownerPassword,
    });
    expect(login.status).toBe(200);
    const csrfFromLogin = login.body.csrfToken as string;
    const sessionCookie = client.cookies.bs_session!;
    expect(sessionCookie).toBeTruthy();

    // 2. Now behave like a client that lost the CSRF cookie but kept the session: header only.
    const shops = await app.inject({
      method: 'GET',
      url: '/api/v1/shops',
      headers: { host: HOST, cookie: `bs_session=${sessionCookie}` },
    });
    expect(shops.statusCode).toBe(200);
    const shopId = JSON.parse(shops.body).shops[0].id as string;

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/shops/${shopId}`,
      payload: { supportHours: 'Mon–Fri 09:00–17:00' },
      headers: {
        host: HOST,
        cookie: `bs_session=${sessionCookie}`, // deliberately no bs_csrf cookie
        'x-csrf-token': csrfFromLogin,
        'content-type': 'application/json',
      },
    });
    expect(patched.statusCode).toBe(200);
    expect(JSON.parse(patched.body).shop.supportHours).toBe('Mon–Fri 09:00–17:00');
  });

  it('still rejects a mutation whose header token matches nothing', async () => {
    const client = new TestClient(app);
    await client.bootstrap();
    await client.post('/api/v1/auth/login', { email: env.ownerEmail, password: env.ownerPassword });
    const shopId = (await client.get('/api/v1/shops')).body.shops[0].id as string;

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/shops/${shopId}`,
      payload: { supportHours: 'nope' },
      headers: {
        host: HOST,
        cookie: `bs_session=${client.cookies.bs_session}`,
        'x-csrf-token': 'not-the-right-token-at-all',
        'content-type': 'application/json',
      },
    });
    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body).error.code).toBe('csrf_failed');
  });
});
