import { Product, IProductDocument } from '../../models/product.model';
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
  category?: string;
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

    if (filters.category) query.category = { $regex: filters.category, $options: 'i' };
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
  async search(query: string, page = 1, limit = 20): Promise<PaginatedResponse<IProductDocument>> {
    const pagination = { page, limit };
    const skip = toMongoSkip(pagination);

    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escapedQuery, 'i');

    const filter = {
      $or: [
        { title: { $regex: regex } },
        { description: { $regex: regex } },
        { tags: { $regex: regex } },
      ],
      status: 'active',
      'aiExtraction.confidence': { $gte: 50 },
    };

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
};
