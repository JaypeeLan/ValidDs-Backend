import { Product, IProductDocument } from '../../models/product.model';
import { PRODUCT_CATEGORIES } from '../../api/products/product.constants';
import { ExtractedProduct, NormalizedPost } from '../../ingestion/ingestion.types';
import { logger } from '../../logger';
import { parsePagination, toMongoSkip, buildPaginatedResponse, PaginatedResponse } from '../../utils/pagination.util';

const log = logger.child({ module: 'product-repository' });

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
  videoUrl?: string;
  thumbnailUrl?: string;
  creatorHandle: string;
  creatorFollowers?: number;
  publishedAt?: Date;
  collectedAt: Date;
  isAd: boolean;

  // From Gemini AI extraction
  category: string;              // productNiche mapped to canonical category
  aiConfidence: number;
  trendScore: number;
  trendDirection: 'rising' | 'peaked' | 'saturating' | 'unknown';
  trendReason: string;
  sentimentSummary?: string;
  buyingIntentScore?: number;

  // From Rainforest Amazon enrichment
  title: string;                 // short, searchable Amazon product title (≤80 chars)
  description: string;           // AI-generated product summary
  price: number;                 // average price across Rainforest results (0 if unavailable)
  priceMin?: number;             // lowest price seen
  priceMax?: number;             // highest price seen
  currency: string;
  primaryImageUrl?: string;      // first Rainforest result image
  imageUrls: string[];           // all Rainforest result images
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
    const filter = {
      externalId: post.videoId,
      source: post.source,
    };

    const update = {
      $set: {
        // Identity — always update from latest extraction
        title: extraction.productName,
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

        // Top video — the source post itself
        topVideos: [{
          videoId: post.videoId,
          url: post.videoUrl,
          thumbnailUrl: post.thumbnailUrl,
          viewCount: post.viewCount,
          likeCount: post.likeCount,
          commentCount: post.commentCount,
          shareCount: post.shareCount,
          creatorHandle: post.creatorHandle,
          creatorFollowers: post.creatorFollowers,
          publishedAt: post.publishedAt,
          isAd: post.isAd,
        }],

        // Trend data (AI-calculated)
        'trend.direction': extraction.trendDirection,
        'trend.score': extraction.trendScore,
        'trend.calculatedAt': new Date(),

        // AI metadata
        'aiExtraction.confidence': extraction.extractionConfidence,
        'aiExtraction.trendReason': extraction.trendReason,
        'aiExtraction.sentimentSummary': extraction.sentimentSummary,
        'aiExtraction.buyingIntentScore': extraction.buyingIntentScore,
        'aiExtraction.extractedAt': new Date(),

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
   * Upsert a product enriched with both Gemini AI and Rainforest Amazon data.
   *
   * Used exclusively by the hashtag ingestion pipeline.
   * Keyed on videoId + source (same as upsertFromExtraction).
   */
  async upsertEnrichedProduct(input: EnrichedProductInput): Promise<IProductDocument> {
    const filter = { externalId: input.videoId, source: input.source };

    const update = {
      $set: {
        // Identity
        title:       input.title,
        description: input.description,
        category:    input.category,
        tags:        input.hashtags,

        // Media — from Rainforest results
        primaryImageUrl: input.primaryImageUrl,
        imageUrls:       input.imageUrls,

        // Pricing — computed averages from Rainforest
        price:    input.price,
        priceMin: input.priceMin,
        priceMax: input.priceMax,
        currency: input.currency,

        // Engagement — from TikTok post
        totalViews:    input.viewCount,
        totalLikes:    input.likeCount,
        totalComments: input.commentCount,
        totalShares:   input.shareCount,
        totalVideos:   1,
        engagementRate: input.engagementRate,

        // Top video
        topVideos: [{
          videoId:         input.videoId,
          url:             input.videoUrl,
          thumbnailUrl:    input.thumbnailUrl,
          viewCount:       input.viewCount,
          likeCount:       input.likeCount,
          commentCount:    input.commentCount,
          shareCount:      input.shareCount,
          creatorHandle:   input.creatorHandle,
          creatorFollowers: input.creatorFollowers,
          publishedAt:     input.publishedAt,
          isAd:            input.isAd,
        }],

        // Trend data
        'trend.direction':   input.trendDirection,
        'trend.score':       input.trendScore,
        'trend.calculatedAt': new Date(),

        // AI metadata
        'aiExtraction.confidence':      input.aiConfidence,
        'aiExtraction.trendReason':     input.trendReason,
        'aiExtraction.sentimentSummary': input.sentimentSummary,
        'aiExtraction.buyingIntentScore': input.buyingIntentScore,
        'aiExtraction.extractedAt':     new Date(),

        // Freshness
        dataSourceUpdatedAt: input.collectedAt,
        lastIngestedAt:      new Date(),
        isStale:             false,
        status:              'active',
      },
    };

    const options = { upsert: true, new: true, setDefaultsOnInsert: true };

    try {
      const product = await Product.findOneAndUpdate(filter, update, options);
      log.debug('Enriched product upserted', { videoId: input.videoId, title: input.title });
      return product!;
    } catch (err) {
      log.error('Enriched product upsert failed', err, { videoId: input.videoId });
      throw err;
    }
  },

  /**
   * Purge all products. Used for clearing staging data before a fresh seed.
   */
  async purgeAll(): Promise<void> {
    await Product.deleteMany({});
    log.info('Purged all products from the database');
  },
};
