/**
 * Fastify application assembly.
 * Order matters: security headers -> cookies -> actor resolution -> routes -> static assets.
 */
import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { ERRORS, type ApiError } from '@botshop/shared';
import { randomBytes } from 'node:crypto';
import { checkCsrf, CSRF_COOKIE, readCookie, type RequestWithActor } from './auth.ts';
import { getRequestActor, type AuthServiceInstance } from './request-context.ts';
import { registerAuthRoutes } from './routes/auth-routes.ts';
import { registerBotRoutes } from './routes/bot-routes.ts';
import { registerDashboardRoutes } from './routes/dashboard-routes.ts';
import { registerPreviewRoutes } from './routes/preview-routes.ts';
import { registerShopRoutes } from './routes/shop-routes.ts';
import { registerSystemRoutes } from './routes/system-routes.ts';
import { registerTelegramRoutes } from './routes/telegram-routes.ts';
import { registerStaticRoutes, CSP } from './static.ts';
import type { RouteDeps } from './routes/types.ts';

export interface BuildAppOptions extends RouteDeps {
  /** Set to false in unit tests that do not need the SPA shell. */
  serveStatic?: boolean;
  logger?: boolean;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    trustProxy: true,
    bodyLimit: options.config.limits.jsonBodyLimitBytes,
    logger:
      options.logger === false
        ? false
        : {
            level: process.env.LOG_LEVEL ?? 'info',
            redact: {
              paths: [
                'req.headers.cookie',
                'req.headers.authorization',
                'req.headers["x-telegram-bot-api-secret-token"]',
                'req.headers["x-csrf-token"]',
              ],
              censor: '[redacted]',
            },
          },
    // Deprecated in Fastify 5 but still supported; replaced by logController in Fastify 6.
    disableRequestLogging: options.config.env === 'test',
  });

  await app.register(cookie);

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('content-security-policy', CSP);
    reply.header('referrer-policy', 'same-origin');
    if (options.config.cookieSecure) {
      reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
    }
    return payload;
  });

  app.setErrorHandler((error, request, reply) => {
    const apiError = toApiError(error);
    if (apiError.status >= 500) {
      request.log.error({ err: error, requestId: request.id }, 'request failed');
    }
    return reply.code(apiError.status).send({
      ok: false,
      error: { code: apiError.code, message: apiError.message, ...(apiError.details ? { details: apiError.details } : {}) },
      requestId: request.id,
    });
  });

  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({ ok: false, error: { code: 'not_found', message: `no route for ${request.method} ${request.url}` } }),
  );

  // Issue a CSRF cookie to every client, so double-submit works from the very first mutation
  // (login and signup included) without weakening the check itself.
  app.addHook('onRequest', async (request, reply) => {
    if (readCookie(request, CSRF_COOKIE)) return;
    reply.setCookie(CSRF_COOKIE, randomBytes(16).toString('base64url'), {
      path: '/',
      sameSite: 'lax',
      secure: options.config.cookieSecure,
      httpOnly: false,
    });
  });

  // Resolve the session actor once per request; routes decide whether it is required.
  app.addHook('onRequest', async (request) => {
    const url = request.url;
    if (url.startsWith('/telegram/') || url === '/healthz') return;
    if (!url.startsWith('/api/')) return;
    const auth = options.auth as AuthServiceInstance;
    await getRequestActor(request, auth);
  });

  // Global CSRF guard for every state-changing API call. Telegram webhooks are excluded because
  // they are authenticated by the per-bot secret header instead (docs/06-threat-model.md T3/T8).
  app.addHook('preHandler', async (request) => {
    if (!request.url.startsWith('/api/')) return;
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())) return;
    const scoped = request as RequestWithActor;
    checkCsrf(request, scoped.actor ?? null, scoped.authVia);
  });

  await registerSystemRoutes(app, options);
  await registerAuthRoutes(app, options);
  await registerShopRoutes(app, options);
  await registerDashboardRoutes(app, options);
  await registerBotRoutes(app, options);
  await registerTelegramRoutes(app, options);
  await registerPreviewRoutes(app, options);
  if (options.serveStatic !== false) {
    await registerStaticRoutes(app);
  }

  return app;
}

function toApiError(error: unknown): ApiError {
  if (error instanceof ZodError) {
    return ERRORS.validation('Invalid request', {
      issues: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    });
  }
  if (error instanceof Error && 'status' in error && typeof (error as { status: unknown }).status === 'number') {
    const candidate = error as Error & Partial<ApiError>;
    return {
      code: candidate.code ?? 'error',
      message: candidate.message,
      status: candidate.status ?? 500,
      ...(candidate.details ? { details: candidate.details } : {}),
    };
  }
  const fastifyError = error as { statusCode?: number; message?: string; code?: string };
  if (fastifyError.statusCode && fastifyError.statusCode < 500) {
    return { code: fastifyError.code ?? 'bad_request', message: fastifyError.message ?? 'Bad request', status: fastifyError.statusCode };
  }
  return ERRORS.internal('Internal server error');
}
