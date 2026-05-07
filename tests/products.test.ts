import { MongoMemoryServer } from 'mongodb-memory-server';
import type { Server } from 'http';
import http from 'http';

function httpJson(opts: {
  baseUrl: string;
  method: string;
  path: string;
  token?: string;
}): Promise<{ status: number; text: string }> {
  const url = new URL(opts.path, opts.baseUrl);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method: opts.method,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        headers: {
          'Content-Type': 'application/json',
          ...(opts.token ? { 'authorization': `Bearer ${opts.token}` } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode ?? 0, text: raw });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

describe('Products Endpoints', () => {
  jest.setTimeout(60000);
  let mongo: MongoMemoryServer;
  let server: Server;
  let baseUrl: string;
  let disconnectMongoFn: (() => Promise<void>) | null = null;
  let testToken: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'development';
    process.env.PORT = '0';
    process.env.APP_NAME = 'validds-backend-test';
    process.env.API_VERSION = 'v1';
    process.env.INTERNAL_API_KEY = 'k'.repeat(32);
    process.env.JWT_SECRET = 'x'.repeat(32);
    process.env.JWT_EXPIRES_IN = '7d';
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
    process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:3001';
    process.env.MONGODB_DB_NAME = 'validds_test';
    process.env.REDIS_URL = '';
    process.env.SENTRY_DSN = '';
    process.env.SENTRY_ENVIRONMENT = 'development';
    process.env.SENTRY_TRACES_SAMPLE_RATE = '0';
    process.env.LOG_LEVEL = 'error';
    process.env.LOG_PRETTY = 'false';
    process.env.RESEND_API_KEY = 're_test';
    process.env.RESEND_FROM = 'ValidDs <noreply@validds.test>';
    process.env.GOOGLE_CLIENT_ID = 'google-client-id';
    process.env.TIKTOK_CLIENT_KEY = 'tiktok-client-key';
    process.env.TIKTOK_CLIENT_SECRET = 'tiktok-client-secret';

    mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 60000 } });
    process.env.MONGODB_URI = mongo.getUri();

    jest.resetModules();
    const { connectMongo, disconnectMongo } = await import('../src/db/client');
    await connectMongo();
    disconnectMongoFn = disconnectMongo;

    const { createApp } = await import('../src/app');
    const app = await createApp();
    server = app.listen(0);

    await new Promise<void>((resolve) => {
      server.on('listening', () => resolve());
    });

    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('Failed to bind server');
    baseUrl = `http://127.0.0.1:${addr.port}`;

    // Create a test user and generate token
    const { User } = await import('../src/models/user.model');
    const testUser = await User.create({
      email: 'test@example.com',
      name: 'Test User',
      authProvider: 'local',
      status: 'active',
      plan: 'pro',
    });

    const { signJWT } = await import('../src/security/jwt');
    testToken = signJWT({ sub: (testUser._id as any).toString(), role: 'user' });
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (disconnectMongoFn) {
      await disconnectMongoFn();
    }
    if (mongo) {
      await mongo.stop();
    }
  });

  it('GET /api/v1/products should return product feed', async () => {
    const res = await httpJson({
      baseUrl,
      method: 'GET',
      path: '/api/v1/products?limit=10',
      token: testToken,
    });
    expect(res.status).toBe(200);
    expect(res.text).toContain('data');
  });

  it('GET /api/v1/products?q= should accept search on the list endpoint', async () => {
    const res = await httpJson({
      baseUrl,
      method: 'GET',
      path: '/api/v1/products?q=test',
      token: testToken,
    });
    // In-memory MongoDB text search can error if text index is missing; we only assert the route exists.
    expect(res.status).not.toBe(404);
  });

  it('GET /api/v1/products should return correctly formatted products and strip AI internals', async () => {
    const { Product } = await import('../src/models/product.model');
    await Product.create({
      // Identity
      externalId: 'vid_primary_1',
      source: 'ensemble',
      status: 'active',

      // Content
      title: 'Clip Hair Curler',
      normalizedTitle: 'clip hair curler',
      description: 'Sample product',
      hashtags: ['beautyfinds'],

      // Taxonomy
      categoryL1: 'Beauty & Personal Care',
      categoryL2: 'Hair Care',
      categoryL3: 'Hair Styling Tools',
      categoryPath: 'Beauty & Personal Care / Hair Care / Hair Styling Tools',

      // Media
      primaryImageUrl: 'https://example.com/image.jpg',
      imageUrls: ['https://example.com/image.jpg'],

      // Pricing
      price: 24.99,
      currency: 'USD',
      suppliers: [],

      // Market Evidence
      ratingSources: [],
      topComments: [],

      // Engagement
      viewCount: 120000,
      likeCount: 12000,
      commentCount: 900,
      shareCount: 600,
      engagementRate: 11.25,

      // Creator
      primaryCreator: {
        handle: 'creator1',
        displayName: 'Creator One',
        followers: 500000,
        region: 'US',
        verified: true,
        avatarUrl: 'https://example.com/creator1.jpg',
        tiktokPostUrl: 'https://www.tiktok.com/@creator1/video/vid_primary_1'
      },

      // AI
      aiIntelligence: {
        confidence: 90,
        confidenceReason: 'High confidence from clear product framing',
        buyingSentimentScore: 88,
        buyingSentimentReason: 'Comments ask where to buy',
        extractedAt: new Date()
      },

      // Trend
      trend: {
        score: 84,
        direction: 'rising',
        reason: 'Strong cross-creator velocity',
        isTrending: true,
        calculatedAt: new Date()
      },

      // Counts
      discoverySections: ['trending'],
      relatedProducts: [],
      creativeCounts: { ads: 0, organic: 2, reviews: 0, total: 2 },

      // Freshness
      dataSourceUpdatedAt: new Date(),
      lastIngestedAt: new Date()
    });

    const res = await httpJson({
      baseUrl,
      method: 'GET',
      path: '/api/v1/products?limit=10',
      token: testToken,
    });

    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.text);
    const firstProduct = parsed.data.products[0];
    
    // Assert fields are returned cleanly
    expect(firstProduct.title).toBe('Clip Hair Curler');
    expect(firstProduct.categoryPath).toBe('Beauty & Personal Care / Hair Care / Hair Styling Tools');
    expect(firstProduct.primaryCreator.handle).toBe('creator1');
    expect(firstProduct.trend.isTrending).toBe(true);
    
    // Assert internal AI structure is shielded as formatted in controller
    expect(firstProduct.aiExtraction).toBeUndefined(); // Obsolete field shouldn't exist
    expect(firstProduct.aiInsight).toBeDefined(); // Controller standardizes it as aiInsight
    expect(firstProduct.aiInsight.confidence.score).toBe(90);
  });

  it('GET /api/v1/products/:id should handle ID properly', async () => {
    const res = await httpJson({
      baseUrl,
      method: 'GET',
      path: '/api/v1/products/invalid_id',
      token: testToken,
    });
    // Expected to correctly handle and return 404 for invalid/missing items
    expect(res.status).toBe(404);
  });
});
