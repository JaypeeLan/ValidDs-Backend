import mongoose, { Document, Schema, Model } from 'mongoose';

// ── Enums ─────────────────────────────────────────────────────────────────────

export type CreativeSection =
  | 'top-ads'             // paid/sponsored TikTok ads
  | 'trending'            // organic, high-engagement viral videos
  | 'influencer-reviews'  // creator review or unboxing
  | 'tutorials'           // how-to / demo content
  | 'viral-unboxings';    // purely unboxing format

// ── Sub-document Interfaces ───────────────────────────────────────────────────

/**
 * Full creator profile for the influencer who posted this specific creative.
 * All fields sourced from EnsembleData API at time of ingestion.
 * The tiktokPostUrl is the canonical verified link to the video.
 */
export interface ICreatorProfile {
  tiktokUserId: string;      // EnsembleData author uid — stable identifier
  handle: string;            // @username
  displayName?: string;      // nickname shown on TikTok
  bio?: string;              // creator bio/signature
  avatarUrl?: string;
  followers: number;
  following?: number;
  totalLikes?: number;       // lifetime likes on their profile
  region?: string;           // country code e.g. 'US'
  verified: boolean;
  tiktokPostUrl: string;     // verified direct URL to this specific video
}

/**
 * Video performance metrics captured at time of ingestion.
 * These are point-in-time snapshots — not live.
 */
export interface IVideoMetrics {
  viewCount: number;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  engagementRate?: number;   // (likes + comments + shares) / views * 100
  source: string;            // where metrics came from (e.g. 'EnsembleData')
  fetchedAt: Date;           // snapshot timestamp for metric freshness
}

/**
 * Structured comments for a creative/video.
 */
export interface ICreativeComment {
  comment: string;
  source: string;            // e.g. 'TikTok', 'SerpApi'
  likeCount?: number;
  authorHandle?: string;
  collectedAt: Date;
}

/**
 * Secondary videos for the same product.
 */
export interface ISecondaryVideo {
  externalVideoId: string;
  videoPlayUrl?: string;
  thumbnailUrl?: string;
  creator: ICreatorProfile;
  metrics: IVideoMetrics;
  topComments: ICreativeComment[];
  publishedAt: Date;
}

// ── Main Creative Interface ───────────────────────────────────────────────────

export interface ICreative {
  // ── Identity ───────────────────────────────────────────────────────────
  productId: mongoose.Types.ObjectId;  // parent product
  externalVideoId: string;             // TikTok aweme_id

  // ── Video Content ──────────────────────────────────────────────────────
  videoPlayUrl?: string;               // direct .mp4 / CDN play URL (may expire)
  thumbnailUrl?: string;               // video cover image

  // ── Creator (Full Profile) ─────────────────────────────────────────────
  creator: ICreatorProfile;

  // ── Performance Snapshot ──────────────────────────────────────────────
  metrics: IVideoMetrics;

  // ── Classification ────────────────────────────────────────────────────
  section: CreativeSection;    // how this video is categorized in the feed
  isAd: boolean;               // true = detected as a paid TikTok ad
  productName?: string;        // explicitly extracted product name shown in video
  productDescription?: string; // normalized product description (not video caption)

  // ── Taxonomy (mirrors parent product) ────────────────────────────────
  categoryL1?: string;
  categoryL2?: string;
  categoryL3?: string;

  // ── Content Metadata ──────────────────────────────────────────────────
  description?: string;        // legacy description field (kept for backward compatibility)
  hashtags: string[];
  topComments: ICreativeComment[];

  // ── Variations/Related Videos ─────────────────────────────────────────
  relatedVideos: ISecondaryVideo[];

  // ── Timing ────────────────────────────────────────────────────────────
  publishedAt: Date;
  ingestedAt: Date;

  // ── Timestamps (auto by Mongoose) ────────────────────────────────────
  createdAt: Date;
  updatedAt: Date;
}

export interface ICreativeDocument extends ICreative, Document {}

// ── Mongoose Schemas ──────────────────────────────────────────────────────────

const CreatorProfileSchema = new Schema<ICreatorProfile>(
  {
    tiktokUserId:  { type: String, required: true },
    handle:        { type: String, required: true },
    displayName:   { type: String },
    bio:           { type: String },
    avatarUrl:     { type: String },
    followers:     { type: Number, required: true, min: 0, default: 0 },
    following:     { type: Number, min: 0 },
    totalLikes:    { type: Number, min: 0 },
    region:        { type: String },
    verified:      { type: Boolean, required: true, default: false },
    tiktokPostUrl: { type: String, required: true },
  },
  { _id: false }
);

const VideoMetricsSchema = new Schema<IVideoMetrics>(
  {
    viewCount:     { type: Number, required: true, default: 0, min: 0 },
    likeCount:     { type: Number, required: true, default: 0, min: 0 },
    commentCount:  { type: Number, required: true, default: 0, min: 0 },
    shareCount:    { type: Number, required: true, default: 0, min: 0 },
    engagementRate:{ type: Number, min: 0 },
    source:        { type: String, required: true, default: 'EnsembleData' },
    fetchedAt:     { type: Date, required: true, default: Date.now },
  },
  { _id: false }
);

const CreativeCommentSchema = new Schema<ICreativeComment>(
  {
    comment:     { type: String, required: true },
    source:      { type: String, required: true },
    likeCount:   { type: Number, min: 0 },
    authorHandle:{ type: String },
    collectedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const SecondaryVideoSchema = new Schema<ISecondaryVideo>(
  {
    externalVideoId: { type: String, required: true },
    videoPlayUrl:    { type: String },
    thumbnailUrl:    { type: String },
    creator:         { type: CreatorProfileSchema, required: true },
    metrics:         { type: VideoMetricsSchema, required: true },
    topComments:     { type: [CreativeCommentSchema], default: [] },
    publishedAt:     { type: Date, required: true },
  },
  { _id: false }
);

// ── Main Schema ───────────────────────────────────────────────────────────────

const CreativeSchema = new Schema<ICreativeDocument>(
  {
    // Identity
    productId:       { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    externalVideoId: { type: String, required: true, unique: true },

    // Video Content
    videoPlayUrl:  { type: String },
    thumbnailUrl:  { type: String },

    // Creator (full richly-typed profile)
    creator: { type: CreatorProfileSchema, required: true },

    // Performance
    metrics: { type: VideoMetricsSchema, required: true },

    // Classification
    section: {
      type: String,
      enum: ['top-ads', 'trending', 'influencer-reviews', 'tutorials', 'viral-unboxings'],
      required: true,
      index: true,
    },
    isAd: { type: Boolean, default: false, index: true },
    productName: { type: String },
    productDescription: { type: String, maxlength: 2000 },

    // Taxonomy
    categoryL1: { type: String, index: true },
    categoryL2: { type: String },
    categoryL3: { type: String },

    // Content Metadata
    description: { type: String, maxlength: 2000 },
    hashtags:    [{ type: String }],
    topComments: { type: [CreativeCommentSchema], default: [] },

    // Variations
    relatedVideos: { type: [SecondaryVideoSchema], default: [] },

    // Timing
    publishedAt: { type: Date, required: true },
    ingestedAt:  { type: Date, required: true, default: Date.now },
  },
  { timestamps: true }
);

// ── Indexes ───────────────────────────────────────────────────────────────────

CreativeSchema.index({ productId: 1, section: 1 });
CreativeSchema.index({ 'metrics.viewCount': -1 });
CreativeSchema.index({ 'creator.followers': -1 });
CreativeSchema.index({ publishedAt: -1 });
CreativeSchema.index({ 'creator.handle': 1 });

// ── Export ────────────────────────────────────────────────────────────────────

export const Creative = mongoose.model<ICreativeDocument>('Creative', CreativeSchema);
