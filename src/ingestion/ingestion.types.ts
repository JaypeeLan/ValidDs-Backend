/**
 * ingestion.types.ts
 *
 * Shared normalized types that every ingestion source produces.
 *
 * The transformer for each source (Creative Center, EnsembleData, RapidAPI)
 * is responsible for mapping raw API responses into these shapes.
 * Everything downstream — the orchestrator, repositories, AI extractor —
 * only ever works with these types, never with raw source shapes.
 */

// ── Raw post from any TikTok surface ─────────────────────────────────────────

/**
 * A normalized TikTok video post.
 * All sources must produce this shape from their raw response.
 */
export interface NormalizedPost {
  // Identity
  videoId: string;
  videoUrl?: string;
  thumbnailUrl?: string;

  // Content — what the AI will read to extract the product
  title: string;                   // video title / caption
  description: string;             // full description text
  hashtags: string[];              // e.g. ['tiktokmademebuyit', 'amazon']
  rawText: string;                 // title + description + hashtags joined — sent to AI

  // Creator
  creatorHandle: string;
  creatorDisplayName?: string;
  creatorFollowers?: number;
  creatorVerified?: boolean;
  creatorRegion?: string;

  // Engagement
  viewCount: number;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  engagementRate?: number;         // calculated: (likes+comments+shares)/views

  // Ad signals (from Creative Center)
  isAd: boolean;
  adFirstSeenAt?: Date;            // when the ad was first detected
  adLastSeenAt?: Date;             // when the ad was last detected — freshness signal
  adStatus?: 'active' | 'inactive' | 'unknown';

  // Timing
  publishedAt?: Date;
  collectedAt: Date;               // when we fetched this

  // Source tracking
  source: IngestionSource;
  sourceRaw?: unknown;             // original raw object — kept for debugging, not stored long-term
}

/**
 * Top comments fetched separately for a post.
 * Used by the AI extraction layer to understand buying intent.
 */
export interface NormalizedComment {
  commentId: string;
  videoId: string;
  text: string;
  likeCount: number;
  createdAt?: Date;
  isReply: boolean;
}

// ── AI-extracted product ──────────────────────────────────────────────────────

/**
 * The product extracted by the AI from a NormalizedPost + its top comments.
 * This is what gets stored in MongoDB as a Product record.
 */
export interface ExtractedProduct {
  // Product identity
  productName: string;             // e.g. "Portable Mini Blender"
  productNiche: string;            // e.g. "Kitchen Gadgets"
  productDescription: string;     // one-line AI-generated summary
  estimatedPrice?: number;        // extracted from comments/description if mentioned
  currency?: string;              // default USD

  // AI confidence
  extractionConfidence: number;   // 0–100 — how confident the AI is this is a real product
  isProductVideo: boolean;        // false if the video is clearly not product-related

  // Trend signals (AI-calculated from engagement data)
  trendScore: number;             // 0–100 composite
  trendDirection: 'rising' | 'peaked' | 'saturating' | 'unknown';
  trendReason: string;            // e.g. "High comment-to-view ratio, multiple creators posting"

  // Sentiment from comments
  sentimentSummary?: string;      // e.g. "Users asking where to buy, positive tone"
  buyingIntentScore?: number;     // 0–100 — how many comments express buying intent

  // Source post this was extracted from
  sourceVideoId: string;
  sourceVideoUrl?: string;
}

// ── Trending hashtags and keywords ───────────────────────────────────────────

export interface NormalizedHashtag {
  hashtag: string;                 // without the # symbol
  viewCount: number;
  videoCount: number;
  trendRank?: number;
  region?: string;
  collectedAt: Date;
  source: IngestionSource;
}

export interface NormalizedKeyword {
  keyword: string;
  searchVolume?: number;
  trendScore?: number;
  relatedHashtags?: string[];
  region?: string;
  collectedAt: Date;
  source: IngestionSource;
}

// ── Source identifiers ────────────────────────────────────────────────────────

export type IngestionSource =
  | 'creative-center'     // TikTok Creative Center (primary scraper)
  | 'ensemble'            // EnsembleData API
  | 'rapidapi'            // RapidAPI TikTok scrapers
  | 'manual';             // manually added for testing

// ── Job result ────────────────────────────────────────────────────────────────

/**
 * What each ingestion job returns to the orchestrator.
 */
export interface IngestionJobResult {
  source: IngestionSource;
  success: boolean;
  postsCollected: number;
  productsExtracted: number;
  hashtagsCollected: number;
  errors: string[];
  durationMs: number;
  ranAt: Date;
}

// ── Orchestrator config ───────────────────────────────────────────────────────

export interface OrchestratorConfig {
  primarySource: IngestionSource;
  fallbackSources: IngestionSource[];
  maxRetries: number;
  retryDelayMs: number;
}
