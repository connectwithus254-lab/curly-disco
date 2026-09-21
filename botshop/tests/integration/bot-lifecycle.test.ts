/**
 * Bot lifecycle through the real HTTP surface: connect → disconnect → connect a different bot.
 *
 * This is the flow a seller uses when they typo a token, rotate it in @BotFather, or move from a
 * test bot to the real one — and the flow that produced a confusing "already has a bot connected"
 * dead end before disconnecting was possible from the panel.
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
let client: TestClient;
let shopId: string;

const TOKEN_A = `111111111:AA${'a'.repeat(32)}`;
const TOKEN_B = `222222222:BB${'b'.repeat(32)}`;

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

  client = new TestClient(app);
  await client.bootstrap();
  await client.post('/api/v1/auth/login', { email: env.ownerEmail, password: env.ownerPassword });
  shopId = (await client.get('/api/v1/shops')).body.shops[0].id;
});

describe('bot lifecycle', () => {
  let firstBotId: string;

  it('connects a bot and rejects a second one for the same shop with a clear message', async () => {
    const created = await client.post('/api/v1/bots/connect', { shopId, token: TOKEN_A, mode: 'webhook' });
    expect(created.status).toBe(201);
    firstBotId = created.body.bot.id;

    const second = await client.post('/api/v1/bots/connect', { shopId, token: TOKEN_B, mode: 'webhook' });
    expect(second.status).toBe(409);
    expect(second.body.error.message).toContain('already has a bot connected');
  });

  it('rejects a token that does not look like a Telegram token', async () => {
    const response = await client.post('/api/v1/bots/connect', { shopId, token: 'this is not a telegram bot token', mode: 'webhook' });
    expect(response.status).toBe(400);
    expect(response.body.error.message).toContain('Telegram bot token');
  });

  it('disconnects the bot and reports it as revoked', async () => {
    const response = await client.del(`/api/v1/bots/${firstBotId}`);
    expect(response.status).toBe(200);

    const bots = (await client.get('/api/v1/bots')).body.bots as { id: string; status: string }[];
    expect(bots.find((b) => b.id === firstBotId)?.status).toBe('revoked');
    // The webhook URL is cleared so Telegram cannot keep delivering to a dead routing entry.
    const [row] = await env.adminDb.raw<{ webhook_url: string | null }>('select webhook_url from bots where id = $1', [
      firstBotId,
    ]);
    expect(row?.webhook_url).toBeNull();
  });

  it('lets the seller connect a different bot afterwards (the token-typo recovery path)', async () => {
    const created = await client.post('/api/v1/bots/connect', { shopId, token: TOKEN_B, mode: 'webhook' });
    expect(created.status).toBe(201);
    expect(created.body.bot.status).toBe('active');
    expect(created.body.bot.tokenLast4).toBe(`…${TOKEN_B.slice(-4)}`);

    const [row] = await env.adminDb.raw<{ token_ciphertext: string }>(
      'select token_ciphertext from bots where id = $1',
      [created.body.bot.id],
    );
    expect(env.keyRing.decrypt(row!.token_ciphertext)).toBe(TOKEN_B);
  });

  it('answers a malformed id with 404 instead of crashing on the database', async () => {
    // A stale bookmark or a copy-pasted URL used to reach Postgres as a non-uuid and surface as
    // "Internal server error" (500). A link problem must never look like a platform failure.
    const check = await client.post('/api/v1/bots/undefined/check', {});
    expect(check.status).toBe(404);

    const remove = await client.del('/api/v1/bots/not-a-uuid');
    expect(remove.status).toBe(404);

    const shop = await client.patch('/api/v1/shops/undefined', { name: 'Anything' });
    expect(shop.status).toBe(404);
    expect(shop.body.error.code).toBe('not_found');
  });

  it('audits connect and disconnect', async () => {
    const actions = (await env.adminDb.raw<{ action: string }>(
      "select action from audit_logs where action like 'bot.%' order by created_at",
    )).map((r) => r.action);
    expect(actions).toContain('bot.connected');
    expect(actions).toContain('bot.disconnected');
  });
});
