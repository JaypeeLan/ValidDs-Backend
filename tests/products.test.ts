import { MongoMemoryServer } from 'mongodb-memory-server';
import type { Server } from 'http';
import http from 'http';
import { minimalTestProduct } from './helpers/minimal-product.fixture';
import { minimalTestCreative } from './helpers/minimal-creative.fixture';
import { getSeededTestMarketModels } from './helpers/market-test-models';

async function attachPlayableCreatives(
  products: Array<{ _id?: unknown } | null | undefined>,
): Promise<void> {
  const { Creative } = await getSeededTestMarketModels();
  const docs = products
    .filter((p): p is { _id: unknown } => p != null && p._id != null)
    .map((p, index) =>
      minimalTestCreative({
        productId: p._id,
        externalVideoId: `vid_test_${String(p._id)}_${index}`,
      }),
    );
  if (docs.length > 0) {
    await Creative.create(docs);
  }
}

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
    const searchProducts = await Product.create([
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
    await attachPlayableCreatives(searchProducts);
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
    const clipProduct = await Product.create(
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
        originalPrice: 34.99,
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
    await attachPlayableCreatives([clipProduct]);

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
    expect(firstProduct.originalPrice).toBe(34.99);
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

  it('GET /api/v1/products filters OR across multiple subcategories (comma-separated)', async () => {
    const { Product } = await getSeededTestMarketModels();
    const prefix = 'MultiSub OR';
    const multiSubProducts = await Product.create([
      minimalTestProduct({
        externalId: 'ms_or_skincare',
        source: 'tiktok',
        title: `${prefix} Skincare item`,
        normalizedTitle: 'multisub or skincare item',
        categoryL1: 'Beauty & Personal Care',
        categoryL2: 'Skincare',
        categoryPath: 'Beauty & Personal Care > Skincare > Face Serums',
        totalGmv: 12_000,
      }),
      minimalTestProduct({
        externalId: 'ms_or_hair',
        source: 'tiktok',
        title: `${prefix} Hair item`,
        normalizedTitle: 'multisub or hair item',
        categoryL1: 'Beauty & Personal Care',
        categoryL2: 'Hair Care',
        categoryPath: 'Beauty & Personal Care > Hair Care > Shampoo & Conditioner',
        totalGmv: 11_000,
      }),
      minimalTestProduct({
        externalId: 'ms_or_fragrance',
        source: 'tiktok',
        title: `${prefix} Fragrance item`,
        normalizedTitle: 'multisub or fragrance item',
        categoryL1: 'Beauty & Personal Care',
        categoryL2: 'Fragrance',
        categoryPath: 'Beauty & Personal Care > Fragrance > Perfume',
        totalGmv: 99_000,
      }),
    ]);
    await attachPlayableCreatives(multiSubProducts);

    const category = encodeURIComponent('Beauty & Personal Care');
    const subcategory = encodeURIComponent('Skincare,Hair Care');
    const res = await httpJson({
      baseUrl,
      method: 'GET',
      path: `/api/v1/products?category=${category}&subcategory=${subcategory}&limit=100&sortBy=gmv_desc`,
      token: testToken,
    });

    expect(res.status).toBe(200);
    const body = JSON.parse(res.text);
    const matched = (body.data.products as { title: string; categoryPath?: string }[]).filter((p) =>
      p.title.startsWith(prefix),
    );
    const titles = matched.map((p) => p.title).sort();
    expect(titles).toEqual([`${prefix} Hair item`, `${prefix} Skincare item`]);
    for (const p of matched) {
      expect(p.categoryPath).toMatch(/Skincare|Hair Care/);
    }
  });

  it('GET /api/v1/products filters OR across repeated subcategory query params', async () => {
    const { Product } = await getSeededTestMarketModels();
    const prefix = 'MultiSub Repeat';
    const repeatSubProducts = await Product.create([
      minimalTestProduct({
        externalId: 'ms_rep_skincare',
        source: 'tiktok',
        title: `${prefix} Skincare`,
        normalizedTitle: 'multisub repeat skincare',
        categoryL1: 'Beauty & Personal Care',
        categoryL2: 'Skincare',
        totalGmv: 8_000,
      }),
      minimalTestProduct({
        externalId: 'ms_rep_makeup',
        source: 'tiktok',
        title: `${prefix} Makeup`,
        normalizedTitle: 'multisub repeat makeup',
        categoryL1: 'Beauty & Personal Care',
        categoryL2: 'Makeup & Cosmetics',
        totalGmv: 7_500,
      }),
      minimalTestProduct({
        externalId: 'ms_rep_nail',
        source: 'tiktok',
        title: `${prefix} Nail`,
        normalizedTitle: 'multisub repeat nail',
        categoryL1: 'Beauty & Personal Care',
        categoryL2: 'Nail Care',
        totalGmv: 50_000,
      }),
    ]);
    await attachPlayableCreatives(repeatSubProducts);

    const category = encodeURIComponent('Beauty & Personal Care');
    const res = await httpJson({
      baseUrl,
      method: 'GET',
      path:
        `/api/v1/products?category=${category}` +
        '&subcategory=Skincare&subcategory=Makeup%20%26%20Cosmetics&limit=100',
      token: testToken,
    });

    expect(res.status).toBe(200);
    const body = JSON.parse(res.text);
    const titles = (body.data.products as { title: string }[])
      .filter((p) => p.title.startsWith(prefix))
      .map((p) => p.title)
      .sort();
    expect(titles).toEqual([`${prefix} Makeup`, `${prefix} Skincare`]);
    expect(titles).not.toContain(`${prefix} Nail`);
  });

  it('GET /api/v1/products/:id/related-products returns same L2 only with alias expansion', async () => {
    const { Product } = await getSeededTestMarketModels();
    const prefix = 'Related L2';
    const anchor = await Product.create(
      minimalTestProduct({
        externalId: 'rel_l2_anchor',
        source: 'tiktok',
        title: `${prefix} Anchor Lipstick`,
        normalizedTitle: 'related l2 anchor lipstick',
        categoryL1: 'Beauty & Personal Care',
        categoryL2: 'Makeup',
        categoryL3: 'Lipstick',
        categoryPath: 'Beauty & Personal Care > Makeup > Lipstick',
        totalGmv: 20_000,
      }),
    );
    const relatedProducts = await Product.create([
      minimalTestProduct({
        externalId: 'rel_l2_canonical',
        source: 'tiktok',
        title: `${prefix} Canonical Blush`,
        normalizedTitle: 'related l2 canonical blush',
        categoryL1: 'Beauty & Personal Care',
        categoryL2: 'Makeup & Cosmetics',
        categoryL3: 'Blush',
        totalGmv: 18_000,
      }),
      minimalTestProduct({
        externalId: 'rel_l2_wrong_l2',
        source: 'tiktok',
        title: `${prefix} Wrong L2 Shampoo`,
        normalizedTitle: 'related l2 wrong l2 shampoo',
        categoryL1: 'Beauty & Personal Care',
        categoryL2: 'Hair Care',
        totalGmv: 99_000,
      }),
      minimalTestProduct({
        externalId: 'rel_l2_dup_title',
        source: 'tiktok',
        title: `${prefix} Anchor Lipstick Duplicate`,
        normalizedTitle: 'related l2 anchor lipstick',
        categoryL1: 'Beauty & Personal Care',
        categoryL2: 'Makeup & Cosmetics',
        totalGmv: 50_000,
      }),
      minimalTestProduct({
        externalId: 'rel_l2_invalid',
        source: 'tiktok',
        status: 'invalid',
        title: `${prefix} Invalid Status`,
        normalizedTitle: 'related l2 invalid status',
        categoryL1: 'Beauty & Personal Care',
        categoryL2: 'Makeup & Cosmetics',
        totalGmv: 40_000,
      }),
    ]);
    await attachPlayableCreatives([anchor, ...relatedProducts]);

    const id = String(anchor._id);
    const res = await httpJson({
      baseUrl,
      method: 'GET',
      path: `/api/v1/products/${id}/related-products`,
      token: testToken,
    });

    expect(res.status).toBe(200);
    const body = JSON.parse(res.text);
    const titles = (body.data.relatedProducts as { title: string }[])
      .filter((p) => p.title.startsWith(prefix))
      .map((p) => p.title);
    expect(titles).toEqual([`${prefix} Canonical Blush`]);
    expect(titles).not.toContain(`${prefix} Wrong L2 Shampoo`);
    expect(titles).not.toContain(`${prefix} Anchor Lipstick Duplicate`);
    expect(titles).not.toContain(`${prefix} Invalid Status`);
  });

  it('GET /api/v1/products/compare should return basic info and AI comparison', async () => {
    const { Product } = await getSeededTestMarketModels();
    const [productA, productB, productInvalid] = await Product.create([
      minimalTestProduct({
        externalId: 'compare_a',
        source: 'tiktok',
        status: 'active',
        title: 'Compare Product A',
        normalizedTitle: 'compare product a',
        categoryL1: 'Beauty & Personal Care',
        categoryL2: 'Makeup',
        price: 19.99,
        totalGmv: 12_000,
        totalSales: 600,
      }),
      minimalTestProduct({
        externalId: 'compare_b',
        source: 'tiktok',
        status: 'active',
        title: 'Compare Product B',
        normalizedTitle: 'compare product b',
        categoryL1: 'Beauty & Personal Care',
        categoryL2: 'Makeup',
        price: 29.99,
        totalGmv: 8_000,
        totalSales: 400,
      }),
      minimalTestProduct({
        externalId: 'compare_invalid',
        source: 'tiktok',
        status: 'invalid',
        title: 'Compare Invalid Product',
        normalizedTitle: 'compare invalid product',
        categoryL1: 'Beauty & Personal Care',
        categoryL2: 'Makeup',
      }),
    ]);
    await attachPlayableCreatives([productA, productB, productInvalid]);

    const idA = String(productA._id);
    const idB = String(productB._id);
    const idInvalid = String(productInvalid._id);
    const missingId = '507f1f77bcf86cd799439099';

    const res = await httpJson({
      baseUrl,
      method: 'GET',
      path: `/api/v1/products/compare?ids=${idA},${idB},${idInvalid},${missingId}`,
      token: testToken,
    });

    expect(res.status).toBe(200);
    const body = JSON.parse(res.text);
    const titles = (body.data.products as { title: string }[]).map((p) => p.title);
    expect(titles).toEqual(['Compare Product A', 'Compare Product B']);
    expect(body.data.notFound).toEqual(expect.arrayContaining([idInvalid, missingId]));
    expect(body.data.products[0]).toMatchObject({
      id: idA,
      title: 'Compare Product A',
      price: 19.99,
      totalGmv: 12_000,
      categoryL1: 'Beauty & Personal Care',
      categoryL2: 'Makeup',
    });
    expect(body.data.products[0].imageUrls).toBeUndefined();
    expect(body.data.analysis).toBeDefined();
    expect(body.data.analysis.summary).toEqual(expect.any(String));
    expect(body.data.analysis.products.length).toBeGreaterThanOrEqual(2);
    expect(body.data.analysis.dimensions.length).toBeGreaterThan(0);
  });

  it('GET /api/v1/products/compare should validate ID count', async () => {
    const res = await httpJson({
      baseUrl,
      method: 'GET',
      path: '/api/v1/products/compare?ids=507f1f77bcf86cd799439011',
      token: testToken,
    });
    expect(res.status).toBe(400);
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
