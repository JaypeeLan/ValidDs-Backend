import { getRedisClient } from './redis.client';
import { logger } from '../logger';
import { env } from '../config/env.validation';
import { CACHE_PREFIXES } from './cache.keys';

const log = logger.child({ module: 'cache' });

/**
 * Redis cache abstraction layer.
 *
 * All cache reads/writes go through this service — never call the Redis
 * client directly from controllers or services.
 *
 * Features:
 * - Type-safe get/set with automatic JSON serialization
 * - Safe fallback — cache errors never crash the request (just log + miss)
 * - Prefix-based invalidation (clear all keys for an entity type)
 */

/** Returns true when product caching is disabled and the key is a product cache key. */
function isProductCacheDisabled(key: string): boolean {
  return env.PRODUCT_CACHE_DISABLED && key.startsWith(CACHE_PREFIXES.PRODUCT);
}

const REDIS_OP_TIMEOUT_MS = 4_000;

async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Redis ${label} timed out after ${REDIS_OP_TIMEOUT_MS}ms`)),
      REDIS_OP_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const CacheService = {

  /**
   * Get a cached value.
   * Returns null on miss or error — also returns null when PRODUCT_CACHE_DISABLED=true
   * and the key is a product:* key, forcing a fresh DB read every time.
   */
  async get<T>(key: string): Promise<T | null> {
    if (isProductCacheDisabled(key)) {
      log.debug('Product cache disabled — forced miss', { key });
      return null;
    }

    try {
      const redis = getRedisClient();
      const raw = await withTimeout(redis.get(key), 'get');

      if (raw === null) {
        return null;
      }

      return JSON.parse(raw) as T;
    } catch (err) {
      log.warn('Cache get failed — treating as miss', { key, err: String(err) });
      return null;
    }
  },

  /**
   * Set a cached value with a TTL in seconds.
   * No-op when PRODUCT_CACHE_DISABLED=true and the key is a product:* key.
   */
  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    if (isProductCacheDisabled(key)) {
      log.debug('Product cache disabled — skipping write', { key });
      return;
    }

    try {
      const redis = getRedisClient();
      await withTimeout(redis.setex(key, ttlSeconds, JSON.stringify(value)), 'setex');
    } catch (err) {
      // Cache write failures are non-fatal — the request still succeeds
      log.warn('Cache set failed', { key, err: String(err) });
    }
  },

  /**
   * Delete a single cached key.
   */
  async delete(key: string): Promise<void> {
    try {
      const redis = getRedisClient();
      await redis.del(key);
    } catch (err) {
      log.warn('Cache delete failed', { key, err: String(err) });
    }
  },

  /**
   * Delete all keys matching a prefix pattern.
   * Use this to invalidate an entire entity type (e.g. all product cache entries).
   *
   * Uses SCAN to avoid blocking Redis with KEYS on large datasets.
   */
  async deleteByPrefix(prefix: string): Promise<number> {
    try {
      const redis = getRedisClient();
      let cursor = '0';
      let deleted = 0;

      do {
        const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 100);
        cursor = nextCursor;

        if (keys.length > 0) {
          await redis.del(...keys);
          deleted += keys.length;
        }
      } while (cursor !== '0');

      log.debug(`Cache invalidated ${deleted} keys`, { prefix });
      return deleted;
    } catch (err) {
      log.warn('Cache prefix delete failed', { prefix, err: String(err) });
      return 0;
    }
  },

  /**
   * Get or set pattern — fetch from cache, or call the loader and cache the result.
   *
   * Usage:
   *   const products = await CacheService.getOrSet(
   *     CacheKeys.productFeed(page, limit),
   *     CACHE_TTL.PRODUCT_FEED,
   *     () => productRepository.findFeed({ page, limit })
   *   );
   */
  async getOrSet<T>(
    key: string,
    ttlSeconds: number,
    loader: () => Promise<T>
  ): Promise<T> {
    const cached = await CacheService.get<T>(key);
    if (cached !== null) return cached;

    const value = await loader();
    // Do not block the response on a slow cache write.
    void CacheService.set(key, value, ttlSeconds);
    return value;
  },
};
