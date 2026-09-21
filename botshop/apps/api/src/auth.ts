/**
 * Authentication + authorization.
 *
 *  - Sessions: opaque random token, stored only as a SHA-256 hash, sent in an httpOnly cookie.
 *  - CSRF: double-submit cookie (`bs_csrf` readable by our own JS) + mandatory header on
 *    mutations + Origin check. See docs/06-threat-model.md T8.
 *  - Authorization: a single `authorize()` gate on top of the role matrix in @botshop/shared.
 */
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ERRORS, can, type TenantAction, type TenantRole } from '@botshop/shared';
import { createDb, type Db } from '@botshop/db';
import { hashPassword, verifyPassword } from '@botshop/core';
import * as repo from '@botshop/db/repos';

export const SESSION_COOKIE = 'bs_session';
export const CSRF_COOKIE = 'bs_csrf';
export const CSRF_HEADER = 'x-csrf-token';
export const TENANT_HEADER = 'x-tenant-id';

export interface SessionActor {
  sessionId: string;
  userId: string;
  tenantId: string;
  role: TenantRole;
  email: string;
  actorType: 'user' | 'platform_admin';
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

export class AuthService {
  constructor(
    private readonly db: Db,
    private readonly config: { sessionTtlHours: number; secureCookies: boolean },
  ) {}

  static fromEnv(env: NodeJS.ProcessEnv = process.env) {
    const db = createDb({
      connectionString: env.DATABASE_URL ?? 'postgres://botshop_app:botshop_app@127.0.0.1:54329/botshop',
      applicationName: 'botshop-api',
    });
    return {
      db,
      auth: new AuthService(db, {
        sessionTtlHours: Number(env.SESSION_TTL_HOURS ?? 24 * 14),
        secureCookies: (env.PUBLIC_BASE_URL ?? '').startsWith('https://'),
      }),
    };
  }

  /** Returns the user's tenant candidates. Multiple tenants may share an email across workspaces. */
  async candidates(email: string) {
    return this.db.raw<{
      user_id: string;
      tenant_id: string;
      tenant_slug: string;
      password_hash: string;
      role: TenantRole;
      user_status: string;
      tenant_status: string;
    }>('select * from app.lookup_login_candidates($1)', [email]);
  }

  async createSession(params: {
    tenantId: string;
    userId: string;
    ip?: string;
    userAgent?: string;
  }): Promise<{ token: string; csrfToken: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(16).toString('base64url');
    const expiresAt = new Date(Date.now() + this.config.sessionTtlHours * 3600 * 1000);
    await this.db.withTenant(params.tenantId, async (tx) => {
      await tx.execute(
        `insert into sessions (tenant_id, user_id, token_hash, expires_at, ip, user_agent)
         values ($1,$2,$3,$4,$5,$6)`,
        [params.tenantId, params.userId, sha256(token), expiresAt, params.ip ?? null, params.userAgent ?? null],
      );
      await tx.execute('update users set last_login_at = now(), failed_logins = 0 where id = $1', [params.userId]);
      await repo.writeAudit(tx, {
        tenantId: params.tenantId,
        actorType: 'user',
        actorId: params.userId,
        action: 'auth.login',
        entityType: 'session',
        ip: params.ip ?? null,
        userAgent: params.userAgent ?? null,
      });
    });
    return { token, csrfToken, expiresAt };
  }

  async resolve(token: string | undefined): Promise<SessionActor | null> {
    if (!token) return null;
    const rows = await this.db.raw<{
      session_id: string;
      user_id: string;
      tenant_id: string;
      role: TenantRole;
      email: string;
      tenant_status: string;
      user_status: string;
    }>('select * from app.authenticate_session($1)', [sha256(token)]);
    const row = rows[0];
    if (!row) return null;
    if (row.user_status !== 'active' || row.tenant_status === 'closed') return null;
    return {
      sessionId: row.session_id,
      userId: row.user_id,
      tenantId: row.tenant_id,
      role: row.role,
      email: row.email,
      actorType: 'user',
    };
  }

  async destroy(token: string | undefined): Promise<void> {
    if (!token) return;
    await this.db.raw('delete from sessions where token_hash = $1', [sha256(token)]);
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return verifyPassword(password, hash);
  }

  hashPassword(password: string): string {
    return hashPassword(password);
  }

  setCookies(reply: FastifyReply, session: { token: string; csrfToken: string; expiresAt: Date }): void {
    const common = {
      path: '/',
      sameSite: 'lax' as const,
      secure: this.config.secureCookies,
      expires: session.expiresAt,
    };
    reply.setCookie(SESSION_COOKIE, session.token, { ...common, httpOnly: true });
    // Readable by our own front-end so it can echo it back in the CSRF header.
    reply.setCookie(CSRF_COOKIE, session.csrfToken, { ...common, httpOnly: false });
  }

  clearCookies(reply: FastifyReply): void {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    reply.clearCookie(CSRF_COOKIE, { path: '/' });
  }
}

/* ------------------------------------------------------------- fastify glue */

export interface RequestWithActor extends FastifyRequest {
  actor?: SessionActor;
}

export function readCookie(request: FastifyRequest, name: string): string | undefined {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

function safeEqualString(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Verifies the double-submit CSRF token and (when present) the Origin header. */
export function checkCsrf(request: FastifyRequest): void {
  const method = request.method.toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return;

  const cookieToken = readCookie(request, CSRF_COOKIE);
  const headerToken = request.headers[CSRF_HEADER];
  if (!cookieToken || typeof headerToken !== 'string' || !safeEqualString(cookieToken, headerToken)) {
    throw ERRORS.forbidden('CSRF check failed');
  }

  const origin = request.headers.origin;
  if (origin) {
    const host = request.headers.host;
    const allowed = new Set<string>();
    if (host) allowed.add(`http://${host}`);
    if (host) allowed.add(`https://${host}`);
    const publicBase = process.env.PUBLIC_BASE_URL?.replace(/\/$/, '');
    if (publicBase) allowed.add(publicBase);
    if (!allowed.has(origin.replace(/\/$/, ''))) {
      throw ERRORS.forbidden('Origin not allowed');
    }
  }
}

export function requireActor(request: RequestWithActor): SessionActor {
  if (!request.actor) throw ERRORS.unauthorized();
  return request.actor;
}

export function authorize(actor: SessionActor, action: TenantAction): void {
  if (!can(actor.role, action)) {
    throw ERRORS.forbidden(`role "${actor.role}" cannot perform "${action}"`);
  }
}
