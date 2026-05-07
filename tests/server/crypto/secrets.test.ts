import crypto from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';

const TEST_KEY_B64 = Buffer.alloc(32, 7).toString('base64');

describe('server/crypto/secrets', () => {
  beforeAll(() => {
    process.env.TELEPHONY_ENC_KEY = TEST_KEY_B64;
  });

  it('round-trips an empty string', async () => {
    const { encrypt, decrypt } = await import('../../../src/server/crypto/secrets');
    const s = '';
    expect(decrypt(encrypt(s))).toBe(s);
  });

  it('round-trips an ASCII string', async () => {
    const { encrypt, decrypt } = await import('../../../src/server/crypto/secrets');
    const s = 'AC1234567890abcdef-twilio-auth-token';
    expect(decrypt(encrypt(s))).toBe(s);
  });

  it('round-trips UTF-8 with emoji and non-Latin characters', async () => {
    const { encrypt, decrypt } = await import('../../../src/server/crypto/secrets');
    const s = 'héllo 世界 🚀🔐 — naïve résumé';
    expect(decrypt(encrypt(s))).toBe(s);
  });

  it('round-trips a 4 KB string', async () => {
    const { encrypt, decrypt } = await import('../../../src/server/crypto/secrets');
    const s = 'x'.repeat(4096);
    expect(decrypt(encrypt(s))).toBe(s);
  });

  it('produces different ciphertexts for the same plaintext (random IV)', async () => {
    const { encrypt, decrypt } = await import('../../../src/server/crypto/secrets');
    const s = 'same-plaintext-every-time';
    const c1 = encrypt(s);
    const c2 = encrypt(s);
    expect(c1).not.toBe(c2);
    expect(decrypt(c1)).toBe(s);
    expect(decrypt(c2)).toBe(s);
  });

  it('throws on tampered ciphertext (one flipped byte)', async () => {
    const { encrypt, decrypt } = await import('../../../src/server/crypto/secrets');
    const s = 'tamper-me-if-you-can';
    const blob = Buffer.from(encrypt(s), 'base64');
    const midIndex = Math.floor(blob.length / 2);
    blob[midIndex] = blob[midIndex] ^ 0x01;
    const tampered = blob.toString('base64');
    expect(() => decrypt(tampered)).toThrow();
  });

  it('throws a helpful error on wrong-length key at first encrypt call', async () => {
    const { encrypt, __resetKeyCacheForTests } = await import('../../../src/server/crypto/secrets');
    const original = process.env.TELEPHONY_ENC_KEY;
    try {
      __resetKeyCacheForTests();
      process.env.TELEPHONY_ENC_KEY = crypto.randomBytes(16).toString('base64');
      expect(() => encrypt('anything')).toThrow(/TELEPHONY_ENC_KEY/);
      expect(() => encrypt('anything')).toThrow(/node -e/);
    } finally {
      process.env.TELEPHONY_ENC_KEY = original;
      __resetKeyCacheForTests();
    }
  });
});
