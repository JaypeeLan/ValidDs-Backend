import { ProductRepository, ProductFeedFilters } from '../db/repositories/product.repository';
import { PRODUCT_CATEGORIES } from '../api/products/product.constants';
import { IProductDocument } from '../models/product.model';
import { FreshnessService } from '../freshness/freshness.service';
import { CacheService } from '../cache/cache.service';
import { CacheKeys, CACHE_TTL } from '../cache/cache.keys';
import { PaginatedResponse } from '../utils/pagination.util';
import { NotFoundError } from '../middleware/error.middleware';
import { EnsembleClient } from '../ingestion/ensemble/ensemble.client';
import { transformEnsemblePosts } from '../ingestion/ensemble/ensemble.transformer';

/**
 * Product Service
 *
 * Business logic layer for all product operations.
 * Controllers call this — never the repository directly.
 */

export const ProductService = {

  /**
   * Get the product feed with optional filters.
   * Cached in Redis for 5 minutes.
   */
  async getFeed(filters: ProductFeedFilters): Promise<{
    feed: PaginatedResponse<IProductDocument>;
    freshness: Awaited<ReturnType<typeof FreshnessService.getResponseMetadata>>;
  }> {
    const cacheKey = CacheKeys.productFeed(
      filters.page ?? 1,
      filters.limit ?? 20,
      JSON.stringify({ ...filters, page: undefined, limit: undefined })
    );

    let feed = await CacheService.get<PaginatedResponse<IProductDocument>>(cacheKey);
    if (feed === null) {
      feed = await ProductRepository.findFeed(filters);
      // Do not cache an empty page — avoids locking in "no products" for 5m after deploy or ingestion lag.
      if (feed.pagination.total > 0) {
        await CacheService.set(cacheKey, feed, CACHE_TTL.PRODUCT_FEED);
      }
    }

    const freshness = await FreshnessService.getResponseMetadata('product');

    return { feed, freshness };
  },

  async cleanupProducts(): Promise<{ genericDeleted: number; duplicatesDeleted: number; lowViewsDeleted: number }> {
    return ProductRepository.cleanupBadProducts();
  },

  /**
   * Get a single product by its MongoDB ID.
   */
  async getById(id: string): Promise<{
    product: IProductDocument;
    freshness: Awaited<ReturnType<typeof FreshnessService.getResponseMetadata>>;
  }> {
    const cacheKey = CacheKeys.productDetail(id);

    const product = await CacheService.getOrSet(
      cacheKey,
      CACHE_TTL.PRODUCT_DETAIL,
      async () => {
        const p = await ProductRepository.findById(id);
        if (!p) throw new NotFoundError('Product');
        return p;
      }
    );

    const freshness = await FreshnessService.getResponseMetadata('product');
    return { product: product as IProductDocument, freshness };
  },

  /**
   * Get all unique product categories.
   */
  async getCategories(): Promise<string[]> {
    return [...PRODUCT_CATEGORIES];
  },

  /**
   * Full-text search across product titles, descriptions, and tags.
   */
  async search(
    query: string,
    category?: string[],
    page = 1,
    limit = 20,
    discovery?: Pick<ProductFeedFilters, 'section' | 'isAd'>
  ): Promise<PaginatedResponse<IProductDocument>> {
    return ProductRepository.search(query, category, page, limit, discovery);
  },

  async keywordContext(params: {
    name: string;
    timeFilter: 1 | 7 | 30 | 90 | 180;
    sortOrder: 0 | 1;
    country: string;
    cursor: number;
    matchExactly: boolean;
  }): Promise<{
    keyword: string;
    filters: {
      timeFilter: 1 | 7 | 30 | 90 | 180;
      sortOrder: 0 | 1;
      country: string;
      matchExactly: boolean;
    };
    pagination: {
      cursor: number;
      nextCursor: number | null;
    };
    suggestedHashtags: string[];
    posts: ReturnType<typeof transformEnsemblePosts>;
  }> {
    const client = new EnsembleClient(params.country.toUpperCase());
    const { posts: rawPosts, nextCursor } = await client.searchKeywordFull({
      name: params.name,
      days: params.timeFilter,
      period: params.timeFilter,
      sorting: params.sortOrder,
      cursor: params.cursor,
      country: params.country,
      matchExactly: params.matchExactly,
    });

    const posts = transformEnsemblePosts(rawPosts);
    const hashtagCounts = new Map<string, number>();
    for (const post of posts) {
      for (const hashtag of post.hashtags) {
        hashtagCounts.set(hashtag, (hashtagCounts.get(hashtag) ?? 0) + 1);
      }
    }
    const suggestedHashtags = [...hashtagCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .map(([name]) => name);

    return {
      keyword: params.name,
      filters: {
        timeFilter: params.timeFilter,
        sortOrder: params.sortOrder,
        country: params.country,
        matchExactly: params.matchExactly,
      },
      pagination: {
        cursor: params.cursor,
        nextCursor,
      },
      suggestedHashtags,
      posts,
    };
  },
};
