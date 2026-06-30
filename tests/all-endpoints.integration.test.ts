/**
 * Full HTTP integration smoke tests — every registered route on a real Express app + MongoMemoryServer.
 * No route mocks; external APIs may return 4xx/503 when not configured.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { Server } from 'http';
import { Types } from 'mongoose';
import { httpRequest, assertAllowedStatus } from './helpers/http-test.util';
import { minimalIngestCreative, minimalIngestProduct } from './helpers/ingest-product.fixture';
import { seedListableProductPair } from './helpers/seed-listable.fixture';

const API = '/api/v1';
const API_KEY = 'k'.repeat(32);
const INGEST_KEY = 'change-me-scraper-ingest-key';

describe('All API endpoints (HTTP integration)', () => {
  jest.setTimeout(120_000);

  let mongo: MongoMemoryServer;
  let server: Server;
  let baseUrl: string;
  let disconnectMongoFn: (() => Promise<void>) | null = null;

  let userToken: string;
  let adminToken: string;
  let userId: string;
  let adminUserId: string;
  let productId: string;
  let creativeId: string;
  let bookmarkId: string;

  async function hit(
    method: string,
    path: string,
    opts: {
      token?: 'user' | 'admin';
      headers?: Record<string, string>;
      body?: unknown;
      rawBody?: Buffer;
      allowed: number[];
    },
  ): Promise<void> {
    const headers: Record<string, string> = { ...opts.headers };
    if (opts.token === 'user') headers.authorization = `Bearer ${userToken}`;
    if (opts.token === 'admin') headers.authorization = `Bearer ${adminToken}`;

    const payload =
      opts.rawBody ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined);

    const res = await httpRequest({
      baseUrl,
      method,
      path,
      headers,
      body: payload,
    });
    assertAllowedStatus(`${method} ${path}`, res, opts.allowed);
  }

  beforeAll(async () => {
    process.env.SCRAPER_INGEST_KEY = INGEST_KEY;

    mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
    process.env.MONGODB_URI = mongo.getUri();

    jest.resetModules();
    const db = await import('../src/db/client');
    await db.connectMongo();
    disconnectMongoFn = db.disconnectMongo;

    const redis = await import('../src/cache/redis.client');
    jest.spyOn(redis, 'getRedisStatus').mockReturnValue('ready');
    jest.spyOn(redis, 'getRedisClient').mockReturnValue({
      ping: jest.fn().mockResolvedValue('PONG'),
    } as never);

    const s3 = await import('../src/utils/s3-video.util');
    jest.spyOn(s3, 's3ObjectExists').mockResolvedValue(true);

    const originalFetch = global.fetch;
    global.fetch = (async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('api.resend.com/emails')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'email-id' }),
          text: async () => JSON.stringify({ id: 'email-id' }),
        } as Response;
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    const { createApp } = await import('../src/app');
    const app = await createApp();
    server = app.listen(0);
    await new Promise<void>((resolve) => server.on('listening', () => resolve()));

    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('Failed to bind server');
    baseUrl = `http://127.0.0.1:${addr.port}`;

    const { User } = await import('../src/models/user.model');
    const { signJWT } = await import('../src/security/jwt');

    const user = await User.create({
      email: 'endpoint-user@validds.test',
      name: 'Endpoint User',
      authProvider: 'local',
      status: 'active',
      plan: 'pro',
      contentRegion: 'US',
    });
    userId = String(user._id);
    userToken = signJWT({ sub: userId, role: 'user' });

    const admin = await User.create({
      email: 'endpoint-admin@validds.test',
      name: 'Endpoint Admin',
      authProvider: 'local',
      status: 'active',
      plan: 'premium',
      role: 'admin',
      contentRegion: 'US',
    });
    adminUserId = String(admin._id);
    adminToken = signJWT({ sub: adminUserId, role: 'admin' });

    const seeded = await seedListableProductPair();
    productId = seeded.productId;
    creativeId = seeded.creativeId;
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (disconnectMongoFn) await disconnectMongoFn();
    if (mongo) await mongo.stop();
  });

  // ── Root / ops ────────────────────────────────────────────────────────────

  it('GET /health', () => hit('GET', '/health', { allowed: [200] }));

  it('GET /ready', () => hit('GET', '/ready', { allowed: [200] }));

  it('GET /docs', () => hit('GET', '/docs', { allowed: [200, 301, 302] }));

  it('GET /admin-docs', () => hit('GET', '/admin-docs', { allowed: [200, 301, 302] }));

  it('GET /shopify/app', () =>
    hit('GET', '/shopify/app?shop=test.myshopify.com', { allowed: [200, 302, 400, 503] }));

  it('GET /shopify/connected', () => hit('GET', '/shopify/connected', { allowed: [200, 302] }));

  // ── Webhooks ──────────────────────────────────────────────────────────────

  it('POST /api/v1/webhooks/stripe (no signature)', () =>
    hit('POST', `${API}/webhooks/stripe`, {
      rawBody: Buffer.from('{}'),
      allowed: [400, 503],
    }));

  it('POST /api/v1/webhooks/shopify (no signature)', () =>
    hit('POST', `${API}/webhooks/shopify`, {
      rawBody: Buffer.from('{}'),
      allowed: [400, 401, 403, 503],
    }));

  // ── Internal ingest ───────────────────────────────────────────────────────

  it('POST /internal/ingest/product (no key)', () =>
    hit('POST', '/internal/ingest/product', {
      body: { market: 'US', product: {} },
      allowed: [401, 403],
    }));

  it('POST /internal/ingest/product', () =>
    hit('POST', '/internal/ingest/product', {
      headers: { 'X-Ingest-Key': INGEST_KEY },
      body: {
        market: 'US',
        product: minimalIngestProduct({ externalId: `http-ingest-${Date.now()}` }),
      },
      allowed: [200, 201, 422],
    }));

  it('POST /internal/ingest/creative', () =>
    hit('POST', '/internal/ingest/creative', {
      headers: { 'X-Ingest-Key': INGEST_KEY },
      body: {
        market: 'US',
        creative: minimalIngestCreative(productId, {
          externalVideoId: `meta:http-${Date.now()}`,
        }),
      },
      allowed: [200, 201, 422],
    }));

  // ── Auth ──────────────────────────────────────────────────────────────────

  it('GET /auth/google', () => hit('GET', `${API}/auth/google`, { allowed: [302, 200] }));

  it('GET /auth/me', () => hit('GET', `${API}/auth/me`, { token: 'user', allowed: [200] }));

  it('POST /auth/logout', () =>
    hit('POST', `${API}/auth/logout`, { token: 'user', allowed: [200] }));

  it('POST /auth/login (invalid creds)', () =>
    hit('POST', `${API}/auth/login`, {
      body: { email: 'nope@validds.test', password: 'wrong-password-1' },
      allowed: [400, 401, 404],
    }));

  it('POST /auth/register (validation)', () =>
    hit('POST', `${API}/auth/register`, {
      body: { email: 'bad', password: 'short' },
      allowed: [400, 422],
    }));

  it('POST /auth/forgot-password', () =>
    hit('POST', `${API}/auth/forgot-password`, {
      body: { email: 'endpoint-user@validds.test' },
      allowed: [200, 202],
    }));

  // ── Profile ───────────────────────────────────────────────────────────────

  it('GET /profile', () => hit('GET', `${API}/profile`, { token: 'user', allowed: [200] }));

  it('PATCH /profile', () =>
    hit('PATCH', `${API}/profile`, {
      token: 'user',
      body: { timezone: 'America/New_York' },
      allowed: [200],
    }));

  it('GET /profile/content-region', () =>
    hit('GET', `${API}/profile/content-region`, { token: 'user', allowed: [200] }));

  it('PATCH /profile/content-region', () =>
    hit('PATCH', `${API}/profile/content-region`, {
      token: 'user',
      body: { contentRegion: 'US' },
      allowed: [200],
    }));

  it('GET /profile/bookmarks', () =>
    hit('GET', `${API}/profile/bookmarks`, { token: 'user', allowed: [200] }));

  it('POST /profile/bookmarks', async () => {
    await hit('POST', `${API}/profile/bookmarks`, {
      token: 'user',
      body: { productId },
      allowed: [200, 201],
    });
    const res = await httpRequest({
      baseUrl,
      method: 'GET',
      path: `${API}/profile/bookmarks`,
      headers: { authorization: `Bearer ${userToken}` },
    });
    const json = JSON.parse(res.text);
    bookmarkId = json?.data?.products?.[0]?.id ?? json?.data?.[0]?.id ?? productId;
  });

  it('DELETE /profile/bookmarks/:id', () =>
    hit('DELETE', `${API}/profile/bookmarks/${bookmarkId}?kind=product`, {
      token: 'user',
      allowed: [200, 204],
    }));

  // ── Products ──────────────────────────────────────────────────────────────

  it('GET /products', () =>
    hit('GET', `${API}/products?market=US`, { token: 'user', allowed: [200] }));

  it('GET /products/keyword-context', () =>
    hit('GET', `${API}/products/keyword-context?name=serum&market=US`, {
      token: 'user',
      allowed: [200, 400, 502, 503],
    }));

  it('GET /products/categories', () =>
    hit('GET', `${API}/products/categories?market=US`, { token: 'user', allowed: [200] }));

  it('GET /products/subcategories', () =>
    hit(
      'GET',
      `${API}/products/subcategories?market=US&categoryL1=Beauty%20%26%20Personal%20Care`,
      {
        token: 'user',
        allowed: [200],
      },
    ));

  it('GET /products/taxonomy', () =>
    hit('GET', `${API}/products/taxonomy?market=US`, { token: 'user', allowed: [200] }));

  it('GET /products/saved', () =>
    hit('GET', `${API}/products/saved`, { token: 'user', allowed: [200] }));

  it('GET /products/for-you', () =>
    hit('GET', `${API}/products/for-you`, { token: 'user', allowed: [200] }));

  it('GET /products/compare', () =>
    hit('GET', `${API}/products/compare?ids=${productId}&market=US`, {
      token: 'user',
      allowed: [200, 400],
    }));

  it('GET /products/:id', () =>
    hit('GET', `${API}/products/${productId}`, { token: 'user', allowed: [200] }));

  it('GET /products/:id/related-products', () =>
    hit('GET', `${API}/products/${productId}/related-products`, { token: 'user', allowed: [200] }));

  it('GET /products/:id/you-may-like', () =>
    hit('GET', `${API}/products/${productId}/you-may-like`, { token: 'user', allowed: [200] }));

  it('GET /products/:id/related-videos', () =>
    hit('GET', `${API}/products/${productId}/related-videos`, { token: 'user', allowed: [200] }));

  it('GET /products/:id/related-ads', () =>
    hit('GET', `${API}/products/${productId}/related-ads`, { token: 'user', allowed: [200] }));

  // ── Creatives ─────────────────────────────────────────────────────────────

  it('GET /creatives', () =>
    hit('GET', `${API}/creatives?market=US`, { token: 'user', allowed: [200] }));

  it('GET /creatives/categories', () =>
    hit('GET', `${API}/creatives/categories?market=US`, { token: 'user', allowed: [200] }));

  it('GET /creatives/top-ads', () =>
    hit('GET', `${API}/creatives/top-ads?market=US`, { token: 'user', allowed: [200] }));

  it('GET /creatives/:id', () =>
    hit('GET', `${API}/creatives/${creativeId}`, { token: 'user', allowed: [200] }));

  it('GET /creatives/:id/related-videos', () =>
    hit('GET', `${API}/creatives/${creativeId}/related-videos?market=US`, {
      token: 'user',
      allowed: [200],
    }));

  it('GET /creatives/:id/video', () =>
    hit('GET', `${API}/creatives/${creativeId}/video?market=US`, {
      token: 'user',
      allowed: [200, 302, 400, 404, 502, 503],
    }));

  it('GET /creatives/:id/thumbnail', () =>
    hit('GET', `${API}/creatives/${creativeId}/thumbnail?market=US`, {
      token: 'user',
      allowed: [200, 302, 400, 404, 502, 503],
    }));

  it('POST /creatives/ingest', () =>
    hit('POST', `${API}/creatives/ingest`, {
      token: 'user',
      body: { keyword: 'skincare', limit: 1, period: 7, country: 'us' },
      allowed: [503],
    }));

  // ── Ingestion admin ───────────────────────────────────────────────────────

  it('POST /ingestion/trigger', () =>
    hit('POST', `${API}/ingestion/trigger`, { token: 'user', allowed: [200] }));

  // ── Jobs ──────────────────────────────────────────────────────────────────

  it('GET /jobs/status', () =>
    hit('GET', `${API}/jobs/status`, {
      headers: { 'X-Api-Key': API_KEY },
      allowed: [200],
    }));

  it('GET /jobs/product-refresh (method warning)', () =>
    hit('GET', `${API}/jobs/product-refresh`, { allowed: [405] }));

  const jobPosts = [
    'product-refresh',
    'product-ingestion',
    'creative-ingestion',
    'live-monitor-discover',
    'stale-cleanup',
  ] as const;

  it.each(jobPosts)('POST /jobs/%s', (job) =>
    hit('POST', `${API}/jobs/${job}`, {
      headers: { 'X-Api-Key': API_KEY },
      allowed: [200, 202, 409, 503],
    }),
  );

  // ── Admin ─────────────────────────────────────────────────────────────────

  it('GET /admin/health', () =>
    hit('GET', `${API}/admin/health`, { token: 'admin', allowed: [200] }));

  it('GET /admin/analytics/users', () =>
    hit('GET', `${API}/admin/analytics/users`, { token: 'admin', allowed: [200] }));

  it('GET /admin/analytics/products', () =>
    hit('GET', `${API}/admin/analytics/products?market=US`, { token: 'admin', allowed: [200] }));

  it('GET /admin/analytics/creatives', () =>
    hit('GET', `${API}/admin/analytics/creatives?market=US`, { token: 'admin', allowed: [200] }));

  it('GET /admin/users', () =>
    hit('GET', `${API}/admin/users`, { token: 'admin', allowed: [200] }));

  it('PATCH /admin/users/:id/status', () =>
    hit('PATCH', `${API}/admin/users/${userId}/status`, {
      token: 'admin',
      body: { status: 'active' },
      allowed: [200],
    }));

  it('GET /admin/products', () =>
    hit('GET', `${API}/admin/products?market=US`, { token: 'admin', allowed: [200] }));

  it('GET /admin/transactions', () =>
    hit('GET', `${API}/admin/transactions`, { token: 'admin', allowed: [200] }));

  it('GET /admin/waitlist', () =>
    hit('GET', `${API}/admin/waitlist`, { token: 'admin', allowed: [200] }));

  // ── Billing ───────────────────────────────────────────────────────────────

  it('GET /billing/plans', () =>
    hit('GET', `${API}/billing/plans`, { token: 'user', allowed: [200] }));

  it('GET /billing/stripe-config', () =>
    hit('GET', `${API}/billing/stripe-config`, { token: 'user', allowed: [200, 503] }));

  it('GET /billing/subscription', () =>
    hit('GET', `${API}/billing/subscription`, { token: 'user', allowed: [200] }));

  it('GET /billing/transactions', () =>
    hit('GET', `${API}/billing/transactions`, { token: 'user', allowed: [200] }));

  it('POST /billing/checkout', () =>
    hit('POST', `${API}/billing/checkout`, {
      token: 'user',
      body: { plan: 'pro' },
      allowed: [200, 400, 503],
    }));

  // ── Waitlist ──────────────────────────────────────────────────────────────

  it('POST /waitlist', () =>
    hit('POST', `${API}/waitlist`, {
      token: 'user',
      body: { email: `waitlist-${Date.now()}@validds.test` },
      allowed: [200, 201],
    }));

  // ── Stores / Shopify ──────────────────────────────────────────────────────

  it('GET /stores/shopify/status', () =>
    hit('GET', `${API}/stores/shopify/status`, { token: 'user', allowed: [200] }));

  it('GET /stores/shopify/install', () =>
    hit('GET', `${API}/stores/shopify/install?shop=test.myshopify.com`, {
      token: 'user',
      allowed: [200, 302, 400, 503],
    }));

  it('GET /stores/shopify/callback', () =>
    hit('GET', `${API}/stores/shopify/callback?shop=test.myshopify.com&code=abc`, {
      allowed: [200, 302, 400, 401, 403, 503],
    }));

  it('POST /stores/shopify/disconnect', () =>
    hit('POST', `${API}/stores/shopify/disconnect`, { token: 'user', allowed: [200, 404] }));

  it('POST /stores/shopify/claim', () =>
    hit('POST', `${API}/stores/shopify/claim`, {
      token: 'user',
      body: { shop: 'test.myshopify.com' },
      allowed: [200, 400, 404],
    }));

  it('POST /stores/shopify/products', () =>
    hit('POST', `${API}/stores/shopify/products`, {
      token: 'user',
      body: { productId, market: 'US' },
      allowed: [200, 400, 404, 503],
    }));

  // ── TikTok ────────────────────────────────────────────────────────────────

  it('GET /tiktok/live/discover', () =>
    hit('GET', `${API}/tiktok/live/discover`, { token: 'user', allowed: [200] }));

  it('POST /tiktok/live/reconcile', () =>
    hit('POST', `${API}/tiktok/live/reconcile`, {
      token: 'user',
      allowed: [200, 503],
    }));

  it('GET /tiktok/live', () =>
    hit('GET', `${API}/tiktok/live?handle=testcreator`, {
      token: 'admin',
      allowed: [200, 400, 502, 503],
    }));

  it('GET /tiktok/live/batch', () =>
    hit('GET', `${API}/tiktok/live/batch?handles=testcreator`, {
      token: 'admin',
      allowed: [200, 400, 502, 503],
    }));

  it('GET /tiktok/live/products', () =>
    hit('GET', `${API}/tiktok/live/products?handle=testcreator`, {
      token: 'admin',
      allowed: [200, 400, 502, 503],
    }));

  it('GET /tiktok/sessions', () =>
    hit('GET', `${API}/tiktok/sessions`, { token: 'admin', allowed: [200] }));

  it('GET /tiktok/sessions/:id', () =>
    hit('GET', `${API}/tiktok/sessions/${new Types.ObjectId()}`, {
      token: 'admin',
      allowed: [404],
    }));

  // ── Auth guards (routes must exist, not 404) ──────────────────────────────

  it('GET /admin/users without token', () => hit('GET', `${API}/admin/users`, { allowed: [401] }));

  it('GET /jobs/status without api key', () =>
    hit('GET', `${API}/jobs/status`, { allowed: [401, 403] }));
});
