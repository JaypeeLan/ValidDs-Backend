import { NormalizedPost, NormalizedComment, ExtractedProduct } from '../ingestion/ingestion.types';
import { PRODUCT_CATEGORIES } from '../api/products/product.constants';
import { logger } from '../logger';

const log = logger.child({ module: 'product-extractor' });

/**
 * Product Extractor
 *
 * Uses an AI API to extract structured product information
 * from a TikTok post (video title, description, hashtags) and
 * its top comments.
 *
 * For each post, the AI returns:
 *  - Product name and niche
 *  - Whether the video is actually about a product
 *  - Estimated price (if mentioned anywhere)
 *  - Trend direction and score
 *  - A one-line reason why this product is gaining traction
 *  - Sentiment summary from comments
 *  - Buying intent score
 *
 * If the video is clearly not product-related (a dance, a joke, a news clip),
 * Claude sets isProductVideo=false and we discard the post.
 *
 * Rate limiting: the extractor batches posts and processes them concurrently
 * up to CONCURRENCY_LIMIT to avoid hammering the API.
 *
 * Cost: approximately 1,000 input tokens + 300 output tokens per post.
 */

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

const PROVIDERS = [
  {
    name: 'deepseek',
    apiKey: process.env.DEEPSEEK_API_KEY,
    url: DEEPSEEK_API_URL,
    model: 'deepseek-chat',
    format: 'openai' as const,
  },
  {
    name: 'openai',
    apiKey: process.env.OPENAI_API_KEY,
    url: OPENAI_API_URL,
    model: 'gpt-4o-mini',
    format: 'openai' as const,
  },
];

const CONCURRENCY_LIMIT = 5;               // Max parallel API calls
const MIN_CONFIDENCE_THRESHOLD = 50;       // Discard extractions below this confidence

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a product intelligence engine for a dropshipping research platform.

You receive data from a TikTok video (title, description, hashtags, and top comments) and extract structured product information.

Your job is to determine:
1. What product is being shown or discussed
2. Whether this is genuinely a product-related video
3. Trend signals based on engagement context
4. What the comments reveal about buying intent

Rules:
- If the video is clearly NOT about a product (dance, news, comedy, personal vlog), set isProductVideo to false
- Extract a clean, short, and meaningful product name (2-5 words max). Strip out ALL SEO fluff, Amazon-style descriptors (e.g. "for men", "heavy duty"), emojis, and tracking links. (e.g., return "Portable Blender" instead of "Portable Mini Blender USB Rechargeable Fruit Juicer").
- productNiche MUST be exactly one of the provided canonical categories.
- Estimated price: Extract only if explicitly mentioned. If not, set to null.
- Units sold: Provide a global estimate representing total market reach (typically 50k to 5M+ for hot products).
- Respond ONLY with valid JSON.`;

// ── Extraction prompt builder ─────────────────────────────────────────────────

function buildExtractionPrompt(post: NormalizedPost, comments: NormalizedComment[]): string {
  const topComments = comments
    .slice(0, 20)
    .map((c) => `- "${c.text}" (${c.likeCount} likes)`)
    .join('\n');

  const engagementContext = buildEngagementContext(post);

  return `
VIDEO DATA:
Title: ${post.title || '(no title)'}
Description: ${post.description || '(no description)'}
Hashtags: ${post.hashtags.length > 0 ? post.hashtags.map((h) => `#${h}`).join(' ') : '(none)'}
Creator: @${post.creatorHandle} (${formatNumber(post.creatorFollowers)} followers)
${post.isAd ? 'Type: PAID AD' : 'Type: Organic video'}
${post.isAd ? `Ad active: ${post.adStatus === 'active' ? 'YES — still running' : 'No — stopped running'}` : ''}
${post.adFirstSeenAt ? `Ad first seen: ${formatDaysAgo(post.adFirstSeenAt)}` : ''}
${post.adLastSeenAt ? `Ad last seen: ${formatDaysAgo(post.adLastSeenAt)}` : ''}

ENGAGEMENT:
${engagementContext}

TOP COMMENTS (${comments.length} total):
${topComments || '(no comments available)'}

Respond with this exact JSON structure:
{
  "isProductVideo": true,
  "productName": "Portable Mini Blender",
  "amazonSearchTerm": "portable mini blender USB rechargeable",
  "productNiche": "Home & Kitchen",
  "productDescription": "One-sentence description of what the product is and why it is trending",
  "estimatedPrice": 24.99,
  "unitsSold": 1250,
  "currency": "USD",
  "extractionConfidence": 85,
  "confidenceReason": "One sentence on why this confidence level is assigned",
  "trendScore": 72,
  "trendDirection": "rising",
  "isTrending": true,
  "trendReason": "One sentence explaining why this product is gaining traction",
  "buyingSentimentScore": 78,
  "buyingSentimentReason": "One sentence describing buyer intent and tone in comments"
}

unitsSold: your best estimate or extracted number of units already sold;

productNiche MUST be one of:
${PRODUCT_CATEGORIES.map(c => `- ${c}`).join('\n')}

trendDirection must be one of: "rising", "peaked", "saturating", "unknown"
amazonSearchTerm: 2-5 keyword Amazon search query — shorter and generic works BETTER (e.g. "motion sensor wall light" not "Magnetic Motion-Sensor Wall Light")
estimatedPrice must be null if not mentioned
extractionConfidence is 0-100 — your confidence that this is a real, identifiable product
trendScore is 0-100 based on engagement signals
buyingSentimentScore is 0-100 based on comment intent signals`.trim();
}

// ── Extractor ─────────────────────────────────────────────────────────────────

export const ProductExtractor = {

  /**
   * Extract product information from a single post.
   * Returns null if the post is not product-related or the API fails.
   */
  async extractFromPost(
    post: NormalizedPost,
    comments: NormalizedComment[] = []
  ): Promise<ExtractedProduct | null> {
    let explicitlyRejected = false; // true when AI says isProductVideo: false

    for (const provider of PROVIDERS) {
      if (!provider.apiKey) {
        log.debug(`${provider.name} API key not set — skipping`);
        continue;
      }

      try {
        const result = await this.callProvider(provider, post, comments);
        if (result) {
          log.debug(`Extraction successful with ${provider.name}`);
          return result;
        }

        // callProvider returns null when AI said isProductVideo: false
        // No need to try further providers or the fallback
        explicitlyRejected = true;
        break;
      } catch (err) {
        log.warn(`${provider.name} extraction failed`, { err: String(err), videoId: post.videoId });
      }
    }

    // If AI explicitly said this is NOT a product video, don't use the fallback
    if (explicitlyRejected) {
      log.debug('Post discarded — all providers confirm not product-related', { videoId: post.videoId });
      return null;
    }

    log.warn('All AI providers failed — using fallback extraction');
    return buildFallbackExtraction(post);
  },

  /**
   * Call a specific AI provider for extraction.
   */
  async callProvider(
    provider: typeof PROVIDERS[0],
    post: NormalizedPost,
    comments: NormalizedComment[]
  ): Promise<ExtractedProduct | null> {
    const prompt = buildExtractionPrompt(post, comments);

    let requestBody: any;
    let headers: Record<string, string>;

    // OpenAI/DeepSeek format
    requestBody = {
      model: provider.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 500,
    };
    headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${provider.apiKey}`,
    };

    const requestUrl = provider.url;

    const response = await fetch(requestUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`${provider.name} API error ${response.status}: ${err}`);
    }

    const data = await response.json() as any;

    let text: string;
    if (data.error) throw new Error(`${provider.name} error: ${data.error.message}`);
    text = data.choices?.[0]?.message?.content ?? '';

    const parsed = parseAIJSON(text);
    if (!parsed) {
      throw new Error(`Failed to parse ${provider.name} JSON response`);
    }

    // Discard if AI says this is not a product video
    if (!parsed.isProductVideo) {
      log.debug('Post discarded — not a product video', { videoId: post.videoId });
      return null;
    }

    // Discard low-confidence extractions
    if (((parsed.extractionConfidence as number) ?? 0) < MIN_CONFIDENCE_THRESHOLD) {
      log.debug('Post discarded — low extraction confidence', {
        videoId: post.videoId,
        confidence: parsed.extractionConfidence,
      });
      return null;
    }

    return {
      productName: String(parsed.productName ?? ''),
      amazonSearchTerm: String(parsed.amazonSearchTerm ?? parsed.productName ?? ''),
      productNiche: String(parsed.productNiche ?? ''),
      productDescription: String(parsed.productDescription ?? ''),
      estimatedPrice: typeof parsed.estimatedPrice === 'number' ? parsed.estimatedPrice : undefined,
      unitsSold: typeof parsed.unitsSold === 'number' ? parsed.unitsSold : 0,
      currency: String(parsed.currency ?? 'USD'),
      extractionConfidence: Number(parsed.extractionConfidence ?? 0),
      confidenceReason: typeof parsed.confidenceReason === 'string' ? parsed.confidenceReason : undefined,
      isProductVideo: true,
      trendScore: Number(parsed.trendScore ?? 50),
      trendDirection: (parsed.trendDirection as 'rising' | 'peaked' | 'saturating' | 'unknown') ?? 'unknown',
      isTrending: typeof parsed.isTrending === 'boolean'
        ? parsed.isTrending
        : (parsed.trendDirection !== 'unknown' && Number(parsed.trendScore ?? 0) >= 60),
      trendReason: typeof parsed.trendReason === 'string' ? parsed.trendReason : undefined,
      buyingSentimentScore: typeof parsed.buyingSentimentScore === 'number'
        ? parsed.buyingSentimentScore
        : (typeof parsed.buyingIntentScore === 'number' ? parsed.buyingIntentScore : undefined),
      buyingSentimentReason: typeof parsed.buyingSentimentReason === 'string'
        ? parsed.buyingSentimentReason
        : (typeof parsed.sentimentSummary === 'string' ? parsed.sentimentSummary : undefined),
      sourceVideoId: post.videoId,
      sourceVideoUrl: post.videoUrl,
    };
  },

  /**
   * Extract products from a batch of posts with concurrency control.
   * Returns only successful, high-confidence extractions.
   */
  async extractBatch(
    posts: NormalizedPost[],
    commentMap: Map<string, NormalizedComment[]> = new Map()
  ): Promise<ExtractedProduct[]> {
    const results: ExtractedProduct[] = [];
    const batches = chunk(posts, CONCURRENCY_LIMIT);

    log.info(`Starting batch extraction for ${posts.length} posts`);

    for (const batch of batches) {
      const batchResults = await Promise.allSettled(
        batch.map((post) =>
          ProductExtractor.extractFromPost(post, commentMap.get(post.videoId) ?? [])
        )
      );

      for (const result of batchResults) {
        if (result.status === 'fulfilled' && result.value !== null) {
          results.push(result.value);
        }
      }

      // Small delay between batches to respect API rate limits
      await sleep(200);
    }

    log.info(`Batch extraction complete`, {
      input: posts.length,
      extracted: results.length,
      discarded: posts.length - results.length,
    });

    return results;
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseAIJSON(text: string): Record<string, unknown> | null {
  try {
    // Strip any markdown code fences if present
    const clean = text
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    return JSON.parse(clean);
  } catch {
    // Try to extract JSON object from text
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * When the AI API is not configured or fails,
 * build a basic extraction from the post metadata alone.
 * This ensures the pipeline continues without AI.
 */
function buildFallbackExtraction(post: NormalizedPost): ExtractedProduct | null {
  // Without AI, only keep posts with strong explicit product signals
  const hasProductHashtag = post.hashtags.some((h) =>
    ['tiktokmademebuyit', 'amazon', 'amazonfinds', 'shopify', 'product', 'buy'].includes(h)
  );

  if (!hasProductHashtag && !post.isAd) return null;

  return {
    productName: post.title || 'Unknown Product',
    amazonSearchTerm: post.title || 'Unknown Product',
    productNiche: inferNicheFromHashtags(post.hashtags),
    productDescription: post.description || post.title || '',
    estimatedPrice: undefined,
    currency: 'USD',
    extractionConfidence: 30,          // Low confidence — no AI
    confidenceReason: 'Extracted without AI provider confidence rationale',
    isProductVideo: true,
    trendScore: Math.min(100, Math.round((post.engagementRate ?? 0) * 10)),
    trendDirection: 'unknown',
    isTrending: false,
    trendReason: 'Extracted without AI — engagement signals only',
    buyingSentimentScore: undefined,
    buyingSentimentReason: undefined,
    sourceVideoId: post.videoId,
    sourceVideoUrl: post.videoUrl,
  };
}

function buildEngagementContext(post: NormalizedPost): string {
  const lines: string[] = [
    `Views: ${formatNumber(post.viewCount)}`,
    `Likes: ${formatNumber(post.likeCount)}`,
    `Comments: ${formatNumber(post.commentCount)}`,
    `Shares: ${formatNumber(post.shareCount)}`,
  ];
  if (post.engagementRate !== undefined) {
    lines.push(`Engagement rate: ${post.engagementRate}%`);
  }
  return lines.join(' | ');
}

function inferNicheFromHashtags(hashtags: string[]): string {
  const nicheMap: Record<string, string> = {
    kitchen: 'Home & Kitchen',
    cooking: 'Home & Kitchen',
    beauty: 'Beauty & Healthcare',
    skincare: 'Beauty & Healthcare',
    makeup: 'Beauty & Healthcare',
    fitness: 'Sports & Outdoors',
    workout: 'Sports & Outdoors',
    gym: 'Sports & Outdoors',
    gadget: 'Electronics & Gadgets',
    tech: 'Electronics & Gadgets',
    fashion: 'Fashion & Accessories',
    outfit: 'Fashion & Accessories',
    pet: 'Pet Supplies',
    baby: 'Toys & Hobbies',
    toy: 'Toys & Hobbies',
    home: 'Home & Kitchen',
    travel: 'Sports & Outdoors',
    automotive: 'Automotive',
    car: 'Automotive',
    repair: 'Tools & Home Improvement',
    office: 'Office Products',
  };
  for (const tag of hashtags) {
    const lowerTag = tag.toLowerCase();
    for (const [key, niche] of Object.entries(nicheMap)) {
      if (lowerTag.includes(key)) return niche;
    }
  }
  return 'Beauty & Healthcare'; // default to a safe primary niche if no match
}

function formatNumber(n?: number): string {
  if (!n) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatDaysAgo(date?: Date): string {
  if (!date) return 'unknown';
  const days = Math.round((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
