import type { IAIIntelligence, IProduct, ProductFeedItem } from '../types/product.types';
import { imageAssetKey } from './creative-response.util';
import { buildProductItemFreshness } from './product-freshness.util';
import { postRecencyFlags } from './product-recency.util';
import { normalizePrimaryCreatorOnProduct, supplierHasRating } from './product-response.util';
import { resolveEngagementTrend } from './product-trend.util';
import { resolveShopProductUrl, resolveShopStoreUrl } from './shop-avatar.util';
import { buildStoreLinks } from './store-links.util';
import { resolveProductIsAd } from './discovery-sections.util';

export type ProductFeedFormatInput = Record<string, unknown> & {
  aiIntelligence?: IAIIntelligence;
  ratingSources?: IProduct['ratingSources'];
  toObject?: () => Record<string, unknown>;
};

const NON_PRODUCT_IMAGE_RE =
  /biz_tag=tt_video|sc=feed_cover|\/avt-|feed_cover|\/(?:logo|icon|badge|avatar|placeholder)/i;

function toProductPlain(input: ProductFeedFormatInput): Record<string, unknown> {
  return typeof input.toObject === 'function' ? input.toObject() : { ...input };
}

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
    if (!supplierHasRating(row)) continue;
    const score = Number((row as { competitorScore?: number })?.competitorScore);
    if (Number.isFinite(score) && (max === null || score > max)) max = score;
  }
  return max;
}

function resolveOriginalPrice(product: Record<string, unknown>): number | null {
  const sale = product.price;
  const raw = product.originalPrice;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return null;
  if (typeof sale === 'number' && sale > 0 && raw <= sale) return null;
  return raw;
}

export function deriveAverageRatingFromSources(
  sources: Array<{ rating?: number; reviewCount?: number }>,
): number | undefined {
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

/** Lean payload for discovery product cards (`GET /products`, bookmarks). */
export function formatProductFeedItem(input: ProductFeedFormatInput): ProductFeedItem {
  const product = toProductPlain(input);
  const engagement = resolveEngagementTrend(product);
  const ratingSources = Array.isArray(product.ratingSources) ? product.ratingSources : [];
  const derivedRating = deriveAverageRatingFromSources(ratingSources);
  const finalRating =
    typeof product.rating === 'number' && product.rating > 0 ? product.rating : derivedRating;
  const imageUrls = collectProductImageUrls(product);
  const postDate = product.publishedAt ?? product.postCreatedAt;
  const { isNew3d, isNew7d } = postRecencyFlags(postDate);
  const ai = (input.aiIntelligence ?? product.aiIntelligence) as IAIIntelligence | undefined;

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

  const item: ProductFeedItem = {
    id: String(product._id ?? product.id),
    title: String(product.title ?? ''),
    primaryImageUrl: imageUrls[0] ?? (product.primaryImageUrl as string | undefined),
    imageUrls,
    price: product.price as number | undefined,
    originalPrice: resolveOriginalPrice(product),
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
    shopUrl: resolvedShopUrl,
    shopAvatarUrl: (product.shopAvatarUrl as string | null | undefined) ?? null,
    officialWebsiteUrl: officialWebsiteUrl ?? null,
    storeLinks: buildStoreLinks({
      shopUrl: resolvedShopUrl,
      productUrl: resolvedProductUrl,
      listingId: product.externalId as string | undefined,
      shopName: product.shopName as string | undefined,
      officialWebsiteUrl,
      officialProductUrl,
    }),
    shopAvatarProxyUrl:
      typeof (product as { shopAvatarProxyUrl?: unknown }).shopAvatarProxyUrl === 'string'
        ? ((product as { shopAvatarProxyUrl?: string }).shopAvatarProxyUrl as string)
        : undefined,
    lastIngestedAt: product.lastIngestedAt as string | Date,
    freshness: buildProductItemFreshness(product),
    publishedAt: postDate as string | Date | null | undefined,
    isNew3d,
    isNew7d,
    isTopAd: resolveProductIsAd(product),
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
