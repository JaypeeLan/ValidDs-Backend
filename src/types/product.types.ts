import { Document, Model } from 'mongoose';

// ── Primitive enums ───────────────────────────────────────────────────────────

export type ProductStatus   = 'active' | 'review' | 'invalid';
export type TrendDirection  = 'rising' | 'peaked' | 'saturating' | 'stable' | 'declining' | 'emerging' | 'viral' | 'unknown';
export type PriceBand       = 'budget' | 'mid-range' | 'premium';
export type ProductType     = 'evergreen' | 'trend-driven' | 'seasonal' | 'unknown';

// ── Sub-document interfaces ───────────────────────────────────────────────────

export interface IPrimaryCreator {
  tiktokUserId?: string;
  handle: string;
  displayName?: string;
  followers?: number;
  verified?: boolean;
  tiktokPostUrl?: string;
  /** Fetched from TikTok oEmbed / ui-avatars fallback */
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
  /** Store-level average rating */
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
  originalPrice?: number | null;
  onSale?: boolean;
  currency?: string;
  rating?: number | null;
  totalRatings?: number | null;
  totalReviews?: number | null;
  soldLast30Days?: number | null;
  availableForSale?: boolean;
  shippingDays?: number;
  moq?: number;
  /** Store info (name, url, rating) */
  shop?: IProductSupplierShop | null;
  checkedAt?: Date;
  fetchedAt?: Date;
  // ── Competitor intelligence ───────────────────────────────────────────────
  /** Monthly unique visitors to the store (SimilarWeb) */
  monthlyTraffic?: number | null;
  /** Units of this specific product sold (Shopify public API) */
  productUnitsSold?: number | null;
  /** Estimated monthly revenue for this product at this store */
  estimatedMonthlyRevenue?: number | null;
  /** How revenue was derived */
  revenueSource?: 'product-sales' | 'traffic-estimate' | null;
  /** Composite competitor rank score 0–100 (revenue 40%, traffic 30%, units 20%, price 10%) */
  competitorScore?: number | null;
}

// ── Marketing analysis ────────────────────────────────────────────────────────

export type Gender         = 'female' | 'male' | 'mixed' | 'unisex';
export type IncomeLevel    = 'budget' | 'mid-range' | 'premium' | 'luxury';
export type PurchaseIntent = 'impulse' | 'considered' | 'habitual' | 'gifting';
export type ContentFormat  = 'tutorial' | 'lifestyle' | 'entertainment' | 'review' | 'comparison';

export interface IMarketingAnalysis {
  /** Primary gender skew of the target audience */
  primaryGender: Gender;
  /** Top age brackets, e.g. ["18-24", "25-34"] */
  topAgeGroups: string[];
  /** Top geographic markets, e.g. ["US", "Southeast Asia"] */
  topRegions: string[];
  /** Accessibility or special-needs tags, e.g. ["senior-friendly"] or ["none"] */
  accessibilityTags: string[];
  /** Lifestyle / interest segments, e.g. ["beauty enthusiast", "fitness lover"] */
  lifestyleSegments: string[];
  /** Broad income bracket of the typical buyer */
  incomeLevel: IncomeLevel;
  /** Primary purchase driver */
  purchaseIntent: PurchaseIntent;
  /** Dominant TikTok content style used to market this product */
  contentFormat: ContentFormat;
  /** 1–2 sentence summary of the marketing opportunity */
  marketingInsight: string;
  /** ISO timestamp of when this analysis was generated */
  analyzedAt: Date;
}

// ── AI Intelligence ───────────────────────────────────────────────────────────

export interface IAIIntelligence {
  confidence: number;
  confidenceReason: string;
  brand?: string;
  categoryKeywords: string[];
  buyingSentimentScore?: number;
  buyingSentimentReason?: string;
  extractedAt: Date;
  // Enrichment fields (set by enrichment pipeline)
  niche?: string;
  productType: ProductType;
  priceBand?: PriceBand;
  audience: string[];
  problemStatement?: string;
  valueStatement?: string;
  /** Uniform AI-generated marketing demographic analysis */
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
  originalPrice?: number;
  shippingFee?: number;

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
  engagementRate?: number;

  // Creator
  primaryCreator?: IPrimaryCreator;

  // AI
  aiIntelligence: IAIIntelligence;

  // Trend
  trend: ITrend;

  // Creative summary
  creativeCounts: {
    ads: number;
    organic: number;
    reviews: number;
    total: number;
  };

  // Shop context
  shopName?: string;
  shopUrl?: string;
  shopFollowers?: number;
  postUrl?: string;
  videoUrl?: string;
  productUrl?: string;
  variations: unknown[];
  sizes: string[];

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