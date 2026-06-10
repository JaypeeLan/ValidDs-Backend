import mongoose, { Schema } from 'mongoose';
import type {
  IAIIntelligence,
  IMarketingAnalysis,
  IMarketingAngle,
  IMetricTrend,
  IMetricTrendWindow,
  IPriceTrend,
  IPrimaryCreator,
  IProductDocument,
  IProductModel,
  IProductReview,
  IProductSupplier,
  IProductSupplierShop,
  IProductTrends,
  IRevenueHistoryEntry,
  ISalesHistoryEntry,
  ITrend,
} from '../types/product.types.js';
import {
  ensureLastIngestedAtOnCreate,
  touchProductFreshnessOnUpdate,
} from '../utils/product-freshness.util';

export type {
  IAIIntelligence,
  IMarketingAnalysis,
  IMarketingAngle,
  IMetricTrend,
  IMetricTrendWindow,
  IPriceTrend,
  IPriceTrendWindow,
  IPrimaryCreator,
  IProduct,
  IProductDocument,
  IProductModel,
  IProductReview,
  IProductSupplier,
  IProductSupplierShop,
  IProductTrends,
  IRevenueHistoryEntry,
  ISalesHistoryEntry,
  ITrend,
  PriceBand,
  ProductStatus,
  ProductType,
  TrendDirection,
  Gender,
  IncomeLevel,
  PurchaseIntent,
  ContentFormat,
} from '../types/product.types.js';

const STRICT_SUB = { _id: false, strict: true } as const;

// ── Sub-schemas ───────────────────────────────────────────────────────────────

const PrimaryCreatorSchema = new Schema<IPrimaryCreator>(
  {
    handle: { type: String, required: true },
    tiktokUserId: { type: String, default: '' },
    displayName: { type: String, default: '' },
    bio: { type: String, default: '' },
    followers: { type: Number, min: 0, default: 0 },
    following: { type: Number, min: 0, default: 0 },
    totalLikes: { type: Number, min: 0, default: 0 },
    region: { type: String, default: '' },
    verified: { type: Boolean, default: false },
    tiktokPostUrl: { type: String, default: '' },
    primaryImageUrl: { type: String, default: '' },
    avatarUrl: { type: String, default: '' },
    avatarS3Key: { type: String, default: '' },
  },
  STRICT_SUB,
);

const ProductReviewSchema = new Schema<IProductReview>(
  {
    name: { type: String, default: null },
    author: { type: String, default: null },
    rating: { type: Number, min: 0, max: 5, default: null },
    review: { type: String, default: null },
    content: { type: String, default: null },
    date: { type: String, default: null },
    item: { type: String, default: null },
    images: { type: [String], default: [] },
  },
  STRICT_SUB,
);

const ProductSupplierShopSchema = new Schema<IProductSupplierShop>(
  {
    name: { type: String, required: true, default: null },
    url: { type: String, required: true, default: null },
    rating: { type: Number, min: 0, max: 5, default: null },
  },
  STRICT_SUB,
);

const ProductSupplierSchema = new Schema<IProductSupplier>(
  {
    source: { type: String, required: true },
    platform: { type: String, default: '' },
    externalId: { type: String, required: true, default: '' },
    title: { type: String, required: true, default: '' },
    productUrl: { type: String, required: true, default: '' },
    shareUrl: { type: String, required: true, default: '' },
    price: { type: Number, min: 0, default: null },
    currency: { type: String, default: 'USD' },
    onSale: { type: Boolean, default: false },
    rating: { type: Number, min: 0, max: 5, default: null },
    totalRatings: { type: Number, min: 0, default: null },
    totalReviews: { type: Number, min: 0, default: null },
    soldLast30Days: { type: Number, min: 0, default: null },
    availableForSale: { type: Boolean, default: true },
    moq: { type: Number, min: 0, default: 0 },
    shop: { type: ProductSupplierShopSchema, default: null },
    checkedAt: { type: Date, default: null },
    fetchedAt: { type: Date, required: true },
    monthlyTraffic: { type: Number, required: true, min: 0, default: null },
    productUnitsSold: { type: Number, required: true, min: 1, default: 1 },
    estimatedMonthlyRevenue: { type: Number, required: true, min: 0, default: null },
    revenueSource: {
      type: String,
      enum: ['product-sales', 'traffic-estimate', null],
      required: true,
      default: null,
    },
    competitorScore: { type: Number, required: true, min: 0, max: 100, default: null },
  },
  STRICT_SUB,
);

const MarketingAngleSchema = new Schema<IMarketingAngle>(
  {
    hook: { type: String, required: true },
    body: { type: String, required: true },
    target: { type: String, required: true },
    videoUrl: { type: String, required: false },
    videoProxyUrl: { type: String, required: false },
    thumbnailProxyUrl: { type: String, required: false },
    metaAdLibraryUrl: { type: String, required: false },
  },
  STRICT_SUB,
);

const MarketingAnalysisSchema = new Schema<IMarketingAnalysis>(
  {
    primaryGender: {
      type: String,
      enum: ['female', 'male', 'mixed', 'unisex'],
      required: true,
    },
    topAgeGroups: { type: [String], required: true, default: [] },
    topRegions: { type: [String], required: true, default: [] },
    accessibilityTags: { type: [String], required: true, default: [] },
    lifestyleSegments: { type: [String], required: true, default: [] },
    incomeLevel: {
      type: String,
      enum: ['budget', 'mid-range', 'premium', 'luxury'],
      required: true,
    },
    purchaseIntent: {
      type: String,
      enum: ['impulse', 'considered', 'habitual', 'gifting'],
      required: true,
    },
    contentFormat: {
      type: String,
      enum: ['tutorial', 'lifestyle', 'entertainment', 'review', 'comparison'],
      required: true,
    },
    marketingInsight: { type: String, required: true },
    sentimentLabel: {
      type: String,
      enum: ['positive', 'neutral', 'negative'],
      default: null,
    },
    angles: { type: [MarketingAngleSchema], required: true, default: [] },
    analyzedAt: { type: Date, required: true },
  },
  STRICT_SUB,
);

const ReviewSummarySchema = new Schema(
  {
    summary: { type: String, required: true, default: '' },
    generatedAt: { type: Date, required: true, default: Date.now },
  },
  STRICT_SUB,
);

const AIIntelligenceSchema = new Schema<IAIIntelligence>(
  {
    confidence: { type: Number, required: true, min: 0, max: 100 },
    confidenceReason: { type: String, required: true },
    brand: { type: String, required: true, default: '' },
    buyingSentimentScore: { type: Number, required: true, min: 0, max: 100, default: 0 },
    buyingSentimentReason: { type: String, default: '' },
    buyingSentimentLabel: {
      type: String,
      enum: ['positive', 'neutral', 'negative'],
      default: null,
    },
    reviewSummary: { type: ReviewSummarySchema, required: true },
    extractedAt: { type: Date, required: true, default: Date.now },
    niche: { type: String, required: true, default: '' },
    productType: {
      type: String,
      enum: ['evergreen', 'trend-driven', 'seasonal', 'unknown'],
      required: true,
      default: 'unknown',
    },
    priceBand: {
      type: String,
      enum: ['budget', 'mid-range', 'premium'],
      required: true,
      default: 'mid-range',
    },
    audience: { type: [String], required: true, default: [] },
    categoryKeywords: { type: [String], required: true, default: [] },
    problemStatement: { type: String, required: true, default: '' },
    valueStatement: { type: String, required: true, default: '' },
    marketingAnalysis: { type: MarketingAnalysisSchema, required: true },
  },
  STRICT_SUB,
);

const TrendSchema = new Schema<ITrend>(
  {
    score: { type: Number, required: true, min: 0, max: 5, default: 0 },
    direction: {
      type: String,
      enum: [
        'rising',
        'peaked',
        'saturating',
        'stable',
        'declining',
        'emerging',
        'viral',
        'unknown',
      ],
      required: true,
      default: 'unknown',
    },
    reason: { type: String, default: '' },
    isTrending: { type: Boolean, required: true, default: false },
    calculatedAt: { type: Date, required: true, default: Date.now },
  },
  STRICT_SUB,
);

const MetricTrendWindowSchema = new Schema<IMetricTrendWindow>(
  {
    label: { type: String, required: true },
    daysAgo: { type: Number, required: true, min: 0 },
    value: { type: Number, required: true, min: 0 },
  },
  STRICT_SUB,
);

const MetricTrendSchema = new Schema<IMetricTrend>(
  {
    direction: { type: String, enum: ['up', 'down', 'stable'], required: true },
    changePercent: { type: Number, required: true },
    windows: { type: [MetricTrendWindowSchema], required: true, default: [] },
  },
  STRICT_SUB,
);

const SalesHistoryEntrySchema = new Schema<ISalesHistoryEntry>(
  {
    sales: { type: Number, required: true, min: 0 },
    recordedAt: { type: Schema.Types.Mixed, required: true },
  },
  STRICT_SUB,
);

const RevenueHistoryEntrySchema = new Schema<IRevenueHistoryEntry>(
  {
    revenue: { type: Number, required: true, min: 0 },
    recordedAt: { type: Schema.Types.Mixed, required: true },
  },
  STRICT_SUB,
);

const PriceTrendSchema = new Schema<IPriceTrend>(
  {
    direction: { type: String, enum: ['up', 'down', 'stable'], required: true },
    changePercent: { type: Number, required: true },
    windows: { type: [MetricTrendWindowSchema], required: true, default: [] },
  },
  STRICT_SUB,
);

const RatingSourceSchema = new Schema(
  {
    platform: { type: String, required: true, default: '' },
    rating: { type: Number, required: true, min: 0, max: 5, default: null },
    reviewCount: { type: Number, required: true, min: 0, default: null },
    sourceUrl: { type: String, required: true, default: '' },
    fetchedAt: { type: Date, required: true },
  },
  STRICT_SUB,
);

const ProductTrendsSchema = new Schema<IProductTrends>(
  {
    engagement: { type: TrendSchema, required: true },
  },
  STRICT_SUB,
);

const CreativeCountsSchema = new Schema(
  {
    ads: { type: Number, required: true, default: 0 },
    organic: { type: Number, required: true, default: 0 },
    reviews: { type: Number, required: true, default: 0 },
    total: { type: Number, required: true, default: 0 },
  },
  STRICT_SUB,
);

// ── Main schema ───────────────────────────────────────────────────────────────

export const ProductSchema = new Schema<IProductDocument, IProductModel>(
  {
    // Identity
    externalId: { type: String, required: true },
    source: { type: String, required: true },
    status: {
      type: String,
      enum: ['active', 'review', 'invalid'],
      required: true,
      default: 'review',
      index: true,
    },

    // Content
    title: { type: String, required: true, maxlength: 500 },
    normalizedTitle: { type: String, required: true, index: true },
    description: { type: String, required: true, default: '', maxlength: 2000 },
    hashtags: { type: [String], required: true, default: [] },

    // Taxonomy
    categoryL1: { type: String, required: true, index: true },
    categoryL2: { type: String, required: true, default: '' },
    categoryL3: { type: String, required: true, default: '' },
    categoryPath: { type: String, required: true },

    // Media
    primaryImageUrl: { type: String, required: true, default: '' },
    imageUrls: { type: [String], required: true, default: [] },

    // Pricing
    price: { type: Number, required: true, min: 0, default: 0 },
    currency: { type: String, required: true, default: 'USD' },
    priceTrend: { type: PriceTrendSchema, required: true },

    // Competitor suppliers
    suppliers: { type: [ProductSupplierSchema], required: true, default: [] },

    // Market evidence
    rating: { type: Number, required: true, min: 0, max: 5, default: 0 },
    reviewCount: { type: Number, required: true, min: 0, default: 0 },
    reviews: { type: [ProductReviewSchema], required: true, default: [] },
    ratingSources: { type: [RatingSourceSchema], required: true, default: [] },

    // Sales & GMV
    soldCount: { type: Number, required: true, min: 0, default: 0 },
    totalSales: { type: Number, required: true, min: 0, default: 0 },
    totalGmv: { type: Number, required: true, min: 0, default: 0 },
    salesHistory: { type: [SalesHistoryEntrySchema], required: true, default: [] },
    salesTrend: { type: MetricTrendSchema, required: true },
    revenueHistory: { type: [RevenueHistoryEntrySchema], required: true, default: [] },
    revenueTrend: { type: MetricTrendSchema, required: true },

    // Store-level aggregates
    storeGmv: { type: Number, required: true, min: 0, default: 0 },
    storeTotalSales: { type: Number, required: true, min: 0, default: 0 },

    // TikTok engagement
    viewCount: { type: Number, required: true, default: 0, min: 0 },
    likeCount: { type: Number, required: true, default: 0, min: 0 },
    commentCount: { type: Number, required: true, default: 0, min: 0 },
    shareCount: { type: Number, required: true, default: 0, min: 0 },
    engagementRate: { type: Number, required: true, default: 0 },

    // Creator
    primaryCreator: { type: PrimaryCreatorSchema, required: true },

    // AI
    aiIntelligence: { type: AIIntelligenceSchema, required: true },

    // Trend signals
    trends: { type: ProductTrendsSchema, required: true },

    // Discovery
    discoverySections: { type: [String], required: true, default: [] },

    // Shop context
    shopName: { type: String, required: true, default: '' },
    shopUrl: { type: String, required: true, default: '' },
    shopAvatarUrl: { type: String, required: true, default: '' },
    shopAvatarS3Key: { type: String, default: '' },
    shopFollowers: { type: Number, required: true, min: 0, default: 0 },
    postUrl: { type: String, required: true, default: '' },
    postCreatedAt: { type: String, required: true, default: '' },
    publishedAt: { type: Date, required: true, default: () => new Date() },
    productUrl: { type: String, required: true, default: '' },

    // TikTok account context
    accountHandle: { type: String, required: true, default: '' },
    accountKind: { type: String, required: true, default: '' },

    // Market
    market: { type: String, required: true, default: '' },

    // Creative counts
    relatedVideosCount: { type: Number, required: true, default: 0 },
    creativeCounts: { type: CreativeCountsSchema, required: true },

    // Validation
    validationStatus: { type: String, required: true, default: 'pending' },

    // Freshness
    lastIngestedAt: { type: Date, required: true },
    dataSourceUpdatedAt: { type: Date, required: true },
  },
  { timestamps: true, strict: true },
);

ProductSchema.pre('save', function productFreshnessOnSave(next) {
  ensureLastIngestedAtOnCreate(this);
  next();
});

ProductSchema.pre(
  ['updateOne', 'updateMany', 'findOneAndUpdate'],
  function productFreshnessOnUpdate(next) {
    const update = this.getUpdate();
    if (update && typeof update === 'object' && !Array.isArray(update)) {
      touchProductFreshnessOnUpdate(update as Record<string, unknown>);
      this.setUpdate(update);
    }
    next();
  },
);

// ── Indexes ───────────────────────────────────────────────────────────────────

ProductSchema.index({ externalId: 1, source: 1 }, { unique: true });
ProductSchema.index({ 'trends.engagement.score': -1 });
ProductSchema.index({ 'trends.engagement.direction': 1 });
ProductSchema.index({ totalSales: -1 });
ProductSchema.index({ totalGmv: -1 });
ProductSchema.index({ 'suppliers.competitorScore': -1 });
ProductSchema.index({ lastIngestedAt: -1 });
ProductSchema.index({ title: 'text', description: 'text' });

// ── Static methods ────────────────────────────────────────────────────────────

ProductSchema.statics.findByExternalId = function (externalId: string) {
  return this.findOne({ externalId, status: { $ne: 'invalid' } });
};

export const Product = mongoose.model<IProductDocument, IProductModel>('Product', ProductSchema);
