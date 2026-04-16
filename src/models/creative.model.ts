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

  // ── Taxonomy (mirrors parent product) ────────────────────────────────
  categoryL1?: string;
  categoryL2?: string;
  categoryL3?: string;

  // ── Content Metadata ──────────────────────────────────────────────────
  description?: string;        // video caption
  hashtags: string[];

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

    // Taxonomy
    categoryL1: { type: String, index: true },
    categoryL2: { type: String },
    categoryL3: { type: String },

    // Content Metadata
    description: { type: String, maxlength: 2000 },
    hashtags:    [{ type: String }],

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
