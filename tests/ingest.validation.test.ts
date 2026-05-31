import {
  BASELINE_INGEST,
  INGEST_QUALITY,
  validateCreativeForIngest,
  validateMetaCreativeForIngest,
  validateProductForIngest,
} from '../src/api/internal/ingest.validation';

function minimalProduct(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date();
  const metricWindow = {
    direction: 'stable',
    changePercent: 0,
    windows: [{ label: 'Now', daysAgo: 0, monthsAgo: 0, value: 1 }],
  };
  return {
    externalId: 'ext-1',
    source: 'tiktok',
    title: 'Test Product Title Here',
    description: 'A'.repeat(50),
    categoryL1: 'Beauty & Personal Care',
    categoryL2: 'Skincare',
    categoryL3: 'Face Serums',
    categoryPath: 'Beauty & Personal Care > Skincare > Face Serums',
    shopName: 'Shop',
    shopUrl: 'https://example.com/shop',
    shopAvatarUrl: 'https://example.com/shop.jpg',
    price: 20,
    currency: 'USD',
    rating: 4.5,
    soldCount: 500,
    totalGmv: 10_000,
    viewCount: 5000,
    imageUrls: ['https://example.com/1.jpg', 'https://example.com/2.jpg', 'https://example.com/3.jpg'],
    primaryCreator: {
      handle: 'creator1',
      avatarUrl: 'https://example.com/c.jpg',
      tiktokPostUrl: 'https://www.tiktok.com/@creator1/video/1',
    },
    reviews: Array.from({ length: 10 }, (_, i) => ({
      content: `Review number ${i} with enough text`,
      author: 'user',
    })),
    priceTrend: metricWindow,
    salesTrend: metricWindow,
    revenueTrend: metricWindow,
    storeGmv: 5000,
    shopFollowers: 100,
    accountHandle: 'shop',
    accountKind: 'store',
    postCreatedAt: now.toISOString(),
    publishedAt: now,
    postUrl: 'https://www.tiktok.com/@creator1/video/1',
    productUrl: 'https://example.com/p',
    market: 'US',
    creativeCounts: { ads: 0, organic: 1, reviews: 0, total: 1 },
    suppliers: [
      { monthlyTraffic: 10_000 },
      { monthlyTraffic: 20_000 },
      { monthlyTraffic: 30_000 },
    ],
    aiIntelligence: {
      reviewSummary: { summary: 'Good product reviews overall' },
      marketingAnalysis: {
        angles: Array.from({ length: 5 }, (_, i) => ({
          hook: `Hook ${i}`,
          body: `Body ${i}`,
          target: `Target ${i}`,
          videoUrl: i < 2 ? `https://www.tiktok.com/@c/video/${i}` : undefined,
        })),
      },
    },
    ...overrides,
  };
}

describe('validateProductForIngest', () => {
  it('accepts a fully valid product', () => {
    expect(validateProductForIngest(minimalProduct(), 'US')).toEqual([]);
  });

  it('enforces baseline and strict soldCount', () => {
    const zeroSold = validateProductForIngest(minimalProduct({ soldCount: 0 }), 'US');
    expect(zeroSold).toContain(`soldCount must be >= ${BASELINE_INGEST.MIN_SOLD_COUNT}`);
    expect(zeroSold).toContain(`soldCount must be >= ${INGEST_QUALITY.MIN_UNITS_SOLD}`);

    const lowSold = validateProductForIngest(minimalProduct({ soldCount: 50 }), 'US');
    expect(lowSold).not.toContain(`soldCount must be >= ${BASELINE_INGEST.MIN_SOLD_COUNT}`);
    expect(lowSold).toContain(`soldCount must be >= ${INGEST_QUALITY.MIN_UNITS_SOLD}`);

    expect(validateProductForIngest(minimalProduct({ totalGmv: 100 }), 'US')).toEqual([]);
  });

  it('enforces reviews, angles, and suppliers', () => {
    const noReviews = validateProductForIngest(minimalProduct({ reviews: [] }), 'US');
    expect(noReviews).toContain(`need at least ${BASELINE_INGEST.MIN_REVIEWS} review`);
    expect(noReviews).toContain(`need at least ${INGEST_QUALITY.MIN_REVIEWS} reviews`);

    const fewAngles = validateProductForIngest(
      minimalProduct({
        aiIntelligence: {
          marketingAnalysis: { angles: [{ hook: 'h', body: 'b', target: 't' }] },
        },
      }),
      'US',
    );
    expect(fewAngles).toContain(`need at least ${INGEST_QUALITY.MIN_MARKETING_ANGLES} marketing angles`);

    const badAngle = validateProductForIngest(
      minimalProduct({
        aiIntelligence: {
          marketingAnalysis: {
            angles: [{ hook: 'only hook', body: '', target: '' }],
          },
        },
      }),
      'US',
    );
    expect(badAngle).toContain('marketing angle[0] must have hook, body, and target');

    const supplierReasons = validateProductForIngest(
      minimalProduct({ suppliers: [{ monthlyTraffic: 1 }] }),
      'US',
    );
    expect(
      supplierReasons.some((r) => r.startsWith(`need at least ${INGEST_QUALITY.MIN_SUPPLIERS} suppliers`)),
    ).toBe(true);

    const badTraffic = validateProductForIngest(
      minimalProduct({
        suppliers: [
          { monthlyTraffic: 0 },
          { monthlyTraffic: 10_000 },
          { monthlyTraffic: 20_000 },
        ],
      }),
      'US',
    );
    expect(badTraffic).toContain('supplier[0].monthlyTraffic must be > 0');
  });
});

describe('validateCreativeForIngest', () => {
  const now = new Date();
  const base = {
    externalVideoId: '123',
    productId: '507f1f77bcf86cd799439011',
    tiktokPostUrl: 'https://www.tiktok.com/@u/video/123',
    embedUrl: 'https://www.tiktok.com/embed/v2/123',
    thumbnailUrl: 'https://example.com/t.jpg',
    creator: { handle: 'u', avatarUrl: 'https://example.com/a.jpg' },
    metrics: { viewCount: 5000 },
    publishedAt: now,
    productRating: 4.5,
    productSalesTrend: {
      direction: 'stable',
      changePercent: 0,
      windows: [{ daysAgo: 0, value: 1 }],
    },
    relatedVideos: [
      { externalVideoId: '2', embedUrl: 'https://e/2', tiktokPostUrl: 'https://www.tiktok.com/@u/video/2', creator: { handle: 'u' }, metrics: {}, publishedAt: now },
      { externalVideoId: '3', embedUrl: 'https://e/3', tiktokPostUrl: 'https://www.tiktok.com/@u/video/3', creator: { handle: 'u' }, metrics: {}, publishedAt: now },
      { externalVideoId: '4', embedUrl: 'https://e/4', tiktokPostUrl: 'https://www.tiktok.com/@u/video/4', creator: { handle: 'u' }, metrics: {}, publishedAt: now },
    ],
  };

  it('requires at least 3 related videos for TikTok creatives', () => {
    const reasons = validateCreativeForIngest({ ...base, relatedVideos: [] });
    expect(reasons).toContain(`need at least ${INGEST_QUALITY.MIN_RELATED_VIDEOS} related videos`);
  });

  it('routes Meta creatives to meta rules (no related-video requirement)', () => {
    const meta = {
      externalVideoId: 'meta:123',
      productId: '507f1f77bcf86cd799439011',
      tiktokPostUrl: 'https://www.facebook.com/ads/library/?id=123',
      thumbnailUrl: 'https://example.com/t.jpg',
      creator: { handle: 'page', avatarUrl: 'https://example.com/a.jpg' },
      productRating: 4.0,
    };
    expect(validateCreativeForIngest(meta)).toEqual(validateMetaCreativeForIngest(meta));
    expect(validateCreativeForIngest(meta)).not.toContain(
      `need at least ${INGEST_QUALITY.MIN_RELATED_VIDEOS} related videos`,
    );
  });
});
