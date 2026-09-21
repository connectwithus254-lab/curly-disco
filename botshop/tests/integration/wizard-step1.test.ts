/**
 * Wizard step 1 regression suite.
 *
 * Real bug this pins down: the panel submits an empty text box as `null` (and drops `undefined`),
 * but the schema only accepted strings — so leaving the contact email or phone blank made step 1
 * impossible to save. The seller saw a short toast, the shop was never created, and every later
 * action answered "No shop yet". Both spellings of "empty" must now work, and the error messages
 * must tell the person what to type.
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
    rateLimiter: createRateLimiter({ disabled: true }),
    serveStatic: false,
    logger: false,
  });
  await app.ready();
});

/** Creates a fresh workspace and returns an authenticated client for it. */
async function newWorkspace(suffix: string): Promise<TestClient> {
  const client = new TestClient(app);
  await client.bootstrap();
  const signup = await client.post('/api/v1/auth/signup', {
    workspaceName: `Wizard Test ${suffix}`,
    fullName: 'Wizard Tester',
    email: `wizard-${suffix}@test.local`,
    password: 'wizard-password-123',
  });
  expect(signup.status, JSON.stringify(signup.body)).toBe(201);
  return client;
}

describe('wizard step 1', () => {
  it('saves with only a business name (every optional field omitted)', async () => {
    const client = await newWorkspace('minimal');
    const created = await client.post('/api/v1/shops', { name: 'Minimal Shop' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const patched = await client.patch(`/api/v1/shops/${created.body.shop.id}`, {
      name: 'Minimal Shop',
      onboardingStep: 2,
    });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect(patched.body.shop.onboardingStep).toBe(2);
  });

  it('saves when the form sends null for empty email, phone, country, currency and timezone', async () => {
    const client = await newWorkspace('nulls');
    const created = await client.post('/api/v1/shops', { name: 'Null Shop' });
    expect(created.status).toBe(201);

    // Exactly what the panel used to submit.
    const patched = await client.patch(`/api/v1/shops/${created.body.shop.id}`, {
      name: 'Null Shop',
      description: null,
      category: null,
      country: null,
      currency: null,
      timezone: null,
      contactEmail: null,
      contactPhone: null,
      onboardingStep: 2,
    });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect(patched.body.shop.contactEmail).toBeNull();
    // The shop keeps the defaults it was created with rather than losing them.
    expect(patched.body.shop.currency).toBe('USD');
  });

  it('normalises country and currency to upper case instead of rejecting lower case', async () => {
    const client = await newWorkspace('codes');
    const created = await client.post('/api/v1/shops', { name: 'Codes Shop', country: 'ke', currency: 'kes' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.shop.country).toBe('KE');
    expect(created.body.shop.currency).toBe('KES');

    const patched = await client.patch(`/api/v1/shops/${created.body.shop.id}`, { country: 'ng', currency: 'ngn' });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect(patched.body.shop.country).toBe('NG');
    expect(patched.body.shop.currency).toBe('NGN');
  });

  it('explains invalid codes clearly enough to act on', async () => {
    const client = await newWorkspace('badcodes');
    const created = await client.post('/api/v1/shops', { name: 'Bad Codes Shop' });
    const shopId = created.body.shop.id as string;

    const badCountry = await client.patch(`/api/v1/shops/${shopId}`, { country: 'Kenya' });
    expect(badCountry.status).toBe(400);
    expect(JSON.stringify(badCountry.body.error.details.issues)).toContain('2-letter country code');

    const badCurrency = await client.patch(`/api/v1/shops/${shopId}`, { currency: 'shillings' });
    expect(badCurrency.status).toBe(400);
    expect(JSON.stringify(badCurrency.body.error.details.issues)).toContain('3-letter currency code');

    const badEmail = await client.patch(`/api/v1/shops/${shopId}`, { contactEmail: 'not-an-email' });
    expect(badEmail.status).toBe(400);
    expect(JSON.stringify(badEmail.body.error.details.issues)).toContain('valid email address');

    // Every issue names the offending field, so the panel can highlight it.
    const issues = badCountry.body.error.details.issues as { path: string }[];
    expect(issues.some((i) => i.path === 'country')).toBe(true);
  });

  it('survives clearing a previously saved value (empty submit must not resurrect or crash)', async () => {
    const client = await newWorkspace('clear');
    const created = await client.post('/api/v1/shops', { name: 'Clear Shop', contactEmail: 'keep@test.local' });
    const shopId = created.body.shop.id as string;

    const cleared = await client.patch(`/api/v1/shops/${shopId}`, { contactEmail: null });
    expect(cleared.status, JSON.stringify(cleared.body)).toBe(200);
    expect(cleared.body.shop.contactEmail).toBeNull();
  });

  it('still refuses a second shop in the same workspace, naming the reason', async () => {
    const client = await newWorkspace('second');
    await client.post('/api/v1/shops', { name: 'First Shop' });
    const second = await client.post('/api/v1/shops', { name: 'Second Shop' });
    expect(second.status).toBe(409);
    expect(second.body.error.message).toContain('already has a shop');
  });

  it('treats a name made only of spaces as missing, not as a valid name', async () => {
    const client = await newWorkspace('spacename');
    const spaces = await client.post('/api/v1/shops', { name: '   ' });
    expect(spaces.status).toBe(400);
    expect(JSON.stringify(spaces.body.error.details.issues)).toContain('at least 2 characters');
  });

  it('trims stray spaces around values instead of storing them', async () => {
    const client = await newWorkspace('trim');
    const created = await client.post('/api/v1/shops', {
      name: '  Trimmed Shop  ',
      country: ' ke ',
      currency: ' kes ',
      contactEmail: ' owner@test.local ',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.shop.name).toBe('Trimmed Shop');
    expect(created.body.shop.country).toBe('KE');
    expect(created.body.shop.currency).toBe('KES');
    expect(created.body.shop.contactEmail).toBe('owner@test.local');
  });

  it('treats a spaces-only email as an empty field rather than an invalid address', async () => {
    const client = await newWorkspace('spaceemail');
    const created = await client.post('/api/v1/shops', { name: 'Blank Email Shop', contactEmail: '   ' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.shop.contactEmail).toBeNull();
  });

  it('requires a real business name', async () => {
    const client = await newWorkspace('noname');
    const empty = await client.post('/api/v1/shops', { name: '' });
    expect(empty.status).toBe(400);

    const oneChar = await client.post('/api/v1/shops', { name: 'A' });
    expect(oneChar.status).toBe(400);
    expect(JSON.stringify(oneChar.body.error.details.issues)).toContain('at least 2 characters');
  });
});
