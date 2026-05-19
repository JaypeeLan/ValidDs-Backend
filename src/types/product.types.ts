import { Document, Model } from 'mongoose';

// ── Primitive enums ───────────────────────────────────────────────────────────

export type ProductStatus   = 'active' | 'review' | 'invalid';
export type TrendDirection  = 'rising' | 'peaked' | 'saturating' | 'stable' | 'declining' | 'emerging' | 'viral' | 'unknown';
export type PriceBand       = 'budget' | 'mid-range' | 'premium';
export type ProductType     = 'evergreen' | 'trend-driven' | 'seasonal' | 'unknown';

// ── Sub-document interfaces ───────────────────────────────────────────────────

/** TikTok creator on the discovery post — persisted on `Product.primaryCreator`. */
export interface IPrimaryCreator {
  tiktokUserId?: string;
  handle: string;
  displayName?: string;
  bio?: string;
  followers?: number;
  following?: number;
  totalLikes?: number;
  region?: string;
  verified?: boolean;
  tiktokPostUrl?: string;
  /** Creator profile image (canonical avatar for UI). */
  primaryImageUrl?: string | null;
  /** Legacy alias of `primaryImageUrl` — mirrored on read/write when set. */
  avatarUrl?: string | null;
}

/** `primaryCreator` after `formatProductResponse` (includes read-time proxy URL). */
export interface IPrimaryCreatorApi extends IPrimaryCreator {
  /** Same-origin proxy for `primaryImageUrl` when a linked creative exists. */
  avatarProxyUrl?: string;
}

export interface ProductAiInsightResponse {
  confidence: { score?: number; reason?: string };
  buyingSentiment: { score?: number; reason?: string };
  /** Present on product detail when enrichment has run; null on feed cards (listing projection). */
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

/** Discovery grid card — GET /products (feed/search). */
export interface ProductFeedItem {
  id: string;
  title: string;
  primaryImageUrl?: string;
  /** All product image URLs (primary first, deduped). */
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
  /** TikTok Shop / merchant storefront URL. */
  shopUrl?: string;
  shopAvatarUrl?: string | null;
  lastIngestedAt: string | Date;
  isTopAd?: boolean;
  /** Max `suppliers[].competitorScore` when present. */
  competitionScore?: number | null;
  aiInsight: {
    confidence: { score?: number };
    buyingSentiment?: { score?: number };
  };
  trend?: {
    score?: number;
    direction?: string;
    isTrending?: boolean;
  };
  primaryCreator?: IPrimaryCreatorApi;
}

/** Full product shape returned by GET /products/:id (and saved list). */
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
  /** Monthly organic visits to the store domain (SEMrush) */
  monthlyTraffic?: number | null;
  /** SEMrush global domain rank (lower = stronger) */
  semrushRank?: number | null;
  /** Units of this specific product sold at this competitor store */
  productUnitsSold?: number | null;
  /** Estimated monthly revenue this competitor earns from this product */
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



// ── Sales / revenue trends (stored on product detail) ───────────────────────────

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

/** Windowed price change — same structure as `IMetricTrend` / sales & revenue trends. */
export type IPriceTrend = IMetricTrend;
export type IPriceTrendWindow = IMetricTrendWindow;

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
  salesHistory?: ISalesHistoryEntry[];
  salesTrend?: IMetricTrend | null;
  revenueHistory?: IRevenueHistoryEntry[];
  revenueTrend?: IMetricTrend | null;
  priceHistory?: IPriceHistoryEntry[];
  priceTrend?: IPriceTrend | null;

  discoverySections?: string[];
  ratingSources?: Array<{
    platform?: string;
    rating?: number;
    reviewCount?: number;
    sourceUrl?: string;
    fetchedAt?: Date | string;
  }>;

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
  shopAvatarUrl?: string | null;
  /** Defaults to 0 when shop followers are unavailable */
  shopFollowers: number;
  postUrl?: string;
  /** ISO 8601 timestamp when the TikTok video was originally posted */
  postCreatedAt?: string | null;
  productUrl?: string;

  /** Total number of creatives (ads + store posts) attached to this product */
  relatedVideosCount?: number;

  // Creative counts (computed by enricher)
  creativeCounts?: {
    ads: number;
    organic: number;
    reviews: number;
    total: number;
  };

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