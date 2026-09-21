/**
 * Static asset serving for the seller panel (a single-page app with no build step).
 *
 * Hand-rolled instead of @fastify/static so the M1 slice keeps a minimal, auditable surface:
 *  - path traversal is impossible: the resolved path must stay inside PUBLIC_DIR
 *  - dotfiles are never served
 *  - a strict CSP is applied (no inline scripts, no third-party origins)
 *  - /api/* and /telegram/* are never answered by the SPA fallback
 */
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export const PUBLIC_DIR = resolve(join(dirname(fileURLToPath(import.meta.url)), '..', 'public'));

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ');

/** Returns an absolute path inside `root`, or null when the path escapes it. */
export function safeJoin(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const normalized = normalize(decoded).replace(/^([.][.][/\\])+/, '');
  const candidate = resolve(join(root, normalized));
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  const inside = candidate === root || candidate.startsWith(rootWithSep);
  if (!inside) return null;
  if (candidate.split(sep).some((part) => part.startsWith('.') && part.length > 1)) return null;
  return candidate;
}

async function sendFile(reply: FastifyReply, filePath: string): Promise<FastifyReply> {
  const body = await readFile(filePath);
  const type = CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream';
  return reply
    .header('content-type', type)
    .header('content-security-policy', CSP)
    .header('cache-control', type.startsWith('text/html') ? 'no-store' : 'public, max-age=300')
    .send(body);
}

export async function registerStaticRoutes(app: FastifyInstance): Promise<void> {
  app.get('/*', async (request: FastifyRequest, reply: FastifyReply) => {
    const urlPath = (request.raw.url ?? '/').split('?')[0] ?? '/';
    if (urlPath.startsWith('/api/') || urlPath.startsWith('/telegram/')) {
      return reply.code(404).send({ ok: false, error: { code: 'not_found', message: 'unknown route' } });
    }

    const target = urlPath === '/' ? '/index.html' : urlPath;
    const filePath = safeJoin(PUBLIC_DIR, target);
    if (!filePath) {
      return reply.code(400).send({ ok: false, error: { code: 'bad_request', message: 'bad path' } });
    }
    try {
      const info = await stat(filePath);
      if (info.isFile()) return await sendFile(reply, filePath);
    } catch {
      /* fall through to the SPA shell */
    }
    try {
      return await sendFile(reply, join(PUBLIC_DIR, 'index.html'));
    } catch {
      return reply.code(404).send({ ok: false, error: { code: 'not_found', message: 'panel not built' } });
    }
  });
}
