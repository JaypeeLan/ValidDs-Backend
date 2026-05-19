import rateLimit from 'express-rate-limit';
import { env } from '../config/env.validation';

/**
 * Rate limiting middleware using express-rate-limit (in-memory store).
 *
 * For multi-instance deployments swap in RedisStore:
 *   import { RedisStore } from 'rate-limit-redis';
 *   store: new RedisStore({ sendCommand: (...args) => redisClient.call(...args) })
 *
 * Three limiters:
 *   globalLimiter  — blanket safety net applied to all routes in app.ts
 *   strictLimiter  — auth mutations, waitlist signup, expensive ingest endpoints
 *   mediaLimiter   — TikTok CDN proxy streams (video + thumbnail); tighter per-minute window
 */

const isDev  = env.NODE_ENV === 'development';
const isTest = env.NODE_ENV === 'test';

// Shared key generator — resolve real client IP.
// Requires app.set('trust proxy', 1) in app.ts so that Express populates
// req.ip from X-Forwarded-For (set by Render / nginx) rather than the
// load-balancer address.
const clientIp = (req: import('express').Request): string =>
  req.ip ?? req.socket.remoteAddress ?? 'unknown';

/** 100 req / 15 min — applied globally in app.ts before all routes */
export const globalLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX_REQUESTS,
  keyGenerator: clientIp,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many requests. Please try again later.',
    },
  },
  skip: (req) => isDev || isTest || req.path === '/health' || req.path === '/ready',
});

/** 10 req / 15 min — auth mutations, waitlist, expensive POST operations */
export const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: clientIp,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many attempts. Please try again later.',
    },
  },
  skip: () => isDev || isTest,
});

/** 30 req / 1 min — TikTok CDN proxy endpoints (video stream + thumbnail) */
export const mediaLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: clientIp,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many media requests. Please slow down.',
    },
  },
  skip: () => isDev || isTest,
});
