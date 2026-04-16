import mongoose, { Document, Schema, Model } from 'mongoose';

// ── Shared Enums ──────────────────────────────────────────────────────────────

export type ProductStatus  = 'active' | 'archived' | 'stale';
export type TrendDirection = 'rising' | 'peaked' | 'saturating' | 'stable' | 'declining' | 'emerging' | 'viral' | 'unknown';
export type AdStatus       = 'active' | 'inactive' | 'unknown';

// ── Sub-document Interfaces ───────────────────────────────────────────────────

/**
 * The original TikTok creator who posted the video that triggered discovery.
 * Sourced from EnsembleData. This is NOT an influencer list — it is a
 * single author record for the post we found the product in.
 */
export interface IPrimaryCreator {
  tiktokUserId?: string;
  handle: string;            // @username
  displayName?: string;      // nickname
  bio?: string;
  followers?: number;        // follower count at time of ingestion
  following?: number;
  totalLikes?: number;
  region?: string;           // country code e.g. 'US'
  verified?: boolean;
  avatarUrl?: string;
  tiktokPostUrl: string;     // direct link to the specific video that was ingested
}

/**
 * A single supplier/sourcing option for this product.
 * Only populated when a TeemDrop (or future supplier) match is found.
 */
export interface ISupplier {
  platform: string;          // e.g. 'TeemDrop', 'AliExpress'
  productUrl?: string;       // direct listing URL for verification
  price?: number;
  currency?: string;
  shippingDays?: number;
  moq?: number;              // minimum order quantity
  checkedAt: Date;
}

/**
 * A verified rating entry from a specific platform.
 * Only stored when sourced from SerpApi or a verified supplier API.
 */
export interface IRatingSource {
  platform: string;          // e.g. 'Amazon', 'Google Shopping', 'TeemDrop'
  rating: number;            // 1–5 scale
  reviewCount: number;
  sourceUrl?: string;        // link to the reviews page
  fetchedAt: Date;
}

/**
 * A representative comment from TikTok users about this product.
 * Sourced from EnsembleData comment API. Used as social proof on the product card.
 */
export interface IProductComment {
  text: string;                    // comment body
  likeCount: number;               // comment likes — proxy for usefulness
  authorHandle?: string;           // commenter's @handle (may be absent)
  sentiment: 'positive' | 'negative' | 'neutral';  // AI-classified
  source: string;                  // 'EnsembleData'
  collectedAt: Date;
}

/**
 * Verified sales volume evidence from a specific store.
 * Only stored when the AI can cite a concrete source.
 */
export interface ISalesEvidence {
  unitsSold: number;
  store: string;             // e.g. 'Amazon', 'TikTok Shop'
  storeUrl?: string;         // direct link to the evidence listing
  timeframe?: string;        // e.g. 'last 30 days', 'all time'
  fetchedAt: Date;
}

/**
 * AI extraction intelligence — all scores come with a human-readable reason.
 */
export interface IAIIntelligence {
  confidence: number;             // 0–100: how certain AI is this is a real product
  confidenceReason: string;       // e.g. "Product name visible in video + matches 5 Amazon results"
  brand?: string;                 // e.g. "Stanley", "Anker"
  categoryKeywords: string[];     // core niche terms used for content relevance filtering
  buyingSentimentScore?: number;  // 0–100: buying intent from comments
  buyingSentimentReason?: string; // e.g. "85% of comments express intent to purchase"
  extractedAt: Date;
}

/**
 * Trend signals — calculated by Discovery Service from engagement data.
 */
export interface ITrend {
  score: number;             // 0–100 composite score
  direction: TrendDirection;
  reason?: string;           // e.g. "High comment-to-view ratio, multiple creators posting"
  isTrending: boolean;
  calculatedAt: Date;
}

/**
 * A related product card surfaced from SerpApi Shopping results.
 */
export interface IRelatedProduct {
  title: string;
  price?: string;
  thumbnail?: string;
  link?: string;
  store?: string;           // e.g. 'Amazon', 'Walmart'
}

// ── Main Product Interface ────────────────────────────────────────────────────

export interface IProduct {
  // ── Identity ─────────────────────────────────────────────────────────────
  externalId: string;          // TikTok aweme_id of the discovery post
  source: string;              // ingestion source e.g. 'ensemble'
  status: ProductStatus;

  // ── Content ──────────────────────────────────────────────────────────────
  title: string;               // clean, searchable product title (≤120 chars)
  normalizedTitle: string;     // lowercase, punctuation-stripped for dedup
  description: string;         // AI-generated product summary
  hashtags: string[];          // from the discovery post

  // ── Taxonomy (3-Level Hierarchy) ─────────────────────────────────────────
  categoryL1: string;          // e.g. 'Beauty & Personal Care'
  categoryL2?: string;         // e.g. 'Skin Care'
  categoryL3?: string;         // e.g. 'Cleansers'
  categoryPath: string;        // e.g. 'Beauty & Personal Care / Skin Care / Cleansers'

  // ── Media (SerpApi-first) ────────────────────────────────────────────────
  primaryImageUrl?: string;    // best single image from SerpApi Immersive/Shopping
  imageUrls: string[];         // full gallery from SerpApi Shopping results

  // ── Pricing (from TeemDrop if matched, otherwise AI estimate) ────────────
  price?: number;
  currency: string;
  suppliers: ISupplier[];      // verified supplier options

  // ── Market Evidence ──────────────────────────────────────────────────────
  rating?: number;             // average rating across all sources (1–5 scale)
  reviewCount?: number;        // total number of reviews across all sources
  salesEvidence?: ISalesEvidence;    // units sold with verifiable source
  ratingSources: IRatingSource[];    // multi-platform ratings (SerpApi + estimated)

  // ── Social Proof Comments (from EnsembleData) ────────────────────────────
  topComments: IProductComment[];    // up to 10 representative TikTok comments

  // ── TikTok Engagement (from original discovery post) ─────────────────────
  viewCount: number;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  engagementRate?: number;

  // ── Discovery Origin ─────────────────────────────────────────────────────
  primaryCreator: IPrimaryCreator;  // who posted the discovery video

  // ── AI Intelligence ──────────────────────────────────────────────────────
  aiIntelligence: IAIIntelligence;

  // ── Trend Analysis ───────────────────────────────────────────────────────
  trend: ITrend;

  // ── Discovery Sections ───────────────────────────────────────────────────
  discoverySections: string[];       // e.g. ['trending', 'top-ads', 'viral']
  relatedProducts: IRelatedProduct[];

  // ── Creative Summary (counts populated by CreativeService) ───────────────
  creativeCounts: {
    ads: number;
    organic: number;
    reviews: number;
    total: number;
  };

  // ── Freshness ────────────────────────────────────────────────────────────
  lastIngestedAt: Date;
  dataSourceUpdatedAt: Date;

  // ── Timestamps (auto by Mongoose) ────────────────────────────────────────
  createdAt: Date;
  updatedAt: Date;
}

export interface IProductDocument extends IProduct, Document {}
export interface IProductModel extends Model<IProductDocument> {
  findByExternalId(externalId: string): Promise<IProductDocument | null>;
}

// ── Mongoose Schemas ──────────────────────────────────────────────────────────

const PrimaryCreatorSchema = new Schema<IPrimaryCreator>(
  {
    tiktokUserId:  { type: String },
    handle:        { type: String, required: true },
    displayName:   { type: String },
    bio:           { type: String },
    followers:     { type: Number, min: 0 },
    following:     { type: Number, min: 0 },
    totalLikes:    { type: Number, min: 0 },
    region:        { type: String },
    verified:      { type: Boolean, default: false },
    avatarUrl:     { type: String },
    tiktokPostUrl: { type: String, required: true },
  },
  { _id: false }
);

const SupplierSchema = new Schema<ISupplier>(
  {
    platform:    { type: String, required: true },
    productUrl:  { type: String },
    price:       { type: Number, min: 0 },
    currency:    { type: String, default: 'USD' },
    shippingDays:{ type: Number, min: 0 },
    moq:         { type: Number, min: 1 },
    checkedAt:   { type: Date, default: Date.now },
  },
  { _id: false }
);

const RatingSourceSchema = new Schema<IRatingSource>(
  {
    platform:   { type: String, required: true },
    rating:     { type: Number, required: true, min: 0, max: 5 },
    reviewCount:{ type: Number, required: true, min: 0 },
    sourceUrl:  { type: String },
    fetchedAt:  { type: Date, default: Date.now },
  },
  { _id: false }
);

const SalesEvidenceSchema = new Schema<ISalesEvidence>(
  {
    unitsSold:  { type: Number, required: true, min: 0 },
    store:      { type: String, required: true },
    storeUrl:   { type: String },
    timeframe:  { type: String },
    fetchedAt:  { type: Date, default: Date.now },
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
  },
  { _id: false }
);

const TrendSchema = new Schema<ITrend>(
  {
    score:       { type: Number, required: true, min: 0, max: 100, default: 0 },
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

const RelatedProductSchema = new Schema<IRelatedProduct>(
  {
    title:     { type: String, required: true },
    price:     { type: String },
    thumbnail: { type: String },
    link:      { type: String },
    store:     { type: String },
  },
  { _id: false }
);

const ProductCommentSchema = new Schema<IProductComment>(
  {
    text:         { type: String, required: true },
    likeCount:    { type: Number, required: true, min: 0 },
    authorHandle: { type: String },
    sentiment:    { type: String, enum: ['positive', 'negative', 'neutral'], required: true },
    source:       { type: String, required: true, default: 'EnsembleData' },
    collectedAt:  { type: Date, default: Date.now },
  },
  { _id: false }
);

// ── Main Schema ───────────────────────────────────────────────────────────────

const ProductSchema = new Schema<IProductDocument, IProductModel>(
  {
    // Identity
    externalId: { type: String, required: true },
    source:     { type: String, required: true },
    status:     { type: String, enum: ['active', 'archived', 'stale'], default: 'active', index: true },

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
    price:    { type: Number, min: 0 },
    currency: { type: String, default: 'USD' },
    suppliers:{ type: [SupplierSchema], default: [] },

    // Market Evidence
    rating:        { type: Number, min: 0, max: 5 },
    reviewCount:   { type: Number, min: 0 },
    salesEvidence: { type: SalesEvidenceSchema },
    ratingSources: { type: [RatingSourceSchema], default: [] },

    // Social Proof
    topComments: { type: [ProductCommentSchema], default: [] },

    // Engagement
    viewCount:     { type: Number, default: 0, min: 0 },
    likeCount:     { type: Number, default: 0, min: 0 },
    commentCount:  { type: Number, default: 0, min: 0 },
    shareCount:    { type: Number, default: 0, min: 0 },
    engagementRate:{ type: Number, min: 0 },

    // Discovery Origin
    primaryCreator: { type: PrimaryCreatorSchema, required: true },

    // AI Intelligence
    aiIntelligence: { type: AIIntelligenceSchema, required: true },

    // Trend
    trend: { type: TrendSchema, required: true, default: () => ({}) },

    // Discovery Sections
    discoverySections: [{ type: String }],
    relatedProducts:   { type: [RelatedProductSchema], default: [] },

    // Creative Summary
    creativeCounts: {
      ads:     { type: Number, default: 0, min: 0 },
      organic: { type: Number, default: 0, min: 0 },
      reviews: { type: Number, default: 0, min: 0 },
      total:   { type: Number, default: 0, min: 0 },
    },

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
ProductSchema.index({ discoverySections: 1 });
ProductSchema.index({ totalViews: -1 });
ProductSchema.index({ lastIngestedAt: -1 });
ProductSchema.index({ title: 'text', description: 'text' });

// ── Static Methods ────────────────────────────────────────────────────────────

ProductSchema.statics.findByExternalId = function (externalId: string) {
  return this.findOne({ externalId, status: { $ne: 'archived' } });
};

export const Product = mongoose.model<IProductDocument, IProductModel>('Product', ProductSchema);
