import { Document, Model } from 'mongoose';
import type { SentimentLabel } from '../utils/sentiment.util.js';

export type { SentimentLabel };

// ── Primitive enums ───────────────────────────────────────────────────────────

export type ProductStatus   = 'active' | 'review' | 'invalid';
export type TrendDirection  = 'rising' | 'peaked' | 'saturating' | 'stable' | 'declining' | 'emerging' | 'viral' | 'unknown';
export type PriceBand       = 'budget' | 'mid-range' | 'premium';
export type ProductType     = 'evergreen' | 'trend-driven' | 'seasonal' | 'unknown';

// ── Sub-document interfaces ───────────────────────────────────────────────────

/** Stored shape — sparse on TikTok Shop rows; normalized on write via `normalizePrimaryCreatorForStorage`. */
export interface IPrimaryCreator {
  handle: string;
  tiktokUserId?: string;
  displayName?: string;
  bio?: string;
  followers?: number;
  following?: number;
  totalLikes?: number;
  region?: string;
  verified?: boolean;
  tiktokPostUrl?: string;
  primaryImageUrl?: string | null;
  /** Legacy alias — mirrored with primaryImageUrl on read/write. */
  avatarUrl?: string | null;
}

/** `primaryCreator` after `formatProductResponse` (includes read-time proxy URL). */
export interface IPrimaryCreatorApi extends IPrimaryCreator {
  avatarProxyUrl?: string;
}

export interface IProductReview {
  /** TikTok Shop review author (ingested as `name`). */
  name?: string | null;
  /** AI / legacy extraction author. */
  author?: string | null;
  rating: number | null;
  /** TikTok Shop review body (ingested as `review`). */
  review?: string | null;
  /** AI / legacy extraction body. */
  content?: string | null;
  date: string | null;
  item: string | null;
  images: string[];
}

export interface IProductSupplierShop {
  name: string | null;
  url:  string | null;
  rating: number | null;
}

export interface IProductSupplier {
  source: string;
  /** Omitted on Shopify App competitor rows — defaults to `source` on read. */
  platform?: string;
  externalId: string;
  title: string;
  productUrl: string;
  shareUrl: string;
  price: number | null;
  currency: string;
  onSale?: boolean;
  rating: number | null;
  totalRatings: number | null;
  totalReviews: number | null;
  soldLast30Days?: number | null;
  availableForSale: boolean;
  moq?: number;
  shop: IProductSupplierShop | null;
  checkedAt?: Date | string;
  fetchedAt: Date | string;
  monthlyTraffic: number | null;
  productUnitsSold: number | null;
  estimatedMonthlyRevenue: number | null;
  revenueSource: 'product-sales' | 'traffic-estimate' | null;
  competitorScore: number | null;
}

// ── Marketing analysis ────────────────────────────────────────────────────────

export type Gender         = 'female' | 'male' | 'mixed' | 'unisex';
export type IncomeLevel    = 'budget' | 'mid-range' | 'premium' | 'luxury';
export type PurchaseIntent = 'impulse' | 'considered' | 'habitual' | 'gifting';
export type ContentFormat  = 'tutorial' | 'lifestyle' | 'entertainment' | 'review' | 'comparison';

export interface IMarketingAngle {
  hook: string;
  body: string;
  target: string;
}

export interface IMarketingAnalysis {
  primaryGender: Gender;
  topAgeGroups: string[];
  topRegions: string[];
  accessibilityTags: string[];
  lifestyleSegments: string[];
  incomeLevel: IncomeLevel;
  purchaseIntent: PurchaseIntent;
  contentFormat: ContentFormat;
  marketingInsight: string;
  /** Buying-intent label for cards (e.g. positive / neutral / negative). */
  sentimentLabel?: SentimentLabel;
  /** Usually populated by AI; omitted on a small set of legacy rows (defaults to `[]` on write). */
  angles?: IMarketingAngle[];
  analyzedAt: Date;
}

// ── AI Intelligence ───────────────────────────────────────────────────────────

export interface IAIIntelligence {
  confidence: number;
  confidenceReason: string;
  brand: string;
  buyingSentimentScore: number;
  buyingSentimentReason: string;
  /** Optional persisted label; API falls back to score-derived label when omitted. */
  buyingSentimentLabel?: SentimentLabel;
  extractedAt: Date;
  niche: string;
  productType: ProductType;
  priceBand: PriceBand;
  audience: string[];
  categoryKeywords: string[];
  problemStatement: string;
  valueStatement: string;
  marketingAnalysis: IMarketingAnalysis | null;
}

// ── Trend ─────────────────────────────────────────────────────────────────────

export interface ITrend {
  score: number;
  direction: TrendDirection;
  reason?: string;
  isTrending: boolean;
  calculatedAt: Date;
}

/** Per-dimension trend signals stored on the product. */
export interface IProductTrends {
  engagement: ITrend | null;
  priceHistory: IPriceHistoryEntry[];
}

// ── Sales / revenue / price trends ───────────────────────────────────────────

export interface IMetricTrendWindow {
  label: string;
  daysAgo: number;
  value: number;
}

export interface IMetricTrend {
  direction: 'up' | 'down' | 'stable';
  changePercent: number;
  windows: IMetricTrendWindow[];
}

export interface ISalesHistoryEntry {
  sales: number;
  recordedAt: Date | string;
}

export interface IRevenueHistoryEntry {
  revenue: number;
  recordedAt: Date | string;
}

export interface IPriceHistoryEntry {
  price: number;
  recordedAt: Date | string;
}

export type IPriceTrend = IMetricTrend;
export type IPriceTrendWindow = IMetricTrendWindow;

// ── Main product interface ────────────────────────────────────────────────────

export interface IProductRatingSource {
  platform: string;
  rating: number | null;
  reviewCount: number | null;
  sourceUrl: string;
  fetchedAt: Date | string;
}

export interface IProduct {
  // Identity
  externalId: string;
  source: string;
  status: ProductStatus;

  // Content
  title: string;
  normalizedTitle: string;
  description: string;
  hashtags: string[];

  // Taxonomy
  categoryL1: string;
  categoryL2: string;
  categoryL3: string;
  categoryPath: string;

  // Media
  primaryImageUrl: string | null;
  imageUrls: string[];

  // Pricing
  price: number | null;
  currency: string;
  priceHistory: IPriceHistoryEntry[];
  priceTrend: IPriceTrend | null;

  // Competitor suppliers (sorted by competitorScore desc)
  suppliers: IProductSupplier[];

  // Market evidence
  rating: number | null;
  reviewCount: number | null;
  reviews: IProductReview[];
  ratingSources: IProductRatingSource[];

  // Sales & GMV
  soldCount: number;
  totalSales: number;
  totalGmv: number;
  salesHistory: ISalesHistoryEntry[];
  salesTrend: IMetricTrend | null;
  revenueHistory: IRevenueHistoryEntry[];
  revenueTrend: IMetricTrend | null;

  // Store-level aggregates (sourced from TikTok Shop store profile)
  storeGmv: number;
  storeTotalSales: number;

  // TikTok engagement
  viewCount: number;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  engagementRate: number | null;

  // Creator
  primaryCreator: IPrimaryCreator | null;

  // AI
  aiIntelligence: IAIIntelligence;

  // Trend signals keyed by dimension
  trends: IProductTrends | null;

  // Discovery
  discoverySections: string[];

  // Shop context
  shopName: string;
  shopUrl: string;
  shopAvatarUrl: string | null;
  shopFollowers: number;
  postUrl: string;
  postCreatedAt: string | null;
  publishedAt: string | Date | null;
  productUrl: string;

  // TikTok account context
  accountHandle: string;
  accountKind: string;

  // Market
  market: string;

  // Creative counts (computed by enricher)
  relatedVideosCount: number;
  creativeCounts: {
    ads: number;
    organic: number;
    reviews: number;
    total: number;
  } | null;

  // Validation
  validationStatus: string;

  // Freshness
  lastIngestedAt: Date;
  dataSourceUpdatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ── API response shapes ───────────────────────────────────────────────────────

export interface ProductAiInsightResponse {
  confidence: { score?: number; reason?: string };
  buyingSentiment: { score?: number; reason?: string; label?: SentimentLabel };
  marketingAnalysis?: IMarketingAnalysis | null;
  brand?: string;
  niche?: string;
  audience?: string[];
  productType?: ProductType;
  priceBand?: PriceBand;
  problemStatement?: string;
  valueStatement?: string;
  extractedAt?: string | Date;
}

export interface ProductFeedItem {
  id: string;
  title: string;
  primaryImageUrl?: string;
  imageUrls: string[];
  price?: number;
  currency?: string;
  categoryL1: string;
  categoryPath?: string;
  rating?: number;
  ratings?: number;
  totalSales?: number;
  totalGmv?: number;
  salesTrend?: IMetricTrend | null;
  shopName?: string;
  shopUrl?: string;
  shopAvatarUrl?: string | null;
  lastIngestedAt: string | Date;
  isTopAd?: boolean;
  competitionScore?: number | null;
  aiInsight: {
    confidence: { score?: number };
    buyingSentiment?: { score?: number; label?: SentimentLabel };
  };
  trend?: {
    score?: number;
    direction?: string;
    isTrending?: boolean;
  };
  primaryCreator?: IPrimaryCreatorApi;
}

export interface ProductApiResponse {
  _id: unknown;
  title: string;
  primaryImageUrl?: string;
  primaryCreator?: IPrimaryCreatorApi;
  aiInsight?: ProductAiInsightResponse;
  isTopAd?: boolean;
  rating?: number;
  ratings?: number;
  trend?: ITrend & { isTrending: boolean };
  [key: string]: unknown;
}

// ── Mongoose document / model ─────────────────────────────────────────────────

export interface IProductDocument extends IProduct, Document {}

export interface IProductModel extends Model<IProductDocument> {
  findByExternalId(externalId: string): Promise<IProductDocument | null>;
}
