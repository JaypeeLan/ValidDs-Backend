import mongoose from 'mongoose';
import { Product, IProductDocument, IProductModel } from '../../models/product.model';
import { logger } from '../../logger';
import { PRODUCT_CATEGORIES } from '../../api/products/product.constants';

const log = logger.child({ module: 'product-repository' });

// ── Generic title filtering ───────────────────────────────────────────────────

const GENERIC_PHRASES = [
  'amazon finds', 'amazon must-haves', 'amazon must haves', 'amazon home finds',
  'trending amazon products', 'viral products', 'tiktok finds',
  'tiktok made me buy it', 'must haves', 'must-haves', 'dropshipping products',
  'unknown product', 'product name', 'things you need', 'buy this',
  'beauty products', 'home products', 'tech products', 'kitchen products',
];

const GENERIC_TITLE_PATTERNS: RegExp[] = [
  /^(trending|top|best|viral|tiktok)\s+(amazon|tiktok)\s+(products|finds|deals?|must[- ]haves?)/i,
  /^(amazon|tiktok)\s+(finds|products|deals|must[- ]haves?)/i,
  /^(dropshipping|dropship)\s+(products|items|deals?)/i,
  /^(unknown|new)\s+(product|item)/i,
  /^(beauty|home|tech|kitchen|baby|pet)\s+products?$/i,
];

export function normalizeProductTitle(title: string): string {
  return title
    .trim()
    .replace(/[\u2018\u2019\u201C\u201D]/g, "'")
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function isGenericTitle(title: string): boolean {
  if (!title || title.trim().length < 3) return true;
  const normalized = normalizeProductTitle(title);
  if (GENERIC_PHRASES.some(p => normalized.includes(p))) return true;
  return GENERIC_TITLE_PATTERNS.some(r => r.test(normalized));
}

// ── Input type ────────────────────────────────────────────────────────────────

/**
 * Shape passed from ProductEnricher to upsertEnrichedProduct.
 * Represents fully-enriched data ready to be persisted.
 */
export interface EnrichedProductInput {
  // Identity (TikTok post)
  videoId: string;
  source: string;
  hashtags: string[];
  publishedAt?: Date;
  collectedAt: Date;

  // TikTok engagement from original post
  viewCount: number;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  engagementRate?: number;
  videoPlayUrl?: string;
  thumbnailUrl?: string;
  isAd: boolean;

  // Content
  title: string;
  description: string;

  // Taxonomy (3-level)
  categoryL1: string;
  categoryL2?: string;
  categoryL3?: string;
  categoryPath: string;

  // Media (SerpApi-first)
  primaryImageUrl?: string;
  imageUrls: string[];

  // Pricing
  price?: number;
  currency: string;
  suppliers?: Array<{
    platform: string;
    productUrl?: string;
    price?: number;
    currency?: string;
    shippingDays?: number;
    moq?: number;
    checkedAt: Date;
  }>;

  // Market evidence
  salesEvidence?: {
    unitsSold: number;
    store: string;
    storeUrl?: string;
    timeframe?: string;
    fetchedAt: Date;
  };
  ratingSources?: Array<{
    platform: string;
    rating: number;
    reviewCount: number;
    sourceUrl?: string;
    fetchedAt: Date;
  }>;
  rating?: number;
  reviewCount?: number;
  topComments?: Array<{
    comment: string;
    text: string;
    likeCount: number;
    authorHandle?: string;
    sentiment: 'positive' | 'negative' | 'neutral';
    source: string;
    collectedAt: Date;
  }>;

  // Discovery origin (from TikTok post)
  primaryCreator: {
    tiktokUserId?: string;
    handle: string;
    displayName?: string;
    bio?: string;
    followers?: number;
    following?: number;
    totalLikes?: number;
    region?: string;
    verified?: boolean;
    avatarUrl?: string;
    tiktokPostUrl: string;
  };

  // AI intelligence
  aiIntelligence: {
    confidence: number;
    confidenceReason: string;
    brand?: string;
    categoryKeywords: string[];
    buyingSentimentScore?: number;
    buyingSentimentReason?: string;
    extractedAt: Date;
  };

  // Trend
  trend: {
    score: number;
    direction: string;
    reason?: string;
    isTrending: boolean;
    calculatedAt: Date;
  };

  // Discovery sections (populated after discovery service)
  discoverySections?: string[];
  relatedProducts?: Array<{
    title: string;
    price?: string;
    thumbnail?: string;
    link?: string;
    store?: string;
  }>;
  creativeCounts?: {
    ads: number;
    organic: number;
    reviews: number;
    total: number;
  };
}

// ── Query filter types ────────────────────────────────────────────────────────

export interface ProductFeedFilters {
  category?: string[];
  section?: string;
  trendDirection?: string;
  minTrendScore?: number;
  minViews?: number;
  isAd?: boolean;
  page?: number;
  limit?: number;
  sortBy?: 'trendScore' | 'views' | 'recent' | 'engagement';
}

// ── Repository ────────────────────────────────────────────────────────────────

export const ProductRepository = {

  /**
   * Upsert an enriched product using videoId + source as the unique key.
   */
  async upsertEnrichedProduct(input: EnrichedProductInput): Promise<IProductDocument | null> {
    const title           = input.title.trim().slice(0, 120);
    const normalizedTitle = normalizeProductTitle(title);

    if (isGenericTitle(title)) {
      log.debug('Blocked generic title', { title });
      return null;
    }

    try {
      const doc = await (Product as any).findOneAndUpdate(
        { externalId: input.videoId, source: input.source },
        {
          $set: {
            // Identity
            externalId: input.videoId,
            source:     input.source,
            status:     'active',

            // Content
            title,
            normalizedTitle,
            description: input.description,
            hashtags:    input.hashtags,

            // Taxonomy
            categoryL1:   input.categoryL1,
            categoryL2:   input.categoryL2,
            categoryL3:   input.categoryL3,
            categoryPath: input.categoryPath,

            // Media
            primaryImageUrl: input.primaryImageUrl,
            imageUrls:       input.imageUrls,

            // Pricing
            price:     input.price,
            currency:  input.currency,
            suppliers: input.suppliers ?? [],

            // Market evidence
            rating:        input.rating,
            reviewCount:   input.reviewCount,
            salesEvidence: input.salesEvidence,
            ratingSources: input.ratingSources ?? [],

            // Social Proof
            topComments: input.topComments ?? [],

            // TikTok engagement
            viewCount:     input.viewCount,
            likeCount:     input.likeCount,
            commentCount:  input.commentCount,
            shareCount:    input.shareCount,
            engagementRate:input.engagementRate,

            // Discovery origin
            primaryCreator: input.primaryCreator,

            // AI intelligence
            aiIntelligence: input.aiIntelligence,

            // Trend
            trend: input.trend,

            // Discovery
            discoverySections: input.discoverySections ?? [],
            relatedProducts:   input.relatedProducts ?? [],
            creativeCounts:    input.creativeCounts ?? { ads: 0, organic: 0, reviews: 0, total: 0 },

            // Freshness
            lastIngestedAt:      new Date(),
            dataSourceUpdatedAt: input.collectedAt,
          },
        },
        { upsert: true, new: true }
      );

      log.debug('Enriched product upserted', { videoId: input.videoId, title });
      return doc;

    } catch (err: any) {
      if (err.code === 11000) {
        log.warn('Duplicate key on upsert — product already exists', { videoId: input.videoId });
        return Product.findOne({ externalId: input.videoId, source: input.source });
      }
      log.error('upsertEnrichedProduct failed', { err: String(err), videoId: input.videoId });
      return null;
    }
  },

  async findFeed(filters: ProductFeedFilters): Promise<import('../../utils/pagination.util').PaginatedResponse<IProductDocument>> {
    const page  = Math.max(1, filters.page ?? 1);
    const limit = Math.min(150, Math.max(1, filters.limit ?? 20));
    const skip  = (page - 1) * limit;

    const query: Record<string, unknown> = { status: 'active' };

    if (filters.category?.length)       query['categoryL1'] = { $in: filters.category };
    if (filters.trendDirection)         query['trend.direction'] = filters.trendDirection;
    if (filters.minTrendScore != null)  query['trend.score'] = { $gte: filters.minTrendScore };
    if (filters.minViews != null)       query['viewCount'] = { $gte: filters.minViews };
    if (filters.isAd != null)           query['adSignals.isAd'] = filters.isAd;
    if (filters.section)                query['discoverySections'] = filters.section;

    const sortMap: Record<string, Record<string, 1 | -1>> = {
      trendScore:  { 'trend.score': -1 },
      views:       { viewCount: -1 },
      recent:      { lastIngestedAt: -1 },
      engagement:  { engagementRate: -1 },
    };
    const sort = sortMap[filters.sortBy ?? 'trendScore'] ?? sortMap['trendScore'];

    const [data, total] = await Promise.all([
      Product.find(query).sort(sort).skip(skip).limit(limit).lean(),
      Product.countDocuments(query),
    ]);

    const totalPages = Math.ceil(total / limit);
    return {
      data: data as unknown as IProductDocument[],
      pagination: { page, limit, total, totalPages, hasNextPage: page < totalPages, hasPrevPage: page > 1 },
    };
  },

  async findById(id: string): Promise<IProductDocument | null> {
    if (!mongoose.isValidObjectId(id)) return null;
    return Product.findById(id);
  },

  async findAllUniqueProducts(): Promise<IProductDocument[]> {
    return Product.find({ status: 'active' }).sort({ 'trend.score': -1 }).limit(500);
  },

  async getCategories(): Promise<string[]> {
    return [...PRODUCT_CATEGORIES];
  },

  async search(
    query: string,
    category?: string[],
    page = 1,
    limit = 20,
  ): Promise<import('../../utils/pagination.util').PaginatedResponse<IProductDocument>> {
    const skip    = (page - 1) * limit;
    const filter: Record<string, unknown> = {
      status: 'active',
      $text: { $search: query },
    };
    if (category?.length) filter['categoryL1'] = { $in: category };

    const [data, total] = await Promise.all([
      Product.find(filter, { score: { $meta: 'textScore' } })
        .sort({ score: { $meta: 'textScore' } })
        .skip(skip).limit(limit).lean(),
      Product.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(total / limit);
    return {
      data: data as unknown as IProductDocument[],
      pagination: { page, limit, total, totalPages, hasNextPage: page < totalPages, hasPrevPage: page > 1 },
    };
  },

  async markStaleProducts(olderThanDays = 7): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 86_400_000);
    const result = await Product.updateMany(
      { lastIngestedAt: { $lt: cutoff }, status: 'active' },
      { $set: { status: 'stale' } }
    );
    return result.modifiedCount;
  },

  async cleanupBadProducts(): Promise<{ genericDeleted: number; duplicatesDeleted: number; lowViewsDeleted: number }> {
    // Remove products with generic/empty titles
    const genericResult = await Product.deleteMany({ status: { $ne: 'archived' }, normalizedTitle: { $in: ['', 'unknown product'] } });

    // Remove products with very low views that have been around > 14 days
    const cutoff = new Date(Date.now() - 14 * 86_400_000);
    const lowViewsResult = await Product.deleteMany({ viewCount: { $lt: 100 }, createdAt: { $lt: cutoff } });

    return {
      genericDeleted:    genericResult.deletedCount,
      duplicatesDeleted: 0,
      lowViewsDeleted:   lowViewsResult.deletedCount,
    };
  },
};
