import * as crypto from 'crypto';
import { env } from '../config/env.validation';

/**
 * AES-256-GCM encryption for sensitive fields stored in MongoDB.
 *
 * Use this for any field that would be problematic if the DB were breached:
 * API keys, tokens, supplier credentials, etc.
 *
 * GCM mode provides both encryption AND authentication (integrity check).
 * Never use AES-CBC without a separate HMAC.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;   // 96-bit IV — recommended for GCM

export interface EncryptedValue {
  iv: string;      // hex
  tag: string;     // hex
  data: string;    // hex
}

export function encrypt(plaintext: string): EncryptedValue {
  const key = Buffer.from(env.ENCRYPTION_KEY, 'hex');
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  return {
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    data: encrypted.toString('hex'),
  };
}

export function decrypt(value: EncryptedValue): string {
  const key = Buffer.from(env.ENCRYPTION_KEY, 'hex');
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(value.iv, 'hex')
  );

  decipher.setAuthTag(Buffer.from(value.tag, 'hex'));

  return (
    decipher.update(Buffer.from(value.data, 'hex')).toString('utf8') +
    decipher.final('utf8')
  );
}

/**
 * API key utilities.
 *
 * Raw keys are shown to the user ONCE on creation.
 * Only the SHA-256 hash is stored in the DB.
 * On each request, hash the incoming key and compare to stored hash.
 */
export function generateApiKey(): string {
  return 'vds_' + crypto.randomBytes(32).toString('hex');
}

export function hashApiKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

export function verifyApiKey(rawKey: string, storedHash: string): boolean {
  const inputHash = hashApiKey(rawKey);
  // Use timingSafeEqual to prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(inputHash, 'hex'),
    Buffer.from(storedHash, 'hex')
  );
}

/**
 * CORS allowed origins.
 * Parsed from comma-separated CORS_ALLOWED_ORIGINS env var.
 */
export function getAllowedOrigins(): string[] {
  return env.CORS_ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
}
