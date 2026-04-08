import { ProductRepository, ProductFeedFilters } from '../db/repositories/product.repository';
import { IProductDocument } from '../models/product.model';
import { FreshnessService } from '../freshness/freshness.service';
import { CacheService } from '../cache/cache.service';
import { CacheKeys, CACHE_TTL } from '../cache/cache.keys';
import { PaginatedResponse } from '../utils/pagination.util';
import { NotFoundError } from '../middleware/error.middleware';

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

    const feed = await CacheService.getOrSet(
      cacheKey,
      CACHE_TTL.PRODUCT_FEED,
      () => ProductRepository.findFeed(filters)
    );

    const freshness = await FreshnessService.getResponseMetadata('product');

    return { feed, freshness };
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
    const cacheKey = CacheKeys.productCategories();
    return CacheService.getOrSet(
      cacheKey,
      CACHE_TTL.CATEGORIES,
      () => ProductRepository.getCategories()
    );
  },

  /**
   * Full-text search across product titles, descriptions, and tags.
   */
  async search(query: string, category?: string[], page = 1, limit = 20): Promise<PaginatedResponse<IProductDocument>> {
    return ProductRepository.search(query, category, page, limit);
  },
};
