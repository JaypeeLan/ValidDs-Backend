import { ExtractedProduct, NormalizedPost } from '../ingestion/ingestion.types';
import { RainforestProduct } from './rainforest.types';
import { ProductRepository, EnrichedProductInput } from '../db/repositories/product.repository';
import { IProductDocument } from '../models/product.model';
import { logger } from '../logger';
import { ImageService } from './image.service';
import { PriceService } from './price.service';
import { MarketResearchService } from './market-research.service';

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
    let { avgPrice, minPrice, maxPrice } = computePriceStats(rainforestResults);
    const title = pickBestTitle(rainforestResults, extraction.productName);
    
    // Fallback price if Rainforest returns 0
    if (avgPrice === 0) {
      log.debug('Rainforest price is 0, attempting web search fallback', { title });
      const webPrice = await PriceService.findProductPrice(extraction.productName);
      if (webPrice) {
        avgPrice = webPrice;
        minPrice = webPrice;
        maxPrice = webPrice;
      }
    }

    // Global Sales Grounding (NEW)
    let globalSales = extraction.unitsSold;
    const researchedSales = await MarketResearchService.estimateGlobalSales(extraction.productName);
    if (researchedSales !== null && researchedSales > (globalSales ?? 0)) {
      log.debug('Google Search found higher global sales volume', { researchedSales });
      globalSales = researchedSales;
    }

    const { primaryImageUrl, imageUrls } = await collectImages(rainforestResults, extraction.productName, post.thumbnailUrl);

    // Rating & Reviews (From the best Rainforest match)
    const topMatch = rainforestResults.find(r => r.rating !== undefined && r.ratings_total !== undefined) || rainforestResults[0];
    const rating = topMatch?.rating;
    const reviewsCount = topMatch?.ratings_total;

    // Sterilize Category (NEW)
    const category = categorize(extraction.productNiche);

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
      videoPlayUrl:    post.videoPlayUrl,
      thumbnailUrl:    post.thumbnailUrl,
      creatorHandle:   post.creatorHandle,
      creatorFollowers: post.creatorFollowers,
      publishedAt:     post.publishedAt,
      collectedAt:     post.collectedAt,
      isAd:            post.isAd,

      // Gemini AI extraction
      category,
      description:      cleanDescription(extraction.productDescription),
      aiConfidence:     extraction.extractionConfidence,
      trendScore:       extraction.trendScore,
      trendDirection:   extraction.trendDirection,
      trendReason:      extraction.trendReason,
      sentimentSummary: extraction.sentimentSummary,
      buyingIntentScore: extraction.buyingIntentScore,

      // Rainforest Amazon enrichment
      title,
      price:          avgPrice || 19.99, // Final sterilization: never $0 for winning products
      priceMin:       minPrice || 19.99,
      priceMax:       maxPrice || 19.99,
      currency:       'USD',
      primaryImageUrl,
      imageUrls,
      unitsSold:      globalSales,
      store:          'TeemDrop',
      videoUrl:       post.videoPlayUrl,
      rating,
      reviewsCount,
    };

    log.debug('Upserting enriched product', {
      videoId: post.videoId,
      title,
      avgPrice,
      images: imageUrls.length,
    });

    return ProductRepository.upsertEnrichedProduct(input);
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
 * Clean a product title — removes emojis, SEO junk, and promotional patterns.
 */
function cleanTitle(title: string): string {
  if (!title) return '';
  return title
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '') // Emojis
    .split(' - ')[0]
    .split(' | ')[0]
    .split(' — ')[0]
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

/**
 * Clean a product description.
 */
function cleanDescription(desc: string): string {
  if (!desc) return '';
  return desc
    .replace(/https?:\/\/\S+/g, '') // remove URLs
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Map a niche to a canonical category.
 */
function categorize(niche: string): string {
  const { PRODUCT_CATEGORIES } = require('../api/products/product.constants');
  const normalized = niche.toLowerCase();
  for (const cat of PRODUCT_CATEGORIES) {
    if (normalized.includes(cat.toLowerCase()) || cat.toLowerCase().includes(normalized)) {
      return cat;
    }
  }
  return 'Home & Kitchen'; // Default
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

  // Clean and shorten Amazon titles to prevent SEO fluff
  const cleanedTitles = titles.map(t => cleanTitle(t));

  // Prefer the shortest cleaned title that fits inside 80 chars
  const short = cleanedTitles.find(t => t.length <= 80);
  if (short) return short;

  // Truncate the first title if it's too long
  if (cleanedTitles[0]) return cleanedTitles[0].slice(0, 80).trim();

  // Ultimate fallback: the AI-extracted product name
  return cleanTitle(fallback);
}

/**
 * Collect product images from Rainforest results.
 * primaryImageUrl = first available image.
 * imageUrls = all unique images across results (max 10).
 * Falls back to the TikTok thumbnail if Rainforest has no images.
 */
/**
 * Collect product images from Rainforest results.
 * primaryImageUrl = first available image, or high-res web search fallback.
 * imageUrls = all unique images across results (max 10).
 * Falls back to the TikTok thumbnail only if all else fails.
 */
async function collectImages(
  results: RainforestProduct[],
  productName: string,
  tiktokThumbnail?: string
): Promise<{ primaryImageUrl: string | undefined; imageUrls: string[] }> {
  const allImages = results
    .map(r => r.image)
    .filter((img): img is string => Boolean(img));

  // Ensure high-res Amazon images by stripping the _AC_... thumbnail suffix
  const uniqueImages = [...new Set(allImages)]
    .slice(0, 10)
    .map(url => url.replace(/\._.*_\./, '.'));

  // If Rainforest has images, use the first one as primary
  if (uniqueImages.length > 0) {
    return { primaryImageUrl: uniqueImages[0], imageUrls: uniqueImages };
  }

  // Fallback 1: Internet Search for HD version (NEW)
  log.debug('Rainforest has no images, attempting HD image web search', { productName });
  const hdImage = await ImageService.findProductImage(productName);
  if (hdImage) {
    return { primaryImageUrl: hdImage, imageUrls: [hdImage] };
  }

  // Fallback 2: The TikTok post thumbnail
  if (tiktokThumbnail) {
    return { primaryImageUrl: tiktokThumbnail, imageUrls: [tiktokThumbnail] };
  }

  return { primaryImageUrl: undefined, imageUrls: [] };
}
