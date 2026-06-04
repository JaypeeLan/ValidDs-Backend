import { Request, Response, NextFunction } from 'express';
import {
  findCreativesByProductId,
  findRelatedAdsByProductId,
  loadPlayableVideoIndexForProduct,
} from '../../services/creative.service';
import { ProductService, getRelatedProducts } from '../../services/product.service';
import {
  ProductFeedQuery,
  ProductKeywordContextQuery,
  ProductRelatedCreativesQuery,
} from './product.validator';
import { FreshnessService } from '../../freshness/freshness.service';
import { ResponseMessage, successResponse } from '../../utils/response.util';
import type {
  IAIIntelligence,
  IProduct,
  IProductReview,
  IProductSupplier,
  IProductTrends,
  ITrend,
  ProductAiInsightResponse,
  ProductApiResponse,
  ProductFeedItem,
} from '../../types/product.types';
import {
  enrichProductsWithCreatorAvatars,
  normalizePrimaryCreatorOnProduct,
} from '../../utils/product-response.util';
import {
  enrichAnglesWithMetaVideoProxyUrls,
  stripAngleExternalLinks,
  enrichAnglesWithVideoProxyUrls,
  enrichAnglesWithFallbackCreativeProxyUrls,
  filterMarketingAnglesWithPlayableVideo,
  normalizeMarketingAngleVideoUrls,
  sortMarketingAnglesWithVideoFirst,
  stripNonPlayableAngleVideoUrls,
} from '../../utils/marketing-angles.util';
import { resolveEngagementTrend } from '../../utils/product-trend.util';
import { resolveBuyingSentimentLabel, type SentimentLabel } from '../../utils/sentiment.util';
import { postRecencyFlags } from '../../utils/product-recency.util';
import { buildProductItemFreshness } from '../../utils/product-freshness.util';
import { formatCreativeFeedItem, imageAssetKey } from '../../utils/creative-response.util';

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

function metaViewerUrlsFromCreatives(creatives: unknown[]): string[] {
  const urls: string[] = [];
  for (const item of creatives) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const ext = String(row.externalVideoId ?? '');
    if (!ext.startsWith('meta:')) continue;
    for (const field of ['metaAdLibraryUrl', 'tiktokPostUrl', 'embedUrl'] as const) {
      const u = row[field];
      if (typeof u === 'string' && u.trim()) urls.push(u.trim());
    }
  }
  return urls;
}

function buildAiInsight(
  aiIntelligence: IAIIntelligence | undefined,
  opts: {
    metaViewerUrls?: string[];
    playableVideoIndex?: Map<string, string>;
    fallbackCreativeId?: string;
    apiVersion?: string;
  } = {},
): ProductAiInsightResponse {
  const ai = aiIntelligence ?? ({} as IAIIntelligence);
  const sentimentLabel = resolveStoredSentimentLabel(ai);
  const rawAngles = ai.marketingAnalysis?.angles ?? [];
  const stripped = stripNonPlayableAngleVideoUrls(
    normalizeMarketingAngleVideoUrls(rawAngles as Record<string, unknown>[]),
  );
  const apiVersion = opts.apiVersion ?? process.env.API_VERSION ?? 'v1';
  const index = opts.playableVideoIndex ?? new Map();
  const withProxy = enrichAnglesWithVideoProxyUrls(stripped, index, apiVersion);
  const withMetaProxy = enrichAnglesWithMetaVideoProxyUrls(withProxy, index, apiVersion);
  const withFallback = enrichAnglesWithFallbackCreativeProxyUrls(
    withMetaProxy,
    opts.fallbackCreativeId,
    apiVersion,
  );
  const angles = filterMarketingAnglesWithPlayableVideo(
    sortMarketingAnglesWithVideoFirst(stripAngleExternalLinks(withFallback)),
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
// Removed getProfileCountryCode — market is now determined by attachMarketModels middleware
// which reads req.user.contentRegion and resolves req.models to the correct per-market collection.

const NON_PRODUCT_IMAGE_RE =
  /biz_tag=tt_video|sc=feed_cover|\/avt-|feed_cover|\/(?:logo|icon|badge|avatar|placeholder)/i;

function isDisplayableProductImage(url: string): boolean {
  const u = url.trim();
  if (!u.startsWith('https://') || NON_PRODUCT_IMAGE_RE.test(u)) return false;
  const dim = u.match(/(?:jpeg|webp|heic|png):(\d+):(\d+)/i);
  if (dim) {
    const w = Number(dim[1]);
    const h = Number(dim[2]);
    if (Math.max(w, h) < 280) return false;
  }
  return true;
}

function collectProductImageUrls(product: Record<string, unknown>): string[] {
  const primary = typeof product.primaryImageUrl === 'string' ? product.primaryImageUrl.trim() : '';
  const fromArray = Array.isArray(product.imageUrls)
    ? product.imageUrls
        .filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
        .map((u) => u.trim())
    : [];
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const url of [primary, ...fromArray]) {
    if (!url || !isDisplayableProductImage(url)) continue;
    const key = imageAssetKey(url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    urls.push(url);
  }
  return urls.slice(0, 12);
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
  const product = toProductPlain(input);
  const engagement = resolveEngagementTrend(product);
  const ratingSources = Array.isArray(product.ratingSources) ? product.ratingSources : [];
  const derivedRating = deriveAverageRatingFromSources(ratingSources);
  const finalRating =
    typeof product.rating === 'number' && product.rating > 0 ? product.rating : derivedRating;
  const discoverySections = Array.isArray(product.discoverySections)
    ? (product.discoverySections as string[])
    : [];
  const imageUrls = collectProductImageUrls(product);
  const postDate = product.publishedAt ?? product.postCreatedAt;
  const { isNew3d, isNew7d } = postRecencyFlags(postDate);
  const ai = (input.aiIntelligence ?? product.aiIntelligence) as IAIIntelligence | undefined;

  const item: ProductFeedItem = {
    id: String(product._id ?? product.id),
    title: String(product.title ?? ''),
    primaryImageUrl: imageUrls[0] ?? (product.primaryImageUrl as string | undefined),
    imageUrls,
    price: product.price as number | undefined,
    currency: product.currency as string | undefined,
    categoryL1: String(product.categoryL1 ?? ''),
    categoryPath: product.categoryPath as string | undefined,
    rating: finalRating,
    ratings: finalRating,
    totalSales: product.totalSales as number | undefined,
    totalGmv: product.totalGmv as number | undefined,
    salesTrend: (product.salesTrend as ProductFeedItem['salesTrend']) ?? null,
    priceTrend: (product.priceTrend as ProductFeedItem['priceTrend']) ?? null,
    shopName: product.shopName as string | undefined,
    shopUrl: product.shopUrl as string | undefined,
    shopAvatarUrl: (product.shopAvatarUrl as string | null | undefined) ?? null,
    shopAvatarProxyUrl:
      typeof (product as { shopAvatarProxyUrl?: unknown }).shopAvatarProxyUrl === 'string'
        ? ((product as { shopAvatarProxyUrl?: string }).shopAvatarProxyUrl as string)
        : undefined,
    lastIngestedAt: product.lastIngestedAt as string | Date,
    freshness: buildProductItemFreshness(product),
    publishedAt: postDate as string | Date | null | undefined,
    isNew3d,
    isNew7d,
    isTopAd: discoverySections.includes('top-ads'),
    competitionScore: maxCompetitorScore(product.suppliers),
    aiInsight: {
      confidence: { score: ai?.confidence },
      reviewSummary: ai?.reviewSummary ?? null,
    },
    trend: {
      score: engagement.score,
      direction: engagement.direction,
      isTrending: engagement.isTrending,
    },
  };

  if (product.primaryCreator) {
    item.primaryCreator = {
      ...(product.primaryCreator as object),
    } as ProductFeedItem['primaryCreator'];
    normalizePrimaryCreatorOnProduct(item as unknown as Record<string, unknown>);
  }

  return item;
}

function formatProductResponse(
  input: ProductLike,
  options: {
    metaViewerUrls?: string[];
    playableVideoIndex?: Map<string, string>;
    fallbackCreativeId?: string;
    apiVersion?: string;
  } = {},
): ProductApiResponse {
  const product = toProductPlain(input);
  const engagement = resolveEngagementTrend(product);
  const ratingSources = Array.isArray(product.ratingSources) ? product.ratingSources : [];
  const derivedRating = deriveAverageRatingFromSources(ratingSources);
  const finalRating =
    typeof product.rating === 'number' && product.rating > 0 ? product.rating : derivedRating;
  const discoverySections = Array.isArray(product.discoverySections)
    ? (product.discoverySections as string[])
    : [];

  const response = {
    ...product,
    rating: finalRating,
    ratings: finalRating,
    reviewCount: product.reviewCount,
    isTopAd: discoverySections.includes('top-ads'),
    trend: engagement,
    trends: product.trends ?? { engagement },
    freshness: buildProductItemFreshness(product),
    aiInsight: buildAiInsight(product.aiIntelligence as IAIIntelligence | undefined, options),
  } as Record<string, unknown>;

  delete response.aiIntelligence;
  delete response.aiExtraction;

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

  async relatedProducts(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const productModel = req.models?.Product;
      const creativeModel = req.models?.Creative;

      await ProductService.getById(id, productModel, req.market);
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

      await ProductService.getById(id, productModel, req.market);
      const relatedVideos = await findCreativesByProductId(id, creativeModel, query.limit);

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

      await ProductService.getById(id, productModel, req.market);
      const relatedAds = await findRelatedAdsByProductId(id, creativeModel, query.limit);

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

      const [{ product, freshness }, relatedDocs, relatedVideos, relatedAds, playableVideoIndex] =
        await Promise.all([
          ProductService.getById(id, productModel, req.market),
          getRelatedProducts(id, productModel, req.market),
          findCreativesByProductId(id, creativeModel),
          findRelatedAdsByProductId(id, creativeModel),
          loadPlayableVideoIndexForProduct(id, creativeModel),
        ]);

      const [plain, ...relatedPlains] = await enrichProductsWithCreatorAvatars(
        await toPlainWithImages([
          product as unknown as ProductLike,
          ...(relatedDocs as unknown as ProductLike[]),
        ]),
        creativeModel,
      );

      const fallbackCreativeId =
        relatedVideos.find((v) => typeof v?.videoProxyUrl === 'string' && v.videoProxyUrl.trim())
          ?.id ?? undefined;

      res.json(
        successResponse(
          {
            product: formatProductResponse(plain as ProductLike, {
              metaViewerUrls: metaViewerUrlsFromCreatives(relatedAds),
              playableVideoIndex,
              fallbackCreativeId,
              apiVersion: process.env.API_VERSION ?? 'v1',
            }),
            relatedProducts: relatedPlains.map(formatProductFeedItem),
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
            { products: [], pagination: { total: 0, pages: 0, page: 1, limit: 20 } },
            ResponseMessage.PRODUCTS_RETRIEVED,
            200,
          ),
        );
        return;
      }

      // Populate savedProducts to get full product data
      const user = await req.user.populate('savedProducts.productId');
      const savedDocs = user.savedProducts
        .filter((p) => p.productId)
        .map((p) => p.productId as unknown as ProductLike);
      const savedPlains = await enrichProductsWithCreatorAvatars(
        await toPlainWithImages(savedDocs),
        req.models?.Creative,
      );
      const products = savedPlains.map(formatProductResponse);

      res.json(
        successResponse(
          {
            products,
            pagination: { total: products.length, pages: 1, page: 1, limit: products.length || 20 },
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
