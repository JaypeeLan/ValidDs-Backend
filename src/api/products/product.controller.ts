import { Request, Response, NextFunction } from 'express';
import { ProductService } from '../../services/product.service';
import { ProductFeedQuery, ProductSearchQuery, ProductKeywordContextQuery } from './product.validator';
import { ResponseMessage, successResponse } from '../../utils/response.util';

type ProductLike = Record<string, unknown> & {
  aiExtraction?: {
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

function buildCreatorsVideos(topVideos: NonNullable<ProductLike['topVideos']>): Array<Record<string, unknown>> {
  const creators = new Map<string, {
    handle: string;
    displayName?: string;
    followers?: number;
    region?: string;
    verified?: boolean;
    avatarUrl?: string;
    totalViews: number;
    videos: Array<Record<string, unknown>>;
  }>();

  for (const video of topVideos) {
    const handle = video.creatorHandle || 'unknown';
    const existing = creators.get(handle) ?? {
      handle,
      displayName: video.creatorDisplayName,
      followers: video.creatorFollowers,
      region: video.creatorRegion,
      verified: video.creatorVerified,
      avatarUrl: video.creatorAvatarUrl,
      totalViews: 0,
      videos: [],
    };

    existing.totalViews += video.viewCount ?? 0;
    existing.displayName = existing.displayName || video.creatorDisplayName;
    existing.followers = existing.followers ?? video.creatorFollowers;
    existing.region = existing.region || video.creatorRegion;
    existing.verified = existing.verified ?? video.creatorVerified;
    existing.avatarUrl = existing.avatarUrl || video.creatorAvatarUrl;
    existing.videos.push({
      videoId: video.videoId,
      url: video.url,
      playUrl: video.playUrl,
      thumbnailUrl: video.thumbnailUrl,
      viewCount: video.viewCount ?? 0,
      likeCount: video.likeCount ?? 0,
      commentCount: video.commentCount ?? 0,
      shareCount: video.shareCount ?? 0,
      publishedAt: video.publishedAt,
      isAd: Boolean(video.isAd),
    });
    creators.set(handle, existing);
  }

  const rankedCreators = [...creators.values()].sort((a, b) => b.totalViews - a.totalViews);
  return rankedCreators.map((creator, index) => ({
    handle: creator.handle,
    displayName: creator.displayName,
    followers: creator.followers,
    region: creator.region,
    verified: creator.verified,
    avatarUrl: creator.avatarUrl,
    isPrimary: index === 0,
    videos: creator.videos.sort((a, b) => Number((b.viewCount as number) ?? 0) - Number((a.viewCount as number) ?? 0)),
  }));
}

function formatProductResponse(input: ProductLike): Record<string, unknown> {
  const product = typeof input.toObject === 'function' ? input.toObject() : input;
  const aiExtraction = (product.aiExtraction ?? {}) as NonNullable<ProductLike['aiExtraction']>;
  const trend = (product.trend ?? {}) as NonNullable<ProductLike['trend']>;
  const creatorsVideos = buildCreatorsVideos((product.topVideos ?? []) as NonNullable<ProductLike['topVideos']>);

  const response = {
    ...product,
    trend: {
      ...trend,
      isTrending: Boolean(trend.isTrending),
      reason: trend.reason,
    },
    aiInsight: {
      confidence: {
        score: aiExtraction.confidence,
        reason: aiExtraction.confidenceReason,
      },
      buyingSentiment: {
        score: aiExtraction.buyingSentimentScore,
        reason: aiExtraction.buyingSentimentReason,
      },
    },
    creatorsVideos,
  } as Record<string, unknown>;

  delete response.aiExtraction;
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
