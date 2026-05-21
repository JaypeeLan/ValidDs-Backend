import mongoose from 'mongoose';
import { Product, IProductDocument, IProductModel } from '../../models/product.model';
import { logger } from '../../logger';
import { PRODUCT_CATEGORIES } from '../../api/products/product.constants';
import { normalizePrimaryCreatorForStorage } from '../../utils/product-response.util';

const log = logger.child({ module: 'product-repository' });

/**
 * Inclusion projection for discovery grid (`GET /products`).
 * Only fields rendered on product cards — detail uses full `findById`.
 */
export const PRODUCT_LISTING_FIELD_PROJECTION: Record<string, 1> = {
  title: 1,
  primaryImageUrl: 1,
  imageUrls: 1,
  price: 1,
  currency: 1,
  categoryL1: 1,
  categoryPath: 1,
  rating: 1,
  totalSales: 1,
  totalGmv: 1,
  salesTrend: 1,
  shopName: 1,
  shopUrl: 1,
  shopAvatarUrl: 1,
  lastIngestedAt: 1,
  discoverySections: 1,
  'aiIntelligence.confidence': 1,
  'aiIntelligence.buyingSentimentScore': 1,
  'trends.engagement': 1,
  'trend.score': 1,
  'trend.direction': 1,
  'trend.isTrending': 1,
  ratingSources: 1,
  reviewCount: 1,
  priceTrend: 1,
  priceHistory: 1,
  creativeCounts: 1,
  relatedVideosCount: 1,
  'suppliers.competitorScore': 1,
  primaryCreator: 1,
};

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

  // Media
  primaryImageUrl?: string;
  imageUrls: string[];
  sourcePrimaryImageUrl?: string;
  sourceImageUrls?: string[];
  imagesResolvedAt?: Date;

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
    sourceBreakdown?: Array<{
      source: string;
      unitsSold: number;
      url?: string;
    }>;
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
  reviews?: Array<{
    source: string;
    text: string;
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
    primaryImageUrl?: string;
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

  // Supplemental market metrics
  region?: string;
  commissionRate?: number;
  totalSale30d?: number;
  totalSale7d?: number;
  totalGmv?: number;
  totalGmv30d?: number;
  totalCreators?: number;
  salesChannel?: 'video' | 'live' | 'none';
  freeShipping?: boolean;
  isManagedStore?: boolean;
}

// ── Query filter types ────────────────────────────────────────────────────────

export interface ProductFeedFilters {
  category?: string[];
  subcategory?: string[];
  section?: string;
  trendDirection?: string;
  minTrendScore?: number;
  minViews?: number;
  isAd?: boolean;
  page?: number;
  limit?: number;
  sortBy?: 'gmv' | 'trendScore' | 'views' | 'recent' | 'engagement';
  userRegion?: string;
}

/** Applies discovery-section rules to a Mongo filter (feed or text search). */
const PRODUCT_SORT_MAP: Record<string, Record<string, 1 | -1>> = {
  gmv:         { totalGmv: -1, lastIngestedAt: -1 },
  trendScore:  { 'trends.engagement.score': -1, 'trend.score': -1 },
  views:       { viewCount: -1 },
  recent:      { lastIngestedAt: -1 },
  engagement:  { engagementRate: -1 },
};

function resolveProductSort(sortBy?: string): Record<string, 1 | -1> {
  return PRODUCT_SORT_MAP[sortBy ?? 'gmv'] ?? PRODUCT_SORT_MAP.gmv;
}

function applyDiscoverySectionRules(
  filter: Record<string, unknown>,
  opts: { section?: string; isAd?: boolean }
): void {
  const parts: Record<string, unknown>[] = [];
  if (opts.section) parts.push({ discoverySections: opts.section });
  if (opts.isAd === true) parts.push({ discoverySections: 'top-ads' });
  if (opts.isAd === false) parts.push({ $nor: [{ discoverySections: 'top-ads' }] });

  if (parts.length === 0) return;
  if (parts.length === 1) Object.assign(filter, parts[0]!);
  else filter.$and = parts;
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
            ...(input.sourcePrimaryImageUrl !== undefined && { sourcePrimaryImageUrl: input.sourcePrimaryImageUrl }),
            ...(input.sourceImageUrls       !== undefined && { sourceImageUrls:       input.sourceImageUrls }),
            ...(input.imagesResolvedAt      !== undefined && { imagesResolvedAt:      input.imagesResolvedAt }),

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
            reviews: input.reviews ?? [],

            // TikTok engagement
            viewCount:     input.viewCount,
            likeCount:     input.likeCount,
            commentCount:  input.commentCount,
            shareCount:    input.shareCount,
            engagementRate:input.engagementRate,

            // Discovery origin
            primaryCreator: normalizePrimaryCreatorForStorage(input.primaryCreator),

            // AI intelligence
            aiIntelligence: input.aiIntelligence,

            // Trend (schema: trends.engagement)
            trends: {
              engagement: input.trend,
              priceHistory: [],
            },

            // Discovery
            discoverySections: input.discoverySections ?? [],
            relatedProducts:   input.relatedProducts ?? [],
            creativeCounts:    input.creativeCounts ?? { ads: 0, organic: 0, reviews: 0, total: 0 },

            // Supplemental market metrics (conditionally included)
            ...(input.region           !== undefined && { region:           input.region }),
            ...(input.commissionRate   !== undefined && { commissionRate:   input.commissionRate }),
            ...(input.totalSale30d     !== undefined && { totalSale30d:     input.totalSale30d }),
            ...(input.totalSale7d      !== undefined && { totalSale7d:      input.totalSale7d }),
            ...(input.totalGmv         !== undefined && { totalGmv:         input.totalGmv }),
            ...(input.totalGmv30d      !== undefined && { totalGmv30d:      input.totalGmv30d }),
            ...(input.totalCreators    !== undefined && { totalCreators:    input.totalCreators }),
            ...(input.salesChannel     !== undefined && { salesChannel:     input.salesChannel }),
            ...(input.freeShipping     !== undefined && { freeShipping:     input.freeShipping }),
            ...(input.isManagedStore   !== undefined && { isManagedStore:   input.isManagedStore }),

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

  async findFeed(
    filters: ProductFeedFilters,
    /** Pass req.models.Product to query the correct market collection. Defaults to the global US model. */
    model: IProductModel = Product,
  ): Promise<import('../../utils/pagination.util').PaginatedResponse<IProductDocument>> {
    const page  = Math.max(1, filters.page ?? 1);
    const limit = Math.min(100, Math.max(1, filters.limit ?? 20));
    const skip  = (page - 1) * limit;

    // Each market already has its own collection — no region filter needed when
    // a market-specific model is passed. The legacy `userRegion` filter still
    // applies when using the global model (single-collection fallback).
    const query: Record<string, unknown> = { status: { $ne: 'archived' } };

    // ── Legacy multi-region fallback (single-collection path only) ───────────
    if (model === Product) {
      if (filters.userRegion) {
        const [regionCount, usCount] = await Promise.all([
          model.countDocuments({ region: filters.userRegion, status: 'active' }),
          model.countDocuments({ region: 'US', status: 'active' }),
        ]);
        if (regionCount > 0) {
          query['region'] = filters.userRegion;
        } else if (usCount > 0) {
          query['region'] = 'US';
        }
      } else {
        const [hasRegionedData, usCount] = await Promise.all([
          model.countDocuments({ region: { $exists: true, $nin: [null, ''] }, status: 'active' }),
          model.countDocuments({ region: 'US', status: 'active' }),
        ]);
        if (hasRegionedData > 0 && usCount > 0) query['region'] = 'US';
      }
    }

    if (filters.category?.length)       query['categoryL1'] = { $in: filters.category };
    if (filters.subcategory?.length)    query['categoryL2'] = { $in: filters.subcategory };
    if (filters.trendDirection) {
      query.$and = [
        ...((query.$and as unknown[]) ?? []),
        {
          $or: [
            { 'trends.engagement.direction': filters.trendDirection },
            { 'trend.direction': filters.trendDirection },
          ],
        },
      ];
    }
    if (filters.minTrendScore != null) {
      query.$and = [
        ...((query.$and as unknown[]) ?? []),
        {
          $or: [
            { 'trends.engagement.score': { $gte: filters.minTrendScore } },
            { 'trend.score': { $gte: filters.minTrendScore } },
          ],
        },
      ];
    }
    if (filters.minViews != null)       query['viewCount'] = { $gte: filters.minViews };
    applyDiscoverySectionRules(query, { section: filters.section, isAd: filters.isAd });

    const sort = resolveProductSort(filters.sortBy);

    const [data, total] = await Promise.all([
      model.find(query)
        .select(PRODUCT_LISTING_FIELD_PROJECTION)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(),
      model.countDocuments(query),
    ]);

    const totalPages = Math.ceil(total / limit);
    return {
      data: data as unknown as IProductDocument[],
      pagination: { page, limit, total, totalPages, hasNextPage: page < totalPages, hasPrevPage: page > 1 },
    };
  },

  async findById(
    id: string,
    /** Pass req.models.Product to query the correct market collection. Defaults to the global US model. */
    model: IProductModel = Product,
  ): Promise<IProductDocument | null> {
    if (!mongoose.isValidObjectId(id)) return null;
    return model.findById(id);
  },

  /**
   * Find related products for a given product.
   * Strategy:
   *   1. Same categoryL2 (subcategory), excluding current — up to 8 results.
   *   2. If fewer than 8 found, backfill from same categoryL1, excluding already-found IDs.
   * Sorted by trend score desc then totalSales desc.
   */
  async findRelated(
    id: string,
    categoryL1: string,
    categoryL2: string | undefined,
    limit = 8,
    model: IProductModel = Product,
  ): Promise<IProductDocument[]> {
    if (!mongoose.isValidObjectId(id)) return [];

    const objectId    = new mongoose.Types.ObjectId(id);
    const baseFilter  = { _id: { $ne: objectId }, status: { $ne: 'archived' } };
    const sort        = { 'trends.engagement.score': -1 as const, 'trend.score': -1 as const, totalSales: -1 as const };
    const projection  = PRODUCT_LISTING_FIELD_PROJECTION;

    const results: IProductDocument[] = [];

    // Pass 1 — same subcategory
    if (categoryL2) {
      const subcategoryResults = await model
        .find({ ...baseFilter, categoryL2 })
        .select(projection)
        .sort(sort)
        .limit(limit)
        .lean() as unknown as IProductDocument[];
      results.push(...subcategoryResults);
    }

    // Pass 2 — backfill from same top-level category if needed
    if (results.length < limit) {
      const seenIds = new Set([id, ...results.map((p) => String((p as any)._id))]);
      const remaining = limit - results.length;
      const categoryResults = await model
        .find({ ...baseFilter, categoryL1, _id: { $nin: [...seenIds].map((sid) => new mongoose.Types.ObjectId(sid)) } })
        .select(projection)
        .sort(sort)
        .limit(remaining)
        .lean() as unknown as IProductDocument[];
      results.push(...categoryResults);
    }

    return results;
  },

  async getCategories(): Promise<string[]> {
    return [...PRODUCT_CATEGORIES];
  },

  async search(
    query: string,
    category?: string[],
    page = 1,
    limit = 20,
    discovery?: Pick<ProductFeedFilters, 'section' | 'isAd' | 'sortBy'>,
    /** Pass req.models.Product to query the correct market collection. Defaults to the global US model. */
    model: IProductModel = Product,
  ): Promise<import('../../utils/pagination.util').PaginatedResponse<IProductDocument>> {
    const skip    = (page - 1) * limit;
    const filter: Record<string, unknown> = {
      status: { $ne: 'archived' },
      $text: { $search: query },
    };
    if (category?.length) filter['categoryL1'] = { $in: category };
    if (discovery) applyDiscoverySectionRules(filter, discovery);

    const sort = resolveProductSort(discovery?.sortBy);

    const [data, total] = await Promise.all([
      model.find(filter, { score: { $meta: 'textScore' } })
        .select(PRODUCT_LISTING_FIELD_PROJECTION)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(),
      model.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(total / limit);
    return {
      data: data as unknown as IProductDocument[],
      pagination: { page, limit, total, totalPages, hasNextPage: page < totalPages, hasPrevPage: page > 1 },
    };
  },

  async markStaleProducts(olderThanMinutes = 10): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);
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
