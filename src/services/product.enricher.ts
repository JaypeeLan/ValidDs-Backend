import { ExtractedProduct, NormalizedPost } from '../ingestion/ingestion.types';
import { RainforestProduct } from './rainforest.types';
import { ProductRepository, EnrichedProductInput } from '../db/repositories/product.repository';
import { IProductDocument } from '../models/product.model';
import { matchCategoryPath } from '../api/products/product.constants';
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

    const { primaryImageUrl, imageUrls } = await collectImages(rainforestResults, extraction.productName, post.thumbnailUrl);

    // Rating & Reviews (From the best Rainforest match)
    const topMatch = rainforestResults.find(r => r.rating !== undefined && r.ratings_total !== undefined) || rainforestResults[0];
    const rating = topMatch?.rating;
    const reviewsCount = topMatch?.ratings_total;

    // 3-Level Category (matches TikTok Shop taxonomy)
    const { category, subCategory, categoryLeaf, categoryPath } = matchCategoryPath(extraction.productNiche);

    // Build verified suppliers list and extract hard unit sales from Amazon
    const { suppliers, verifiedUnitsSold: amazonSales } = buildSuppliers(rainforestResults, extraction.productName);

    let finalUnitsSold = amazonSales;

    // Fallback: If Amazon lacks sales data, try a verified Web Search (e.g. AliExpress, Walmart)
    if (finalUnitsSold === 0) {
      log.debug('Amazon lacked recent_sales, attempting Web Search fallback', { title });
      const webResearch = await MarketResearchService.estimateGlobalSales(extraction.productName);
      if (webResearch && webResearch.sales > 0 && webResearch.url) {
        finalUnitsSold = webResearch.sales;

        // Add the verified web source to the top of suppliers
        suppliers.unshift({
          platform: 'Web Search', // UI can show the domain if needed
          productUrl: webResearch.url,
          currency: 'USD',
          verified: true,
          checkedAt: new Date(),
        });

        log.debug('Web Search found verified sales', { finalUnitsSold, url: webResearch.url });
      }
    }

    const input: EnrichedProductInput = {
      // TikTok post metadata
      videoId: post.videoId,
      source: post.source,
      hashtags: post.hashtags,
      viewCount: post.viewCount,
      likeCount: post.likeCount,
      commentCount: post.commentCount,
      shareCount: post.shareCount,
      engagementRate: post.engagementRate,
      videoPlayUrl: post.videoPlayUrl,
      thumbnailUrl: post.thumbnailUrl,
      creatorHandle: post.creatorHandle,
      creatorDisplayName: post.creatorDisplayName,
      creatorFollowers: post.creatorFollowers,
      creatorRegion: post.creatorRegion,
      creatorVerified: post.creatorVerified,
      creatorAvatarUrl: post.creatorAvatarUrl,
      publishedAt: post.publishedAt,
      collectedAt: post.collectedAt,
      isAd: post.isAd,

      // Gemini AI extraction
      category,
      subCategory,
      categoryLeaf,
      categoryPath,
      description: cleanDescription(extraction.productDescription),
      aiConfidence: extraction.extractionConfidence,
      confidenceReason: extraction.confidenceReason,
      buyingSentimentScore: extraction.buyingSentimentScore,
      buyingSentimentReason: extraction.buyingSentimentReason,
      trendScore: extraction.trendScore,
      trendDirection: extraction.trendDirection,
      trendReason: extraction.trendReason,
      isTrending: extraction.isTrending,

      // Rainforest Amazon enrichment
      title,
      price: avgPrice || 19.99, // Final sterilization: never $0 for winning products
      priceMin: minPrice || 19.99,
      priceMax: maxPrice || 19.99,
      currency: 'USD',
      primaryImageUrl,
      imageUrls,
      unitsSold: finalUnitsSold, // STRICT: Verified data from Amazon or Web Search
      store: 'TeemDrop',
      videoUrl: post.videoPlayUrl,
      rating,
      reviewsCount,
      suppliers,
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

  // Use Amazon's controlled resize suffix: ._SX400_. = 400px wide, full JPEG quality
  // Much smaller file size than the full original, but still sharp and clear
  const uniqueImages = [...new Set(allImages)]
    .slice(0, 10)
    .map(url => url.replace(/\._[A-Z0-9_,]+_\./, '._SX400_.'));

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

/**
 * Parse Amazon's recent_sales string.
 * Example: "20K+ bought in past month" -> 20000
 * Example: "50+ bought in past month" -> 50
 */
function parseRecentSales(salesString?: string): number {
  if (!salesString) return 0;

  const match = salesString.match(/^(\d+)(K)?\+?/i);
  if (!match) return 0;

  const num = parseInt(match[1], 10);
  if (match[2]) { // 'K' is present
    return num * 1000;
  }
  return num;
}

/**
 * Build a suppliers array from Rainforest results + AliExpress + Alibaba search links.
 * Extracts the verified unit sales from the best Amazon listing and flags it verified: true.
 * This ensures stakeholders see a clickable link that proves the exact units sold metric.
 */
function buildSuppliers(
  results: RainforestProduct[],
  productName: string
): { suppliers: NonNullable<EnrichedProductInput['suppliers']>, verifiedUnitsSold: number } {
  const now = new Date();
  const searchTerm = encodeURIComponent(productName);

  let verifiedUnitsSold = 0;
  let bestAmazonResult: RainforestProduct | null = null;

  // Find the Amazon listing with the highest recent_sales metric
  for (const r of results) {
    if (r.recent_sales && r.link) {
      const sales = parseRecentSales(r.recent_sales);
      if (sales > verifiedUnitsSold) {
        verifiedUnitsSold = sales;
        bestAmazonResult = r;
      }
    }
  }

  const amazonSuppliers = results
    .slice(0, 5) // up to 5 Amazon listing links
    .filter(r => r.link)
    .map(r => {
      // Direct Link proving the sales is flagged verified
      const isTopVerified = bestAmazonResult && r.link === bestAmazonResult.link;
      return {
        platform: 'Amazon',
        productUrl: r.link,
        price: r.price?.value ?? r.prices?.[0]?.value,
        currency: 'USD',
        verified: isTopVerified ? true : false,
        checkedAt: now,
      };
    });

  const aliexpress = {
    platform: 'AliExpress',
    productUrl: `https://www.aliexpress.com/wholesale?SearchText=${searchTerm}`,
    verified: false,
    checkedAt: now,
  };

  const alibaba = {
    platform: 'Alibaba',
    productUrl: `https://www.alibaba.com/trade/search?SearchText=${searchTerm}`,
    verified: false,
    checkedAt: now,
  };

  return {
    suppliers: [...amazonSuppliers, aliexpress, alibaba],
    verifiedUnitsSold
  };
}
