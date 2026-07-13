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
    /**
     * Never permanently give up reconnecting. The previous strategy returned
     * null after 5 attempts, which on a managed Redis that drops idle
     * connections left the client dead until the next process restart — every
     * cache op then silently missed (and pagination totals stopped being
     * pinned). Reconnect forever with a capped backoff instead.
     */
    retryStrategy: (times) => {
      const delay = Math.min(times * 200, 5000);
      if (times <= 5 || times % 20 === 0) {
        log.warn(`Redis retry attempt ${times}, waiting ${delay}ms`);
      }
      return delay;
    },
    /**
     * Reconnect (rather than error) on transient failover conditions such as a
     * replica being promoted — common on managed Redis and a likely source of
     * the observed connect/disconnect flapping.
     */
    reconnectOnError: (err) => {
      const target = ['READONLY', 'ETIMEDOUT', 'ECONNRESET'];
      return target.some((code) => err.message.includes(code));
    },
    tls: redisUrl.startsWith('rediss://') ? {} : undefined,
    lazyConnect: false,
    enableReadyCheck: true,
    connectTimeout: 10000,
    /** TCP keepalive pings stop managed Redis from dropping an idle connection. */
    keepAlive: 15000,
    /** Prevent hung product-detail requests when Redis is slow/unreachable in production. */
    commandTimeout: 5000,
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
