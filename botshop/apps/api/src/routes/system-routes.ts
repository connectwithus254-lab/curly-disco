import type { FastifyInstance } from 'fastify';
import type { RouteDeps } from './types.ts';

export async function registerSystemRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  const { db, config } = deps;

  /** Liveness + readiness in one cheap endpoint (used by Docker/compose healthchecks). */
  app.get('/healthz', async (_request, reply) => {
    try {
      await db.raw('select 1');
      return reply.send({ ok: true, db: 'up', env: config.env, telegram: config.telegram.mode });
    } catch (error) {
      return reply.code(503).send({ ok: false, db: 'down', error: (error as Error).message });
    }
  });

  app.get('/api/v1/meta', async (_request, reply) => {
    return reply.send({
      name: 'botshop',
      version: '0.1.0',
      milestone: 'M1 (shop + bot onboarding)',
      env: config.env,
      telegramMode: config.telegram.mode,
      publicBaseUrl: config.publicBaseUrl,
      locales: ['en', 'sw', 'ru'],
    });
  });
}
