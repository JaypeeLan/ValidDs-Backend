import mongoose, { Document, Schema, Model } from 'mongoose';

/**
 * Product Model
 *
 * Core entity for ValidDs. Represents a TikTok-discoverable dropshippable product.
 *
 * Data comes from ingestion layer (TikTok API / fallback sources).
 * Fields are designed to support:
 *  - Product feed (list view with quick stats)
 *  - Product detail (full validation signals)
 *  - Filtering and sorting by trend, engagement, freshness
 */

export type ProductStatus = 'active' | 'archived' | 'stale';
export type TrendDirection = 'rising' | 'stable' | 'falling' | 'unknown';
export type SourceabilityStatus = 'verified' | 'likely' | 'unverified' | 'unavailable';

export interface IProductVideo {
  videoId: string;
  url?: string;
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
  score: number;                   // 0–100 composite trend score
  velocityScore: number;           // Rate of change in engagement
  peakViewsLast7d: number;
  totalVideosLast7d: number;
  totalVideosLast30d: number;
  categoryRank?: number;           // Rank within its category
  calculatedAt: Date;
}

export interface ISupplierRef {
  platform: string;                // 'aliexpress' | 'cj' | 'zendrop' | 'other'
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
  productCount?: number;
  totalSales?: number;
}

export interface IProduct {
  // Identity
  externalId: string;              // ID from source (TikTok product ID)
  source: string;                  // 'tiktok' | 'fallback-a' | 'fallback-b'
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

  // Engagement signals (aggregated across videos)
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  totalVideos: number;
  engagementRate?: number;         // (likes + comments + shares) / views

  // Top videos featuring this product
  topVideos: IProductVideo[];

  // Trend data
  trend: IProductTrend;

  // Sourceability (can you actually sell this?)
  sourceabilityStatus: SourceabilityStatus;
  suppliers: ISupplierRef[];

  // Store / competitor data
  stores: IStoreRef[];

  // Freshness
  status: ProductStatus;
  dataSourceUpdatedAt: Date;       // When the source last updated this product
  lastIngestedAt: Date;            // When we last pulled this product
  isStale: boolean;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

export interface IProductDocument extends IProduct, Document {}
export interface IProductModel extends Model<IProductDocument> {
  findByExternalId(externalId: string): Promise<IProductDocument | null>;
}

// ── Schema ────────────────────────────────────────────────────────────────────

const ProductVideoSchema = new Schema<IProductVideo>(
  {
    videoId:          { type: String, required: true },
    url:              { type: String },
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
    direction:          { type: String, enum: ['rising', 'stable', 'falling', 'unknown'], default: 'unknown' },
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
    productCount:  { type: Number },
    totalSales:    { type: Number },
  },
  { _id: false }
);

const ProductSchema = new Schema<IProductDocument, IProductModel>(
  {
    externalId:       { type: String, required: true },
    source:           { type: String, required: true },
    title:            { type: String, required: true, trim: true, maxlength: 500 },
    description:      { type: String, maxlength: 2000 },
    category:         { type: String },
    subCategory:      { type: String },
    tags:             [{ type: String }],

    imageUrls:        [{ type: String }],
    primaryImageUrl:  { type: String },

    price:            { type: Number },
    priceMin:         { type: Number },
    priceMax:         { type: Number },
    currency:         { type: String, default: 'USD' },
    estimatedMargin:  { type: Number },

    totalViews:       { type: Number, default: 0 },
    totalLikes:       { type: Number, default: 0 },
    totalComments:    { type: Number, default: 0 },
    totalShares:      { type: Number, default: 0 },
    totalVideos:      { type: Number, default: 0 },
    engagementRate:   { type: Number },

    topVideos:        { type: [ProductVideoSchema], default: [] },
    trend:            { type: ProductTrendSchema, default: () => ({}) },

    sourceabilityStatus: {
      type: String,
      enum: ['verified', 'likely', 'unverified', 'unavailable'],
      default: 'unverified',
    },
    suppliers: { type: [SupplierRefSchema], default: [] },
    stores:    { type: [StoreRefSchema], default: [] },

    status:               { type: String, enum: ['active', 'archived', 'stale'], default: 'active' },
    dataSourceUpdatedAt:  { type: Date, required: true },
    lastIngestedAt:       { type: Date, required: true },
    isStale:              { type: Boolean, default: false },
  },
  { timestamps: true }
);

// ── Indexes ───────────────────────────────────────────────────────────────────

ProductSchema.index({ externalId: 1, source: 1 }, { unique: true });
ProductSchema.index({ 'trend.score': -1 });
ProductSchema.index({ 'trend.direction': 1 });
ProductSchema.index({ totalViews: -1 });
ProductSchema.index({ category: 1 });
ProductSchema.index({ status: 1 });
ProductSchema.index({ isStale: 1 });
ProductSchema.index({ lastIngestedAt: -1 });
ProductSchema.index({ tags: 1 });

// Text search index for title + description + tags
ProductSchema.index({ title: 'text', description: 'text', tags: 'text' });

// ── Static methods ────────────────────────────────────────────────────────────

ProductSchema.statics.findByExternalId = function (externalId: string) {
  return this.findOne({ externalId, status: { $ne: 'archived' } });
};

export const Product = mongoose.model<IProductDocument, IProductModel>('Product', ProductSchema);
