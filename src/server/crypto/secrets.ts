// AES-256-GCM at-rest encryption for telephony provider credentials.
// Used by the telephony layer to write/read telephony_credentials.auth_token_encrypted
// (e.g. Twilio Auth Tokens) so plaintext secrets never touch the database.
// Key material is supplied via the TELEPHONY_ENC_KEY env var (base64, 32 bytes raw).
// Wire format is base64( IV(12) || CIPHERTEXT(N) || TAG(16) ).
import crypto from 'node:crypto';

const ENV_VAR = 'TELEPHONY_ENC_KEY';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey !== null) return cachedKey;

  const raw = process.env[ENV_VAR];
  if (!raw || raw.length === 0) {
    throw new Error(
      `${ENV_VAR} is not set. Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }

  let decoded: Buffer;
  try {
    decoded = Buffer.from(raw, 'base64');
  } catch {
    throw new Error(
      `${ENV_VAR} is not valid base64. Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }

  if (decoded.length !== KEY_LENGTH) {
    throw new Error(
      `${ENV_VAR} must decode to exactly ${KEY_LENGTH} bytes (got ${decoded.length}). Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }

  cachedKey = decoded;
  return cachedKey;
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ciphertext, tag]).toString('base64');
}

export function decrypt(ciphertextB64: string): string {
  const key = getKey();
  const blob = Buffer.from(ciphertextB64, 'base64');
  if (blob.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error('Invalid ciphertext: payload too short');
  }
  const iv = blob.subarray(0, IV_LENGTH);
  const tag = blob.subarray(blob.length - TAG_LENGTH);
  const ciphertext = blob.subarray(IV_LENGTH, blob.length - TAG_LENGTH);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

export function __resetKeyCacheForTests(): void {
  cachedKey = null;
}
