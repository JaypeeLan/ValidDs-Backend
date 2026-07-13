/**
 * Regression test for pagination totals wobbling across page fetches
 * (e.g. page 1 → 100, page 2 → 98, page 3 → 102) when Redis is flapping.
 *
 * stabilizeFeedTotal must pin the total from the first observation and keep
 * returning it even while Redis is unreachable, thanks to the in-process
 * fallback. It should only track Redis once Redis comes back with a value.
 */

const redisStore = new Map<string, string>();
let redisUp = true;

const fakeRedis = {
  get: jest.fn(async (key: string) => {
    if (!redisUp) throw new Error('ECONNRESET: Redis is down');
    return redisStore.has(key) ? redisStore.get(key)! : null;
  }),
  setex: jest.fn(async (key: string, _ttl: number, value: string) => {
    if (!redisUp) throw new Error('ECONNRESET: Redis is down');
    redisStore.set(key, value);
    return 'OK';
  }),
};

jest.mock('../src/cache/redis.client', () => ({
  getRedisClient: () => fakeRedis,
}));

import { CacheService } from '../src/cache/cache.service';

const KEY = 'product:feedtotal:US:{}';
const TTL = 1800;

beforeEach(() => {
  redisStore.clear();
  redisUp = true;
  jest.clearAllMocks();
});

describe('stabilizeFeedTotal', () => {
  it('pins the total across pages while Redis stays up', async () => {
    const p1 = await CacheService.stabilizeFeedTotal(KEY, 100, TTL);
    const p2 = await CacheService.stabilizeFeedTotal(KEY, 98, TTL);
    const p3 = await CacheService.stabilizeFeedTotal(KEY, 102, TTL);
    expect([p1, p2, p3]).toEqual([100, 100, 100]);
  });

  it('keeps the total frozen when Redis drops mid-session (the reported bug)', async () => {
    // Page 1: Redis healthy, pins 100 in Redis + local mirror.
    const p1 = await CacheService.stabilizeFeedTotal(KEY, 100, TTL);
    expect(p1).toBe(100);

    // Redis flaps out between page fetches.
    redisUp = false;

    // Pages 2 & 3 compute drifting live counts, but the in-process pin holds.
    const p2 = await CacheService.stabilizeFeedTotal(KEY, 98, TTL);
    const p3 = await CacheService.stabilizeFeedTotal(KEY, 102, TTL);
    expect(p2).toBe(100);
    expect(p3).toBe(100);
  });

  it('still pins the total when Redis is down for the very first page', async () => {
    redisUp = false;
    const p1 = await CacheService.stabilizeFeedTotal(KEY, 100, TTL);
    const p2 = await CacheService.stabilizeFeedTotal(KEY, 98, TTL);
    const p3 = await CacheService.stabilizeFeedTotal(KEY, 102, TTL);
    expect([p1, p2, p3]).toEqual([100, 100, 100]);
  });

  it('re-seeds Redis from the local pin once Redis recovers', async () => {
    await CacheService.stabilizeFeedTotal(KEY, 100, TTL); // pin 100
    redisUp = false;
    await CacheService.stabilizeFeedTotal(KEY, 98, TTL); // served locally
    redisUp = true;
    await CacheService.stabilizeFeedTotal(KEY, 102, TTL); // re-seeds Redis
    expect(redisStore.get(KEY)).toBe('100');
  });
});
