import { describe, expect, it } from 'vitest';
import { KeyRing, SecretError, envelopeKeyId, last4, safeEqual } from '@botshop/core';

const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);

describe('secret envelope encryption', () => {
  it('round-trips a bot token and never stores it in plaintext', () => {
    const ring = new KeyRing({ k1: KEY_A }, 'k1');
    const token = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
    const envelope = ring.encrypt(token);

    expect(envelope).not.toContain(token);
    expect(envelope.startsWith('v1.k1.')).toBe(true);
    expect(envelopeKeyId(envelope)).toBe('k1');
    expect(ring.decrypt(envelope)).toBe(token);
  });

  it('produces a different ciphertext every time (random IV)', () => {
    const ring = new KeyRing({ k1: KEY_A }, 'k1');
    expect(ring.encrypt('same-secret')).not.toBe(ring.encrypt('same-secret'));
  });

  it('detects tampering instead of returning corrupted plaintext', () => {
    const ring = new KeyRing({ k1: KEY_A }, 'k1');
    const envelope = ring.encrypt('super-secret-token');
    const [version, keyId, blob] = envelope.split('.') as [string, string, string];
    const tampered = `${version}.${keyId}.${blob.slice(0, -2)}${blob.slice(-2) === 'AA' ? 'BB' : 'AA'}`;

    expect(() => ring.decrypt(tampered)).toThrow(SecretError);
  });

  it('supports rotation: new writes use the active key, old ciphertext still decrypts', () => {
    const oldRing = new KeyRing({ k1: KEY_A }, 'k1');
    const legacy = oldRing.encrypt('legacy-token');

    const rotating = new KeyRing({ k1: KEY_A, k2: KEY_B }, 'k2');
    expect(rotating.decrypt(legacy)).toBe('legacy-token');
    expect(envelopeKeyId(rotating.encrypt('new-token'))).toBe('k2');
  });

  it('refuses malformed keys and empty secrets', () => {
    expect(() => new KeyRing({ k1: 'short' }, 'k1')).toThrow(SecretError);
    expect(() => new KeyRing({ k1: KEY_A }, 'k3')).toThrow(SecretError);
    const ring = new KeyRing({ k1: KEY_A }, 'k1');
    expect(() => ring.encrypt('')).toThrow(SecretError);
  });

  it('compares secrets in constant time and only ever exposes the last 4 characters', () => {
    expect(safeEqual('webhook-secret', 'webhook-secret')).toBe(true);
    expect(safeEqual('webhook-secret', 'webhook-secreu')).toBe(false);
    expect(safeEqual('short', 'longer-value')).toBe(false);
    expect(last4('123456:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw')).toBe('Dsaw');
  });
});
