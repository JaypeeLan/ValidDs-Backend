import mongoose, { Document, Schema, Model } from 'mongoose';

export type ProductStatus = 'active' | 'archived' | 'stale';
export type TrendDirection = 'rising' | 'peaked' | 'saturating' | 'unknown';
export type SourceabilityStatus = 'verified' | 'likely' | 'unverified' | 'unavailable';
export type AdStatus = 'active' | 'inactive' | 'unknown';

// ── Sub-document interfaces ───────────────────────────────────────────────────

export interface IProductVideo {
  videoId: string;
  url?: string;
  playUrl?: string;
  thumbnailUrl?: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  creatorHandle?: string;
  creatorFollowers?: number;
  publishedAt?: Date;
  isAd: boolean;
}

export interface IProductTrend {
  direction: TrendDirection;
  score: number;
  velocityScore: number;
  peakViewsLast7d: number;
  totalVideosLast7d: number;
  totalVideosLast30d: number;
  categoryRank?: number;
  calculatedAt: Date;
}

/**
 * AI extraction metadata.
 * Populated by the product extractor.
 */
export interface IAIExtraction {
  confidence: number;              // 0–100 — how confident the AI is
  trendReason?: string;            // e.g. "High comment-to-view ratio"
  sentimentSummary?: string;       // e.g. "Users asking where to buy, positive tone"
  buyingIntentScore?: number;      // 0–100
  isProductVideo: boolean;         // false = video isn't really about a product
  extractedAt: Date;
}

/**
 * Ad signal metadata from Creative Center.
 * Only populated for posts sourced from top-ads endpoints.
 */
export interface IAdSignals {
  isAd: boolean;
  firstSeenAt?: Date;              // when the ad first appeared
  lastSeenAt?: Date;               // when the ad was last detected — freshness signal
  status: AdStatus;
  landingPage?: string;
  industry?: string;
}

export interface ISupplierRef {
  platform: string;
  url?: string;
  price?: number;
  currency?: string;
  shippingDays?: number;
  verified: boolean;
  checkedAt: Date;
}

export interface IStoreRef {
  tiktokShopId?: string;
  storeName?: string;
  storeUrl?: string;
  shopifyUrl?: string;             // populated when Shopify integration is added
  productCount?: number;
  totalSales?: number;
}

// ── Main interface ────────────────────────────────────────────────────────────

export interface IProduct {
  // Identity
  externalId: string;
  source: string;
  title: string;
  description?: string;
  category?: string;
  subCategory?: string;
  tags: string[];

  // Media
  imageUrls: string[];
  primaryImageUrl?: string;

  // Pricing
  price?: number;
  priceMin?: number;
  priceMax?: number;
  currency?: string;
  estimatedMargin?: number;
  unitsSold: number;
  store: string;
  rating?: number;
  reviewsCount?: number;

  // Engagement
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  totalVideos: number;
  engagementRate?: number;

  // Videos
  topVideos: IProductVideo[];
  videoUrl?: string; // Direct .mp4 media link for primary video

  // Trend
  trend: IProductTrend;

  // AI extraction metadata
  aiExtraction?: IAIExtraction;

  // Ad signals (Creative Center)
  adSignals?: IAdSignals;

  // Sourceability
  sourceabilityStatus: SourceabilityStatus;
  suppliers: ISupplierRef[];
  stores: IStoreRef[];

  // Freshness
  status: ProductStatus;
  dataSourceUpdatedAt: Date;
  lastIngestedAt: Date;
  isStale: boolean;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

export interface IProductDocument extends IProduct, Document {}
export interface IProductModel extends Model<IProductDocument> {
  findByExternalId(externalId: string): Promise<IProductDocument | null>;
}

// ── Sub-schemas ───────────────────────────────────────────────────────────────

const ProductVideoSchema = new Schema<IProductVideo>(
  {
    videoId:          { type: String, required: true },
    url:              { type: String },
    playUrl:          { type: String },
    thumbnailUrl:     { type: String },
    viewCount:        { type: Number, default: 0 },
    likeCount:        { type: Number, default: 0 },
    commentCount:     { type: Number, default: 0 },
    shareCount:       { type: Number, default: 0 },
    creatorHandle:    { type: String },
    creatorFollowers: { type: Number },
    publishedAt:      { type: Date },
    isAd:             { type: Boolean, default: false },
  },
  { _id: false }
);

const ProductTrendSchema = new Schema<IProductTrend>(
  {
    direction:          { type: String, enum: ['rising', 'peaked', 'saturating', 'unknown'], default: 'unknown' },
    score:              { type: Number, default: 0, min: 0, max: 100 },
    velocityScore:      { type: Number, default: 0 },
    peakViewsLast7d:    { type: Number, default: 0 },
    totalVideosLast7d:  { type: Number, default: 0 },
    totalVideosLast30d: { type: Number, default: 0 },
    categoryRank:       { type: Number },
    calculatedAt:       { type: Date, default: Date.now },
  },
  { _id: false }
);

const AIExtractionSchema = new Schema<IAIExtraction>(
  {
    confidence:         { type: Number, default: 0, min: 0, max: 100 },
    trendReason:        { type: String },
    sentimentSummary:   { type: String },
    buyingIntentScore:  { type: Number, min: 0, max: 100 },
    isProductVideo:     { type: Boolean, default: true },
    extractedAt:        { type: Date, default: Date.now },
  },
  { _id: false }
);

const AdSignalsSchema = new Schema<IAdSignals>(
  {
    isAd:        { type: Boolean, default: false },
    firstSeenAt: { type: Date },
    lastSeenAt:  { type: Date },
    status:      { type: String, enum: ['active', 'inactive', 'unknown'], default: 'unknown' },
    landingPage: { type: String },
    industry:    { type: String },
  },
  { _id: false }
);

const SupplierRefSchema = new Schema<ISupplierRef>(
  {
    platform:     { type: String, required: true },
    url:          { type: String },
    price:        { type: Number },
    currency:     { type: String, default: 'USD' },
    shippingDays: { type: Number },
    verified:     { type: Boolean, default: false },
    checkedAt:    { type: Date, default: Date.now },
  },
  { _id: false }
);

const StoreRefSchema = new Schema<IStoreRef>(
  {
    tiktokShopId:  { type: String },
    storeName:     { type: String },
    storeUrl:      { type: String },
    shopifyUrl:    { type: String },
    productCount:  { type: Number },
    totalSales:    { type: Number },
  },
  { _id: false }
);

// ── Main schema ───────────────────────────────────────────────────────────────

const ProductSchema = new Schema<IProductDocument, IProductModel>(
  {
    externalId:   { type: String, required: true },
    source:       { type: String, required: true },
    title:        { type: String, required: true, trim: true, maxlength: 500 },
    description:  { type: String, maxlength: 2000 },
    category:     { type: String },
    subCategory:  { type: String },
    tags:         [{ type: String }],

    imageUrls:       [{ type: String }],
    primaryImageUrl: { type: String },

    price:           { type: Number },
    priceMin:        { type: Number },
    priceMax:        { type: Number },
    currency:        { type: String, default: 'USD' },
    estimatedMargin: { type: Number },
    unitsSold:       { type: Number, default: 0 },
    store:           { type: String, default: 'TeemDrop' },
    rating:          { type: Number },
    reviewsCount:    { type: Number },

    totalViews:    { type: Number, default: 0 },
    totalLikes:    { type: Number, default: 0 },
    totalComments: { type: Number, default: 0 },
    totalShares:   { type: Number, default: 0 },
    totalVideos:   { type: Number, default: 0 },
    engagementRate: { type: Number },

    topVideos:    { type: [ProductVideoSchema], default: [] },
    videoUrl:     { type: String },
    trend:        { type: ProductTrendSchema, default: () => ({}) },
    aiExtraction: { type: AIExtractionSchema },
    adSignals:    { type: AdSignalsSchema },

    sourceabilityStatus: {
      type: String,
      enum: ['verified', 'likely', 'unverified', 'unavailable'],
      default: 'unverified',
    },
    suppliers: { type: [SupplierRefSchema], default: [] },
    stores:    { type: [StoreRefSchema], default: [] },

    status:              { type: String, enum: ['active', 'archived', 'stale'], default: 'active' },
    dataSourceUpdatedAt: { type: Date, required: true },
    lastIngestedAt:      { type: Date, required: true },
    isStale:             { type: Boolean, default: false },
  },
  { timestamps: true }
);

// ── Indexes ───────────────────────────────────────────────────────────────────

ProductSchema.index({ externalId: 1, source: 1 }, { unique: true });
ProductSchema.index({ 'trend.score': -1 });
ProductSchema.index({ 'trend.direction': 1 });
ProductSchema.index({ 'aiExtraction.confidence': -1 });
ProductSchema.index({ 'adSignals.isAd': 1 });
ProductSchema.index({ 'adSignals.status': 1 });
ProductSchema.index({ totalViews: -1 });
ProductSchema.index({ category: 1 });
ProductSchema.index({ status: 1 });
ProductSchema.index({ isStale: 1 });
ProductSchema.index({ lastIngestedAt: -1 });
ProductSchema.index({ tags: 1 });
ProductSchema.index({ title: 'text', description: 'text', tags: 'text' });

// ── Static methods ────────────────────────────────────────────────────────────

ProductSchema.statics.findByExternalId = function (externalId: string) {
  return this.findOne({ externalId, status: { $ne: 'archived' } });
};

export const Product = mongoose.model<IProductDocument, IProductModel>('Product', ProductSchema);
