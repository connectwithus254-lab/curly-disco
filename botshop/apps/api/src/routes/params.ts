/**
 * Route-parameter helpers.
 *
 * Ids in our URLs are uuids. Passing a non-uuid straight to Postgres raises
 * `invalid input syntax for type uuid`, which surfaced as a 500 "Internal server error" for a
 * request as harmless as a stale link — so every route reads its ids through here and answers with
 * a clean 404 instead.
 */
import type { FastifyRequest } from 'fastify';
import { ERRORS } from '@botshop/shared';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/** Reads a uuid route parameter, or throws a 404 (never lets a malformed id reach the database). */
export function pathId(request: FastifyRequest, name: string): string {
  const value = (request.params as Record<string, unknown>)[name];
  if (!isUuid(value)) throw ERRORS.notFound('Not found — that link looks incomplete or out of date.');
  return value;
}
