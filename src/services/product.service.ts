import { compareProducts } from './product-compare.service';
import { ProductRepository, ProductFeedFilters } from '../db/repositories/product.repository';
import { CATEGORY_TAXONOMY } from '../api/products/product.constants';
import {
  filterL1CategoriesWithProducts,
  filterSubcategoriesWithProducts,
} from '../utils/product-category-catalog.util';
import { IProductDocument, IProductModel } from '../models/product.model';
import type { ProductCompareResponse } from '../types/product.types';
import { FreshnessService } from '../freshness/freshness.service';
import { CacheService } from '../cache/cache.service';
import { CacheKeys, CACHE_TTL } from '../cache/cache.keys';
import { PaginatedResponse } from '../utils/pagination.util';
import { NotFoundError } from '../middleware/error.middleware';
import mongoose from 'mongoose';
import { DEFAULT_MARKET, type MarketCode } from '../utils/markets';

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
  market: MarketCode = DEFAULT_MARKET,
): Promise<IProductDocument[]> {
  if (!mongoose.isValidObjectId(id)) return [];

  const cacheKey = CacheKeys.productRelated(market, id);
  return CacheService.getOrSet(cacheKey, CACHE_TTL.PRODUCT_RELATED, async () => {
    const product = await ProductRepository.findById(id, productModel);
    if (!product) return [];
    return ProductRepository.findRelated(
      id,
      product.categoryL1,
      product.categoryL2,
      product.normalizedTitle,
      8,
      productModel,
      product.categoryL3,
    );
  }) as Promise<IProductDocument[]>;
}

export type ProductServiceType = {
  getFeed: (
    filters: ProductFeedFilters,
    productModel?: IProductModel,
    market?: MarketCode,
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
    market?: MarketCode,
    creativeModel?: import('mongoose').Model<import('../types/creative.types').ICreativeDocument>,
  ) => Promise<{
    product: IProductDocument;
    freshness: Awaited<ReturnType<typeof FreshnessService.getResponseMetadata>>;
  }>;
  getCategories: (productModel?: IProductModel, market?: MarketCode) => Promise<string[]>;
  getSubcategories: (
    category?: string,
    productModel?: IProductModel,
    market?: MarketCode,
  ) => Promise<Record<string, string[]> | string[]>;
  getTaxonomy: () => Promise<typeof CATEGORY_TAXONOMY>;
  getRelated: (
    id: string,
    productModel?: IProductModel,
    market?: MarketCode,
  ) => Promise<IProductDocument[]>;
  compare: (
    ids: string[],
    productModel?: IProductModel,
    market?: MarketCode,
  ) => Promise<ProductCompareResponse>;
  search: (
    query: string,
    filters: ProductFeedFilters,
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
    market: MarketCode = DEFAULT_MARKET,
  ): Promise<{
    feed: PaginatedResponse<IProductDocument>;
    freshness: Awaited<ReturnType<typeof FreshnessService.getResponseMetadata>>;
  }> {
    const cacheKey = CacheKeys.productFeed(
      market,
      filters.page ?? 1,
      filters.limit ?? 20,
      JSON.stringify({ ...filters, page: undefined, limit: undefined }),
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

  async cleanupProducts(): Promise<{
    genericDeleted: number;
    duplicatesDeleted: number;
    lowViewsDeleted: number;
  }> {
    return ProductRepository.cleanupBadProducts();
  },

  /**
   * Get a single product by its MongoDB ID (always from MongoDB — no Redis cache).
   */
  async getById(
    id: string,
    /** Market-specific Product model from req.models.Product. Defaults to global model (US). */
    productModel?: IProductModel,
    market: MarketCode = DEFAULT_MARKET,
    creativeModel?: import('mongoose').Model<import('../types/creative.types').ICreativeDocument>,
  ): Promise<{
    product: IProductDocument;
    freshness: Awaited<ReturnType<typeof FreshnessService.getResponseMetadata>>;
  }> {
    const product = await ProductRepository.findById(id, productModel);
    if (!product) throw new NotFoundError('Product');

    const { getMarketModels } = await import('../models/market-models.factory');
    const Creative = creativeModel ?? getMarketModels(market).Creative;
    const hasCreative = await ProductRepository.hasPlayableCreative(id, Creative);
    if (!hasCreative) throw new NotFoundError('Product');

    const freshness = await FreshnessService.getResponseMetadata('product');
    return { product, freshness };
  },

  /**
   * L1 categories that have at least one listable product (canonical order).
   */
  async getCategories(
    productModel?: IProductModel,
    market: MarketCode = DEFAULT_MARKET,
  ): Promise<string[]> {
    const cacheKey = CacheKeys.productCategories(market);
    return CacheService.getOrSet(cacheKey, CACHE_TTL.CATEGORIES, async () => {
      const dbL1 = await ProductRepository.getDistinctCategoryL1(productModel);
      return filterL1CategoriesWithProducts(dbL1);
    }) as Promise<string[]>;
  },

  async getSubcategories(
    category?: string,
    productModel?: IProductModel,
    market: MarketCode = DEFAULT_MARKET,
  ): Promise<Record<string, string[]> | string[]> {
    const cacheKey = CacheKeys.productSubcategories(market, category);
    return CacheService.getOrSet(cacheKey, CACHE_TTL.CATEGORIES, async () => {
      const dbByL1 = await ProductRepository.getDistinctSubcategoriesByL1(productModel);
      return filterSubcategoriesWithProducts(dbByL1, category);
    }) as Promise<Record<string, string[]> | string[]>;
  },

  async getTaxonomy(): Promise<typeof CATEGORY_TAXONOMY> {
    return CATEGORY_TAXONOMY;
  },

  getRelated: getRelatedProducts,

  async compare(
    ids: string[],
    productModel?: IProductModel,
    market: MarketCode = DEFAULT_MARKET,
  ): Promise<ProductCompareResponse> {
    return compareProducts(ids, productModel, market);
  },

  /**
   * Full-text search across product titles, descriptions, and tags.
   */
  async search(
    query: string,
    filters: ProductFeedFilters,
    productModel?: IProductModel,
  ): Promise<PaginatedResponse<IProductDocument>> {
    return ProductRepository.search(query, filters, productModel);
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
