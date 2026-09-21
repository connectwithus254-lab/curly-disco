import type { FastifyRequest } from 'fastify';
import type { AuthService } from './auth.ts';
import { readCookie, SESSION_COOKIE, type RequestWithActor } from './auth.ts';

export type AuthServiceInstance = AuthService;

/**
 * Resolves the caller's session, supporting two transports:
 *
 *  1. `Authorization: Bearer <session token>` — used by the panel when cookies are unavailable.
 *     Browsers refuse to store cookies for a third-party context (embedded preview iframes,
 *     `SameSite` restrictions in Safari/Firefox), which would otherwise make the panel impossible
 *     to use there. Bearer tokens are never attached automatically by a browser, so they also
 *     remove the CSRF risk for those requests (see checkCsrf).
 *  2. The `bs_session` cookie — the default in a normal, same-site deployment (httpOnly, so it is
 *     not readable by scripts).
 *
 * Never throws: routes decide whether an actor is required.
 */
export async function getRequestActor(request: FastifyRequest, auth: AuthServiceInstance): Promise<void> {
  const target = request as RequestWithActor;

  const header = request.headers.authorization;
  if (typeof header === 'string' && header.length > 7) {
    const [scheme, ...rest] = header.split(' ');
    if (scheme?.toLowerCase() === 'bearer') {
      const token = rest.join(' ').trim();
      if (token.length >= 16) {
        const actor = await auth.resolve(token);
        if (actor) {
          target.actor = actor;
          target.authVia = 'bearer';
          return;
        }
        request.log?.warn({ auth: { via: 'bearer', resolved: false } }, 'bearer token rejected');
      }
    }
  }

  const cookieToken = readCookie(request, SESSION_COOKIE);
  const actor = await auth.resolve(cookieToken);
  if (actor) {
    target.actor = actor;
    target.authVia = 'cookie';
  }
}
