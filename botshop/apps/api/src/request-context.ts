import type { FastifyRequest } from 'fastify';
import type { AuthService } from './auth.ts';
import { readCookie, SESSION_COOKIE } from './auth.ts';
import type { RequestWithActor } from './auth.ts';

export type AuthServiceInstance = AuthService;

/** Attaches `request.actor` when a valid session cookie is present. Never throws. */
export async function getRequestActor(request: FastifyRequest, auth: AuthServiceInstance): Promise<void> {
  const token = readCookie(request, SESSION_COOKIE);
  const actor = await auth.resolve(token);
  if (actor) {
    (request as RequestWithActor).actor = actor;
  }
}
