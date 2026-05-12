import mongoose, { Schema } from 'mongoose';
import type {
  IAIIntelligence,
  IMarketingAnalysis,
  IPrimaryCreator,
  IProductDocument,
  IProductModel,
  IProductReview,
  IProductSupplier,
  IProductSupplierShop,
  ITrend,
} from '../types/product.types';

export type {
  IAIIntelligence,
  IMarketingAnalysis,
  IPrimaryCreator,
  IProduct,
  IProductDocument,
  IProductModel,
  IProductReview,
  IProductSupplier,
  IProductSupplierShop,
  ITrend,
  PriceBand,
  ProductStatus,
  ProductType,
  TrendDirection,
  Gender,
  IncomeLevel,
  PurchaseIntent,
  ContentFormat,
} from '../types/product.types';

// ── Sub-schemas ───────────────────────────────────────────────────────────────

const PrimaryCreatorSchema = new Schema<IPrimaryCreator>(
  {
    tiktokUserId:  { type: String },
    handle:        { type: String, required: true },
    displayName:   { type: String },
    followers:     { type: Number, min: 0 },
    verified:      { type: Boolean, default: false },
    tiktokPostUrl: { type: String },
    avatarUrl:     { type: String, default: null },
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
    originalPrice:    { type: Number, min: 0, default: null },
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
    // ── Competitor intelligence ─────────────────────────────────────────────
    monthlyTraffic:          { type: Number, min: 0, default: null },
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
    analyzedAt:       { type: Date, required: true },
  },
  { _id: false },
);

const AIIntelligenceSchema = new Schema<IAIIntelligence>(
  {
    confidence:            { type: Number, required: true, min: 0, max: 100 },
    confidenceReason:      { type: String, required: true },
    brand:                 { type: String },
    categoryKeywords:      [{ type: String }],
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

// ── Main schema ───────────────────────────────────────────────────────────────

const ProductSchema = new Schema<IProductDocument, IProductModel>(
  {
    externalId: { type: String, required: true },
    source:     { type: String, required: true },
    status:     { type: String, enum: ['active', 'review', 'invalid'], default: 'review', index: true },

    title:           { type: String, required: true, maxlength: 120 },
    normalizedTitle: { type: String, required: true, index: true },
    description:     { type: String, maxlength: 2000 },
    hashtags:        [{ type: String }],

    categoryL1:   { type: String, required: true, index: true },
    categoryL2:   { type: String },
    categoryL3:   { type: String },
    categoryPath: { type: String, required: true },

    primaryImageUrl: { type: String },
    imageUrls:       [{ type: String }],

    price:         { type: Number, min: 0 },
    currency:      { type: String, default: 'USD' },
    originalPrice: { type: Number, min: 0 },
    shippingFee:   { type: Number, min: 0 },

    suppliers: { type: [ProductSupplierSchema], default: [] },

    rating:      { type: Number, min: 0, max: 5 },
    reviewCount: { type: Number, min: 1 },
    reviews:     { type: [ProductReviewSchema], default: [] },

    soldCount:  { type: Number, min: 0 },
    totalSales: { type: Number, min: 0 },
    totalGmv:   { type: Number, min: 0 },

    viewCount:      { type: Number, default: 0, min: 0 },
    likeCount:      { type: Number, default: 0, min: 0 },
    commentCount:   { type: Number, default: 0, min: 0 },
    shareCount:     { type: Number, default: 0, min: 0 },
    engagementRate: { type: Number, min: 0 },

    primaryCreator: { type: PrimaryCreatorSchema },

    aiIntelligence: { type: AIIntelligenceSchema, required: true },

    trend: { type: TrendSchema, required: true, default: () => ({}) },

    creativeCounts: {
      ads:     { type: Number, default: 0, min: 0 },
      organic: { type: Number, default: 0, min: 0 },
      reviews: { type: Number, default: 0, min: 0 },
      total:   { type: Number, default: 0, min: 0 },
    },

    shopName:      { type: String },
    shopUrl:       { type: String },
    shopFollowers: { type: Number, min: 0 },
    postUrl:       { type: String },
    videoUrl:      { type: String },
    productUrl:    { type: String },
    variations:    { type: [Schema.Types.Mixed], default: [] },
    sizes:         [{ type: String }],

    validationStatus: { type: String, required: true, default: 'pending' },

    lastIngestedAt:      { type: Date, required: true },
    dataSourceUpdatedAt: { type: Date, required: true },
  },
  { timestamps: true },
);

// ── Indexes ───────────────────────────────────────────────────────────────────

ProductSchema.index({ externalId: 1, source: 1 }, { unique: true });
ProductSchema.index({ 'trend.score': -1 });
ProductSchema.index({ 'trend.direction': 1 });
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