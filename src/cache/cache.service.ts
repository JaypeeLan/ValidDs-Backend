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
  async getOrSet<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
    const cached = await CacheService.get<T>(key);
    if (cached !== null) return cached;

    const value = await loader();
    // Do not block the response on a slow cache write.
    void CacheService.set(key, value, ttlSeconds);
    return value;
  },

  /**
   * Pin feed totals for a filter set so page 1 and page N return the same `total`
   * during the TTL window (avoids pagination jumping while ingestion is running).
   *
   * Backed by Redis *and* a small in-process map so the pin survives Redis
   * flapping: managed Redis drops idle connections, and without a local fallback
   * every page fetched during a disconnect would recompute a live (drifting)
   * count, making totalPages jump (e.g. 100 → 98 → 102). The in-process copy
   * keeps the total stable per instance; safe because deployments are
   * single-instance (see docs/architecture). Redis remains the cross-instance
   * source of truth when it is up.
   */
  async stabilizeFeedTotal(
    key: string,
    computedTotal: number,
    ttlSeconds: number,
  ): Promise<number> {
    const cached = await CacheService.get<number>(key);
    if (cached !== null) {
      setLocalFeedTotal(key, cached, ttlSeconds); // refresh local mirror from Redis
      return cached;
    }

    // Redis missed or was unreachable — fall back to the in-process pin.
    const local = getLocalFeedTotal(key);
    if (local !== null) {
      void CacheService.set(key, local, ttlSeconds); // best-effort re-seed Redis
      return local;
    }

    // First observation of this filter set — pin the freshly computed total.
    setLocalFeedTotal(key, computedTotal, ttlSeconds);
    void CacheService.set(key, computedTotal, ttlSeconds);
    return computedTotal;
  },
};

/**
 * In-process fallback store for feed totals, keyed identically to Redis.
 * Bounded so a flood of distinct filter sets cannot grow it without limit.
 */
const LOCAL_FEED_TOTAL_MAX_ENTRIES = 2_000;
const localFeedTotals = new Map<string, { value: number; expiresAt: number }>();

function getLocalFeedTotal(key: string): number | null {
  const entry = localFeedTotals.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    localFeedTotals.delete(key);
    return null;
  }
  return entry.value;
}

function setLocalFeedTotal(key: string, value: number, ttlSeconds: number): void {
  // Evict the oldest entry when at capacity (Map preserves insertion order).
  if (localFeedTotals.size >= LOCAL_FEED_TOTAL_MAX_ENTRIES && !localFeedTotals.has(key)) {
    const oldest = localFeedTotals.keys().next().value;
    if (oldest !== undefined) localFeedTotals.delete(oldest);
  }
  localFeedTotals.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1_000 });
}
