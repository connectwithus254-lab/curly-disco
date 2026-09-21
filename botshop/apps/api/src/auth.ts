/**
 * Authentication + authorization.
 *
 *  - Sessions: opaque random token, stored only as a SHA-256 hash, sent in an httpOnly cookie.
 *  - CSRF: the token is bound to the session (stored as a hash server-side) AND mirrored in a
 *    readable cookie. A mutation passes when the double-submit pair matches, when the header
 *    matches the session's token, or when the request is provably same-site (Origin host equals
 *    the host we were reached on). See docs/06-threat-model.md T8 and migration 0003 for why the
 *    cookie alone is not enough in embedded/proxied deployments.
 *  - Authorization: a single `authorize()` gate on top of the role matrix in @botshop/shared.
 */
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiProblem, ERRORS, can, type TenantAction, type TenantRole } from '@botshop/shared';
import { createDb, type Db } from '@botshop/db';
import { hashPassword, verifyPassword } from '@botshop/core';
import * as repo from '@botshop/db/repos';

export const SESSION_COOKIE = 'bs_session';
export const CSRF_COOKIE = 'bs_csrf';
export const CSRF_HEADER = 'x-csrf-token';
export const TENANT_HEADER = 'x-tenant-id';

/** Minimum length for a token we accept in the header (the cookie value is 22 chars). */
const MIN_CSRF_TOKEN_LENGTH = 16;

export interface SessionActor {
  sessionId: string;
  userId: string;
  tenantId: string;
  role: TenantRole;
  email: string;
  actorType: 'user' | 'platform_admin';
  /** sha256 of the CSRF token issued with this session; empty for sessions created before 0003. */
  csrfHash: string;
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
    /**
     * Reuse the CSRF token the browser already holds (if any) so the cookie is never rotated
     * mid-session; whatever token we hand back is the one whose hash is bound to the session.
     */
    csrfToken?: string | undefined;
  }): Promise<{ token: string; csrfToken: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('base64url');
    const csrfToken =
      params.csrfToken && params.csrfToken.length >= MIN_CSRF_TOKEN_LENGTH
        ? params.csrfToken
        : randomBytes(16).toString('base64url');
    const expiresAt = new Date(Date.now() + this.config.sessionTtlHours * 3600 * 1000);
    await this.db.withTenant(params.tenantId, async (tx) => {
      await tx.execute(
        `insert into sessions (tenant_id, user_id, token_hash, csrf_token_hash, expires_at, ip, user_agent)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [
          params.tenantId,
          params.userId,
          sha256(token),
          sha256(csrfToken),
          expiresAt,
          params.ip ?? null,
          params.userAgent ?? null,
        ],
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
      csrf_token_hash: string | null;
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
      csrfHash: row.csrf_token_hash ?? '',
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

export function safeEqualString(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function headerHost(request: FastifyRequest): string | null {
  const forwarded = request.headers['x-forwarded-host'];
  if (typeof forwarded === 'string' && forwarded.length > 0) return forwarded.split(',')[0]!.trim();
  if (Array.isArray(forwarded) && forwarded.length > 0) return forwarded[0]!;
  const host = request.headers.host;
  return typeof host === 'string' ? host : null;
}

function publicBaseHost(): string | null {
  const base = process.env.PUBLIC_BASE_URL;
  if (!base) return null;
  try {
    return new URL(base).host;
  } catch {
    return null;
  }
}

/**
 * CSRF guard for state-changing requests.
 *
 * Accepts a request when ANY of these holds:
 *   1. double-submit: the `bs_csrf` cookie equals the `X-CSRF-Token` header;
 *   2. session-bound: the header token hashes to the token issued with the authenticated session
 *      (survives cookie loss, and cannot be produced by an attacker who cannot read our pages);
 *   3. same-site: the browser-supplied Origin host equals the host we were reached on
 *      (an attacker's page carries its own Origin; `Origin: null` never matches).
 *
 * Everything else is rejected — including cross-site form posts, which can do none of the above.
 */
export function checkCsrf(request: FastifyRequest, actor?: SessionActor | null): void {
  const method = request.method.toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return;

  const cookieToken = readCookie(request, CSRF_COOKIE);
  const rawHeader = request.headers[CSRF_HEADER];
  const headerToken = typeof rawHeader === 'string' ? rawHeader : null;
  const origin = typeof request.headers.origin === 'string' ? request.headers.origin : null;
  const host = headerHost(request);

  const sameSite = ((): boolean => {
    if (!origin) return false;
    if (origin === 'null') return false;
    const allowed = new Set([host, publicBaseHost()].filter((h): h is string => Boolean(h)));
    try {
      return allowed.has(new URL(origin).host);
    } catch {
      return false;
    }
  })();

  if (headerToken && headerToken.length >= MIN_CSRF_TOKEN_LENGTH) {
    // Session-bound token: an attacker can never obtain one (it is only ever sent to our origin),
    // so this path does not need the Origin check.
    if (actor?.csrfHash && safeEqualString(sha256(headerToken), actor.csrfHash)) return;
    // Double-submit: the cookie alone proves nothing if an attacker could plant both values, so
    // require the request to also be same-site (or to carry no Origin at all, e.g. a CLI client).
    if (cookieToken && safeEqualString(cookieToken, headerToken) && (sameSite || !origin)) return;
  }

  // Same-site browser request (the normal panel case, including when cookies were dropped).
  if (sameSite) return;

  const diagnostics = {
    cookiePresent: Boolean(cookieToken),
    headerPresent: Boolean(headerToken),
    sessionPresent: Boolean(actor),
    origin,
    host,
  };
  request.log?.warn({ csrf: diagnostics }, 'CSRF check failed');
  throw new ApiProblem(
    'csrf_failed',
    'Security check failed. Reload the page and try again.',
    403,
    diagnostics,
  );
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
