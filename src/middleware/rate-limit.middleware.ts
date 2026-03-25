import rateLimit from 'express-rate-limit';
import { env } from '../config/env.validation';

/**
 * Rate limiting middleware using express-rate-limit.
 *
 * For V1, uses in-memory store (sufficient for single-instance deployment on Render free tier).
 * When scaling to multiple instances, swap the store for RedisStore:
 *
 *   import { RedisStore } from 'rate-limit-redis';
 *   store: new RedisStore({ sendCommand: (...args) => redisClient.call(...args) })
 *
 * Two limiters are provided:
 *   - globalLimiter:  applied to all routes
 *   - strictLimiter:  applied to sensitive routes (auth, key generation)
 */

export const globalLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,     // default: 15 minutes
  max: env.RATE_LIMIT_MAX_REQUESTS,        // default: 100 requests per window
  standardHeaders: true,                   // Return RateLimit-* headers
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many requests. Please try again later.',
    },
  },
  skip: (req) => req.path === '/health' || req.path === '/ready',
});

export const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 minutes
  max: 10,                      // 10 attempts per window
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many attempts. Please try again later.',
    },
  },
});
