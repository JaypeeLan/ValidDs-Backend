import { ExtractedProduct, NormalizedPost } from '../ingestion/ingestion.types';
import { RainforestProduct } from './rainforest.types';
import { ProductRepository, EnrichedProductInput } from '../db/repositories/product.repository';
import { IProductDocument } from '../models/product.model';
import { logger } from '../logger';

const log = logger.child({ module: 'product-enricher' });

/**
 * Product Enricher
 *
 * Merges AI extraction data (Gemini) with Amazon data (Rainforest)
 * into a single, fully-enriched product document and writes it to the DB.
 *
 * Called by the hashtag ingestion pipeline after both AI extraction
 * and Rainforest lookup have completed for a single post.
 */
export const ProductEnricher = {

  /**
   * Merge AI extraction output with Rainforest Amazon search results,
   * then upsert the enriched product into MongoDB.
   *
   * Rainforest may return 0-20 results for a product name search.
   * - Average price  = mean of all prices with valid values (0 if none)
   * - Best title     = shortest Rainforest title ≤ 80 chars, fallback to productName
   * - Primary image  = first Rainforest result image
   * - Image array    = all unique Rainforest images
   */
  async mergeAndUpsert(
    extraction: ExtractedProduct,
    rainforestResults: RainforestProduct[],
    post: NormalizedPost
  ): Promise<IProductDocument> {
    const { avgPrice, minPrice, maxPrice } = computePriceStats(rainforestResults);
    const title = pickBestTitle(rainforestResults, extraction.productName);
    const { primaryImageUrl, imageUrls } = collectImages(rainforestResults, post.thumbnailUrl);

    const input: EnrichedProductInput = {
      // TikTok post metadata
      videoId:         post.videoId,
      source:          post.source,
      hashtags:        post.hashtags,
      viewCount:       post.viewCount,
      likeCount:       post.likeCount,
      commentCount:    post.commentCount,
      shareCount:      post.shareCount,
      engagementRate:  post.engagementRate,
      videoUrl:        post.videoUrl,
      thumbnailUrl:    post.thumbnailUrl,
      creatorHandle:   post.creatorHandle,
      creatorFollowers: post.creatorFollowers,
      publishedAt:     post.publishedAt,
      collectedAt:     post.collectedAt,
      isAd:            post.isAd,

      // Gemini AI extraction
      category:         extraction.productNiche,
      description:      extraction.productDescription,
      aiConfidence:     extraction.extractionConfidence,
      trendScore:       extraction.trendScore,
      trendDirection:   extraction.trendDirection,
      trendReason:      extraction.trendReason,
      sentimentSummary: extraction.sentimentSummary,
      buyingIntentScore: extraction.buyingIntentScore,

      // Rainforest Amazon enrichment
      title,
      price:          avgPrice,
      priceMin:       minPrice,
      priceMax:       maxPrice,
      currency:       'USD',
      primaryImageUrl,
      imageUrls,
    };

    log.debug('Upserting enriched product', {
      videoId: post.videoId,
      title,
      avgPrice,
      images: imageUrls.length,
    });

    return ProductRepository.upsertEnrichedProduct(input);
  },

  /**
   * Clears all products from the database.
   */
  async purgeData(): Promise<void> {
    await ProductRepository.purgeAll();
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Compute average, min, and max price from Rainforest results.
 * Ignores null / 0 prices. Returns 0 as avg if no prices found (per spec).
 */
function computePriceStats(results: RainforestProduct[]): {
  avgPrice: number;
  minPrice: number | undefined;
  maxPrice: number | undefined;
} {
  const prices = results
    .map(r => r.price?.value ?? r.prices?.[0]?.value)
    .filter((p): p is number => typeof p === 'number' && p > 0);

  if (prices.length === 0) {
    return { avgPrice: 0, minPrice: undefined, maxPrice: undefined };
  }

  const avg = prices.reduce((sum, p) => sum + p, 0) / prices.length;

  return {
    avgPrice: Math.round(avg * 100) / 100,
    minPrice: Math.min(...prices),
    maxPrice: Math.max(...prices),
  };
}

/**
 * Pick the best Amazon product title for the product card.
 * Strategy: shortest title ≤ 80 chars from the top 5 results.
 * Falls back to truncating the first result, then to the AI product name.
 */
function pickBestTitle(results: RainforestProduct[], fallback: string): string {
  const titles = results
    .slice(0, 5)
    .map(r => r.title?.trim())
    .filter((t): t is string => Boolean(t));

  // Prefer the shortest title that fits inside 80 chars
  const short = titles.find(t => t.length <= 80);
  if (short) return short;

  // Truncate the first title if it's too long
  if (titles[0]) return titles[0].slice(0, 80).trim();

  // Ultimate fallback: the AI-extracted product name
  return fallback.slice(0, 80).trim();
}

/**
 * Collect product images from Rainforest results.
 * primaryImageUrl = first available image.
 * imageUrls = all unique images across results (max 10).
 * Falls back to the TikTok thumbnail if Rainforest has no images.
 */
function collectImages(
  results: RainforestProduct[],
  tiktokThumbnail?: string
): { primaryImageUrl: string | undefined; imageUrls: string[] } {
  const allImages = results
    .map(r => r.image)
    .filter((img): img is string => Boolean(img));

  const uniqueImages = [...new Set(allImages)].slice(0, 10);

  if (uniqueImages.length > 0) {
    return { primaryImageUrl: uniqueImages[0], imageUrls: uniqueImages };
  }

  // Fallback to the TikTok post thumbnail
  if (tiktokThumbnail) {
    return { primaryImageUrl: tiktokThumbnail, imageUrls: [tiktokThumbnail] };
  }

  return { primaryImageUrl: undefined, imageUrls: [] };
}
