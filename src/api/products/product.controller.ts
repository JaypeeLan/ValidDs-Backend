import { Request, Response, NextFunction } from 'express';
import { ProductService, getRelatedProducts } from '../../services/product.service';
import { ProductFeedQuery, ProductKeywordContextQuery } from './product.validator';
import { FreshnessService } from '../../freshness/freshness.service';
import { ResponseMessage, successResponse } from '../../utils/response.util';
import type { ProductApiResponse, ProductFeedItem } from '../../types/product.types';
import {
  enrichProductsWithCreatorAvatars,
  normalizePrimaryCreatorOnProduct,
} from '../../utils/product-response.util';

type ProductLike = Record<string, unknown> & {
  aiIntelligence?: {
    confidence?: number;
    confidenceReason?: string;
    buyingSentimentScore?: number;
    buyingSentimentReason?: string;
    marketingAnalysis?: Record<string, unknown> | null;
    brand?: string;
    niche?: string;
    audience?: string[];
    productType?: string;
    priceBand?: string;
    problemStatement?: string;
    valueStatement?: string;
    extractedAt?: string | Date;
  };
  trend?: {
    direction?: string;
    score?: number;
    reason?: string;
    isTrending?: boolean;
  };
  topVideos?: Array<{
    videoId?: string;
    url?: string;
    playUrl?: string;
    thumbnailUrl?: string;
    viewCount?: number;
    likeCount?: number;
    commentCount?: number;
    shareCount?: number;
    creatorHandle?: string;
    creatorDisplayName?: string;
    creatorFollowers?: number;
    creatorRegion?: string;
    creatorVerified?: boolean;
    creatorAvatarUrl?: string;
    publishedAt?: string | Date;
    isAd?: boolean;
  }>;
  toObject?: () => Record<string, unknown>;
};

async function toPlainWithImages(inputs: ProductLike[]): Promise<Record<string, unknown>[]> {
  return inputs.map((p) =>
    typeof p.toObject === 'function' ? p.toObject() : { ...p }
  ) as Record<string, unknown>[];
}

// Removed buildCreatorsVideos as 'topVideos' is deleted. It is now handled via the /creatives endpoint.
// Removed getProfileCountryCode — market is now determined by attachMarketModels middleware
// which reads req.user.contentRegion and resolves req.models to the correct per-market collection.

function collectProductImageUrls(product: Record<string, unknown>): string[] {
  const primary =
    typeof product.primaryImageUrl === 'string' ? product.primaryImageUrl.trim() : '';
  const fromArray = Array.isArray(product.imageUrls)
    ? product.imageUrls
        .filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
        .map((u) => u.trim())
    : [];
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const url of [primary, ...fromArray]) {
    if (url && !seen.has(url)) {
      seen.add(url);
      urls.push(url);
    }
  }
  return urls;
}

function maxCompetitorScore(suppliers: unknown): number | null {
  if (!Array.isArray(suppliers)) return null;
  let max: number | null = null;
  for (const row of suppliers) {
    const score = Number((row as { competitorScore?: number })?.competitorScore);
    if (Number.isFinite(score) && (max === null || score > max)) max = score;
  }
  return max;
}

/** Lean payload for discovery product cards (`GET /products`). */
function formatProductFeedItem(input: ProductLike): ProductFeedItem {
  const product = typeof input.toObject === 'function' ? input.toObject() : input;
  const aiIntelligence = (product.aiIntelligence ?? {}) as NonNullable<ProductLike['aiIntelligence']>;
  const trend = (product.trend ?? {}) as NonNullable<ProductLike['trend']>;
  const ratingSources = Array.isArray((product as any).ratingSources) ? (product as any).ratingSources : [];
  const derivedRating = deriveAverageRatingFromSources(ratingSources);
  const finalRating =
    typeof (product as any).rating === 'number' && (product as any).rating > 0
      ? (product as any).rating
      : derivedRating;
  const discoverySections = Array.isArray((product as any).discoverySections)
    ? ((product as any).discoverySections as string[])
    : [];
  const imageUrls = collectProductImageUrls(product as Record<string, unknown>);

  const item: ProductFeedItem = {
    id: String((product as any)._id ?? (product as any).id),
    title: String(product.title ?? ''),
    primaryImageUrl: imageUrls[0] ?? (product as any).primaryImageUrl,
    imageUrls,
    price: (product as any).price,
    currency: (product as any).currency,
    categoryL1: String((product as any).categoryL1 ?? ''),
    categoryPath: (product as any).categoryPath,
    rating: finalRating,
    ratings: finalRating,
    totalSales: (product as any).totalSales,
    totalGmv: (product as any).totalGmv,
    salesTrend: (product as any).salesTrend ?? null,
    shopName: (product as any).shopName,
    shopAvatarUrl: (product as any).shopAvatarUrl ?? null,
    lastIngestedAt: (product as any).lastIngestedAt,
    isTopAd: discoverySections.includes('top-ads'),
    competitionScore: maxCompetitorScore((product as any).suppliers),
    aiInsight: {
      confidence: { score: aiIntelligence.confidence },
      buyingSentiment: { score: aiIntelligence.buyingSentimentScore },
    },
    trend: {
      score: trend.score,
      direction: trend.direction,
      isTrending: Boolean(trend.isTrending),
    },
  };

  if (product.primaryCreator) {
    item.primaryCreator = { ...(product.primaryCreator as object) } as ProductFeedItem['primaryCreator'];
    normalizePrimaryCreatorOnProduct(item as unknown as Record<string, unknown>);
  }

  return item;
}

function formatProductResponse(input: ProductLike): ProductApiResponse {
  const product = typeof input.toObject === 'function' ? input.toObject() : input;
  const aiIntelligence = (product.aiIntelligence ?? {}) as NonNullable<ProductLike['aiIntelligence']>;
  const trend = (product.trend ?? {}) as NonNullable<ProductLike['trend']>;
  const ratingSources = Array.isArray((product as any).ratingSources) ? (product as any).ratingSources : [];
  const derivedRating = deriveAverageRatingFromSources(ratingSources);
  const finalRating = typeof (product as any).rating === 'number' && (product as any).rating > 0
    ? (product as any).rating
    : derivedRating;
  const discoverySections = Array.isArray((product as any).discoverySections)
    ? ((product as any).discoverySections as string[])
    : [];

  const response = {
    ...product,
    rating: finalRating,
    ratings: finalRating,
    isTopAd: discoverySections.includes('top-ads'),
    trend: {
      ...trend,
      isTrending: Boolean(trend.isTrending),
      reason: trend.reason,
    },
    aiInsight: {
      confidence: {
        score: aiIntelligence.confidence,
        reason: aiIntelligence.confidenceReason,
      },
      buyingSentiment: {
        score: aiIntelligence.buyingSentimentScore,
        reason: aiIntelligence.buyingSentimentReason,
      },
      marketingAnalysis: aiIntelligence.marketingAnalysis ?? null,
      brand: aiIntelligence.brand,
      niche: aiIntelligence.niche,
      audience: aiIntelligence.audience,
      productType: aiIntelligence.productType,
      priceBand: aiIntelligence.priceBand,
      problemStatement: aiIntelligence.problemStatement,
      valueStatement: aiIntelligence.valueStatement,
      extractedAt: aiIntelligence.extractedAt,
    },
  } as Record<string, unknown>;

  delete response.aiIntelligence;
  delete response.aiExtraction; // Cleanup legacy field if present

  normalizePrimaryCreatorOnProduct(response);

  return response as ProductApiResponse;
}

function deriveAverageRatingFromSources(sources: any[]): number | undefined {
  if (!Array.isArray(sources) || sources.length === 0) return undefined;
  let weighted = 0;
  let reviews = 0;
  for (const source of sources) {
    const rating = Number(source?.rating);
    const reviewCount = Number(source?.reviewCount);
    if (Number.isFinite(rating) && Number.isFinite(reviewCount) && rating > 0 && reviewCount > 0) {
      weighted += rating * reviewCount;
      reviews += reviewCount;
    }
  }
  if (reviews <= 0) return undefined;
  return Math.round((weighted / reviews) * 10) / 10;
}

/**
 * Product Controller
 *
 * GET /api/v1/products — paginated list or full-text search (`q`); optional filters
 * GET /api/v1/products/:id — product detail
 */

export const ProductController = {

  async feed(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = req.query as unknown as ProductFeedQuery;
      // Market is determined by attachMarketModels (req.models.Product → products_us, products_uk, etc.)
      // The collection IS the market — no userRegion filter needed.

      if (query.q) {
        const results = await ProductService.search(query.q, query.category, query.page, query.limit, {
          section: query.section,
          isAd: query.isAd,
          sortBy: query.sortBy,
        }, req.models?.Product);
        const freshness = await FreshnessService.getResponseMetadata('product');

        const searchPlains = await enrichProductsWithCreatorAvatars(
          await toPlainWithImages(results.data as unknown as ProductLike[]),
        );
        res.json(
          successResponse(
            {
              products: searchPlains.map(formatProductFeedItem),
              pagination: results.pagination,
              freshness,
            },
            ResponseMessage.PRODUCTS_RETRIEVED,
            200
          )
        );
        return;
      }

      const { feed, freshness } = await ProductService.getFeed({
        category:    query.category,
        subcategory: query.subcategory,
        trendDirection: query.trendDirection,
        minTrendScore: query.minTrendScore,
        minViews: query.minViews,
        isAd: query.isAd,
        section: query.section,
        page: query.page,
        limit: query.limit,
        sortBy: query.sortBy,
      }, req.models?.Product);

      const feedPlains = await enrichProductsWithCreatorAvatars(
        await toPlainWithImages(feed.data as unknown as ProductLike[]),
      );
      res.json(
        successResponse(
          {
            products: feedPlains.map(formatProductFeedItem),
            pagination: feed.pagination,
            freshness,
          },
          ResponseMessage.PRODUCTS_RETRIEVED,
          200
        )
      );
    } catch (err) {
      next(err);
    }
  },

  async detail(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      const [{ product, freshness }, relatedDocs] = await Promise.all([
        ProductService.getById(id, req.models?.Product),
        getRelatedProducts(id, req.models?.Product),
      ]);

      const [plain, ...relatedPlains] = await enrichProductsWithCreatorAvatars(
        await toPlainWithImages([
          product as unknown as ProductLike,
          ...relatedDocs as unknown as ProductLike[],
        ]),
      );

      res.json(
        successResponse(
          {
            product: formatProductResponse(plain as ProductLike),
            relatedProducts: relatedPlains.map(formatProductFeedItem),
            freshness,
          },
          ResponseMessage.PRODUCT_RETRIEVED,
          200
        )
      );
    } catch (err) {
      next(err);
    }
  },

  async creatives(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { Creative } = await import('../../models/creative.model');
      
      const creatives = await Creative.find({ productId: id })
        .sort({ 'metrics.viewCount': -1 })
        .limit(100);

      const creatorsMap = new Map<string, any>();
      
      for (const doc of creatives) {
        const creative = doc.toObject();
        const handle = creative.creator?.handle || 'unknown';
        
        if (!creatorsMap.has(handle)) {
          creatorsMap.set(handle, {
            ...creative.creator, // Now correctly spreads plain object fields
            totalViews: 0,
            videos: [],
          });
        }
        
        const existing = creatorsMap.get(handle);
        existing.totalViews += (creative.metrics?.viewCount || 0);
        
        existing.videos.push({
          id: creative._id,
          externalVideoId: creative.externalVideoId,
          embedUrl: creative.embedUrl,
          tiktokPostUrl: creative.tiktokPostUrl,
          thumbnailUrl: creative.thumbnailUrl,
          metrics: creative.metrics,
          section: creative.section,
          isIndependentCreator: creative.isIndependentCreator,
        });
      }
      
      const groupedCreators = [...creatorsMap.values()].sort((a, b) => b.totalViews - a.totalViews);

      res.json(
        successResponse(
          { creators: groupedCreators },
          'Creatives retrieved successfully',
          200
        )
      );
    } catch (err) {
      next(err);
    }
  },

  async saved(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        res.json(successResponse({ products: [], pagination: { total: 0, pages: 0, page: 1, limit: 20 } }, ResponseMessage.PRODUCTS_RETRIEVED, 200));
        return;
      }

      // Populate savedProducts to get full product data
      const user = await req.user.populate('savedProducts.productId');
      const savedDocs = user.savedProducts
        .filter(p => p.productId)
        .map(p => p.productId as unknown as ProductLike);
      const savedPlains = await enrichProductsWithCreatorAvatars(
        await toPlainWithImages(savedDocs),
      );
      const products = savedPlains.map(formatProductResponse);

      res.json(
        successResponse(
          { 
            products,
            pagination: { total: products.length, pages: 1, page: 1, limit: products.length || 20 }
          },
          ResponseMessage.PRODUCTS_RETRIEVED,
          200
        )
      );
    } catch (err) {
      next(err);
    }
  },

  async categories(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const categories = await ProductService.getCategories();
      res.json(successResponse({ categories }, ResponseMessage.SUCCESS, 200));
    } catch (err) {
      next(err);
    }
  },

  async subcategories(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const category = req.query.category as string | undefined;
      const data = await ProductService.getSubcategories(category);
      res.json(successResponse(data, ResponseMessage.SUCCESS, 200));
    } catch (err) {
      next(err);
    }
  },

  async taxonomy(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = await ProductService.getTaxonomy();
      res.json(successResponse(data, ResponseMessage.SUCCESS, 200));
    } catch (err) {
      next(err);
    }
  },

  async keywordContext(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = req.query as unknown as ProductKeywordContextQuery;
      const country = (query.country ?? req.user?.contentRegion ?? 'US').toLowerCase();
      const result = await ProductService.keywordContext({
        ...query,
        country,
      });

      res.json(
        successResponse(
          result,
          ResponseMessage.SUCCESS,
          200
        )
      );
    } catch (err) {
      next(err);
    }
  },
};
