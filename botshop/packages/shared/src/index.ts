/**
 * Shared primitives used across apps and packages.
 * Keep this package dependency-free (zod only) so it can be imported anywhere.
 */

export type Uuid = string;

export type ActorType = 'user' | 'platform_admin' | 'api_key' | 'system' | 'customer';

export const TENANT_ROLES = ['owner', 'admin', 'staff', 'viewer'] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];

export const PLATFORM_ROLES = ['admin', 'finance', 'support'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

/** Highest privilege first; index = rank. */
export const ROLE_RANK: Record<TenantRole, number> = {
  owner: 3,
  admin: 2,
  staff: 1,
  viewer: 0,
};

export const TENANT_ROLE_ACTIONS = ['read', 'write', 'billing', 'manage_users', 'delete_shop'] as const;
export type TenantAction = (typeof TENANT_ROLE_ACTIONS)[number];
export type Action = TenantAction | '*';

const ROLE_ACTION_MATRIX: Record<TenantRole, readonly Action[]> = {
  owner: ['read', 'write', 'billing', 'manage_users', 'delete_shop', '*'],
  admin: ['read', 'write', 'billing', 'manage_users'],
  staff: ['read', 'write'],
  viewer: ['read'],
};

/** Single authorization gate. Every route/worker mutation goes through this. */
export function can(role: TenantRole, action: Action): boolean {
  return ROLE_ACTION_MATRIX[role].includes(action);
}

export interface Actor {
  type: ActorType;
  id: string;
  tenantId: string | null;
  role: TenantRole | PlatformRole | null;
}

export interface Result<T> {
  ok: boolean;
  value?: T;
  error?: ApiError;
}

export interface ApiError {
  code: string;
  message: string;
  status: number;
  details?: Record<string, unknown>;
}

/**
 * Domain errors are thrown, so they must be real Error instances — otherwise the HTTP layer
 * cannot tell them apart from unexpected failures and everything degrades into a 500.
 * They carry their own status code and never leak internal detail through `message`.
 */
export class ApiProblem extends Error implements ApiError {
  readonly code: string;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, status: number, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiProblem';
    this.code = code;
    this.status = status;
    if (details) this.details = details;
  }
}

export const ERRORS = {
  unauthorized: (m = 'Authentication required') => err('unauthorized', m, 401),
  forbidden: (m = 'Not permitted') => err('forbidden', m, 403),
  notFound: (m = 'Not found') => err('not_found', m, 404),
  validation: (m = 'Invalid request', details?: Record<string, unknown>) =>
    err('validation_error', m, 400, details),
  conflict: (m = 'Conflict') => err('conflict', m, 409),
  rateLimited: (m = 'Too many requests') => err('rate_limited', m, 429),
  internal: (m = 'Internal error') => err('internal_error', m, 500),
} as const;

export function err(code: string, message: string, status: number, details?: Record<string, unknown>): ApiProblem {
  return new ApiProblem(code, message, status, details);
}

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail<T>(error: ApiError): Result<T> {
  return { ok: false, error };
}

/** Slug used for shop URLs / bot deep-link payloads. */
export function slugify(input: string, max = 48): string {
  const base = input
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max);
  return base.length > 0 ? base : 'shop';
}

export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Buffer.from(buf).toString('base64url');
}

/** UTC ISO string; all timestamps in the system are stored as timestamptz. */
export function nowIso(): string {
  return new Date().toISOString();
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function redact<T extends Record<string, unknown>>(input: T, keys: string[]): T {
  const clone: Record<string, unknown> = { ...input };
  for (const key of keys) {
    if (key in clone) clone[key] = '[redacted]';
  }
  return clone as T;
}
