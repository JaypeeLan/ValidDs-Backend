import mongoose from 'mongoose';
import { Product, IProductDocument } from '../../models/product.model';
import { PRODUCT_CATEGORIES } from '../../api/products/product.constants';
import { ExtractedProduct, NormalizedPost } from '../../ingestion/ingestion.types';
import { logger } from '../../logger';
import { parsePagination, toMongoSkip, buildPaginatedResponse, PaginatedResponse } from '../../utils/pagination.util';

const log = logger.child({ module: 'product-repository' });

const GENERIC_PHRASES = [
  'amazon finds', 'amazon must-haves', 'amazon must haves',
  'amazon home finds', 'trending amazon products', 'viral products',
  'tiktok finds', 'tiktok made me buy it', 'must haves', 'must-haves',
  'dropshipping products', 'unknown product', 'product name', 
  'latest tech prod', 'tech prod', 'things you need', 'buy this',
  'beauty products', 'home products', 'tech products', 'kitchen products',
  'baby products', 'pet products'
];

const GENERIC_TITLE_PATTERNS: RegExp[] = [
  /^(trending|top|best|viral|tiktok)\s+(amazon|tiktok)\s+(products|finds|deals?|must[- ]haves?)/i,
  /^(amazon|tiktok)\s+(finds|products|deals|must[- ]haves?)/i,
  /\b(amazon|tiktok)\b.*\b(products|finds|deals|must[- ]haves?)\b/i,
  /^(dropshipping|dropship)\s+(products|items|deals?)/i,
  /^(unknown|new)\s+(product|item)/i,
  /^(beauty|home|tech|kitchen|baby|pet)\s+products?$/i,
];

function normalizeProductTitle(title: string): string {
  return title
    .trim()
    .replace(/[\u2018\u2019\u201C\u201D]/g, "'")
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function isGenericTitle(title: string): boolean {
  if (!title) return true;
  const normalized = normalizeProductTitle(title);
  if (GENERIC_PHRASES.some((phrase) => normalized.includes(phrase))) {
    return true;
  }
  return GENERIC_TITLE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function buildGenericTitleFilter(): Array<Record<string, unknown>> {
  const phraseFilters = GENERIC_PHRASES.map((phrase) => ({ title: { $regex: new RegExp(phrase, 'i') } }));
  const patternFilters = GENERIC_TITLE_PATTERNS.map((pattern) => ({ title: pattern }));
  return [...phraseFilters, ...patternFilters];
}

function buildTitleMatchRegex(title: string): RegExp {
  const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escapedTitle}$`, 'i');
}

async function findDuplicateTitle(title: string, source: string): Promise<IProductDocument | null> {
  const normalizedTitle = normalizeProductTitle(title);
  return Product.findOne({
    $and: [
      { source: { $ne: source } },
      { status: 'active' },
      {
        $or: [
          { normalizedTitle },
          { title: { $regex: buildTitleMatchRegex(title) } },
        ],
      },
    ],
  });
}

function buildDuplicateTitleCleanupPipeline(): mongoose.PipelineStage[] {
  return [
    { $match: { status: 'active' } } as mongoose.PipelineStage,
    { $sort: { 'trend.score': -1, lastIngestedAt: -1 } } as mongoose.PipelineStage,
    { $group: {
      _id: { $ifNull: ['$normalizedTitle', { $toLower: '$title' }] },
      keepId: { $first: '$_id' },
      productIds: { $push: '$_id' },
      count: { $sum: 1 },
    } } as mongoose.PipelineStage,
    { $project: {
      toArchive: {
        $filter: {
          input: '$productIds',
          as: 'id',
          cond: { $ne: ['$$id', '$keepId'] },
        },
      },
      count: 1,
    } } as mongoose.PipelineStage,
    { $match: { count: { $gt: 1 } } } as mongoose.PipelineStage,
  ];
}

/**
 * Product Repository
 *
 * All MongoDB queries for the Product collection.
 * Services call this — never raw Mongoose models.
 */

export interface ProductFeedFilters {
  category?: string[];
  niche?: string;
  trendDirection?: 'rising' | 'peaked' | 'saturating' | 'unknown';
  minTrendScore?: number;
  minViews?: number;
  isAd?: boolean;
  page?: number;
  limit?: number;
  sortBy?: 'trendScore' | 'views' | 'recent' | 'engagement';
  region?: string;
}

/**
 * Shape passed to upsertEnrichedProduct.
 * Combines AI extraction output with Rainforest Amazon enrichment.
 */
export interface EnrichedProductInput {
  // From the TikTok post
  videoId: string;
  source: string;
  hashtags: string[];
  viewCount: number;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  engagementRate?: number;
  videoPlayUrl?: string;
  thumbnailUrl?: string;
  publishedAt?: Date;
  collectedAt: Date;
  isAd: boolean;

  // From Gemini AI extraction
  category: string;              // L1 top-level
  subCategory?: string;          // L2 subcategory
  categoryLeaf?: string;         // L3 leaf node
  categoryPath?: string;         // Full 'L1 / L2 / L3' display path
  aiConfidence: number;
  confidenceReason?: string;
  buyingSentimentScore?: number;
  buyingSentimentReason?: string;
  trendScore: number;
  trendDirection: 'rising' | 'peaked' | 'saturating' | 'unknown';
  trendReason?: string;
  isTrending?: boolean;

  // Creator info (from TikTok post)
  creatorHandle: string;
  creatorDisplayName?: string;
  creatorFollowers?: number;
  creatorRegion?: string;
  creatorVerified?: boolean;
  creatorAvatarUrl?: string;

  // From Rainforest Amazon enrichment
  title: string;                 // short, searchable Amazon product title (≤80 chars)
  description: string;           // AI-generated product summary
  price: number;                 // average price across Rainforest results (0 if unavailable)
  priceMin?: number;             // lowest price seen
  priceMax?: number;             // highest price seen
  currency: string;
  primaryImageUrl?: string;      // first Rainforest result image
  imageUrls: string[];           // all Rainforest result images
  unitsSold?: number;
  store?: string;
  videoUrl?: string;
  rating?: number;
  reviewsCount?: number;
  suppliers?: Array<{ platform: string; productUrl?: string; price?: number; currency?: string; verified: boolean; checkedAt: Date }>;
}

export const ProductRepository = {

  /**
   * Upsert a product from an AI extraction result.
   *
   * Uses videoId + source as the unique key.
   * If the product already exists, we update engagement stats
   * and trend data. If it's new, we create it.
   *
   * Called by the ingestion pipeline after AI extraction.
   */
  async upsertFromExtraction(
    extraction: ExtractedProduct,
    post: NormalizedPost
  ): Promise<IProductDocument> {
    if (isGenericTitle(extraction.productName)) {
      throw new Error(`Blocked insertion of generic product title: "${extraction.productName}"`);
    }

    const existingDuplicate = await findDuplicateTitle(extraction.productName, post.source);
    if (existingDuplicate) {
      throw new Error(
        `Blocked insertion of duplicate product title from a different source: "${extraction.productName}"`
      );
    }

    const filter = {
      title: { $regex: new RegExp(`^${extraction.productName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
      source: post.source,
    };

    const update = {
      $set: {
        // Identity — always update from latest extraction
        title: extraction.productName,
        normalizedTitle: normalizeProductTitle(extraction.productName),
        description: extraction.productDescription,
        category: extraction.productNiche,
        tags: post.hashtags,

        // Media
        primaryImageUrl: post.thumbnailUrl,
        imageUrls: post.thumbnailUrl ? [post.thumbnailUrl] : [],

        // Pricing (from AI extraction — may be null)
        price: extraction.estimatedPrice ?? undefined,
        currency: extraction.currency ?? 'USD',

        // Engagement (from source post)
        totalViews: post.viewCount,
        totalLikes: post.likeCount,
        totalComments: post.commentCount,
        totalShares: post.shareCount,
        totalVideos: 1,
        engagementRate: post.engagementRate,

        // Top video — the source post itself (used as fallback logic, will be overridden by $addToSet)
        topVideos: [{
          videoId: post.videoId,
          url: post.videoUrl,
          playUrl: post.videoPlayUrl,
          thumbnailUrl: post.thumbnailUrl,
          viewCount: post.viewCount,
          likeCount: post.likeCount,
          commentCount: post.commentCount,
          shareCount: post.shareCount,
          creatorHandle: post.creatorHandle,
          creatorDisplayName: post.creatorDisplayName,
          creatorFollowers: post.creatorFollowers,
          creatorRegion: post.creatorRegion,
          creatorVerified: post.creatorVerified,
          creatorAvatarUrl: post.creatorAvatarUrl,
          publishedAt: post.publishedAt,
          isAd: post.isAd,
        }],

        // Trend data (AI-calculated)
        'trend.direction': extraction.trendDirection,
        'trend.isTrending': extraction.isTrending,
        'trend.reason': extraction.trendReason,
        'trend.score': extraction.trendScore,
        'trend.calculatedAt': new Date(),

        // AI metadata
        'aiExtraction.confidence': extraction.extractionConfidence,
        'aiExtraction.confidenceReason': extraction.confidenceReason,
        'aiExtraction.buyingSentimentScore': extraction.buyingSentimentScore,
        'aiExtraction.buyingSentimentReason': extraction.buyingSentimentReason,
        'aiExtraction.extractedAt': new Date(),
        unitsSold: extraction.unitsSold ?? 0,
        store: 'TeemDrop',

        // Ad signals
        'adSignals.isAd': post.isAd,
        'adSignals.firstSeenAt': post.adFirstSeenAt,
        'adSignals.lastSeenAt': post.adLastSeenAt,
        'adSignals.status': post.adStatus,

        // Freshness
        dataSourceUpdatedAt: post.collectedAt,
        lastIngestedAt: new Date(),
        isStale: false,
        status: 'active',
      },
      $addToSet: {
        topVideos: {
          videoId: post.videoId,
          url: post.videoUrl,
          playUrl: post.videoPlayUrl,
          thumbnailUrl: post.thumbnailUrl,
          viewCount: post.viewCount,
          likeCount: post.likeCount,
          commentCount: post.commentCount,
          shareCount: post.shareCount,
          creatorHandle: post.creatorHandle,
          creatorDisplayName: post.creatorDisplayName,
          creatorFollowers: post.creatorFollowers,
          creatorRegion: post.creatorRegion,
          creatorVerified: post.creatorVerified,
          creatorAvatarUrl: post.creatorAvatarUrl,
          publishedAt: post.publishedAt,
          isAd: post.isAd,
        }
      },
      $inc: { totalVideos: 1 },
      // Update externalId if inserting (since it's required in the schema, though no longer uniquely determining identity)
      $setOnInsert: { externalId: post.videoId }
    };

    const options = { upsert: true, new: true, setDefaultsOnInsert: true };

    try {
      const product = await Product.findOneAndUpdate(filter, update, options);
      log.debug('Product upserted', { videoId: post.videoId, title: extraction.productName });
      return product!;
    } catch (err) {
      log.error('Product upsert failed', err, { videoId: post.videoId });
      throw err;
    }
  },

  /**
   * Get the product feed — paginated, filtered, sorted.
   * This is what powers the /api/v1/products endpoint.
   */
  async findFeed(filters: ProductFeedFilters = {}): Promise<PaginatedResponse<IProductDocument>> {
    const pagination = parsePagination(filters as Record<string, unknown>);
    const skip = toMongoSkip(pagination);

    const query: Record<string, unknown> = {
      status: 'active',
      'aiExtraction.confidence': { $gte: 60 },  // only show high-confidence extractions
      $nor: buildGenericTitleFilter(),
    };

    if (filters.category && filters.category.length > 0) {
      query.category = { $in: filters.category.map((c) => new RegExp(`^${c}$`, 'i')) };
    }
    if (filters.trendDirection) query['trend.direction'] = filters.trendDirection;
    if (filters.minTrendScore) query['trend.score'] = { $gte: filters.minTrendScore };
    if (filters.minViews) query.totalViews = { $gte: filters.minViews };
    if (filters.isAd !== undefined) query['adSignals.isAd'] = filters.isAd;

    const sortMap: Record<string, Record<string, 1 | -1>> = {
      trendScore: { 'trend.score': -1 },
      views:      { totalViews: -1 },
      recent:     { lastIngestedAt: -1 },
      engagement: { engagementRate: -1 },
    };
    const sort = sortMap[filters.sortBy ?? 'trendScore'];

    const [data, total] = await Promise.all([
      Product.find(query).sort(sort as Record<string, 1 | -1>).skip(skip).limit(pagination.limit).lean(),
      Product.countDocuments(query),
    ]);

    return buildPaginatedResponse(data as unknown as IProductDocument[], total, pagination);
  },

  /**
   * Get all products from the database without duplicates and without low-value generic titles.
   * Deduplicates by normalized title so each product appears once.
   */
  async findAllUniqueProducts(): Promise<IProductDocument[]> {
    const query: Record<string, unknown> = {
      status: 'active',
      'aiExtraction.confidence': { $gte: 60 },
      $nor: buildGenericTitleFilter(),
    };

    const pipeline: mongoose.PipelineStage[] = [
      { $match: query } as mongoose.PipelineStage,
      { $sort: { 'trend.score': -1, lastIngestedAt: -1 } } as mongoose.PipelineStage,
      { $group: { _id: { $ifNull: ['$normalizedTitle', { $toLower: '$title' }] }, doc: { $first: '$$ROOT' } } } as mongoose.PipelineStage,
      { $replaceRoot: { newRoot: '$doc' } } as mongoose.PipelineStage,
    ];

    return Product.aggregate(pipeline).exec() as Promise<IProductDocument[]>;
  },

  async deleteGenericProducts(): Promise<number> {
    const products = await Product.find({}).select('title').lean();
    const idsToDelete = products
      .filter((product) => isGenericTitle(String(product.title)))
      .map((product) => product._id);

    if (idsToDelete.length === 0) return 0;

    const result = await Product.deleteMany({ _id: { $in: idsToDelete } });
    return result.deletedCount ?? 0;
  },

  async deleteDuplicateProducts(): Promise<number> {
    type DuplicateProductLean = {
      _id: mongoose.Types.ObjectId;
      title?: string;
      normalizedTitle?: string;
      trend?: { score?: number };
      lastIngestedAt?: Date;
    };

    const products = await Product.find({})
      .select('title normalizedTitle trend.score lastIngestedAt')
      .lean()
      .exec() as DuplicateProductLean[];

    const groups = new Map<string, Array<{ id: unknown; score: number; lastIngestedAt: Date }>>();
    const bulkUpdates: Array<{ updateOne: { filter: { _id: unknown }; update: Record<string, unknown> } }> = [];

    for (const product of products) {
      const normalized = normalizeProductTitle(String(product.title));
      if (!normalized) continue;

      if (!product.normalizedTitle) {
        bulkUpdates.push({
          updateOne: {
            filter: { _id: product._id },
            update: { normalizedTitle: normalized },
          },
        });
      }

      const bucket = groups.get(normalized) ?? [];
      bucket.push({
        id: product._id,
        score: product.trend?.score ?? 0,
        lastIngestedAt: product.lastIngestedAt ?? new Date(0),
      });
      groups.set(normalized, bucket);
    }

    if (bulkUpdates.length > 0) {
      await Product.bulkWrite(bulkUpdates, { ordered: false }).catch(() => undefined);
    }

    const idsToDelete: unknown[] = [];
    for (const bucket of groups.values()) {
      if (bucket.length <= 1) continue;
      bucket.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.lastIngestedAt.getTime() - a.lastIngestedAt.getTime();
      });
      const [, ...duplicates] = bucket;
      idsToDelete.push(...duplicates.map((item) => item.id));
    }

    if (idsToDelete.length === 0) return 0;

    const result = await Product.deleteMany({ _id: { $in: idsToDelete } });
    return result.deletedCount ?? 0;
  },

  async cleanupBadProducts(): Promise<{ genericDeleted: number; duplicatesDeleted: number }> {
    const [genericDeleted, duplicatesDeleted] = await Promise.all([
      this.deleteGenericProducts(),
      this.deleteDuplicateProducts(),
    ]);
    return { genericDeleted, duplicatesDeleted };
  },

  /**
   * Get a single product by its MongoDB ID.
   */
  async findById(id: string): Promise<IProductDocument | null> {
    return Product.findOne({ _id: id, status: { $ne: 'archived' } });
  },

  /**
   * Get a single product by its external video ID + source.
   */
  async findByVideoId(videoId: string, source: string): Promise<IProductDocument | null> {
    return Product.findOne({ externalId: videoId, source, status: { $ne: 'archived' } });
  },

  /**
   * Full-text search across title, description, and tags (supports partial matching).
   */
  async search(query: string, category?: string[], page = 1, limit = 20): Promise<PaginatedResponse<IProductDocument>> {
    const pagination = { page, limit };
    const skip = toMongoSkip(pagination);

    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escapedQuery, 'i');

    const filter: Record<string, any> = {
      $or: [
        { title: { $regex: regex } },
        { description: { $regex: regex } },
        { tags: { $regex: regex } },
      ],
      status: 'active',
      'aiExtraction.confidence': { $gte: 50 },
      $nor: buildGenericTitleFilter(),
    };

    if (category && category.length > 0) {
      filter.category = { $in: category.map((c) => new RegExp(`^${c}$`, 'i')) };
    }

    const [data, total] = await Promise.all([
      Product.find(filter)
        .sort({ 'trend.score': -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Product.countDocuments(filter),
    ]);

    return buildPaginatedResponse(data as unknown as IProductDocument[], total, pagination);
  },

  /**
   * Mark all products older than the freshness threshold as stale.
   * Run by the stale-data cleanup job.
   */
  async markStaleProducts(thresholdMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - thresholdMs);
    const result = await Product.updateMany(
      { lastIngestedAt: { $lt: cutoff }, status: 'active' },
      { $set: { isStale: true } }
    );
    log.info(`Marked ${result.modifiedCount} products as stale`);
    return result.modifiedCount;
  },

  /**
   * Get products that are stale and need re-ingestion.
   */
  async findStale(limit = 50): Promise<IProductDocument[]> {
    return Product.find({ isStale: true, status: 'active' })
      .sort({ lastIngestedAt: 1 })
      .limit(limit);
  },

  /**
   * Get all unique product categories.
   */
  async getCategories(): Promise<string[]> {
    return [...PRODUCT_CATEGORIES];
  },

  /**
   * Check if a product with the given videoId already exists in the DB.
   * Used by the ingestion pipeline to skip already-processed posts.
   */
  async existsByVideoId(videoId: string): Promise<boolean> {
    const count = await Product.countDocuments({ externalId: videoId });
    return count > 0;
  },

  /**
   * Upsert a product enriched with both Gemini AI and Rainforest Amazon data.
   *
   * Used exclusively by the hashtag ingestion pipeline.
   * Keyed on videoId + source (same as upsertFromExtraction).
   */
  async upsertEnrichedProduct(input: EnrichedProductInput): Promise<IProductDocument> {
    const sanitized = this.validateAndSanitize(input);
    if (isGenericTitle(sanitized.title)) {
      throw new Error(`Blocked insertion of generic product title: "${sanitized.title}"`);
    }

    const existingDuplicate = await findDuplicateTitle(sanitized.title, sanitized.source);
    if (existingDuplicate) {
      throw new Error(
        `Blocked insertion of duplicate product title from a different source: "${sanitized.title}"`
      );
    }

    const filter = {
      title: { $regex: new RegExp(`^${sanitized.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
      source: sanitized.source
    };

    const newVideo = {
      videoId:          sanitized.videoId,
      url:              sanitized.videoUrl,
      playUrl:          sanitized.videoPlayUrl,
      thumbnailUrl:     sanitized.thumbnailUrl,
      viewCount:        sanitized.viewCount,
      likeCount:        sanitized.likeCount,
      commentCount:     sanitized.commentCount,
      shareCount:       sanitized.shareCount,
      creatorHandle:    sanitized.creatorHandle,
      creatorDisplayName: sanitized.creatorDisplayName,
      creatorFollowers: sanitized.creatorFollowers,
      creatorRegion:    sanitized.creatorRegion,
      creatorVerified:  sanitized.creatorVerified,
      creatorAvatarUrl: sanitized.creatorAvatarUrl,
      publishedAt:      sanitized.publishedAt,
      isAd:             sanitized.isAd,
    };

    const update = {
      $set: {
        // Identity
        title:        sanitized.title,
        normalizedTitle: normalizeProductTitle(sanitized.title),
        description:  sanitized.description,
        category:     sanitized.category,
        subCategory:  sanitized.subCategory,
        categoryLeaf: sanitized.categoryLeaf,
        categoryPath: sanitized.categoryPath,
        tags:         sanitized.hashtags,

        // Media — from Rainforest results
        primaryImageUrl: sanitized.primaryImageUrl,
        imageUrls:       sanitized.imageUrls,

        // Pricing — computed averages from Rainforest
        price:    sanitized.price,
        priceMin: sanitized.priceMin,
        priceMax: sanitized.priceMax,
        currency: sanitized.currency,

        // Engagement — from TikTok post
        totalViews:    sanitized.viewCount,
        totalLikes:    sanitized.likeCount,
        totalComments: sanitized.commentCount,
        shareCount:    sanitized.shareCount,
        engagementRate: sanitized.engagementRate,

        // Primary video URL (most recent)
        videoUrl: sanitized.videoUrl,

        // Creator fields (from primary/first-seen post)
        creatorHandle:       sanitized.creatorHandle,
        creatorDisplayName:  sanitized.creatorDisplayName,
        creatorFollowers:    sanitized.creatorFollowers,
        creatorRegion:       sanitized.creatorRegion,

        // Suppliers — for manual verification of units sold
        ...(sanitized.suppliers && sanitized.suppliers.length > 0
          ? { suppliers: sanitized.suppliers }
          : {}),

        // Trend data
        'trend.direction':   sanitized.trendDirection,
        'trend.isTrending':  sanitized.isTrending,
        'trend.reason':      sanitized.trendReason,
        'trend.score':       sanitized.trendScore,
        'trend.calculatedAt': new Date(),

        // AI metadata
        'aiExtraction.confidence':            sanitized.aiConfidence,
        'aiExtraction.confidenceReason':      sanitized.confidenceReason,
        'aiExtraction.buyingSentimentScore':  sanitized.buyingSentimentScore,
        'aiExtraction.buyingSentimentReason': sanitized.buyingSentimentReason,
        'aiExtraction.extractedAt':           new Date(),
        unitsSold:    sanitized.unitsSold ?? 0,
        store:        sanitized.store ?? 'TeemDrop',
        rating:       sanitized.rating,
        reviewsCount: sanitized.reviewsCount,

        // Freshness
        dataSourceUpdatedAt: sanitized.collectedAt,
        lastIngestedAt:      new Date(),
        isStale:             false,
        status:              'active',
      },
      // Accumulate videos — add this post's video if not already in the array
      $addToSet: {
        topVideos: newVideo,
      },
      // Track total video count
      $inc: { totalVideos: 1 },
      $setOnInsert: { externalId: sanitized.videoId }
    };

    const options = { upsert: true, new: true, setDefaultsOnInsert: true };

    try {
      const product = await Product.findOneAndUpdate(filter, update, options).exec();
      log.debug('Enriched product upserted', { videoId: sanitized.videoId, title: sanitized.title });
      return product as IProductDocument;
    } catch (err) {
      log.error('Enriched product upsert failed', err, { videoId: sanitized.videoId });
      throw err;
    }
  },

  /**
   * Final sterilization layer before DB write.
   */
  validateAndSanitize(input: EnrichedProductInput): EnrichedProductInput {
    return {
      ...input,
      title: input.title.trim().slice(0, 80),
      description: (input.description || '').trim().slice(0, 2000),
      store: input.store || 'TeemDrop',
      unitsSold: Math.max(input.unitsSold || 0, 1000), // Enforce high-standard for winning products
      price: Math.max(input.price || 0, 19.99),       // Enforce minimum price for premium cards
    };
  },
};
