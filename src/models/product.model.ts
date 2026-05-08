import mongoose, { Schema } from 'mongoose';
import type {
  IAIIntelligence,
  IPrimaryCreator,
  IProductDocument,
  IProductModel,
  IProductReview,
  ISpecification,
  ITrend,
} from '../types/product.types';

export type {
  IAIIntelligence,
  IPrimaryCreator,
  IProduct,
  IProductDocument,
  IProductModel,
  IProductReview,
  ISpecification,
  ITrend,
  PriceBand,
  ProductStatus,
  ProductType,
  TrendDirection,
} from '../types/product.types';

// ── Mongoose Schemas ──────────────────────────────────────────────────────────

const PrimaryCreatorSchema = new Schema<IPrimaryCreator>(
  {
    tiktokUserId: { type: String },
    handle:       { type: String, required: true },
    displayName:  { type: String },
    followers:    { type: Number, min: 0 },
    verified:     { type: Boolean, default: false },
    tiktokPostUrl:{ type: String },
  },
  { _id: false }
);

const ProductReviewSchema = new Schema<IProductReview>(
  {
    author:  { type: String, default: null },
    rating:  { type: Number, min: 0, max: 5, default: null },
    content: { type: String, default: null },
    date:    { type: String, default: null },
    item:    { type: String, default: null },
  },
  { _id: false }
);

const SpecificationSchema = new Schema<ISpecification>(
  {
    title: { type: String, required: true },
    value: { type: String, required: true },
  },
  { _id: false }
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
    // Enrichment fields
    niche:            { type: String },
    productType:      { type: String, enum: ['evergreen', 'trend-driven', 'seasonal', 'unknown'], default: 'unknown' },
    priceBand:        { type: String, enum: ['budget', 'mid-range', 'premium'] },
    audience:         [{ type: String }],
    problemStatement: { type: String },
    valueStatement:   { type: String },
  },
  { _id: false }
);

const TrendSchema = new Schema<ITrend>(
  {
    score:       { type: Number, required: true, min: 0, max: 5, default: 0 },
    direction:   {
      type: String,
      enum: ['rising', 'peaked', 'saturating', 'stable', 'declining', 'emerging', 'viral', 'unknown'],
      default: 'unknown',
    },
    reason:      { type: String },
    isTrending:  { type: Boolean, default: false },
    calculatedAt:{ type: Date, default: Date.now },
  },
  { _id: false }
);

// ── Main Schema ───────────────────────────────────────────────────────────────

const ProductSchema = new Schema<IProductDocument, IProductModel>(
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
    price:          { type: Number, min: 0 },
    currency:       { type: String, default: 'USD' },
    originalPrice:  { type: Number, min: 0 },
    discountPercent:{ type: Number, min: 0, max: 100 },
    shippingFee:    { type: Number, min: 0 },

    // Market Evidence
    rating:     { type: Number, min: 0, max: 5 },
    reviewCount:{ type: Number, min: 0 },
    reviews:    { type: [ProductReviewSchema], default: [] },

    // Sales & GMV
    soldCount:  { type: Number, min: 0 },
    totalSales: { type: Number, min: 0 },
    totalGmv:   { type: Number, min: 0 },

    // TikTok Engagement
    viewCount:     { type: Number, default: 0, min: 0 },
    likeCount:     { type: Number, default: 0, min: 0 },
    commentCount:  { type: Number, default: 0, min: 0 },
    shareCount:    { type: Number, default: 0, min: 0 },
    engagementRate:{ type: Number, min: 0 },

    // Creator
    primaryCreator: { type: PrimaryCreatorSchema },

    // AI Intelligence
    aiIntelligence: { type: AIIntelligenceSchema, required: true },

    // Trend
    trend: { type: TrendSchema, required: true, default: () => ({}) },

    // Creative Summary
    creativeCounts: {
      ads:     { type: Number, default: 0, min: 0 },
      organic: { type: Number, default: 0, min: 0 },
      reviews: { type: Number, default: 0, min: 0 },
      total:   { type: Number, default: 0, min: 0 },
    },

    // Shop Fields
    shopName:     { type: String },
    shopUrl:      { type: String },
    shopFollowers:{ type: Number, min: 0 },
    inStock:      { type: Boolean },
    postUrl:      { type: String },
    videoUrl:     { type: String },
    productUrl:   { type: String },
    variations:   { type: [Schema.Types.Mixed], default: [] },
    specifications:{ type: [SpecificationSchema], default: [] },
    sizes:        [{ type: String }],
    colors:       [{ type: String }],

    // Validation
    validationStatus: { type: String, required: true, default: 'pending' },
    validationIssues: { type: [Schema.Types.Mixed], default: [] },

    // Freshness
    lastIngestedAt:      { type: Date, required: true },
    dataSourceUpdatedAt: { type: Date, required: true },
  },
  { timestamps: true }
);

// ── Indexes ───────────────────────────────────────────────────────────────────

ProductSchema.index({ externalId: 1, source: 1 }, { unique: true });
ProductSchema.index({ 'trend.score': -1 });
ProductSchema.index({ 'trend.direction': 1 });
ProductSchema.index({ totalSales: -1 });
ProductSchema.index({ totalGmv: -1 });
ProductSchema.index({ lastIngestedAt: -1 });
ProductSchema.index({ title: 'text', description: 'text' });

// ── Static Methods ────────────────────────────────────────────────────────────

ProductSchema.statics.findByExternalId = function (externalId: string) {
  return this.findOne({ externalId, status: { $ne: 'invalid' } });
};

export const Product = mongoose.model<IProductDocument, IProductModel>('Product', ProductSchema);