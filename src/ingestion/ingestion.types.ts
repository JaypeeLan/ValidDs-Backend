/**
 * ingestion.types.ts
 *
 * Shared normalized types that every ingestion source produces.
 *
 * The transformer for each source (e.g. EnsembleData)
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
  videoPlayUrl?: string;           // Direct playable media URL
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
  creatorAvatarUrl?: string;
  creatorBio?: string;
  creatorFollowing?: number;
  creatorTotalLikes?: number;

  // Engagement
  viewCount: number;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  engagementRate?: number;         // calculated: (likes+comments+shares)/views

  // Ad signals
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
  amazonSearchTerm: string;        // optimised short Amazon query e.g. "portable mini blender USB"
  productNiche?: string;           // e.g. "Kitchen Gadgets" (optional)
  productDescription: string;     // one-line AI-generated summary
  brand?: string;
  categoryKeywords: string[];      // For relevance filtering
  estimatedPrice?: number;        // extracted from comments/description if mentioned
  estimatedRating?: number;       // fallback AI rating (1-5)
  estimatedReviewCount?: number;  // fallback AI review count estimate
  unitsSold?: number;             // extracted or estimated number of sales
  currency?: string;              // default USD

  // Hierarchical Categories
  categoryL1: string;
  categoryL2?: string;
  categoryL3?: string;
  categoryPath?: string;


  // AI confidence
  extractionConfidence: number;   // 0–100 — how confident the AI is this is a real product
  confidenceReason?: string;
  isProductVideo: boolean;        // false if the video is clearly not product-related

  // Sales & Social Proof
  salesSource?: {
    store: string;
    url?: string;
    timeframe?: string;
  };

  // Trend signals (AI-calculated from engagement data)
  trendScore: number;             // 0–100 composite
  trendDirection: 'rising' | 'peaked' | 'saturating' | 'unknown';
  isTrending: boolean;
  trendReason?: string;           // e.g. "High comment-to-view ratio, multiple creators posting"

  // Sentiment from comments
  buyingSentimentScore?: number;   // 0–100 — how many comments express buying intent
  buyingSentimentReason?: string;

  // Source post this was extracted from
  sourceVideoId: string;
  sourceVideoUrl?: string;
  groundedImages: string[];
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
  | 'ensemble'            // EnsembleData API
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
