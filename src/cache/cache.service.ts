import { getRedisClient } from './redis.client';
import { logger } from '../logger';
import { cacheHitsTotal, cacheMissesTotal } from '../monitoring/metrics';

const log = logger.child({ module: 'cache' });

/**
 * Redis cache abstraction layer.
 *
 * All cache reads/writes go through this service — never call the Redis
 * client directly from controllers or services.
 *
 * Features:
 * - Type-safe get/set with automatic JSON serialization
 * - Prometheus cache hit/miss tracking
 * - Safe fallback — cache errors never crash the request (just log + miss)
 * - Prefix-based invalidation (clear all keys for an entity type)
 */

export const CacheService = {

  /**
   * Get a cached value.
   * Returns null on miss or error.
   */
  async get<T>(key: string): Promise<T | null> {
    const prefix = keyPrefix(key);
    try {
      const redis = getRedisClient();
      const raw = await redis.get(key);

      if (raw === null) {
        cacheMissesTotal.inc({ key_prefix: prefix });
        return null;
      }

      cacheHitsTotal.inc({ key_prefix: prefix });
      return JSON.parse(raw) as T;
    } catch (err) {
      log.warn('Cache get failed — treating as miss', { key, err: String(err) });
      cacheMissesTotal.inc({ key_prefix: prefix });
      return null;
    }
  },

  /**
   * Set a cached value with a TTL in seconds.
   */
  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    try {
      const redis = getRedisClient();
      await redis.setex(key, ttlSeconds, JSON.stringify(value));
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
    await CacheService.set(key, value, ttlSeconds);
    return value;
  },
};

function keyPrefix(key: string): string {
  return key.split(':')[0] ?? key;
}
