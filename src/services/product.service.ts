import { ProductRepository, ProductFeedFilters } from '../db/repositories/product.repository';
import { PRODUCT_CATEGORIES, SUBCATEGORIES_BY_CATEGORY, CATEGORY_TAXONOMY } from '../api/products/product.constants';
import { IProductDocument, IProductModel } from '../models/product.model';
import { FreshnessService } from '../freshness/freshness.service';
import { CacheService } from '../cache/cache.service';
import { CacheKeys, CACHE_TTL } from '../cache/cache.keys';
import { PaginatedResponse } from '../utils/pagination.util';
import { NotFoundError } from '../middleware/error.middleware';
import mongoose from 'mongoose';

/**
 * Product Service
 *
 * Business logic layer for all product operations.
 * Controllers call this — never the repository directly.
 */

/**
 * Related products for a product detail page (cached).
 */
export async function getRelatedProducts(
  id: string,
  productModel?: IProductModel,
): Promise<IProductDocument[]> {
  if (!mongoose.isValidObjectId(id)) return [];

  const cacheKey = CacheKeys.productRelated(id);
  return CacheService.getOrSet(
    cacheKey,
    CACHE_TTL.PRODUCT_RELATED,
    async () => {
      const product = await ProductRepository.findById(id, productModel);
      if (!product) return [];
      return ProductRepository.findRelated(
        id,
        product.categoryL1,
        product.categoryL2,
        8,
        productModel,
      );
    },
  ) as Promise<IProductDocument[]>;
}

export type ProductServiceType = {
  getFeed: (
    filters: ProductFeedFilters,
    productModel?: IProductModel,
  ) => Promise<{
    feed: PaginatedResponse<IProductDocument>;
    freshness: Awaited<ReturnType<typeof FreshnessService.getResponseMetadata>>;
  }>;
  cleanupProducts: () => Promise<{
    genericDeleted: number;
    duplicatesDeleted: number;
    lowViewsDeleted: number;
  }>;
  getById: (
    id: string,
    productModel?: IProductModel,
  ) => Promise<{
    product: IProductDocument;
    freshness: Awaited<ReturnType<typeof FreshnessService.getResponseMetadata>>;
  }>;
  getCategories: () => Promise<string[]>;
  getSubcategories: (category?: string) => Promise<Record<string, string[]> | string[]>;
  getTaxonomy: () => Promise<typeof CATEGORY_TAXONOMY>;
  getRelated: (id: string, productModel?: IProductModel) => Promise<IProductDocument[]>;
  search: (
    query: string,
    category?: string[],
    page?: number,
    limit?: number,
    discovery?: Pick<ProductFeedFilters, 'section' | 'isAd' | 'sortBy'>,
    productModel?: IProductModel,
  ) => Promise<PaginatedResponse<IProductDocument>>;
  keywordContext: (params: {
    name: string;
    timeFilter: 1 | 7 | 30 | 90 | 180;
    sortOrder: 0 | 1;
    country: string;
    cursor: number;
    matchExactly: boolean;
  }) => Promise<{
    keyword: string;
    filters: {
      timeFilter: 1 | 7 | 30 | 90 | 180;
      sortOrder: 0 | 1;
      country: string;
      matchExactly: boolean;
    };
    pagination: { cursor: number; nextCursor: number | null };
    suggestedHashtags: string[];
    posts: Array<Record<string, unknown>>;
  }>;
};

export const ProductService: ProductServiceType = {

  /**
   * Get the product feed with optional filters.
   * Cached in Redis for 5 minutes.
   */
  async getFeed(
    filters: ProductFeedFilters,
    /** Market-specific Product model from req.models.Product. Defaults to global model (US). */
    productModel?: IProductModel,
  ): Promise<{
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
      feed = await ProductRepository.findFeed(filters, productModel);
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
  async getById(
    id: string,
    /** Market-specific Product model from req.models.Product. Defaults to global model (US). */
    productModel?: IProductModel,
  ): Promise<{
    product: IProductDocument;
    freshness: Awaited<ReturnType<typeof FreshnessService.getResponseMetadata>>;
  }> {
    const cacheKey = CacheKeys.productDetail(id);

    const product = await CacheService.getOrSet(
      cacheKey,
      CACHE_TTL.PRODUCT_DETAIL,
      async () => {
        const p = await ProductRepository.findById(id, productModel);
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

  async getSubcategories(category?: string): Promise<Record<string, string[]> | string[]> {
    if (category) {
      return SUBCATEGORIES_BY_CATEGORY[category] ?? [];
    }
    return SUBCATEGORIES_BY_CATEGORY;
  },

  async getTaxonomy(): Promise<typeof CATEGORY_TAXONOMY> {
    return CATEGORY_TAXONOMY;
  },

  getRelated: getRelatedProducts,

  /**
   * Full-text search across product titles, descriptions, and tags.
   */
  async search(
    query: string,
    category?: string[],
    page = 1,
    limit = 20,
    discovery?: Pick<ProductFeedFilters, 'section' | 'isAd' | 'sortBy'>,
    /** Market-specific Product model from req.models.Product. Defaults to global model (US). */
    productModel?: IProductModel,
  ): Promise<PaginatedResponse<IProductDocument>> {
    return ProductRepository.search(query, category, page, limit, discovery, productModel);
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
    posts: Array<Record<string, unknown>>;
  }> {
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
        nextCursor: null,
      },
      suggestedHashtags: [],
      posts: [],
    };
  },
};
