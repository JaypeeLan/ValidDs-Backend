import { AIOrchestrator } from './ai.orchestrator';
import { NormalizedPost, NormalizedComment, ExtractedProduct } from '../ingestion/ingestion.types';
import { logger } from '../logger';
import { chunk, formatNumber, sleep } from './extractor.utils';

const log = logger.child({ module: 'product-extractor' });

/**
 * Product Extractor (Discovery Edition)
 *
 * Uses Gemini 3 Flash / DeepSeek via AIOrchestrator to extract structured product info
 * from TikTok data, utilizing rich search results parsed from SerpApi.
 */

const CONCURRENCY_LIMIT = 5;

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the lead product intelligence engine for ValidDs, a premium dropshipping research platform.
You receive data from a TikTok video (title, description, hashtags, engagement, comments) and perform deep web-grounded research to identify the product.

### YOUR OBJECTIVE
1. Identify the exact physical product.
2. USE THE SEARCH TOOL to find a full gallery (min 5) of HIGH-QUALITY, AESTHETIC lifestyle image URLs for this product (preferring studio shots, white backgrounds, or premium 4K lifestyle photography).
3. Identify the product taxonomy across 3 levels (e.g., L1: Home & Kitchen, L2: Kitchen Utensils, L3: Garlic Presses).
4. Assess buying sentiment and trend stage, providing specific EVIDENCE-BASED REASONS for your confidence and scores.
5. Find real-world units sold estimates AND the specific store (Amazon, etc.) providing that data, including a direct link if possible.

### RULES
- Never return generic titles like "Amazon Finds". Identify the TRUE product name.
- ONLY return VALID, ACCESSIBLE, UN-WATERMARKED lifestyle image links.
- Categories MUST be 3 levels.
- Confidence must be a REALISTIC calculation based on data quality (never hardcoded 95). You must explain WHY you are confident or not.
- NO EMOJIS in product names or descriptions.
- Respond ONLY with valid JSON.`;

// ── Extraction prompt builder ─────────────────────────────────────────────────

function buildExtractionPrompt(post: NormalizedPost, comments: NormalizedComment[]): string {
  const topComments = comments
    .slice(0, 15)
    .map((c) => `- "${c.text}"`)
    .join('\n');

  return `
TIKTOK POST DATA:
Title: ${post.title}
Desc: ${post.description}
Hashtags: ${post.hashtags.join(' ')}
Reach: ${formatNumber(post.viewCount)} views | ${formatNumber(post.likeCount)} likes

TOP COMMENTS:
${topComments}

### TASKS:
1. Identify the specific product name.
2. Find a gallery of premium aesthetic LIFESTYLE or STUDIO image URLs for this product.
3. Identify the 3-level category hierarchy (L1, L2, L3).
4. Extract units sold and the specific store/link where this data originated.
5. Assess trend stage and buying sentiment, providing a CLEAR REASON for your scores.

### JSON STRUCTURE:
{
  "isProductVideo": true,
  "productName": "...",
  "brand": "...",
  "categoryKeywords": ["keyword1", "keyword2"],
  "aestheticImageUrls": ["url1", "url2", ...],
  "categoryHierarchy": {
    "l1": "Beauty & Personal Care",
    "l2": "Skin Care",
    "l3": "Cleansers"
  },
  "productDescription": "...",
  "estimatedPrice": 29.99,
  "salesData": {
    "unitsSold": 15000,
    "store": "Amazon",
    "url": "https://www.amazon.com/...",
    "timeframe": "last month",
    "breakdown": [
      { "source": "Amazon", "unitsSold": 520, "url": "https://www.amazon.com/..." },
      { "source": "Walmart", "unitsSold": 300, "url": "https://www.walmart.com/..." }
    ]
  },
  "reviews": [
    { "source": "Amazon", "text": "Quiet motor and very easy to clean." },
    { "source": "Walmart", "text": "Works well for smoothies but battery is average." }
  ],
  "trendScore": 85,
  "trendReason": "High engagement growth in last 7 days",
  "trendDirection": "rising",
  "buyingSentimentScore": 75,
  "buyingSentimentReason": "90% positive comments mentioning 'buying now'",
  "confidence": {
    "score": 88,
    "reason": "Product name visible in video and confirmed via multiple shop results"
  }
}`.trim();
}

// ── Extractor ─────────────────────────────────────────────────────────────────

export const ProductExtractor = {
  async extractFromPost(
    post: NormalizedPost,
    comments: NormalizedComment[] = [],
  ): Promise<ExtractedProduct | null> {
    try {
      const prompt = buildExtractionPrompt(post, comments);

      // Use AIOrchestrator for robust failure-tolerant extraction
      // DeepSeek is preferred for parsing structured data from raw strings
      const parsed = await AIOrchestrator.extractJson<any>(SYSTEM_PROMPT, prompt, 'deepseek');

      if (!parsed || !parsed.isProductVideo) {
        log.debug('Post discarded or invalid JSON', { videoId: post.videoId });
        return null;
      }

      const confidence = parsed.confidence || { score: 70, reason: 'Low data available' };
      const cat = parsed.categoryHierarchy || { l1: 'Other' };
      const sales = parsed.salesData || { unitsSold: 0, store: 'Unknown' };
      const salesBreakdown = Array.isArray(sales.breakdown) ? sales.breakdown : [];
      const parsedReviews = Array.isArray(parsed.reviews) ? parsed.reviews : [];

      const validDirections = [
        'rising',
        'peaked',
        'saturating',
        'stable',
        'declining',
        'emerging',
        'viral',
        'unknown',
      ];
      let parsedDirection = String(parsed.trendDirection || 'unknown').toLowerCase();
      if (parsedDirection === 'plateauing') parsedDirection = 'saturating';
      if (!validDirections.includes(parsedDirection)) parsedDirection = 'unknown';

      return {
        productName: String(parsed.productName || ''),
        amazonSearchTerm: String(parsed.productName || ''),

        categoryL1: String(cat.l1 || 'Other'),
        categoryL2: cat.l2 ? String(cat.l2) : undefined,
        categoryL3: cat.l3 ? String(cat.l3) : undefined,
        categoryPath: [cat.l1, cat.l2, cat.l3].filter(Boolean).join(' / '),

        productDescription: String(parsed.productDescription || ''),
        estimatedPrice: Number(parsed.estimatedPrice) || undefined,
        currency: 'USD',

        unitsSold: Number(sales.unitsSold || 0),
        unitsSoldBreakdown: salesBreakdown
          .map((entry: any) => ({
            source: String(entry?.source || '').trim(),
            unitsSold: Number(entry?.unitsSold || 0),
            url: entry?.url ? String(entry.url) : undefined,
          }))
          .filter((entry: any) => entry.source && entry.unitsSold > 0),
        salesSource: {
          store: String(sales.store || 'Unknown'),
          url: sales.url ? String(sales.url) : undefined,
          timeframe: sales.timeframe ? String(sales.timeframe) : undefined,
        },

        extractionConfidence: Number(confidence.score || 70),
        confidenceReason: String(confidence.reason || ''),

        buyingSentimentScore: Number(parsed.buyingSentimentScore || 50),
        buyingSentimentReason: String(parsed.buyingSentimentReason || ''),
        reviews: parsedReviews
          .map((review: any) => ({
            source: String(review?.source || '').trim(),
            text: String(review?.text || '').trim(),
          }))
          .filter((review: any) => review.source && review.text),

        estimatedRating: Number(parsed.estimatedRating) || undefined,
        estimatedReviewCount: Number(parsed.estimatedReviewCount) || undefined,

        brand: parsed.brand ? String(parsed.brand) : undefined,
        categoryKeywords: Array.isArray(parsed.categoryKeywords)
          ? parsed.categoryKeywords.map(String)
          : [],

        trendScore: Number(parsed.trendScore || 50),
        trendReason: String(parsed.trendReason || ''),
        trendDirection: parsedDirection as any,
        isTrending: Number(parsed.trendScore || 0) > 60,
        isProductVideo: true,

        sourceVideoId: post.videoId,
        sourceVideoUrl: post.videoUrl,
        groundedImages: Array.isArray(parsed.aestheticImageUrls) ? parsed.aestheticImageUrls : [],
      } as any;
    } catch (err) {
      log.error('AI extraction failed', { err: String(err), videoId: post.videoId });
      return buildFallbackExtraction(post);
    }
  },

  async extractBatch(
    posts: NormalizedPost[],
    commentMap: Map<string, NormalizedComment[]> = new Map(),
  ): Promise<ExtractedProduct[]> {
    const results: ExtractedProduct[] = [];
    const batches = chunk(posts, CONCURRENCY_LIMIT);

    for (const batch of batches) {
      const batchResults = await Promise.allSettled(
        batch.map((post) => this.extractFromPost(post, commentMap.get(post.videoId) ?? [])),
      );

      for (const result of batchResults) {
        if (result.status === 'fulfilled' && result.value !== null) {
          results.push(result.value);
        }
      }
      await sleep(500);
    }
    return results;
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildFallbackExtraction(post: NormalizedPost): ExtractedProduct | null {
  const hasProductHashtag = post.hashtags.some((h) =>
    ['tiktokmademebuyit', 'amazon', 'amazonfinds', 'shopify', 'product', 'buy'].includes(h),
  );

  if (!hasProductHashtag && !post.isAd) return null;

  let cleanTitle = (post.title || '').replace(/#/g, '');
  const garbageRegex = /amazon finds|tiktok made me buy it|must haves|viral products/gi;
  cleanTitle = cleanTitle.replace(garbageRegex, '').trim();

  if (!cleanTitle || cleanTitle.length < 3) cleanTitle = 'Unknown Product';

  return {
    productName: cleanTitle,
    amazonSearchTerm: cleanTitle,

    categoryL1: 'Other',
    categoryPath: 'Other',

    productDescription: post.description || cleanTitle || '',
    estimatedPrice: undefined,
    currency: 'USD',

    unitsSold: 0,
    unitsSoldBreakdown: [],
    salesSource: {
      store: 'Unknown',
    },

    extractionConfidence: 30,
    confidenceReason: 'Inferred from hashtags/metadata (fallback)',

    trendScore: Math.min(100, Math.round((post.engagementRate ?? 0) * 10)),
    trendDirection: 'unknown',
    isTrending: false,
    isProductVideo: true,

    brand: undefined,
    categoryKeywords: post.hashtags.slice(0, 5), // Use top hashtags as keywords for fallback
    reviews: [],

    sourceVideoId: post.videoId,
    sourceVideoUrl: post.videoUrl,
    groundedImages: [],
  };
}
