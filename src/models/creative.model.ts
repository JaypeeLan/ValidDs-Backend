import mongoose, { Schema } from 'mongoose';
import type {
  ICreativeComment,
  ICreativeDocument,
  ICreatorProfile,
  IMetricTrend,
  IMetricTrendWindow,
  ISecondaryVideo,
  IVideoMetrics,
} from '../types/creative.types.js';

export type {
  CreativeApiItem,
  CreativeFeedItem,
  CreativeSection,
  ICreative,
  ICreativeComment,
  ICreativeDocument,
  ICreatorProfile,
  ICreatorProfileApi,
  IMetricTrend,
  IMetricTrendWindow,
  IProductTrendSnapshot,
  ISecondaryVideo,
  ISecondaryVideoApi,
  IVideoMetrics,
  IVideoMetricsApi,
} from '../types/creative.types.js';

// ── Sub-schemas ───────────────────────────────────────────────────────────────

const CreatorProfileSchema = new Schema<ICreatorProfile>(
  {
    handle: { type: String, required: true },
    displayName: { type: String },
    bio: { type: String },
    avatarUrl: { type: String },
    followers: { type: Number, min: 0, default: 0 },
    following: { type: Number, min: 0 },
    totalLikes: { type: Number, min: 0 },
    region: { type: String },
    verified: { type: Boolean, required: true, default: false },
    tiktokPostUrl: { type: String, required: true },
    isIndependentCreator: { type: Boolean, default: false },
  },
  { _id: false },
);

const VideoMetricsSchema = new Schema<IVideoMetrics>(
  {
    viewCount: { type: Number, required: true, default: 0, min: 0 },
    likeCount: { type: Number, required: true, default: 0, min: 0 },
    commentCount: { type: Number, required: true, default: 0, min: 0 },
    shareCount: { type: Number, required: true, default: 0, min: 0 },
    engagementRate: { type: Number, default: null },
    source: { type: String },
    fetchedAt: { type: Date },
  },
  { _id: false },
);

const CreativeCommentSchema = new Schema<ICreativeComment>(
  {
    comment: { type: String, required: true },
    source: { type: String, required: true },
    likeCount: { type: Number, min: 0 },
    authorHandle: { type: String },
    collectedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const MetricTrendWindowSchema = new Schema<IMetricTrendWindow>(
  {
    label: { type: String, required: true },
    daysAgo: { type: Number, required: true, min: 0 },
    value: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const MetricTrendSchema = new Schema<IMetricTrend>(
  {
    direction: { type: String, enum: ['up', 'down', 'stable'], required: true },
    changePercent: { type: Number, required: true },
    windows: { type: [MetricTrendWindowSchema], default: [] },
  },
  { _id: false },
);

const SecondaryVideoSchema = new Schema<ISecondaryVideo>(
  {
    externalVideoId: { type: String, required: true },
    embedUrl: { type: String, required: true },
    tiktokPostUrl: { type: String, required: true },
    thumbnailUrl: { type: String },
    videoPlayUrl: { type: String },
    videoS3Key: { type: String },
    videoDownloadRequestedAt: { type: Date },
    videoDownloadReadyAt: { type: Date },
    creator: { type: CreatorProfileSchema, required: true },
    metrics: { type: VideoMetricsSchema, required: true },
    topComments: { type: [CreativeCommentSchema], default: [] },
    publishedAt: { type: Date, required: true },
  },
  { _id: false },
);

// ── Main schema ───────────────────────────────────────────────────────────────

export const CreativeSchema = new Schema<ICreativeDocument>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    externalVideoId: { type: String, required: true, unique: true },

    embedUrl: { type: String, required: true },
    tiktokPostUrl: { type: String, required: true },
    thumbnailUrl: { type: String },
    videoPlayUrl: { type: String },
    videoS3Key: { type: String },
    videoDownloadRequestedAt: { type: Date },
    videoDownloadReadyAt: { type: Date },

    creator: { type: CreatorProfileSchema, required: true },
    metrics: { type: VideoMetricsSchema, required: true },

    section: {
      type: String,
      enum: ['top-ads', 'trending', 'influencer-reviews', 'tutorials', 'viral-unboxings'],
      required: true,
      index: true,
    },
    isIndependentCreator: { type: Boolean, default: false, index: true },
    isPrimaryDiscovery: { type: Boolean, default: false },
    isAd: { type: Boolean, default: null },

    productName: { type: String },
    productDescription: { type: String, maxlength: 2000 },

    categoryL1: { type: String, index: true },
    categoryL2: { type: String },
    categoryL3: { type: String },
    categoryPath: { type: String },

    description: { type: String, maxlength: 2000, default: null },
    angle: { type: String, default: null },
    hashtags: [{ type: String }],
    topComments: { type: [CreativeCommentSchema], default: [] },

    relatedVideos: { type: [SecondaryVideoSchema], default: [] },

    // Denormalized product snapshot — refreshed on every ingest
    productRating: { type: Number, default: null },
    productTotalSales: { type: Number, default: null },
    productTotalGmv: { type: Number, default: null },
    productPrice: { type: Number, default: null },
    productUrl: { type: String, default: null },
    shopName: { type: String, default: null },
    shopAvatarUrl: { type: String, default: null },
    productPrimaryImageUrl: { type: String, default: null },
    productSalesTrend: { type: MetricTrendSchema, default: null },
    productTrend: { type: Schema.Types.Mixed, default: null },

    publishedAt: { type: Date, default: null },
    ingestedAt: { type: Date, default: Date.now },
    /** Stable feed/upsert key — see creativeAdDedupeKey() */
    adDedupeKey: { type: String, index: true },
  },
  { timestamps: true, strict: true },
);

// ── Indexes ───────────────────────────────────────────────────────────────────

CreativeSchema.index({ productId: 1, section: 1 });
CreativeSchema.index(
  { adDedupeKey: 1 },
  {
    unique: true,
    partialFilterExpression: { adDedupeKey: { $type: 'string', $gt: '' } },
  },
);
CreativeSchema.index({ 'metrics.viewCount': -1 });
CreativeSchema.index({ 'creator.followers': -1 });
CreativeSchema.index({ publishedAt: -1 });
CreativeSchema.index({ 'creator.handle': 1 });

// ── Export ────────────────────────────────────────────────────────────────────

export const Creative = mongoose.model<ICreativeDocument>('Creative', CreativeSchema);
