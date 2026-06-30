/** Valid product payload for POST /internal/ingest/product (passes validateProductForIngest). */

import { MIN_TOTAL_GMV } from '../../src/api/internal/ingest-quality';

function dayMetricTrend(value: number) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    direction: 'stable' as const,
    changePercent: 0,
    windows: [{ label: today, daysAgo: 0, value }],
  };
}

export function minimalIngestProduct(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const now = new Date();
  const metricWindow = dayMetricTrend(1);
  const base = {
    externalId: `ingest-test-${Date.now()}`,
    source: 'tiktok',
    status: 'review',
    title: 'Integration Test Product Title',
    normalizedTitle: 'integration test product title',
    description: 'A'.repeat(50),
    categoryL1: 'Beauty & Personal Care',
    categoryL2: 'Skincare',
    categoryL3: 'Face Serums',
    categoryPath: 'Beauty & Personal Care > Skincare > Face Serums',
    hashtags: ['#skincare'],
    discoverySections: ['tiktok_shop'],
    ratingSources: [
      {
        platform: 'Shop',
        rating: 4.5,
        reviewCount: 10,
        sourceUrl: 'https://example.com/p',
        fetchedAt: now,
      },
    ],
    shopName: 'Shop',
    shopUrl: 'https://example.com/shop',
    shopAvatarUrl: 'https://example.com/shop.jpg',
    price: 20,
    currency: 'USD',
    rating: 4.5,
    soldCount: 500,
    totalGmv: MIN_TOTAL_GMV,
    viewCount: 5000,
    likeCount: 100,
    lastIngestedAt: now,
    dataSourceUpdatedAt: now,
    imageUrls: [
      'https://example.com/1.jpg',
      'https://example.com/2.jpg',
      'https://example.com/3.jpg',
    ],
    primaryCreator: {
      handle: 'creator1',
      tiktokUserId: 'creator1',
      bio: 'Creator bio',
      avatarS3Key: 'validds/creator-assets/avatars/us/creator1.jpg',
      tiktokPostUrl: 'https://www.tiktok.com/@creator1/video/1',
    },
    reviews: Array.from({ length: 10 }, (_, i) => ({
      content: `Review number ${i} with enough text`,
      author: 'user',
    })),
    priceTrend: dayMetricTrend(20),
    salesTrend: metricWindow,
    revenueTrend: metricWindow,
    trends: {
      engagement: {
        score: 3.5,
        direction: 'stable',
        reason: 'Engagement from TikTok discovery metrics.',
        isTrending: false,
        calculatedAt: now,
      },
    },
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
      {
        source: 'apify_store_leads',
        platform: 'Shopify',
        externalId: 'sup-1',
        title: 'Competitor product',
        productUrl: 'https://shop.example.com/products/a',
        shareUrl: 'https://shop.example.com/products/a',
        fetchedAt: now,
        monthlyTraffic: 10_000,
      },
      {
        source: 'apify_store_leads',
        platform: 'Shopify',
        externalId: 'sup-2',
        title: 'Competitor product 2',
        productUrl: 'https://shop.example.com/products/b',
        shareUrl: 'https://shop.example.com/products/b',
        fetchedAt: now,
        monthlyTraffic: 20_000,
      },
      {
        source: 'apify_store_leads',
        platform: 'Shopify',
        externalId: 'sup-3',
        title: 'Competitor product 3',
        productUrl: 'https://shop.example.com/products/c',
        shareUrl: 'https://shop.example.com/products/c',
        fetchedAt: now,
        monthlyTraffic: 30_000,
      },
    ],
    aiIntelligence: {
      confidence: 50,
      confidenceReason: 'Product intelligence from TikTok Shop listing.',
      buyingSentimentScore: 50,
      buyingSentimentLabel: 'positive',
      buyingSentimentReason: 'Strong purchase intent in reviews.',
      brand: 'Shop',
      niche: 'Beauty',
      productType: 'unknown',
      priceBand: 'mid-range',
      audience: ['general'],
      categoryKeywords: ['beauty'],
      problemStatement: 'Customers need better skincare results.',
      valueStatement: 'Delivers visible results fast.',
      extractedAt: now,
      reviewSummary: { summary: 'Good product reviews overall', generatedAt: now },
      marketingAnalysis: {
        primaryGender: 'unisex',
        incomeLevel: 'mid-range',
        purchaseIntent: 'considered',
        contentFormat: 'lifestyle',
        marketingInsight: 'Strong social proof on TikTok.',
        sentimentLabel: 'positive',
        topAgeGroups: ['18-34'],
        topRegions: ['United States'],
        accessibilityTags: ['general'],
        lifestyleSegments: ['general consumer'],
        analyzedAt: now,
        angles: Array.from({ length: 5 }, (_, i) => ({
          hook: `Hook ${i}`,
          body: `Body ${i}`,
          target: `Target ${i}`,
          videoUrl: i < 2 ? `https://www.tiktok.com/@c/video/${i}` : undefined,
        })),
      },
    },
  };
  return { ...base, ...overrides };
}

export function minimalIngestCreative(
  productId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const now = new Date();
  return {
    externalVideoId: `meta:ingest-test-${Date.now()}`,
    productId,
    tiktokPostUrl: 'https://www.facebook.com/ads/library/?id=123456',
    videoS3Key: 'brightdata/meta-videos/123456.mp4',
    thumbnailUrl: 'https://example.com/t.jpg',
    creator: { handle: 'page', avatarUrl: 'https://example.com/a.jpg' },
    productRating: 4.0,
    publishedAt: now,
    ...overrides,
  };
}
