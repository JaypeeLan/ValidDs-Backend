import mongoose, { Schema } from 'mongoose';
import type {
  IAIIntelligence,
  IMarketingAnalysis,
  IMarketingAngle,
  IMetricTrend,
  IMetricTrendWindow,
  IPriceHistoryEntry,
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

export type {
  IAIIntelligence,
  IMarketingAnalysis,
  IMarketingAngle,
  IMetricTrend,
  IMetricTrendWindow,
  IPriceHistoryEntry,
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

// ── Sub-schemas ───────────────────────────────────────────────────────────────

const PrimaryCreatorSchema = new Schema<IPrimaryCreator>(
  {
    tiktokUserId:    { type: String },
    handle:          { type: String, required: true },
    displayName:     { type: String },
    bio:             { type: String },
    followers:       { type: Number, min: 0 },
    following:       { type: Number, min: 0 },
    totalLikes:      { type: Number, min: 0 },
    region:          { type: String },
    verified:        { type: Boolean, default: false },
    tiktokPostUrl:   { type: String },
    primaryImageUrl: { type: String, default: null },
    avatarUrl:       { type: String, default: null },
  },
  { _id: false },
);

const ProductReviewSchema = new Schema<IProductReview>(
  {
    author:  { type: String, default: null },
    rating:  { type: Number, min: 0, max: 5, default: null },
    content: { type: String, default: null },
    date:    { type: String, default: null },
    item:    { type: String, default: null },
    images:  [{ type: String }],
  },
  { _id: false },
);

const ProductSupplierShopSchema = new Schema<IProductSupplierShop>(
  {
    name:   { type: String, default: null },
    url:    { type: String, default: null },
    rating: { type: Number, min: 0, max: 5, default: null },
  },
  { _id: false },
);

const ProductSupplierSchema = new Schema<IProductSupplier>(
  {
    source:           { type: String },
    platform:         { type: String },
    externalId:       { type: String },
    title:            { type: String },
    productUrl:       { type: String },
    shareUrl:         { type: String },
    price:            { type: Number, min: 0, default: null },
    onSale:           { type: Boolean, default: false },
    currency:         { type: String, default: 'USD' },
    rating:           { type: Number, min: 0, max: 5, default: null },
    totalRatings:     { type: Number, min: 0, default: null },
    totalReviews:     { type: Number, min: 0, default: null },
    soldLast30Days:   { type: Number, min: 0, default: null },
    availableForSale: { type: Boolean, default: true },
    shippingDays:     { type: Number, min: 0 },
    moq:              { type: Number, min: 0 },
    shop:             { type: ProductSupplierShopSchema, default: null },
    checkedAt:        { type: Date },
    fetchedAt:        { type: Date },
    monthlyTraffic:          { type: Number, min: 0, default: null },
    semrushRank:             { type: Number, min: 0, default: null },
    productUnitsSold:        { type: Number, min: 0, default: null },
    estimatedMonthlyRevenue: { type: Number, min: 0, default: null },
    revenueSource: {
      type: String,
      enum: ['product-sales', 'traffic-estimate', null],
      default: null,
    },
    competitorScore: { type: Number, min: 0, max: 100, default: null },
  },
  { _id: false },
);

const MarketingAngleSchema = new Schema<IMarketingAngle>(
  {
    hook:   { type: String, required: true },
    body:   { type: String, required: true },
    target: { type: String, required: true },
  },
  { _id: false },
);

const MarketingAnalysisSchema = new Schema<IMarketingAnalysis>(
  {
    primaryGender: {
      type: String,
      enum: ['female', 'male', 'mixed', 'unisex'],
      required: true,
    },
    topAgeGroups:      [{ type: String }],
    topRegions:        [{ type: String }],
    accessibilityTags: [{ type: String }],
    lifestyleSegments: [{ type: String }],
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
    angles:           { type: [MarketingAngleSchema], default: [] },
    analyzedAt:       { type: Date, required: true },
  },
  { _id: false },
);

const AIIntelligenceSchema = new Schema<IAIIntelligence>(
  {
    confidence:            { type: Number, required: true, min: 0, max: 100 },
    confidenceReason:      { type: String, required: true },
    brand:                 { type: String },
    buyingSentimentScore:  { type: Number, min: 0, max: 100 },
    buyingSentimentReason: { type: String },
    extractedAt:           { type: Date, default: Date.now },
    niche:                 { type: String },
    productType: {
      type: String,
      enum: ['evergreen', 'trend-driven', 'seasonal', 'unknown'],
      default: 'unknown',
    },
    priceBand: {
      type: String,
      enum: ['budget', 'mid-range', 'premium'],
    },
    audience:          [{ type: String }],
    categoryKeywords:  [{ type: String }],
    problemStatement:  { type: String },
    valueStatement:    { type: String },
    marketingAnalysis: { type: MarketingAnalysisSchema, default: null },
  },
  { _id: false },
);

const TrendSchema = new Schema<ITrend>(
  {
    score: { type: Number, required: true, min: 0, max: 5, default: 0 },
    direction: {
      type: String,
      enum: ['rising', 'peaked', 'saturating', 'stable', 'declining', 'emerging', 'viral', 'unknown'],
      default: 'unknown',
    },
    reason:       { type: String },
    isTrending:   { type: Boolean, default: false },
    calculatedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const MetricTrendWindowSchema = new Schema<IMetricTrendWindow>(
  {
    label:   { type: String, required: true },
    daysAgo: { type: Number, required: true, min: 0 },
    value:   { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const MetricTrendSchema = new Schema<IMetricTrend>(
  {
    direction:     { type: String, enum: ['up', 'down', 'stable'], required: true },
    changePercent: { type: Number, required: true },
    windows:       { type: [MetricTrendWindowSchema], default: [] },
  },
  { _id: false },
);

const SalesHistoryEntrySchema = new Schema<ISalesHistoryEntry>(
  {
    sales:      { type: Number, required: true, min: 0 },
    recordedAt: { type: Schema.Types.Mixed, required: true },
  },
  { _id: false },
);

const RevenueHistoryEntrySchema = new Schema<IRevenueHistoryEntry>(
  {
    revenue:    { type: Number, required: true, min: 0 },
    recordedAt: { type: Schema.Types.Mixed, required: true },
  },
  { _id: false },
);

const PriceHistoryEntrySchema = new Schema<IPriceHistoryEntry>(
  {
    price:      { type: Number, required: true, min: 0 },
    recordedAt: { type: Schema.Types.Mixed, required: true },
  },
  { _id: false },
);

const PriceTrendSchema = new Schema<IPriceTrend>(
  {
    direction:     { type: String, enum: ['up', 'down', 'stable'], required: true },
    changePercent: { type: Number, required: true },
    windows:       { type: [MetricTrendWindowSchema], default: [] },
  },
  { _id: false },
);

const RatingSourceSchema = new Schema(
  {
    platform:    { type: String },
    rating:      { type: Number, min: 0, max: 5 },
    reviewCount: { type: Number, min: 0 },
    sourceUrl:   { type: String },
    fetchedAt:   { type: Date },
  },
  { _id: false },
);

/** Per-dimension trend signals — keyed by dimension name. */
const ProductTrendsSchema = new Schema<IProductTrends>(
  {
    engagement:   { type: TrendSchema, default: null },
    priceHistory: { type: [PriceHistoryEntrySchema], default: [] },
  },
  { _id: false },
);

// ── Main schema ───────────────────────────────────────────────────────────────

export const ProductSchema = new Schema<IProductDocument, IProductModel>(
  {
    // Identity
    externalId: { type: String, required: true },
    source:     { type: String, required: true },
    status:     { type: String, enum: ['active', 'review', 'invalid'], default: 'review', index: true },

    // Content
    title:           { type: String, required: true, maxlength: 120 },
    normalizedTitle: { type: String, required: true, index: true },
    description:     { type: String, maxlength: 2000 },
    hashtags:        [{ type: String }],

    // Taxonomy
    categoryL1:   { type: String, required: true, index: true },
    categoryL2:   { type: String },
    categoryL3:   { type: String },
    categoryPath: { type: String, required: true },

    // Media
    primaryImageUrl: { type: String },
    imageUrls:       [{ type: String }],

    // Pricing
    price:        { type: Number, min: 0 },
    currency:     { type: String, default: 'USD' },
    priceHistory: { type: [PriceHistoryEntrySchema], default: [] },
    priceTrend:   { type: PriceTrendSchema, default: null },

    // Competitor suppliers
    suppliers: { type: [ProductSupplierSchema], default: [] },

    // Market evidence
    rating:        { type: Number, min: 0, max: 5 },
    reviewCount:   { type: Number, min: 1 },
    reviews:       { type: [ProductReviewSchema], default: [] },
    ratingSources: { type: [RatingSourceSchema], default: [] },

    // Sales & GMV
    soldCount:      { type: Number, min: 0 },
    totalSales:     { type: Number, min: 0 },
    totalGmv:       { type: Number, min: 0 },
    salesHistory:   { type: [SalesHistoryEntrySchema], default: [] },
    salesTrend:     { type: MetricTrendSchema, default: null },
    revenueHistory: { type: [RevenueHistoryEntrySchema], default: [] },
    revenueTrend:   { type: MetricTrendSchema, default: null },

    // Store-level aggregates
    storeGmv:       { type: Number, min: 0 },
    storeTotalSales:{ type: Number, min: 0 },

    // TikTok engagement
    viewCount:      { type: Number, default: 0, min: 0 },
    likeCount:      { type: Number, default: 0, min: 0 },
    commentCount:   { type: Number, default: 0, min: 0 },
    shareCount:     { type: Number, default: 0, min: 0 },
    engagementRate: { type: Number, default: null },

    // Creator
    primaryCreator: { type: PrimaryCreatorSchema },

    // AI
    aiIntelligence: { type: AIIntelligenceSchema, required: true },

    // Trend signals
    trends: { type: ProductTrendsSchema, default: null },

    // Discovery
    discoverySections: [{ type: String }],

    // Shop context
    shopName:      { type: String },
    shopUrl:       { type: String },
    shopAvatarUrl: { type: String, default: null },
    shopFollowers: { type: Number, min: 0, default: 0 },
    postUrl:       { type: String },
    postCreatedAt: { type: String, default: null },
    publishedAt:   { type: Schema.Types.Mixed, default: null },
    productUrl:    { type: String },

    // TikTok account context
    accountHandle: { type: String },
    accountKind:   { type: String },

    // Market
    market: { type: String },

    // Creative counts
    relatedVideosCount: { type: Number, default: 0 },
    creativeCounts: {
      type: new Schema(
        { ads: Number, organic: Number, reviews: Number, total: Number },
        { _id: false },
      ),
      default: null,
    },

    // Validation
    validationStatus: { type: String, required: true, default: 'pending' },

    // Freshness
    lastIngestedAt:      { type: Date, required: true },
    dataSourceUpdatedAt: { type: Date, required: true },
  },
  { timestamps: true },
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
