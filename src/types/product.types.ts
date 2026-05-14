import { Document, Model } from 'mongoose';

// ── Primitive enums ───────────────────────────────────────────────────────────

export type ProductStatus   = 'active' | 'review' | 'invalid';
export type TrendDirection  = 'rising' | 'peaked' | 'saturating' | 'stable' | 'declining' | 'emerging' | 'viral' | 'unknown';
export type PriceBand       = 'budget' | 'mid-range' | 'premium';
export type ProductType     = 'evergreen' | 'trend-driven' | 'seasonal' | 'unknown';

// ── Sub-document interfaces ───────────────────────────────────────────────────

export interface IPrimaryCreator {
  handle: string;
  displayName?: string;
  followers?: number;
  verified?: boolean;
  tiktokPostUrl?: string;
  avatarUrl?: string | null;
}

export interface IProductReview {
  author?: string | null;
  rating?: number | null;
  content?: string | null;
  date?: string | null;
  item?: string | null;
}

export interface IProductSupplierShop {
  name: string | null;
  url:  string | null;
  rating: number | null;
}

export interface IProductSupplier {
  source?: string;
  platform?: string;
  externalId?: string;
  title?: string;
  productUrl?: string;
  shareUrl?: string;
  price?: number | null;
  onSale?: boolean;
  currency?: string;
  rating?: number | null;
  totalRatings?: number | null;
  totalReviews?: number | null;
  soldLast30Days?: number | null;
  availableForSale?: boolean;
  shippingDays?: number;
  moq?: number;
  shop?: IProductSupplierShop | null;
  checkedAt?: Date;
  fetchedAt?: Date;
  monthlyTraffic?: number | null;
  productUnitsSold?: number | null;
  estimatedMonthlyRevenue?: number | null;
  revenueSource?: 'product-sales' | 'traffic-estimate' | null;
  competitorScore?: number | null;
}

// ── Marketing analysis ────────────────────────────────────────────────────────

export type Gender         = 'female' | 'male' | 'mixed' | 'unisex';
export type IncomeLevel    = 'budget' | 'mid-range' | 'premium' | 'luxury';
export type PurchaseIntent = 'impulse' | 'considered' | 'habitual' | 'gifting';
export type ContentFormat  = 'tutorial' | 'lifestyle' | 'entertainment' | 'review' | 'comparison';

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
  analyzedAt: Date;
}

// ── AI Intelligence ───────────────────────────────────────────────────────────

export interface IAIIntelligence {
  confidence: number;
  confidenceReason: string;
  brand?: string;
  buyingSentimentScore?: number;
  buyingSentimentReason?: string;
  extractedAt: Date;
  niche?: string;
  productType: ProductType;
  priceBand?: PriceBand;
  audience: string[];
  problemStatement?: string;
  valueStatement?: string;
  marketingAnalysis?: IMarketingAnalysis | null;
}

// ── Trend ─────────────────────────────────────────────────────────────────────

export interface ITrend {
  score: number;
  direction: TrendDirection;
  reason?: string;
  isTrending: boolean;
  calculatedAt: Date;
}

// ── Price trend ───────────────────────────────────────────────────────────────

export interface IPriceTrendWindow {
  label: 'today' | '7d' | '14d' | '30d' | '60d' | '90d';
  daysAgo: number;
  /** 0 when no historical data exists for this period */
  price: number;
}

export interface IPriceTrend {
  direction: 'up' | 'down' | 'stable';
  /** Percentage change from oldest available window vs today, rounded to 1 decimal */
  changePercent: number;
  windows: IPriceTrendWindow[];
}

// ── Price history entry ───────────────────────────────────────────────────────

export interface IPriceHistoryEntry {
  price: number;
  currency: string;
  recordedAt: string;
}

// ── Main product interface ────────────────────────────────────────────────────

export interface IProduct {
  // Identity
  externalId: string;
  source: string;
  status: ProductStatus;

  // Content
  title: string;
  normalizedTitle: string;
  description?: string;
  hashtags: string[];

  // Taxonomy
  categoryL1: string;
  categoryL2?: string;
  categoryL3?: string;
  categoryPath: string;

  // Media
  primaryImageUrl?: string;
  imageUrls: string[];

  // Pricing
  price?: number;
  currency: string;

  // Price trend (computed on-read from priceHistory)
  priceTrend?: IPriceTrend | null;

  // Price history (appended on each re-ingestion when price changes)
  priceHistory?: IPriceHistoryEntry[];

  // Competitor suppliers (sorted by competitorScore desc)
  suppliers: IProductSupplier[];

  // Market evidence
  rating?: number;
  reviewCount?: number;
  reviews: IProductReview[];

  // Sales & GMV
  soldCount?: number;
  /** Lifetime total units sold */
  totalSales?: number;
  /** Lifetime GMV (price × totalSales) */
  totalGmv?: number;

  // TikTok engagement
  viewCount: number;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  /** (likes + comments + shares) / views × 100 — null when views = 0 */
  engagementRate?: number | null;

  // Creator
  primaryCreator?: IPrimaryCreator;

  // AI
  aiIntelligence: IAIIntelligence;

  // Trend
  trend: ITrend;

  // Shop context
  shopName?: string;
  shopUrl?: string;
  /** Defaults to 0 when shop followers are unavailable */
  shopFollowers: number;
  postUrl?: string;
  /** ISO 8601 timestamp when the TikTok video was originally posted */
  postCreatedAt?: string | null;
  productUrl?: string;

  // Validation
  validationStatus: string;

  // Freshness
  lastIngestedAt: Date;
  dataSourceUpdatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ── Mongoose document / model ─────────────────────────────────────────────────

export interface IProductDocument extends IProduct, Document {}

export interface IProductModel extends Model<IProductDocument> {
  findByExternalId(externalId: string): Promise<IProductDocument | null>;
}