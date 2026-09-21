/**
 * Envelope encryption for tenant secrets (Telegram bot tokens, payment gateway keys).
 *
 * Design (see docs/06-threat-model.md T5/T6):
 *  - AES-256-GCM, random 96-bit IV per encryption, auth tag stored with ciphertext.
 *  - Envelope format: v1.<keyId>.<base64url(iv|tag|ciphertext)>
 *  - Key material NEVER touches the database, logs, or API responses.
 *  - key_id is stored alongside ciphertext so keys can be rotated without a big-bang migration.
 *  - In production the master key comes from a KMS/secret manager; here from env.
 */
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class SecretError extends Error {}

function parseKey(hex: string, keyId: string): Buffer {
  const buf = Buffer.from(hex.trim(), 'hex');
  if (buf.length !== 32) {
    throw new SecretError(`encryption key ${keyId} must be 32 bytes (64 hex chars), got ${buf.length}`);
  }
  return buf;
}

export class KeyRing {
  private readonly keys: Map<string, Buffer>;
  readonly activeKeyId: string;

  constructor(keys: Record<string, string>, activeKeyId?: string) {
    const entries = Object.entries(keys);
    if (entries.length === 0) throw new SecretError('no encryption keys configured');
    this.keys = new Map(entries.map(([id, hex]) => [id, parseKey(hex, id)]));
    this.activeKeyId = activeKeyId ?? entries[entries.length - 1]![0];
    if (!this.keys.has(this.activeKeyId)) throw new SecretError(`active key ${this.activeKeyId} not in keyring`);
  }

  /** Loads keys from ENCRYPTION_KEYS ("kid1:hex,kid2:hex") and ENCRYPTION_ACTIVE_KEY_ID. */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): KeyRing {
    const raw = env.ENCRYPTION_KEYS;
    if (!raw) throw new SecretError('ENCRYPTION_KEYS is required (format: kid1:<64 hex>,kid2:<64 hex>)');
    const keys: Record<string, string> = {};
    for (const part of raw.split(',')) {
      const idx = part.indexOf(':');
      if (idx <= 0) throw new SecretError(`malformed ENCRYPTION_KEYS entry: ${part.slice(0, 8)}...`);
      keys[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
    }
    return new KeyRing(keys, env.ENCRYPTION_ACTIVE_KEY_ID);
  }

  key(keyId: string): Buffer {
    const k = this.keys.get(keyId);
    if (!k) throw new SecretError(`unknown encryption key id ${keyId}`);
    return k;
  }

  encrypt(plaintext: string): string {
    if (typeof plaintext !== 'string' || plaintext.length === 0) throw new SecretError('refusing to encrypt empty secret');
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key(this.activeKeyId), iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const blob = Buffer.concat([iv, tag, ct]).toString('base64url');
    return `${VERSION}.${this.activeKeyId}.${blob}`;
  }

  decrypt(envelope: string): string {
    const parts = envelope.split('.');
    if (parts.length !== 3 || parts[0] !== VERSION) throw new SecretError('malformed secret envelope');
    const [, keyId, blob] = parts as [string, string, string];
    const buf = Buffer.from(blob, 'base64url');
    if (buf.length <= IV_BYTES + TAG_BYTES) throw new SecretError('truncated secret envelope');
    const iv = buf.subarray(0, IV_BYTES);
    const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ct = buf.subarray(IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', this.key(keyId), iv);
    decipher.setAuthTag(tag);
    try {
      return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
    } catch {
      // Never leak crypto detail to callers; treat as unrecoverable ciphertext.
      throw new SecretError('secret could not be decrypted (wrong key or tampered ciphertext)');
    }
  }
}

/** Extracts the key id from an envelope without decrypting (used for rotation reports). */
export function envelopeKeyId(envelope: string): string | null {
  const parts = envelope.split('.');
  return parts.length === 3 && parts[0] === VERSION ? parts[1]! : null;
}

/** Constant-time comparison for secrets (webhook tokens, API keys). */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Last 4 characters, for UI display ("token ends with …Ab3x"). Never store more. */
export function last4(secret: string): string {
  return secret.slice(-4);
}
