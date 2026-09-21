import { testEnv, TEST_APP_URL, TEST_ADMIN_URL, TEST_ENCRYPTION_KEYS } from './tests/setup/test-db.ts';
import { buildApp } from './apps/api/src/app.ts';
import { AuthService } from './apps/api/src/auth.ts';
import { loadConfig } from './apps/api/src/config.ts';
import { createRateLimiter } from './apps/api/src/rate-limit.ts';
import { TestClient } from './tests/setup/client.ts';

const env = await testEnv();
const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: TEST_APP_URL, DATABASE_ADMIN_URL: TEST_ADMIN_URL, ENCRYPTION_KEYS: TEST_ENCRYPTION_KEYS, ENCRYPTION_ACTIVE_KEY_ID: 'test', PUBLIC_BASE_URL: 'http://localhost:3000', TELEGRAM_MODE: 'fake' });
const auth = new AuthService(env.db, { sessionTtlHours: 1, secureCookies: false });
const app = await buildApp({ db: env.db, auth, config, rateLimiter: createRateLimiter(), serveStatic: false, logger: false });
await app.ready();

const raw = await app.inject({ method: 'GET', url: '/api/v1/meta' });
console.log('meta set-cookie:', JSON.stringify(raw.headers['set-cookie']));
const c = new TestClient(app);
await c.bootstrap();
console.log('client cookies after bootstrap:', JSON.stringify(c.cookies));
const login = await c.post('/api/v1/auth/login', { email: env.ownerEmail, password: env.ownerPassword });
console.log('login:', login.status, JSON.stringify(login.body).slice(0, 200), 'cookies:', JSON.stringify(login.cookies));
await app.close();
process.exit(0);
