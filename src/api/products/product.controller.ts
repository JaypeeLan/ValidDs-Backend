import { Request, Response, NextFunction } from 'express';
import { ProductService } from '../../services/product.service';
import { ProductFeedQuery, ProductKeywordContextQuery } from './product.validator';
import { FreshnessService } from '../../freshness/freshness.service';
import { ResponseMessage, successResponse } from '../../utils/response.util';

type ProductLike = Record<string, unknown> & {
  aiIntelligence?: {
    confidence?: number;
    confidenceReason?: string;
    buyingSentimentScore?: number;
    buyingSentimentReason?: string;
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

function getProfileCountryCode(req: Request): string {
  if (!req.user) return 'us';
  if (req.user.contentRegion) return req.user.contentRegion.toLowerCase();
  const locale = req.user.locale;
  if (locale && locale.includes('-')) {
    return locale.split('-')[1].toLowerCase();
  }
  return 'us';
}

// Removed buildCreatorsVideos as 'topVideos' is deleted. It is now handled via the /creatives endpoint.

function formatProductResponse(input: ProductLike): Record<string, unknown> {
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
    },
  } as Record<string, unknown>;

  delete response.aiIntelligence;
  delete response.aiExtraction; // Cleanup legacy field if present

  return response;
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

      if (!query.region) {
        query.region = getProfileCountryCode(req).toUpperCase();
      }

      if (query.q) {
        const results = await ProductService.search(query.q, query.category, query.page, query.limit, {
          section: query.section,
          isAd: query.isAd,
        });
        const freshness = await FreshnessService.getResponseMetadata('product');

        const searchPlains = await toPlainWithImages(results.data as unknown as ProductLike[]);
        res.json(
          successResponse(
            {
              products: searchPlains.map(formatProductResponse),
              pagination: results.pagination,
              freshness,
              region: query.region,
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
        userRegion: query.region,
      });

      const feedPlains = await toPlainWithImages(feed.data as unknown as ProductLike[]);
      res.json(
        successResponse(
          {
            products: feedPlains.map(formatProductResponse),
            pagination: feed.pagination,
            freshness,
            region: query.region,
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
      const { product, freshness } = await ProductService.getById(id);
      const [plain] = await toPlainWithImages([product as unknown as ProductLike]);

      res.json(
        successResponse(
          { product: formatProductResponse(plain as ProductLike), freshness },
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
      const savedPlains = await toPlainWithImages(savedDocs);
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
      const country = (query.country ?? getProfileCountryCode(req)).toLowerCase();
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
