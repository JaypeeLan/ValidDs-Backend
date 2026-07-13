import mongoose from 'mongoose';
import { Product, IProductDocument, IProductModel } from '../../models/product.model';
import type { IProductSupplier } from '../../types/product.types';
import { logger } from '../../logger';
import { normalizePrimaryCreatorForStorage } from '../../utils/product-response.util';
import {
  recencyPrioritySortSpec,
  recencyTierAddFields,
  usesRecencyPriorityWithGmv,
  withIdTiebreak,
} from '../../utils/product-recency.util';
import {
  applyProductCreatorMetricFilters,
  applyProductMetricFilters,
} from '../../utils/content-feed-filters.util';
import { buildProductTextSearchStrings } from '../../utils/product-text-search.util';
import {
  expandCategoryL3FilterValues,
  expandSubcategoryFilterValues,
  normalizeCategoryL2,
} from '../../utils/category-l2-normalize.util';
import { expandCategoryL1FilterValues } from '../../utils/category-l1-normalize.util';
import { excludedProductCategoryL1Filter } from '../../utils/excluded-product-categories.util';
import {
  creativeCollectionForProductCollection,
  creativeFeedExposureMatchStage,
  productPlayableCreativeLookupStages,
} from '../../utils/creative-response.util';
import type { ICreativeDocument } from '../../types/creative.types';
import {
  LEGACY_DEFAULT_SECTIONS,
  normalizeProductSectionFilter,
} from '../../utils/discovery-sections.util';
import type { Model } from 'mongoose';

const log = logger.child({ module: 'product-repository' });

function playableCreativeStagesForModel(model: IProductModel): Record<string, unknown>[] {
  return productPlayableCreativeLookupStages(
    creativeCollectionForProductCollection(model.collection.name),
  );
}

/**
 * Inclusion projection for discovery grid (`GET /products`).
 * Only fields rendered on product cards — detail uses full `findById`.
 */
export const PRODUCT_LISTING_FIELD_PROJECTION: Record<string, 1> = {
  title: 1,
  primaryImageUrl: 1,
  imageUrls: 1,
  price: 1,
  originalPrice: 1,
  currency: 1,
  categoryL1: 1,
  categoryPath: 1,
  rating: 1,
  totalSales: 1,
  totalGmv: 1,
  salesTrend: 1,
  shopName: 1,
  shopUrl: 1,
  officialWebsiteUrl: 1,
  shopAvatarUrl: 1,
  lastIngestedAt: 1,
  publishedAt: 1,
  postCreatedAt: 1,
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
  creativeCounts: 1,
  relatedVideosCount: 1,
  'suppliers.competitorScore': 1,
  primaryCreator: 1,
};

/**
 * Slim projection before feed aggregation sort/dedupe.
 * Full product docs (reviews, history arrays, AI blobs) exceed Atlas 32MB sort RAM.
 */
export const PRODUCT_FEED_PIPELINE_PROJECTION: Record<string, 1> = {
  ...PRODUCT_LISTING_FIELD_PROJECTION,
  normalizedTitle: 1,
  shopName: 1,
  soldCount: 1,
  ingestedAt: 1,
  createdAt: 1,
  externalId: 1,
  productUrl: 1,
};

/** Fields needed for AI product comparison. */
export const PRODUCT_COMPARE_FIELD_PROJECTION: Record<string, 1> = {
  ...PRODUCT_LISTING_FIELD_PROJECTION,
  categoryL2: 1,
  reviewCount: 1,
  'aiIntelligence.confidence': 1,
  'aiIntelligence.confidenceReason': 1,
  'aiIntelligence.reviewSummary': 1,
  'aiIntelligence.pageSummary': 1,
  'aiIntelligence.problemStatement': 1,
  'aiIntelligence.valueStatement': 1,
  'aiIntelligence.productType': 1,
  'aiIntelligence.priceBand': 1,
  'aiIntelligence.buyingSentimentScore': 1,
  'aiIntelligence.buyingSentimentLabel': 1,
  'aiIntelligence.marketingAnalysis.sentimentLabel': 1,
  'aiIntelligence.marketingAnalysis.marketingInsight': 1,
};

// ── Generic title filtering ───────────────────────────────────────────────────

const GENERIC_PHRASES = [
  'amazon finds',
  'amazon must-haves',
  'amazon must haves',
  'amazon home finds',
  'trending amazon products',
  'viral products',
  'tiktok finds',
  'tiktok made me buy it',
  'must haves',
  'must-haves',
  'dropshipping products',
  'unknown product',
  'product name',
  'things you need',
  'buy this',
  'beauty products',
  'home products',
  'tech products',
  'kitchen products',
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
  if (GENERIC_PHRASES.some((p) => normalized.includes(p))) return true;
  return GENERIC_TITLE_PATTERNS.some((r) => r.test(normalized));
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
  suppliers?: IProductSupplier[];

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
  sortBy?:
    | 'gmv-desc'
    | 'gmv-asc'
    | 'units-desc'
    | 'units-asc'
    | 'trendScore'
    | 'views'
    | 'recent'
    | 'engagement';
  minPrice?: number;
  maxPrice?: number;
  minTotalGmv?: number;
  maxTotalGmv?: number;
  minUnitsSold?: number;
  maxUnitsSold?: number;
  minConfidence?: number;
  maxConfidence?: number;
  minCompetitionScore?: number;
  maxCompetitionScore?: number;
  minOpportunityScore?: number;
  maxOpportunityScore?: number;
  /** hot = high engagement score / trending; seasonal = AI productType seasonal */
  productKind?: 'hot' | 'seasonal';
  minSales7d?: number;
  maxSales7d?: number;
  minGmv7d?: number;
  maxGmv7d?: number;
  userRegion?: string;
  minLikes?: number;
  minEngagementRate?: number;
  startDate?: Date;
  minCreatorGmv?: number;
  maxCreatorGmv?: number;
  minFollowers?: number;
  maxFollowers?: number;
  minCreatorLikes?: number;
  maxCreatorLikes?: number;
}

const HOT_TREND_DIRECTIONS = ['rising', 'emerging', 'viral'] as const;

function metricWindowValueAtDaysAgo(
  field: 'salesTrend' | 'revenueTrend',
  daysAgo: number,
  min?: number,
  max?: number,
): Record<string, unknown> | null {
  if (min == null && max == null) return null;
  const valueFilter: Record<string, number> = {};
  if (min != null) valueFilter.$gte = min;
  if (max != null) valueFilter.$lte = max;
  return {
    [field]: {
      windows: {
        $elemMatch: {
          daysAgo,
          value: valueFilter,
        },
      },
    },
  };
}

function appendAnd(filter: Record<string, unknown>, clause: Record<string, unknown>): void {
  const existing = filter.$and;
  if (Array.isArray(existing)) {
    existing.push(clause);
  } else if (existing) {
    filter.$and = [existing as Record<string, unknown>, clause];
  } else {
    filter.$and = [clause];
  }
}

/** Applies discovery-section rules to a Mongo filter (feed or text search). */
const PRODUCT_SORT_MAP: Record<string, Record<string, 1 | -1>> = {
  'gmv-desc': { totalGmv: -1, lastIngestedAt: -1, _id: 1 },
  'gmv-asc': { totalGmv: 1, lastIngestedAt: -1, _id: 1 },
  'units-desc': { totalSales: -1, lastIngestedAt: -1, _id: 1 },
  'units-asc': { totalSales: 1, lastIngestedAt: -1, _id: 1 },
  trendScore: { 'trends.engagement.score': -1, 'trend.score': -1, _id: 1 },
  views: { viewCount: -1, _id: 1 },
  recent: { lastIngestedAt: -1, _id: 1 },
  engagement: { engagementRate: -1, _id: 1 },
};

function resolveProductSort(sortBy?: string): Record<string, 1 | -1> {
  return PRODUCT_SORT_MAP[sortBy ?? 'gmv-desc'] ?? PRODUCT_SORT_MAP['gmv-desc'];
}

/**
 * Collapse duplicate TikTok Shop listings (same normalized title + shop).
 * Keeps the row with highest soldCount / GMV (requires a prior $sort).
 */
export const PRODUCT_LISTING_DEDUPE_STAGES: Record<string, unknown>[] = [
  {
    $group: {
      _id: {
        title: { $toLower: { $ifNull: ['$normalizedTitle', ''] } },
        shop: { $toLower: { $ifNull: ['$shopName', ''] } },
      },
      doc: { $first: '$$ROOT' },
    },
  },
  { $replaceRoot: { newRoot: '$doc' } },
];

async function runProductFeedQuery(
  model: IProductModel,
  match: Record<string, unknown>,
  filters: ProductFeedFilters,
): Promise<import('../../utils/pagination.util').PaginatedResponse<IProductDocument>> {
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(100, Math.max(1, filters.limit ?? 20));
  const skip = (page - 1) * limit;
  const sortBy = filters.sortBy ?? 'gmv-desc';
  const playableStages = playableCreativeStagesForModel(model);

  if (usesRecencyPriorityWithGmv(sortBy)) {
    const sort = recencyPrioritySortSpec(sortBy);
    const now = new Date();
    const preDedupeSort = withIdTiebreak({ ...sort, soldCount: -1, totalGmv: -1 });
    const [facet] = await model
      .aggregate([
        { $match: match },
        { $project: PRODUCT_FEED_PIPELINE_PROJECTION },
        { $addFields: recencyTierAddFields(now) },
        { $sort: preDedupeSort },
        ...playableStages,
        ...PRODUCT_LISTING_DEDUPE_STAGES,
        {
          $facet: {
            data: [
              { $sort: sort },
              { $skip: skip },
              { $limit: limit },
              { $project: PRODUCT_LISTING_FIELD_PROJECTION },
              { $unset: ['_recencyTier', '_postDate'] },
            ],
            total: [{ $count: 'count' }],
          },
        },
      ])
      .option({ maxTimeMS: 30_000 })
      .allowDiskUse(true)
      .exec();

    const data = (facet?.data ?? []) as unknown as IProductDocument[];
    const total = facet?.total?.[0]?.count ?? 0;
    const totalPages = Math.ceil(total / limit);
    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    };
  }

  const sort = resolveProductSort(sortBy);
  const [facet] = await model
    .aggregate([
      { $match: match },
      { $project: PRODUCT_FEED_PIPELINE_PROJECTION },
      // Sort BEFORE the creative lookup so it can use a product index (the lookup only
      // filters, preserving order). Running it after the lookup forced a blocking
      // in-memory sort of the whole matched set on every request.
      { $sort: sort },
      ...playableStages,
      ...PRODUCT_LISTING_DEDUPE_STAGES,
      {
        $facet: {
          data: [
            { $sort: sort },
            { $skip: skip },
            { $limit: limit },
            { $project: PRODUCT_LISTING_FIELD_PROJECTION },
          ],
          total: [{ $count: 'count' }],
        },
      },
    ])
    .option({ maxTimeMS: 30_000 })
    .allowDiskUse(true)
    .exec();

  const data = (facet?.data ?? []) as unknown as IProductDocument[];
  const total = facet?.total?.[0]?.count ?? 0;
  const totalPages = Math.ceil(total / limit);
  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
  };
}

/** Text search: relevance only (ignores feed sortBy). Exact title match ranks first. */
async function runProductSearchQuery(
  model: IProductModel,
  baseMatch: Record<string, unknown>,
  filters: ProductFeedFilters,
  rawQuery: string,
): Promise<import('../../utils/pagination.util').PaginatedResponse<IProductDocument>> {
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(100, Math.max(1, filters.limit ?? 20));
  const skip = (page - 1) * limit;
  const normalizedQ = rawQuery.trim().toLowerCase();
  const searchStrings = buildProductTextSearchStrings(rawQuery);
  const playableStages = playableCreativeStagesForModel(model);

  for (const searchText of searchStrings) {
    const match: Record<string, unknown> = {
      ...baseMatch,
      $text: { $search: searchText },
    };

    const [facet] = await model
      .aggregate([
        { $match: match },
        { $project: PRODUCT_FEED_PIPELINE_PROJECTION },
        ...playableStages,
        {
          $addFields: {
            _textScore: { $meta: 'textScore' },
            _titleExact: {
              $cond: [
                {
                  $or: [
                    { $eq: [{ $toLower: { $ifNull: ['$normalizedTitle', ''] } }, normalizedQ] },
                    { $eq: [{ $toLower: { $ifNull: ['$title', ''] } }, normalizedQ] },
                  ],
                },
                1000,
                0,
              ],
            },
          },
        },
        { $addFields: { _rank: { $add: ['$_titleExact', '$_textScore'] } } },
        {
          $sort: {
            _rank: -1,
            soldCount: -1,
            totalGmv: -1,
            lastIngestedAt: -1,
            _id: 1,
          },
        },
        ...PRODUCT_LISTING_DEDUPE_STAGES,
        {
          $facet: {
            data: [
              { $sort: { _rank: -1, lastIngestedAt: -1, _id: 1 } },
              { $skip: skip },
              { $limit: limit },
              { $project: PRODUCT_LISTING_FIELD_PROJECTION },
            ],
            total: [{ $count: 'count' }],
          },
        },
      ])
      .option({ maxTimeMS: 30_000 })
      .allowDiskUse(true)
      .exec();

    const total = facet?.total?.[0]?.count ?? 0;
    if (total === 0 && searchStrings.indexOf(searchText) < searchStrings.length - 1) {
      continue;
    }

    const data = (facet?.data ?? []) as unknown as IProductDocument[];
    const totalPages = Math.ceil(total / limit);
    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    };
  }

  return {
    data: [],
    pagination: {
      page,
      limit,
      total: 0,
      totalPages: 0,
      hasNextPage: false,
      hasPrevPage: false,
    },
  };
}

function applyDiscoverySectionRules(
  filter: Record<string, unknown>,
  opts: { section?: string; isAd?: boolean },
): void {
  const parts: Record<string, unknown>[] = [];
  if (opts.section) {
    const normalized = normalizeProductSectionFilter(opts.section);
    if (normalized === 'default') {
      parts.push({ discoverySections: { $in: [...LEGACY_DEFAULT_SECTIONS] } });
    } else {
      parts.push({ discoverySections: normalized });
    }
  }
  if (opts.isAd === true) {
    parts.push({
      $or: [{ 'creativeCounts.ads': { $gte: 1 } }, { discoverySections: 'top-ads' }],
    });
  }
  if (opts.isAd === false) {
    parts.push({
      $and: [
        {
          $or: [{ 'creativeCounts.ads': { $lt: 1 } }, { 'creativeCounts.ads': { $exists: false } }],
        },
        { $nor: [{ discoverySections: 'top-ads' }] },
      ],
    });
  }

  if (parts.length === 0) return;
  if (parts.length === 1) Object.assign(filter, parts[0]!);
  else filter.$and = parts;
}

/** Shared list/search filters (category, price, GMV, hot/seasonal, etc.). */
function applyProductFeedFilters(
  query: Record<string, unknown>,
  filters: ProductFeedFilters,
): void {
  if (filters.category?.length) {
    query['categoryL1'] = { $in: expandCategoryL1FilterValues(filters.category) };
  }
  if (filters.subcategory?.length) {
    query['categoryL2'] = { $in: expandSubcategoryFilterValues(filters.subcategory) };
  }
  if (filters.minPrice != null || filters.maxPrice != null) {
    query.price = {
      ...(filters.minPrice != null ? { $gte: filters.minPrice } : {}),
      ...(filters.maxPrice != null ? { $lte: filters.maxPrice } : {}),
    };
  }
  if (filters.minTotalGmv != null || filters.maxTotalGmv != null) {
    query.totalGmv = {
      ...(filters.minTotalGmv != null ? { $gte: filters.minTotalGmv } : {}),
      ...(filters.maxTotalGmv != null ? { $lte: filters.maxTotalGmv } : {}),
    };
  }
  if (filters.minUnitsSold != null || filters.maxUnitsSold != null) {
    query.totalSales = {
      ...(filters.minUnitsSold != null ? { $gte: filters.minUnitsSold } : {}),
      ...(filters.maxUnitsSold != null ? { $lte: filters.maxUnitsSold } : {}),
    };
  }
  if (filters.minConfidence != null || filters.maxConfidence != null) {
    query['aiIntelligence.confidence'] = {
      ...(filters.minConfidence != null ? { $gte: filters.minConfidence } : {}),
      ...(filters.maxConfidence != null ? { $lte: filters.maxConfidence } : {}),
    };
  }
  if (filters.minOpportunityScore != null || filters.maxOpportunityScore != null) {
    const scoreClause: Record<string, unknown> = {
      ...(filters.minOpportunityScore != null ? { $gte: filters.minOpportunityScore } : {}),
      ...(filters.maxOpportunityScore != null ? { $lte: filters.maxOpportunityScore } : {}),
    };
    appendAnd(query, {
      $or: [{ 'trends.engagement.score': scoreClause }, { 'trend.score': scoreClause }],
    });
  }
  if (filters.minCompetitionScore != null || filters.maxCompetitionScore != null) {
    query['suppliers.competitorScore'] = {
      ...(filters.minCompetitionScore != null ? { $gte: filters.minCompetitionScore } : {}),
      ...(filters.maxCompetitionScore != null ? { $lte: filters.maxCompetitionScore } : {}),
    };
  }
  if (filters.productKind === 'seasonal') {
    query['aiIntelligence.productType'] = 'seasonal';
  } else if (filters.productKind === 'hot') {
    appendAnd(query, {
      $or: [
        { 'trends.engagement.score': { $gte: 70 } },
        { 'trend.score': { $gte: 70 } },
        { 'trends.engagement.isTrending': true },
        { 'trend.isTrending': true },
        { 'trends.engagement.direction': { $in: [...HOT_TREND_DIRECTIONS] } },
        { 'trend.direction': { $in: [...HOT_TREND_DIRECTIONS] } },
        { 'aiIntelligence.productType': 'trend-driven' },
      ],
    });
  }
  const sales7d = metricWindowValueAtDaysAgo(
    'salesTrend',
    7,
    filters.minSales7d,
    filters.maxSales7d,
  );
  if (sales7d) appendAnd(query, sales7d);
  const gmv7d = metricWindowValueAtDaysAgo('revenueTrend', 7, filters.minGmv7d, filters.maxGmv7d);
  if (gmv7d) appendAnd(query, gmv7d);
  if (filters.trendDirection) {
    appendAnd(query, {
      $or: [
        { 'trends.engagement.direction': filters.trendDirection },
        { 'trend.direction': filters.trendDirection },
      ],
    });
  }
  if (filters.minTrendScore != null) {
    appendAnd(query, {
      $or: [
        { 'trends.engagement.score': { $gte: filters.minTrendScore } },
        { 'trend.score': { $gte: filters.minTrendScore } },
      ],
    });
  }
  if (filters.minViews != null) query['viewCount'] = { $gte: filters.minViews };
  applyProductMetricFilters(query, {
    minLikes: filters.minLikes,
    minEngagementRate: filters.minEngagementRate,
    startDate: filters.startDate,
  });
  applyProductCreatorMetricFilters(query, {
    minCreatorGmv: filters.minCreatorGmv,
    maxCreatorGmv: filters.maxCreatorGmv,
    minFollowers: filters.minFollowers,
    maxFollowers: filters.maxFollowers,
    minCreatorLikes: filters.minCreatorLikes,
    maxCreatorLikes: filters.maxCreatorLikes,
  });
  applyDiscoverySectionRules(query, { section: filters.section, isAd: filters.isAd });
}

/** Same eligibility as `findFeed` — categories/subcategories only count listable products. */
export const LISTABLE_PRODUCT_FILTER: Record<string, unknown> = {
  status: { $nin: ['archived', 'invalid'] },
  ...excludedProductCategoryL1Filter(),
};

const NON_EMPTY_STRING = { $exists: true, $nin: [null, ''] };

// ── Repository ────────────────────────────────────────────────────────────────

export const ProductRepository = {
  /**
   * Upsert an enriched product using videoId + source as the unique key.
   */
  async upsertEnrichedProduct(input: EnrichedProductInput): Promise<IProductDocument | null> {
    const title = input.title.trim().slice(0, 500);
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
            source: input.source,
            status: 'active',

            // Content
            title,
            normalizedTitle,
            description: input.description,
            hashtags: input.hashtags,

            // Taxonomy
            categoryL1: input.categoryL1,
            categoryL2: input.categoryL2,
            categoryL3: input.categoryL3,
            categoryPath: input.categoryPath,

            // Media
            primaryImageUrl: input.primaryImageUrl ?? null,
            imageUrls: input.imageUrls ?? [],

            // Pricing
            price: input.price ?? null,
            currency: input.currency,
            suppliers: input.suppliers ?? [],

            // Market evidence
            rating: input.rating ?? null,
            reviewCount: input.reviewCount ?? null,
            ratingSources: input.ratingSources ?? [],
            reviews: (input.reviews ?? []).map((r) => ({
              author: null,
              rating: null,
              content: r.text,
              date: null,
              item: null,
              images: [],
            })),
            totalSales: input.salesEvidence?.unitsSold ?? input.totalSale30d ?? 0,
            totalGmv: input.totalGmv ?? 0,
            soldCount: input.salesEvidence?.unitsSold ?? 0,

            // TikTok engagement
            viewCount: input.viewCount,
            likeCount: input.likeCount,
            commentCount: input.commentCount,
            shareCount: input.shareCount,
            engagementRate: input.engagementRate,

            // Discovery origin
            primaryCreator: normalizePrimaryCreatorForStorage(input.primaryCreator),

            // AI intelligence
            aiIntelligence: input.aiIntelligence,

            // Trend (schema: trends.engagement)
            trends: {
              engagement: input.trend,
            },

            // Discovery
            discoverySections: input.discoverySections ?? [],
            creativeCounts: input.creativeCounts ?? { ads: 0, organic: 0, reviews: 0, total: 0 },
            market: input.region ?? '',

            // Freshness
            lastIngestedAt: new Date(),
            dataSourceUpdatedAt: input.collectedAt,
          },
        },
        { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
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
    // Each market already has its own collection — no region filter needed when
    // a market-specific model is passed. The legacy `userRegion` filter still
    // applies when using the global model (single-collection fallback).
    const query: Record<string, unknown> = { status: { $nin: ['archived', 'invalid'] } };

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

    applyProductFeedFilters(query, filters);

    return runProductFeedQuery(model, query, filters);
  },

  async findById(
    id: string,
    /** Pass req.models.Product to query the correct market collection. Defaults to the global US model. */
    model: IProductModel = Product,
  ): Promise<IProductDocument | null> {
    if (!mongoose.isValidObjectId(id)) return null;
    return model.findById(id).lean().maxTimeMS(15_000) as Promise<IProductDocument | null>;
  },

  /**
   * Fetch multiple products by MongoDB ID for comparison views.
   * Returns rows in the same order as `ids`, omitting missing or non-listable products.
   */
  async findByIds(ids: string[], model: IProductModel = Product): Promise<IProductDocument[]> {
    const objectIds = ids
      .filter((id) => mongoose.isValidObjectId(id))
      .map((id) => new mongoose.Types.ObjectId(id));
    if (objectIds.length === 0) return [];

    const rows = (await model
      .find({
        _id: { $in: objectIds },
        ...LISTABLE_PRODUCT_FILTER,
      })
      .select(PRODUCT_LISTING_FIELD_PROJECTION)
      .lean()
      .maxTimeMS(15_000)
      .exec()) as IProductDocument[];

    const byId = new Map(rows.map((row) => [String(row._id), row]));
    return ids.map((id) => byId.get(id)).filter((row): row is IProductDocument => row != null);
  },

  async findByIdsForCompare(
    ids: string[],
    model: IProductModel = Product,
  ): Promise<IProductDocument[]> {
    const objectIds = ids
      .filter((id) => mongoose.isValidObjectId(id))
      .map((id) => new mongoose.Types.ObjectId(id));
    if (objectIds.length === 0) return [];

    const rows = (await model
      .find({
        _id: { $in: objectIds },
        ...LISTABLE_PRODUCT_FILTER,
      })
      .select(PRODUCT_COMPARE_FIELD_PROJECTION)
      .lean()
      .maxTimeMS(15_000)
      .exec()) as IProductDocument[];

    const byId = new Map(rows.map((row) => [String(row._id), row]));
    return ids.map((id) => byId.get(id)).filter((row): row is IProductDocument => row != null);
  },

  /**
   * Find related products for a given product.
   * L2 narrows the candidate pool (including alias variants).
   * When the anchor has L3, candidates must share that L3 — L2 alone is not enough.
   * When the anchor has no L3, L2-only narrowing is used as a best-effort fallback.
   */
  async findRelated(
    id: string,
    categoryL1: string,
    categoryL2: string | undefined,
    normalizedTitle: string | undefined,
    limit = 8,
    model: IProductModel = Product,
    categoryL3?: string,
  ): Promise<IProductDocument[]> {
    if (!mongoose.isValidObjectId(id) || !categoryL2?.trim()) return [];

    const l2Values = expandSubcategoryFilterValues([normalizeCategoryL2(categoryL1, categoryL2)]);
    if (l2Values.length === 0) return [];

    const objectId = new mongoose.Types.ObjectId(id);
    const sort = {
      'trends.engagement.score': -1 as const,
      'trend.score': -1 as const,
      totalSales: -1 as const,
      soldCount: -1 as const,
      totalGmv: -1 as const,
    };

    const baseMatch: Record<string, unknown> = {
      ...LISTABLE_PRODUCT_FILTER,
      _id: { $ne: objectId },
      categoryL2: l2Values.length === 1 ? l2Values[0]! : { $in: l2Values },
    };

    const titleKey = normalizedTitle?.trim().toLowerCase();
    if (titleKey) {
      baseMatch.normalizedTitle = { $ne: titleKey };
    }

    const runQuery = async (match: Record<string, unknown>) =>
      model
        .aggregate([
          { $match: match },
          ...playableCreativeStagesForModel(model),
          { $sort: sort },
          ...PRODUCT_LISTING_DEDUPE_STAGES,
          { $sort: sort },
          { $limit: limit },
          { $project: PRODUCT_LISTING_FIELD_PROJECTION },
        ])
        .option({ maxTimeMS: 15_000 })
        .allowDiskUse(true)
        .exec() as Promise<unknown[]>;

    const l3 = categoryL3?.trim();
    if (l3) {
      const l3Values = expandCategoryL3FilterValues(categoryL1, categoryL2, l3);
      if (l3Values.length === 0) return [];

      const l3Rows = await runQuery({
        ...baseMatch,
        categoryL3: l3Values.length === 1 ? l3Values[0]! : { $in: l3Values },
      });
      return l3Rows as unknown as IProductDocument[];
    }

    const rows = await runQuery(baseMatch);
    return rows as unknown as IProductDocument[];
  },

  /** True when the product has at least one feed-safe creative (playable video). */
  async hasPlayableCreative(
    productId: string,
    creativeModel: Model<ICreativeDocument>,
  ): Promise<boolean> {
    if (!mongoose.isValidObjectId(productId)) return false;
    const [hit] = await creativeModel
      .aggregate([
        { $match: { productId: new mongoose.Types.ObjectId(productId) } },
        creativeFeedExposureMatchStage(),
        { $limit: 1 },
        { $project: { _id: 1 } },
      ])
      .option({ maxTimeMS: 10_000 })
      .allowDiskUse(true)
      .exec();
    return Boolean(hit);
  },

  /** Distinct L1 category names that have at least one listable product. */
  async getDistinctCategoryL1(model: IProductModel = Product): Promise<string[]> {
    const values = await model
      .aggregate<{ _id: string }>([
        {
          $match: {
            ...LISTABLE_PRODUCT_FILTER,
            categoryL1: NON_EMPTY_STRING,
          },
        },
        ...playableCreativeStagesForModel(model),
        { $group: { _id: '$categoryL1' } },
        { $sort: { _id: 1 } },
      ])
      .option({ maxTimeMS: 30_000 })
      .allowDiskUse(true)
      .exec();
    return values.map((row) => String(row._id ?? '').trim()).filter(Boolean);
  },

  /** L1 → distinct L2 subcategories that have at least one listable product. */
  async getDistinctSubcategoriesByL1(
    model: IProductModel = Product,
  ): Promise<Record<string, string[]>> {
    const rows = await model
      .aggregate<{ _id: string; subs: string[] }>([
        {
          $match: {
            ...LISTABLE_PRODUCT_FILTER,
            categoryL1: NON_EMPTY_STRING,
            categoryL2: NON_EMPTY_STRING,
          },
        },
        ...playableCreativeStagesForModel(model),
        { $group: { _id: '$categoryL1', subs: { $addToSet: '$categoryL2' } } },
        { $sort: { _id: 1 } },
      ])
      .option({ maxTimeMS: 30_000 })
      .allowDiskUse(true)
      .exec();

    const out: Record<string, string[]> = {};
    for (const row of rows) {
      const l1 = String(row._id ?? '').trim();
      if (!l1) continue;
      out[l1] = (row.subs ?? [])
        .map((s) => String(s).trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
    }
    return out;
  },

  async search(
    query: string,
    filters: ProductFeedFilters,
    /** Pass req.models.Product to query the correct market collection. Defaults to the global US model. */
    model: IProductModel = Product,
  ): Promise<import('../../utils/pagination.util').PaginatedResponse<IProductDocument>> {
    // Match feed eligibility: exclude archived AND invalid (was $ne 'archived', which
    // leaked invalid products into search results).
    const filter: Record<string, unknown> = { ...LISTABLE_PRODUCT_FILTER };
    applyProductFeedFilters(filter, filters);

    return runProductSearchQuery(model, filter, filters, query);
  },

  async markStaleProducts(olderThanMinutes = 10): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);
    const result = await Product.updateMany(
      { lastIngestedAt: { $lt: cutoff }, status: 'active' },
      { $set: { status: 'stale' } },
    );
    return result.modifiedCount;
  },

  async cleanupBadProducts(): Promise<{
    genericDeleted: number;
    duplicatesDeleted: number;
    lowViewsDeleted: number;
  }> {
    const genericResult = await Product.deleteMany({
      status: { $ne: 'archived' },
      normalizedTitle: { $in: ['', 'unknown product'] },
    });

    const cutoff = new Date(Date.now() - 14 * 86_400_000);
    const lowViewsResult = await Product.deleteMany({
      viewCount: { $lt: 100 },
      createdAt: { $lt: cutoff },
    });

    return {
      genericDeleted: genericResult.deletedCount,
      duplicatesDeleted: 0,
      lowViewsDeleted: lowViewsResult.deletedCount,
    };
  },
};
