import { Request, Response, NextFunction } from 'express';
import {
  findCreativesByProductId,
  findRelatedAdsByProductId,
} from '../../services/creative.service';
import { computeValidationEngineV1 } from '../../services/validation-engine';
import type { ValidationProductInput } from '../../services/validation-engine';
import { ProductService, getRelatedProducts } from '../../services/product.service';
import {
  getPersonalizedProducts,
  getYouMayLikeProducts,
} from '../../services/product-recommendation.service';
import { recordProductDiscovery } from '../../services/user-activity.service';
import { User } from '../../models/user.model';
import {
  ProductCompareQuery,
  ProductFeedQuery,
  ProductForYouQuery,
  ProductKeywordContextQuery,
  ProductRelatedCreativesQuery,
  ProductYouMayLikeQuery,
} from './product.validator';
import { FreshnessService } from '../../freshness/freshness.service';
import { ResponseMessage, successResponse } from '../../utils/response.util';
import { resolveShopProductUrl, resolveShopStoreUrl } from '../../utils/shop-avatar.util';
import { buildStoreLinks } from '../../utils/store-links.util';
import type {
  IAIIntelligence,
  IProduct,
  IProductReview,
  IProductSupplier,
  IProductTrends,
  ITrend,
  ProductAiInsightResponse,
  ProductApiResponse,
} from '../../types/product.types';
import {
  enrichProductsWithCreatorAvatars,
  normalizePrimaryCreatorOnProduct,
  normalizeSuppliersOnProduct,
} from '../../utils/product-response.util';
import {
  deriveAverageRatingFromSources,
  formatProductFeedItem,
} from '../../utils/product-feed-format.util';
import {
  normalizeMarketingAngleVideoUrls,
  stripAllAngleVideos,
  stripNonPlayableAngleVideoUrls,
} from '../../utils/marketing-angles.util';
import { resolveEngagementTrend } from '../../utils/product-trend.util';
import { resolveBuyingSentimentLabel, type SentimentLabel } from '../../utils/sentiment.util';
import { buildProductItemFreshness } from '../../utils/product-freshness.util';
import {
  formatCreativeFeedItem,
  shouldExposeCreativeInFeed,
} from '../../utils/creative-response.util';
import { enrichCreativesWithResolvedVideoS3Keys } from '../../services/meta-video-s3-resolve.service';
import { formatUserBookmarks } from '../../services/bookmark.service';
import { resolveProductIsAd } from '../../utils/discovery-sections.util';

type ProductLike = Record<string, unknown> & {
  aiIntelligence?: IAIIntelligence;
  trends?: IProductTrends | null;
  trend?: ITrend;
  ratingSources?: IProduct['ratingSources'];
  reviews?: IProductReview[];
  suppliers?: IProductSupplier[];
  creativeCounts?: IProduct['creativeCounts'];
  toObject?: () => Record<string, unknown>;
};

type ProductPlain = Record<string, unknown>;

function toProductPlain(input: ProductLike): ProductPlain {
  return typeof input.toObject === 'function' ? input.toObject() : { ...input };
}

function resolveStoredSentimentLabel(ai: IAIIntelligence): SentimentLabel {
  const fromAi = ai.buyingSentimentLabel;
  if (fromAi === 'positive' || fromAi === 'neutral' || fromAi === 'negative') return fromAi;
  const fromMa = ai.marketingAnalysis?.sentimentLabel;
  if (fromMa === 'positive' || fromMa === 'neutral' || fromMa === 'negative') return fromMa;
  return resolveBuyingSentimentLabel(ai.buyingSentimentScore);
}

function buildAiInsight(aiIntelligence: IAIIntelligence | undefined): ProductAiInsightResponse {
  const ai = aiIntelligence ?? ({} as IAIIntelligence);
  const sentimentLabel = resolveStoredSentimentLabel(ai);
  const rawAngles = ai.marketingAnalysis?.angles ?? [];
  const angles = stripAllAngleVideos(
    stripNonPlayableAngleVideoUrls(
      normalizeMarketingAngleVideoUrls(rawAngles as Record<string, unknown>[]),
    ),
  );
  const marketingAnalysis = ai.marketingAnalysis
    ? {
        ...ai.marketingAnalysis,
        sentimentLabel: ai.marketingAnalysis.sentimentLabel ?? sentimentLabel,
        angles,
      }
    : null;
  return {
    confidence: {
      score: ai.confidence,
      reason: ai.confidenceReason,
    },
    reviewSummary: ai.reviewSummary ?? null,
    pageSummary: ai.pageSummary ?? null,
    marketingAnalysis,
    brand: ai.brand,
    niche: ai.niche,
    audience: ai.audience,
    productType: ai.productType,
    priceBand: ai.priceBand,
    problemStatement: ai.problemStatement,
    valueStatement: ai.valueStatement,
    extractedAt: ai.extractedAt,
  };
}

async function toPlainWithImages(inputs: ProductLike[]): Promise<Record<string, unknown>[]> {
  return inputs.map((p) => (typeof p.toObject === 'function' ? p.toObject() : { ...p })) as Record<
    string,
    unknown
  >[];
}

// Removed buildCreatorsVideos as 'topVideos' is deleted. It is now handled via the /creatives endpoint.

function formatProductResponse(input: ProductLike): ProductApiResponse {
  const product = toProductPlain(input);
  normalizeSuppliersOnProduct(product);
  const engagement = resolveEngagementTrend(product);
  const ratingSources = Array.isArray(product.ratingSources) ? product.ratingSources : [];
  const derivedRating = deriveAverageRatingFromSources(ratingSources);
  const finalRating =
    typeof product.rating === 'number' && product.rating > 0 ? product.rating : derivedRating;

  const resolvedShopUrl = resolveShopStoreUrl(
    product.shopUrl as string | undefined,
    product.shopName as string | undefined,
  );
  const officialWebsiteUrl =
    typeof product.officialWebsiteUrl === 'string' &&
    product.officialWebsiteUrl.trim().startsWith('https://')
      ? product.officialWebsiteUrl.trim()
      : undefined;
  const officialProductUrl =
    typeof product.officialProductUrl === 'string' &&
    product.officialProductUrl.trim().startsWith('https://')
      ? product.officialProductUrl.trim()
      : undefined;
  const resolvedProductUrl = resolveShopProductUrl(
    product.productUrl as string | undefined,
    product.externalId as string | undefined,
  );

  const response = {
    ...product,
    shopUrl: resolvedShopUrl,
    productUrl: resolvedProductUrl ?? product.productUrl,
    officialWebsiteUrl: officialWebsiteUrl ?? null,
    officialProductUrl: officialProductUrl ?? null,
    storeLinks: buildStoreLinks({
      shopUrl: resolvedShopUrl,
      productUrl: resolvedProductUrl,
      listingId: product.externalId as string | undefined,
      shopName: product.shopName as string | undefined,
      officialWebsiteUrl,
      officialProductUrl,
    }),
    rating: finalRating,
    ratings: finalRating,
    reviewCount: product.reviewCount,
    isTopAd: resolveProductIsAd(product),
    trend: engagement,
    trends: product.trends ?? { engagement },
    freshness: buildProductItemFreshness(product),
    aiInsight: buildAiInsight(product.aiIntelligence as IAIIntelligence | undefined),
  } as Record<string, unknown>;

  delete response.aiIntelligence;
  delete response.aiExtraction;

  normalizePrimaryCreatorOnProduct(response);

  return response as ProductApiResponse;
}

/**
 * Product Controller
 *
 * GET /api/v1/products — paginated list or relevance search (`q` / `search`); optional filters
 * GET /api/v1/products/:id — product detail
 */

export const ProductController = {
  async feed(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = req.query as unknown as ProductFeedQuery;
      const filters = query._filters;

      if (query.q) {
        const results = await ProductService.search(
          query.q,
          { ...filters, page: query.page, limit: query.limit },
          req.models?.Product,
        );
        const freshness = await FreshnessService.getResponseMetadata('product');

        if (req.user?._id) {
          recordProductDiscovery(String(req.user._id), {
            query: query.q,
            filters,
            resultCount: results.pagination.total,
          });
        }

        const searchPlains = await enrichProductsWithCreatorAvatars(
          await toPlainWithImages(results.data as unknown as ProductLike[]),
          req.models?.Creative,
        );
        res.json(
          successResponse(
            {
              products: searchPlains.map(formatProductFeedItem),
              pagination: results.pagination,
              freshness,
            },
            ResponseMessage.PRODUCTS_RETRIEVED,
            200,
          ),
        );
        return;
      }

      const { feed, freshness } = await ProductService.getFeed(
        {
          ...filters,
          page: query.page,
          limit: query.limit,
        },
        req.models?.Product,
        req.market,
      );

      if (
        req.user?._id &&
        (filters.category?.length || filters.subcategory?.length || filters.productKind)
      ) {
        recordProductDiscovery(String(req.user._id), {
          filters,
          resultCount: feed.pagination.total,
        });
      }

      const feedPlains = await enrichProductsWithCreatorAvatars(
        await toPlainWithImages(feed.data as unknown as ProductLike[]),
        req.models?.Creative,
      );
      res.json(
        successResponse(
          {
            products: feedPlains.map(formatProductFeedItem),
            pagination: feed.pagination,
            freshness,
          },
          ResponseMessage.PRODUCTS_RETRIEVED,
          200,
        ),
      );
    } catch (err) {
      next(err);
    }
  },

  async compare(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = req.query as unknown as ProductCompareQuery;
      const productModel = req.models?.Product;

      const result = await ProductService.compare(query.ids, productModel, req.market);

      res.json(successResponse(result, ResponseMessage.PRODUCTS_RETRIEVED, 200));
    } catch (err) {
      next(err);
    }
  },

  async forYou(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = req.query as unknown as ProductForYouQuery;
      const productModel = req.models?.Product;
      const creativeModel = req.models?.Creative;

      const user = await User.findById(req.user!._id).select(
        'savedProducts searchHistory shopifyImportHistory',
      );
      if (!user) {
        res.status(404).json({ success: false, message: 'User not found' });
        return;
      }

      const { products, personalized } = await getPersonalizedProducts(
        user,
        productModel!,
        query.limit,
      );
      const plains = await enrichProductsWithCreatorAvatars(
        await toPlainWithImages(products as unknown as ProductLike[]),
        creativeModel,
      );

      res.json(
        successResponse(
          {
            products: plains.map(formatProductFeedItem),
            personalized,
            pagination: {
              page: query.page,
              limit: query.limit,
              total: plains.length,
              totalPages: 1,
              hasNextPage: false,
              hasPrevPage: false,
            },
          },
          ResponseMessage.PRODUCTS_RETRIEVED,
          200,
        ),
      );
    } catch (err) {
      next(err);
    }
  },

  async youMayLike(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const query = req.query as unknown as ProductYouMayLikeQuery;
      const productModel = req.models?.Product;
      const creativeModel = req.models?.Creative;

      await ProductService.getById(id, productModel, req.market, creativeModel);

      const user = req.user?._id
        ? await User.findById(req.user._id).select(
            'savedProducts searchHistory shopifyImportHistory',
          )
        : null;

      const { products, personalized } = await getYouMayLikeProducts(
        id,
        user ?? undefined,
        productModel!,
        req.market,
        query.limit,
      );
      const plains = await enrichProductsWithCreatorAvatars(
        await toPlainWithImages(products as unknown as ProductLike[]),
        creativeModel,
      );

      res.json(
        successResponse(
          {
            youMayLike: plains.map(formatProductFeedItem),
            personalized,
          },
          ResponseMessage.PRODUCTS_RETRIEVED,
          200,
        ),
      );
    } catch (err) {
      next(err);
    }
  },

  async relatedProducts(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const productModel = req.models?.Product;
      const creativeModel = req.models?.Creative;

      await ProductService.getById(id, productModel, req.market, creativeModel);
      const relatedDocs = await getRelatedProducts(id, productModel, req.market);
      const relatedPlains = await enrichProductsWithCreatorAvatars(
        await toPlainWithImages(relatedDocs as unknown as ProductLike[]),
        creativeModel,
      );

      res.json(
        successResponse(
          { relatedProducts: relatedPlains.map(formatProductFeedItem) },
          ResponseMessage.PRODUCTS_RETRIEVED,
          200,
        ),
      );
    } catch (err) {
      next(err);
    }
  },

  async relatedVideos(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const query = req.query as unknown as ProductRelatedCreativesQuery;
      const productModel = req.models?.Product;
      const creativeModel = req.models?.Creative;

      await ProductService.getById(id, productModel, req.market, creativeModel);
      const relatedVideos = await findCreativesByProductId(
        id,
        creativeModel,
        query.limit,
        query.excludeCreativeId,
      );

      res.json(successResponse({ relatedVideos }, ResponseMessage.CREATIVES_RETRIEVED, 200));
    } catch (err) {
      next(err);
    }
  },

  async relatedAds(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const query = req.query as unknown as ProductRelatedCreativesQuery;
      const productModel = req.models?.Product;
      const creativeModel = req.models?.Creative;

      await ProductService.getById(id, productModel, req.market, creativeModel);
      const relatedAds = await findRelatedAdsByProductId(
        id,
        creativeModel,
        query.limit,
        query.excludeCreativeId,
      );

      res.json(successResponse({ relatedAds }, ResponseMessage.CREATIVES_RETRIEVED, 200));
    } catch (err) {
      next(err);
    }
  },

  async detail(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const productModel = req.models?.Product;
      const creativeModel = req.models?.Creative;

      const [{ product, freshness }, relatedVideos, relatedAds] = await Promise.all([
        ProductService.getById(id, productModel, req.market, creativeModel),
        findCreativesByProductId(id, creativeModel),
        findRelatedAdsByProductId(id, creativeModel),
      ]);

      const [plain] = await enrichProductsWithCreatorAvatars(
        await toPlainWithImages([product as unknown as ProductLike]),
        creativeModel,
      );

      const productResponse = formatProductResponse(plain as ProductLike);
      const validation = computeValidationEngineV1({
        product: plain as ValidationProductInput,
        creatives: [...relatedVideos, ...relatedAds],
      });

      res.json(
        successResponse(
          {
            product: productResponse,
            validation,
            relatedVideos,
            relatedAds,
            freshness,
          },
          ResponseMessage.PRODUCT_RETRIEVED,
          200,
        ),
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
        .limit(100)
        .lean();

      const enriched = await enrichCreativesWithResolvedVideoS3Keys(
        creatives as Record<string, unknown>[],
        Creative,
      );

      const creatorsMap = new Map<string, any>();

      for (const creative of enriched) {
        if (!shouldExposeCreativeInFeed(creative)) continue;
        const handle = (creative.creator as { handle?: string } | undefined)?.handle || 'unknown';

        if (!creatorsMap.has(handle)) {
          creatorsMap.set(handle, {
            ...creative.creator, // Now correctly spreads plain object fields
            totalViews: 0,
            videos: [],
          });
        }

        const existing = creatorsMap.get(handle);
        existing.totalViews += creative.metrics?.viewCount || 0;

        const card = formatCreativeFeedItem(creative);
        if (typeof card.videoProxyUrl !== 'string' || !card.videoProxyUrl.trim()) continue;
        existing.videos.push({
          id: card.id,
          externalVideoId: card.externalVideoId,
          thumbnailUrl: card.thumbnailUrl,
          thumbnailProxyUrl: card.thumbnailProxyUrl,
          videoProxyUrl: card.videoProxyUrl,
          metrics: card.metrics,
          section: card.section,
          isIndependentCreator: card.isIndependentCreator,
        });
      }

      const groupedCreators = [...creatorsMap.values()].sort((a, b) => b.totalViews - a.totalViews);

      res.json(
        successResponse({ creators: groupedCreators }, 'Creatives retrieved successfully', 200),
      );
    } catch (err) {
      next(err);
    }
  },

  async saved(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        res.json(
          successResponse(
            { bookmarks: [], pagination: { total: 0, pages: 0, page: 1, limit: 20 } },
            ResponseMessage.PRODUCTS_RETRIEVED,
            200,
          ),
        );
        return;
      }

      const bookmarks = await formatUserBookmarks(
        req.user,
        req.models?.Creative,
        req.models?.Product,
      );

      res.json(
        successResponse(
          {
            bookmarks,
            pagination: {
              total: bookmarks.length,
              pages: 1,
              page: 1,
              limit: bookmarks.length || 20,
            },
          },
          ResponseMessage.PRODUCTS_RETRIEVED,
          200,
        ),
      );
    } catch (err) {
      next(err);
    }
  },

  async categories(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const categories = await ProductService.getCategories(req.models?.Product, req.market);
      res.json(successResponse({ categories }, ResponseMessage.SUCCESS, 200));
    } catch (err) {
      next(err);
    }
  },

  async subcategories(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const category = req.query.category as string | undefined;
      const data = await ProductService.getSubcategories(category, req.models?.Product, req.market);
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

      res.json(successResponse(result, ResponseMessage.SUCCESS, 200));
    } catch (err) {
      next(err);
    }
  },
};
