import mongoose, { Schema } from 'mongoose';
import type {
  ICreativeComment,
  ICreativeDocument,
  ICreatorProfile,
  ISecondaryVideo,
  IVideoMetrics,
} from '../types/creative.types';

export type {
  CreativeSection,
  ICreative,
  ICreativeComment,
  ICreativeDocument,
  ICreatorProfile,
  ISecondaryVideo,
  IVideoMetrics,
} from '../types/creative.types';

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
    source:        { type: String, required: true, default: 'TikTok' },
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
