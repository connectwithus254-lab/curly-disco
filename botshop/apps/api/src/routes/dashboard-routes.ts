/**
 * Dashboard aggregates for the seller panel.
 * Small, tenant-scoped read models — deliberately not a generic "analytics" endpoint yet (M7).
 */
import type { FastifyInstance } from 'fastify';
import { authorize, requireActor, type RequestWithActor } from '../auth.ts';
import type { RouteDeps } from './types.ts';

export async function registerDashboardRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  const { db } = deps;

  app.get('/api/v1/dashboard', async (request: RequestWithActor, reply) => {
    const actor = requireActor(request);
    authorize(actor, 'read');

    const data = await db.withTenant(
      actor.tenantId,
      async (tx) => {
        const customers = await tx.queryOne<{ count: string }>('select count(*)::text as count from customers');
        const updates24h = await tx.queryOne<{ count: string }>(
          `select count(*)::text as count from telegram_updates where received_at > now() - interval '24 hours'`,
        );
        const failedUpdates = await tx.queryOne<{ count: string }>(
          `select count(*)::text as count from telegram_updates where status = 'failed'`,
        );
        const sent = await tx.queryOne<{ count: string }>(
          `select count(*)::text as count from outbound_messages where status = 'sent' and created_at > now() - interval '24 hours'`,
        );
        const failedSends = await tx.queryOne<{ count: string }>(
          `select count(*)::text as count from outbound_messages where status = 'failed'`,
        );
        const recentUpdates = await tx.query(
          `select update_id, status, received_at from telegram_updates order by received_at desc limit 10`,
        );
        const recentAudit = await tx.query(
          `select action, entity_type, actor_type, created_at from audit_logs order by created_at desc limit 10`,
        );
        const events = await tx.query(
          `select event_type, aggregate_type, created_at from domain_events order by created_at desc limit 10`,
        );
        return {
          customers: Number(customers?.count ?? '0'),
          updates24h: Number(updates24h?.count ?? '0'),
          failedUpdates: Number(failedUpdates?.count ?? '0'),
          sent24h: Number(sent?.count ?? '0'),
          failedSends: Number(failedSends?.count ?? '0'),
          recentUpdates,
          recentAudit,
          events,
        };
      },
      { actorRole: actor.role },
    );

    return reply.send(data);
  });

  app.get('/api/v1/customers', async (request: RequestWithActor, reply) => {
    const actor = requireActor(request);
    authorize(actor, 'read');
    const customers = await db.withTenant(
      actor.tenantId,
      (tx) =>
        tx.query(
          `select id, telegram_user_id, username, first_name, locale, last_seen_at, blocked_at
             from customers order by last_seen_at desc limit 50`,
        ),
      { actorRole: actor.role },
    );
    return reply.send({ customers });
  });
}
