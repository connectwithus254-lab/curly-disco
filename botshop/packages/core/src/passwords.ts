/**
 * Password hashing with scrypt (node builtin, no native deps).
 * Format: scrypt$N$r$p$<salt-b64url>$<hash-b64url>
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const N = 1 << 15; // 32768 — 32 MiB of memory at r=8
const R = 8;
const P = 1;
const KEYLEN = 32;
// Node's default scrypt maxmem (32 MiB) is exactly at the limit for these parameters, so state
// the budget explicitly instead of relying on the default.
const MAXMEM = 64 * 1024 * 1024;

export function hashPassword(password: string): string {
  if (password.length < 10) throw new Error('password must be at least 10 characters');
  const salt = randomBytes(16);
  const hash = scryptSync(password.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, n, r, p, saltB64, hashB64] = stored.split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltB64!, 'base64url');
    const expected = Buffer.from(hashB64!, 'base64url');
    const actual = scryptSync(password.normalize('NFKC'), salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: MAXMEM,
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** Session / API key tokens are random, not derived, so hashing with sha256 is enough. */
export async function hashToken(token: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(token).digest('base64url');
}
