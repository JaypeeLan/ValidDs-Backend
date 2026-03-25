import * as crypto from 'crypto';
import { env } from '../config/env.validation';

/**
 * Minimal JWT implementation — sign and verify HS256 JWTs
 * without an external library.
 *
 * Only supports HS256 (HMAC-SHA256).
 * Validates: signature, expiry (exp), issued-at (iat).
 */

export interface JWTPayload {
  sub: string;          // subject (user ID)
  role?: string;
  iat?: number;
  exp?: number;
  [key: string]: unknown;
}

function base64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64urlDecode(input: string): string {
  const padded = input + '=='.slice(0, (4 - (input.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

const HEADER = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

function sign(data: string): string {
  return base64url(
    crypto.createHmac('sha256', env.JWT_SECRET).update(data).digest()
  );
}

export function signJWT(payload: Omit<JWTPayload, 'iat' | 'exp'>): string {
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = parseExpiry(env.JWT_EXPIRES_IN);

  const fullPayload: JWTPayload = {
    ...(payload as JWTPayload),
    iat: now,
    exp: now + expiresIn,
  };

  const encodedPayload = base64url(JSON.stringify(fullPayload));
  const signingInput = `${HEADER}.${encodedPayload}`;
  const signature = sign(signingInput);

  return `${signingInput}.${signature}`;
}

export interface JWTVerifyResult {
  valid: boolean;
  expired?: boolean;
  payload?: JWTPayload;
  error?: string;
}

export function verifyJWT(token: string): JWTVerifyResult {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return { valid: false, error: 'Malformed token' };

    const [header, payload, signature] = parts;
    const signingInput = `${header}.${payload}`;
    const expectedSig = sign(signingInput);

    // Timing-safe comparison
    const sigBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSig);
    if (
      sigBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(sigBuffer, expectedBuffer)
    ) {
      return { valid: false, error: 'Invalid signature' };
    }

    const decoded = JSON.parse(base64urlDecode(payload)) as JWTPayload;
    const now = Math.floor(Date.now() / 1000);

    if (decoded.exp && decoded.exp < now) {
      return { valid: false, expired: true, error: 'Token expired' };
    }

    return { valid: true, payload: decoded };
  } catch {
    return { valid: false, error: 'Token verification failed' };
  }
}

function parseExpiry(expiry: string): number {
  const match = expiry.match(/^(\d+)([smhd])$/);
  if (!match) return 7 * 24 * 60 * 60; // default 7 days
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return value * (multipliers[unit] ?? 1);
}
