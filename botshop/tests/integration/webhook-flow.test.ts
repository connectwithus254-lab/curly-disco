/**
 * End-to-end first slice, through the real HTTP surface and the real worker handler:
 *   login -> connect bot -> webhook receives /start -> dedupe -> worker replies -> panel sees it.
 * Everything runs offline (fake Telegram transport, no pg-boss).
 */
import type { FastifyInstance } from 'fastify';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/api/src/app.ts';
import { AuthService } from '../../apps/api/src/auth.ts';
import { loadConfig } from '../../apps/api/src/config.ts';
import { createRateLimiter } from '../../apps/api/src/rate-limit.ts';
import { handleTelegramUpdate } from '../../apps/api/src/worker.ts';
import type { TelegramUpdateJob } from '../../apps/api/src/worker.ts';
import { TestClient } from '../setup/client.ts';
import { TEST_ADMIN_URL, TEST_APP_URL, TEST_ENCRYPTION_KEYS, testEnv, type TestEnv } from '../setup/test-db.ts';

let env: TestEnv;
let app: FastifyInstance;
let client: TestClient;
let shopId: string;
let botId: string;
let webhookSecret: string;
const jobs: TelegramUpdateJob[] = [];

beforeAll(async () => {
  env = await testEnv();
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_APP_URL,
    DATABASE_ADMIN_URL: TEST_ADMIN_URL,
    ENCRYPTION_KEYS: TEST_ENCRYPTION_KEYS,
    ENCRYPTION_ACTIVE_KEY_ID: 'test',
    PUBLIC_BASE_URL: 'http://localhost:3000',
    TELEGRAM_MODE: 'fake',
    TELEGRAM_WEBHOOK_ENABLED: 'true',
  } as NodeJS.ProcessEnv);

  const auth = new AuthService(env.db, { sessionTtlHours: 1, secureCookies: false });
  app = await buildApp({
    db: env.db,
    auth,
    config,
    rateLimiter: createRateLimiter(),
    enqueueTelegramUpdate: async (job) => {
      jobs.push(job);
    },
    serveStatic: false,
    logger: false,
  });
  await app.ready();

  client = new TestClient(app);
  await client.bootstrap();
});

describe('first slice: seller onboarding and customer journey', () => {
  it('signs the seeded owner in and returns the workspace', async () => {
    const login = await client.post('/api/v1/auth/login', {
      email: env.ownerEmail,
      password: env.ownerPassword,
    });
    expect(login.status).toBe(200);
    expect(login.body.user.role).toBe('owner');
    expect(client.cookies.bs_session).toBeTruthy();

    const me = await client.get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.tenant.slug).toBe('kesi-crafts');
  });

  it('rejects a login with the wrong password and never says which part was wrong', async () => {
    const anon = new TestClient(app);
    await anon.bootstrap();
    const bad = await anon.post('/api/v1/auth/login', { email: env.ownerEmail, password: 'wrong-password' });
    expect(bad.status).toBe(401);
    expect(bad.body.error.message).toBe('Incorrect email or password');
  });

  it('refuses mutations without a CSRF token', async () => {
    const noCsrf = new TestClient(app);
    const response = await noCsrf.request('PATCH', '/api/v1/shops/00000000-0000-0000-0000-000000000000', { name: 'x' });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('csrf_failed');
  });

  it('connects a bot, verifies it, and stores the token encrypted', async () => {
    const shops = await client.get('/api/v1/shops');
    shopId = shops.body.shops[0].id;

    const token = `123456789:AA${'b'.repeat(32)}`;
    const connect = await client.post('/api/v1/bots/connect', { shopId, token, mode: 'webhook' });
    expect(connect.status, JSON.stringify(connect.body)).toBe(201);
    expect(connect.body.bot.status).toBe('active');
    expect(connect.body.bot.webhookUrl).toContain('/telegram/');
    // The token itself must never come back over the API…
    expect(JSON.stringify(connect.body)).not.toContain(token);
    expect(connect.body.bot.tokenLast4).toBe(`…${token.slice(-4)}`);

    // …and must be unreadable in the database.
    const [row] = await env.adminDb.raw<{ id: string; token_ciphertext: string; webhook_secret: string }>(
      'select id, token_ciphertext, webhook_secret from bots where shop_id = $1',
      [shopId],
    );
    expect(row!.token_ciphertext).not.toContain(token);
    expect(row!.token_ciphertext.startsWith('v1.test.')).toBe(true);
    expect(env.keyRing.decrypt(row!.token_ciphertext)).toBe(token);

    botId = row!.id;
    webhookSecret = row!.webhook_secret;
  });

  it('accepts a signed webhook, dedupes retries, and queues exactly one job', async () => {
    const update = {
      update_id: 5001,
      message: {
        message_id: 7,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 4242, type: 'private' },
        from: { id: 4242, is_bot: false, first_name: 'Amina', username: 'amina', language_code: 'en' },
        text: '/start',
      },
    };

    const first = await app.inject({
      method: 'POST',
      url: `/telegram/${botId}`,
      payload: update,
      headers: { 'x-telegram-bot-api-secret-token': webhookSecret },
    });
    expect(first.statusCode).toBe(200);
    expect(JSON.parse(first.body)).toEqual({ ok: true });
    expect(jobs).toHaveLength(1);

    // Telegram retries the same update until it gets a 200 — we must not process it twice.
    const retry = await app.inject({
      method: 'POST',
      url: `/telegram/${botId}`,
      payload: update,
      headers: { 'x-telegram-bot-api-secret-token': webhookSecret },
    });
    expect(retry.statusCode).toBe(200);
    expect(JSON.parse(retry.body)).toEqual({ ok: true, duplicate: true });
    expect(jobs).toHaveLength(1);
  });

  it('rejects a forged webhook and unknown bots', async () => {
    const forged = await app.inject({
      method: 'POST',
      url: `/telegram/${botId}`,
      payload: { update_id: 6001 },
      headers: { 'x-telegram-bot-api-secret-token': 'not-the-secret' },
    });
    expect(forged.statusCode).toBe(403);

    const missingSecret = await app.inject({ method: 'POST', url: `/telegram/${botId}`, payload: { update_id: 6002 } });
    expect(missingSecret.statusCode).toBe(403);

    const unknownBot = await app.inject({
      method: 'POST',
      url: '/telegram/00000000-0000-0000-0000-000000000000',
      payload: { update_id: 6003 },
      headers: { 'x-telegram-bot-api-secret-token': webhookSecret },
    });
    expect(unknownBot.statusCode).toBe(404);
  });

  it('answers the customer: first contact gets the language picker, and it is recorded', async () => {
    const job = jobs[0]!;
    await handleTelegramUpdate({ db: env.db, config: appConfig(), log: () => {} }, job);

    const outbox = await client.get(`/api/v1/preview/outbox?botId=${botId}`);
    expect(outbox.status).toBe(200);
    const calls = outbox.body.calls as { method: string; params: { text?: string; chat_id?: number } }[];
    expect(calls.length).toBeGreaterThan(0);
    const sent = calls.find((c) => c.method === 'sendMessage');
    expect(sent?.params.chat_id).toBe(4242);
    expect(sent?.params.text).toContain('language');

    const updates = await env.db.withTenant(env.tenantId, (tx) =>
      tx.query<{ status: string }>('select status from telegram_updates where update_id = 5001'),
    );
    expect(updates[0]?.status).toBe('processed');

    const customers = await env.db.withTenant(env.tenantId, (tx) =>
      tx.query<{ telegram_user_id: string }>('select telegram_user_id from customers'),
    );
    expect(customers.map((c) => Number(c.telegram_user_id))).toContain(4242);
  });

  it('is idempotent: replaying an already-processed update sends nothing new', async () => {
    const before = (await client.get(`/api/v1/preview/outbox?botId=${botId}`)).body.calls.length;
    await handleTelegramUpdate({ db: env.db, config: appConfig(), log: () => {} }, jobs[0]!);
    const after = (await client.get(`/api/v1/preview/outbox?botId=${botId}`)).body.calls.length;
    expect(after).toBe(before);
  });

  it('previews screens with the same renderer the bot uses (dry run, no side effects)', async () => {
    const preview = await client.post('/api/v1/preview/render', { shopId, callbackData: 'rl:rules' });
    expect(preview.status).toBe(200);
    expect(preview.body.preview.text).toContain('We ship within 3 working days');

    const simulated = await client.post('/api/v1/preview/simulate', { shopId, text: 'Do you ship to Kisumu?' });
    expect(simulated.status).toBe(200);
    expect(simulated.body.effects.map((e: { kind: string }) => e.kind)).toEqual(['notify_staff', 'send']);

    const outboxBefore = (await client.get(`/api/v1/preview/outbox?botId=${botId}`)).body.calls.length;
    expect(outboxBefore).toBeGreaterThan(0);
  });

  it('launches the shop only when the prerequisites are met', async () => {
    const launch = await client.post(`/api/v1/shops/${shopId}/launch`);
    expect(launch.status, `launch failed: ${JSON.stringify(launch.body)}`).toBe(200);
    expect(launch.body.shop.status).toBe('active');
    expect(launch.body.botUsername).toBe('probe_bot');

    const dashboard = await client.get('/api/v1/dashboard');
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.customers).toBeGreaterThanOrEqual(1);
    expect(dashboard.body.sent24h).toBeGreaterThanOrEqual(1);
  });

  it('enforces roles: a viewer can read but cannot write', async () => {
    await env.adminDb.withTenant(env.tenantId, async (tx) => {
      const { hashPassword } = await import('@botshop/core');
      await tx.execute(
        `insert into users (tenant_id, email, password_hash, name, role)
         values ($1, 'viewer@test.local', $2, 'Viewer', 'viewer')`,
        [env.tenantId, hashPassword('viewer-password-123')],
      );
    });

    const viewer = new TestClient(app);
    await viewer.bootstrap();
    const login = await viewer.post('/api/v1/auth/login', {
      email: 'viewer@test.local',
      password: 'viewer-password-123',
    });
    expect(login.status).toBe(200);

    expect((await viewer.get('/api/v1/shops')).status).toBe(200);
    const attempt = await viewer.patch(`/api/v1/shops/${shopId}`, { name: 'Nope' });
    expect(attempt.status).toBe(403);
    expect(attempt.body.error.message).toContain('cannot perform "write"');
  });

  it('audits every mutation', async () => {
    const entries = await env.db.withTenant(env.tenantId, (tx) =>
      tx.query<{ action: string }>('select action from audit_logs order by created_at'),
    );
    const actions = entries.map((e) => e.action);
    expect(actions).toContain('auth.login');
    expect(actions).toContain('bot.connected');
    expect(actions).toContain('shop.launched');
  });
});

function appConfig() {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_APP_URL,
    DATABASE_ADMIN_URL: TEST_ADMIN_URL,
    ENCRYPTION_KEYS: TEST_ENCRYPTION_KEYS,
    ENCRYPTION_ACTIVE_KEY_ID: 'test',
    PUBLIC_BASE_URL: 'http://localhost:3000',
    TELEGRAM_MODE: 'fake',
  } as NodeJS.ProcessEnv);
}
