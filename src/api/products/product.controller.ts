import { Request, Response, NextFunction } from 'express';
import { ProductService } from '../../services/product.service';
import { ProductFeedQuery, ProductSearchQuery, ProductKeywordContextQuery } from './product.validator';
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
  const response = {
    ...product,
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

/**
 * Product Controller
 *
 * GET /api/v1/products         — product feed (paginated, filtered)
 * GET /api/v1/products/search  — full-text search
 * GET /api/v1/products/:id     — product detail
 */

export const ProductController = {

  async feed(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = req.query as unknown as ProductFeedQuery;

      if (!query.region) {
        query.region = getProfileCountryCode(req).toUpperCase();
      }

      const { feed, freshness } = await ProductService.getFeed(query);

      res.json(
        successResponse(
          {
            products: feed.data.map((product) => formatProductResponse(product as unknown as ProductLike)),
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

  async all(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { products, freshness } = await ProductService.getAllProducts();

      res.json(
        successResponse(
          {
            products: products.map((product) => formatProductResponse(product as unknown as ProductLike)),
            total: products.length,
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

  async search(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { q, category, page, limit } = req.query as unknown as ProductSearchQuery;
      const results = await ProductService.search(q, category, page, limit);

      res.json(
        successResponse(
          {
            products: results.data.map((product) => formatProductResponse(product as unknown as ProductLike)),
            pagination: results.pagination,
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

      res.json(
        successResponse(
          { product: formatProductResponse(product as unknown as ProductLike), freshness },
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
          videoPlayUrl: creative.videoPlayUrl,
          thumbnailUrl: creative.thumbnailUrl,
          metrics: creative.metrics,
          section: creative.section,
          isAd: creative.isAd,
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
      const products = user.savedProducts
        .filter(p => p.productId) // Guard against deleted products
        .map(p => formatProductResponse(p.productId as unknown as ProductLike));

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
      res.json(
        successResponse(
          { categories },
          ResponseMessage.SUCCESS,
          200
        )
      );
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
