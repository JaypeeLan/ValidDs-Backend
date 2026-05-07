import Redis from 'ioredis';
import { env } from '../config/env.validation';
import { logger } from '../logger';

const log = logger.child({ module: 'redis' });

/**
 * Redis client singleton for caching and job queuing.
 *
 * Supports both plain redis and rediss (TLS) protocols.
 * The REDIS_URL should be in the format: redis[s]://[:password]@hostname:port
 *
 * This client is shared by:
 *   - Cache layer    (src/cache/)
 *   - BullMQ queues  (src/queue/)
 *   - Rate limiter   (src/middleware/rate-limit.middleware.ts)
 *
 * For BullMQ, a separate connection instance is created (BullMQ requires
 * its own dedicated connection that it controls).
 */

let redisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (redisClient) return redisClient;

  const redisUrl = env.REDIS_URL;
  if (!redisUrl) {
    throw new Error('REDIS_URL is not configured');
  }

  redisClient = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => {
      if (times >= 5) {
        log.error('Redis max retries reached, giving up');
        return null; // stop retrying
      }
      const delay = Math.min(times * 200, 2000);
      log.warn(`Redis retry attempt ${times}, waiting ${delay}ms`);
      return delay;
    },
    tls: redisUrl.startsWith('rediss://') ? {} : undefined,
    lazyConnect: false,
    enableReadyCheck: true,
    connectTimeout: 10000,
  });

  redisClient.on('connect', () => {
    log.info('Redis connected');
  });

  redisClient.on('error', (err) => {
    log.error('Redis client error', err);
  });

  redisClient.on('close', () => {
    log.warn('Redis connection closed');
  });

  redisClient.on('reconnecting', () => {
    log.info('Redis reconnecting...');
  });

  return redisClient;
}

/**
 * Creates a SEPARATE Redis connection for BullMQ.
 *
 * BullMQ requires its own connection that it fully controls
 * (blocking commands, subscribe mode). Never share this with
 * the cache/rate-limit client.
 */
export function createBullMQRedisConnection(): Redis {
  const redisUrl = env.REDIS_URL;
  if (!redisUrl) {
    throw new Error('REDIS_URL is not configured');
  }

  return new Redis(redisUrl, {
    maxRetriesPerRequest: null, // required by BullMQ
    tls: redisUrl.startsWith('rediss://') ? {} : undefined,
    enableReadyCheck: false,
  });
}

export async function disconnectRedis(): Promise<void> {
  if (!redisClient) return;
  await redisClient.quit();
  redisClient = null;
  log.info('Redis disconnected gracefully');
}

export function getRedisStatus(): 'ready' | 'connecting' | 'disconnected' | 'error' {
  if (!redisClient) return 'disconnected';
  return redisClient.status as 'ready' | 'connecting' | 'disconnected' | 'error';
}
