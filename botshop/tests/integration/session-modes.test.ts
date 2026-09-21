/**
 * Session transports.
 *
 * Real-world driver: the panel is often opened inside an iframe from another site (embedded
 * preview) where Safari, Firefox and Chrome refuse to store cookies for the third-party origin.
 * Login returned 200 and set the cookie, the browser silently dropped it, and every following
 * request failed with "Authentication required". These tests pin both transports so that can
 * never happen again.
 */
import type { FastifyInstance } from 'fastify';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/api/src/app.ts';
import { AuthService } from '../../apps/api/src/auth.ts';
import { loadConfig } from '../../apps/api/src/config.ts';
import { createRateLimiter } from '../../apps/api/src/rate-limit.ts';
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

/** Sign in and return the session token from the response body (what the panel stores). */
async function loginForToken(email: string, password: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password },
    headers: { origin: ORIGIN, host: HOST, 'content-type': 'application/json' },
  });
  expect(response.statusCode, response.body).toBe(200);
  const body = JSON.parse(response.body);
  expect(body.sessionToken).toBeTruthy();
  return body.sessionToken as string;
}

describe('bearer-token sessions (browsers that block the cookie)', () => {
  let token: string;

  it('returns a session token on login and accepts it without any cookie', async () => {
    token = await loginForToken(env.ownerEmail, env.ownerPassword);

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { host: HOST, authorization: `Bearer ${token}` }, // deliberately no Cookie header
    });
    expect(me.statusCode, me.body).toBe(200);
    expect(JSON.parse(me.body).user.email).toBe(env.ownerEmail);
  });

  it('allows mutations with a bearer token and no CSRF headers at all', async () => {
    const shops = await app.inject({
      method: 'GET',
      url: '/api/v1/shops',
      headers: { host: HOST, authorization: `Bearer ${token}` },
    });
    const shopId = JSON.parse(shops.body).shops[0].id as string;

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/shops/${shopId}`,
      payload: { description: 'Updated from a bearer session' },
      headers: { host: HOST, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(JSON.parse(patched.body).shop.description).toBe('Updated from a bearer session');
  });

  it('rejects a forged or expired bearer token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { host: HOST, authorization: 'Bearer this-token-was-never-issued-by-us' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('logs out a bearer session server-side, so the token stops working', async () => {
    const gone = await loginForToken(env.ownerEmail, env.ownerPassword);
    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { host: HOST, origin: ORIGIN, authorization: `Bearer ${gone}` },
    });
    expect(logout.statusCode).toBe(200);

    const after = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { host: HOST, authorization: `Bearer ${gone}` },
    });
    expect(after.statusCode).toBe(401);
  });

  it('still refuses a cross-site request that tries to use a cookie session', async () => {
    // Cookie sessions must keep CSRF protection: this is the attack the guard exists for.
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: env.ownerEmail, password: env.ownerPassword },
      headers: { origin: ORIGIN, host: HOST, 'content-type': 'application/json' },
    });
    const setCookie = login.headers['set-cookie'];
    const cookies = (Array.isArray(setCookie) ? setCookie : [setCookie])
      .map((c) => String(c).split(';')[0])
      .join('; ');

    const attack = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { workspaceName: 'Attacker Co', fullName: 'Evil', email: 'evil@example.com', password: 'evil-password-1' },
      headers: {
        host: HOST,
        origin: 'https://attacker.example',
        cookie: cookies,
        'content-type': 'application/json',
      },
    });
    expect(attack.statusCode).toBe(403);
    expect(JSON.parse(attack.body).error.code).toBe('csrf_failed');
  });

  it('keeps cookie sessions working for normal same-site deployments', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: env.ownerEmail, password: env.ownerPassword },
      headers: { origin: ORIGIN, host: HOST, 'content-type': 'application/json' },
    });
    expect(response.statusCode).toBe(200);
    const setCookie = response.headers['set-cookie'];
    const entries = (Array.isArray(setCookie) ? setCookie : [setCookie]).map((c) => String(c));
    const session = entries.find((c) => c.startsWith('bs_session='));
    const csrf = entries.find((c) => c.startsWith('bs_csrf='));
    expect(session, 'the httpOnly session cookie must still be issued').toBeTruthy();
    expect(session).toContain('HttpOnly');
    expect(csrf).toBeTruthy();
    expect(csrf).not.toContain('HttpOnly'); // the panel must be able to read it for double-submit
    expect(entries.every((c) => c.includes('SameSite=Lax'))).toBe(true);
  });
});
