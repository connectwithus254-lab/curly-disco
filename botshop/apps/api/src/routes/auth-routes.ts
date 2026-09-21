/**
 * Auth + workspace routes: signup, login, logout, session introspection.
 * Every mutation is audited; every error answer is deliberately vague (no user enumeration).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ERRORS, slugify, type TenantRole } from '@botshop/shared';
import * as repo from '@botshop/db/repos';
import {
  AuthService,
  checkCsrf,
  CSRF_COOKIE,
  SESSION_COOKIE,
  readCookie,
  requireActor,
  type RequestWithActor,
} from '../auth.ts';
import type { RouteDeps } from './types.ts';

const signupSchema = z.object({
  workspaceName: z.string().min(2).max(80),
  fullName: z.string().min(2).max(80),
  email: z.string().email().max(160),
  password: z.string().min(10).max(200),
});

const loginSchema = z.object({
  email: z.string().email().max(160),
  password: z.string().min(1).max(200),
  workspace: z.string().max(80).optional(),
});

/**
 * The CSRF cookie is never rotated during login/signup: the token the browser already holds is
 * bound to the new session and returned in the response body, so a panel that cached it keeps
 * working and a client that lost the cookie can still send the token it was given.
 */
function existingCsrf(request: Parameters<typeof readCookie>[0]): string | undefined {
  const token = readCookie(request, CSRF_COOKIE);
  return token && token.length >= 16 ? token : undefined;
}

export async function registerAuthRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  const { db, auth, rateLimiter } = deps;

  app.post('/api/v1/auth/signup', async (request: RequestWithActor, reply) => {
    checkCsrf(request, request.actor ?? null);
    rateLimiter.check(request.ip, 'signup', 5, 60_000);
    const body = signupSchema.parse(request.body ?? {});

    const slugBase = slugify(body.workspaceName);
    const tenant = await db.withPlatform(async (tx) => {
      const existing = await repo.findTenantBySlug(tx, slugBase);
      const slug = existing ? `${slugBase}-${Math.random().toString(36).slice(2, 6)}` : slugBase;
      const created = await repo.createTenant(tx, body.workspaceName, slug);
      await repo.createUser(tx, {
        tenantId: created.id,
        email: body.email,
        passwordHash: auth.hashPassword(body.password),
        name: body.fullName,
        role: 'owner' as TenantRole,
      });
      return created;
    });

    const session = await db.withTenant(tenant.id, async (tx) => {
      const user = await tx.queryOne<{ id: string }>('select id from users where lower(email) = lower($1)', [body.email]);
      await repo.writeAudit(tx, {
        tenantId: tenant.id,
        actorType: 'user',
        actorId: user?.id ?? null,
        action: 'workspace.created',
        entityType: 'tenant',
        entityId: tenant.id,
        after: { name: tenant.name, slug: tenant.slug },
        ip: request.ip,
      });
      return { userId: user?.id };
    });

    const created = await auth.createSession({
      tenantId: tenant.id,
      userId: session.userId!,
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? undefined,
      csrfToken: existingCsrf(request),
    });
    auth.setCookies(reply, created);
    return reply.code(201).send({
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
      csrfToken: created.csrfToken,
    });
  });

  app.post('/api/v1/auth/login', async (request: RequestWithActor, reply) => {
    checkCsrf(request, request.actor ?? null);
    rateLimiter.check(request.ip, 'login', 10, 60_000);
    const body = loginSchema.parse(request.body ?? {});

    const candidates = await auth.candidates(body.email);
    const filtered = body.workspace
      ? candidates.filter((c) => c.tenant_slug.toLowerCase() === body.workspace!.toLowerCase())
      : candidates;

    if (filtered.length === 0) throw ERRORS.unauthorized('Incorrect email or password');

    let matched: (typeof filtered)[number] | null = null;
    for (const candidate of filtered) {
      if (await auth.verifyPassword(body.password, candidate.password_hash)) {
        matched = candidate;
        break;
      }
    }
    if (!matched) throw ERRORS.unauthorized('Incorrect email or password');
    if (matched.user_status !== 'active') throw ERRORS.forbidden('This user is disabled');
    if (matched.tenant_status !== 'active') throw ERRORS.forbidden('This workspace is not active');

    const session = await auth.createSession({
      tenantId: matched.tenant_id,
      userId: matched.user_id,
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? undefined,
      csrfToken: existingCsrf(request),
    });
    auth.setCookies(reply, session);
    return reply.send({
      user: { id: matched.user_id, email: body.email, role: matched.role, tenantId: matched.tenant_id },
      csrfToken: session.csrfToken,
    });
  });

  app.post('/api/v1/auth/logout', async (request: RequestWithActor, reply) => {
    checkCsrf(request, request.actor ?? null);
    await auth.destroy(readCookie(request, SESSION_COOKIE));
    auth.clearCookies(reply);
    return reply.send({ ok: true });
  });

  app.get('/api/v1/auth/me', async (request: RequestWithActor, reply) => {
    const actor = requireActor(request);
    const data = await db.withTenant(actor.tenantId, async (tx) => {
      const user = await tx.queryOne<{ id: string; email: string; name: string; role: string }>(
        'select id, email, name, role from users where id = $1',
        [actor.userId],
      );
      const tenant = await tx.queryOne<{ id: string; name: string; slug: string }>(
        'select id, name, slug from tenants where id = $1',
        [actor.tenantId],
      );
      return { user, tenant };
    });
    return reply.send({ user: data.user, tenant: data.tenant, role: actor.role });
  });
}
