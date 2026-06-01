import { MongoMemoryServer } from 'mongodb-memory-server';
import type { Server } from 'http';
import http from 'http';
import { minimalTestProduct } from './helpers/minimal-product.fixture';
import { getSeededTestMarketModels } from './helpers/market-test-models';

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
          ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode ?? 0, text: raw });
        });
      },
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
    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'error';

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
      contentRegion: 'US',
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

  it('GET /api/v1/products search ranks by relevance, not sortBy', async () => {
    const { Product } = await getSeededTestMarketModels();
    await Product.create([
      minimalTestProduct({
        externalId: 'search_high_gmv',
        source: 'tiktok',
        status: 'active',
        title: 'Classic Adult Serum Volume',
        normalizedTitle: 'classic adult serum volume',
        description: 'Classic adult skincare',
        categoryL1: 'Beauty & Personal Care',
      }),
      minimalTestProduct({
        externalId: 'search_exact',
        source: 'tiktok',
        status: 'active',
        title: 'Adult Classic Unfurgettable Lined Clogs',
        normalizedTitle: 'adult classic unfurgettable lined clogs',
        description: 'Crocs Classic Fuzzy lined clogs',
        categoryL1: 'Shoes',
        totalGmv: 1500,
      }),
    ]);
    await Product.syncIndexes();

    const res = await httpJson({
      baseUrl,
      method: 'GET',
      path: '/api/v1/products?q=Adult+Classic+Unfurgettable+Lined+Clogs&sortBy=gmv_desc&limit=12',
      token: testToken,
    });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.text);
    const titles: string[] = body.data.products.map((p: { title: string }) => p.title);
    expect(titles[0]).toBe('Adult Classic Unfurgettable Lined Clogs');
    expect(titles).not.toContain('Classic Adult Serum Volume');
  });

  it('GET /api/v1/products should return correctly formatted products and strip AI internals', async () => {
    const { Product } = await getSeededTestMarketModels();
    await Product.create(
      minimalTestProduct({
        externalId: 'vid_primary_1',
        source: 'tiktok',
        status: 'active',
        title: 'Clip Hair Curler',
        normalizedTitle: 'clip hair curler',
        description: 'Sample product',
        hashtags: ['beautyfinds'],
        categoryL1: 'Beauty & Personal Care',
        categoryL2: 'Hair Care',
        categoryL3: 'Hair Styling Tools',
        categoryPath: 'Beauty & Personal Care / Hair Care / Hair Styling Tools',
        primaryImageUrl: 'https://example.com/image.jpg',
        imageUrls: ['https://example.com/image.jpg'],
        price: 24.99,
        viewCount: 120000,
        likeCount: 12000,
        commentCount: 900,
        shareCount: 600,
        engagementRate: 11.25,
        primaryCreator: {
          handle: 'creator1',
          displayName: 'Creator One',
          followers: 500000,
          region: 'US',
          verified: true,
          avatarUrl: 'https://example.com/creator1.jpg',
          primaryImageUrl: 'https://example.com/creator1.jpg',
          tiktokPostUrl: 'https://www.tiktok.com/@creator1/video/vid_primary_1',
        },
        discoverySections: ['trending'],
        trends: {
          engagement: {
            score: 5,
            direction: 'rising',
            reason: 'Strong cross-creator velocity',
            isTrending: true,
            calculatedAt: new Date(),
          },
          priceHistory: [],
        },
        creativeCounts: { ads: 0, organic: 2, reviews: 0, total: 2 },
        aiIntelligence: {
          confidence: 90,
          confidenceReason: 'High confidence from clear product framing',
          buyingSentimentScore: 88,
          buyingSentimentReason: 'Comments ask where to buy',
          brand: 'Test Brand',
          extractedAt: new Date(),
          niche: 'beauty',
          productType: 'evergreen',
          priceBand: 'mid-range',
          audience: ['shoppers'],
          categoryKeywords: [],
          problemStatement: 'Test',
          valueStatement: 'Test',
          reviewSummary: { summary: 'Good', generatedAt: new Date() },
          marketingAnalysis: {
            primaryGender: 'unisex',
            topAgeGroups: ['18-24'],
            topRegions: ['US'],
            accessibilityTags: [],
            lifestyleSegments: [],
            incomeLevel: 'mid-range',
            purchaseIntent: 'considered',
            contentFormat: 'review',
            marketingInsight: 'Test',
            angles: [],
            analyzedAt: new Date(),
          },
        },
      }),
    );

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
    expect(firstProduct.categoryPath).toBe(
      'Beauty & Personal Care / Hair Care / Hair Styling Tools',
    );
    expect(firstProduct.primaryCreator.handle).toBe('creator1');
    expect(firstProduct.primaryCreator.primaryImageUrl).toBe('https://example.com/creator1.jpg');
    expect(firstProduct.primaryCreator.avatarUrl).toBe('https://example.com/creator1.jpg');
    expect(firstProduct.trend.isTrending).toBe(true);
    expect(firstProduct.priceTrend).toBeDefined();
    expect(firstProduct.priceTrend?.windows?.length).toBeGreaterThan(0);
    expect(firstProduct.salesTrend).toBeDefined();

    // Assert internal AI structure is shielded as formatted in controller
    expect(firstProduct.aiExtraction).toBeUndefined(); // Obsolete field shouldn't exist
    expect(firstProduct.aiInsight).toBeDefined(); // Controller standardizes it as aiInsight
    expect(firstProduct.aiInsight.confidence.score).toBe(90);
  });

  it('GET /api/v1/products/:id should handle ID properly', async () => {
    const res = await httpJson({
      baseUrl,
      method: 'GET',
      path: '/api/v1/products/507f1f77bcf86cd799439011',
      token: testToken,
    });
    // Valid ObjectId format but no matching product
    expect(res.status).toBe(404);
  });
});
