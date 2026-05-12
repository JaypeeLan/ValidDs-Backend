import mongoose, { Schema, Document, Model } from 'mongoose';

// ── Interfaces ─────────────────────────────────────────────────────────────────

export interface ITrackedStore {
  // ── Identity ────────────────────────────────────────────────────────────────
  handle:       string;   // lowercase TikTok handle, no @, unique index
  tiktokUserId?: string;  // internal TikTok user ID

  // ── Display ─────────────────────────────────────────────────────────────────
  displayName?:  string;
  bio?:          string;  // TikTok bio / signature
  avatarThumb?:  string;
  avatarMedium?: string;
  avatarLarger?: string;

  // ── Verification & account type ──────────────────────────────────────────────
  verified?:       boolean;
  privateAccount?: boolean;
  hasShop?:        boolean;  // has TikTok Shop enabled

  // ── Location ─────────────────────────────────────────────────────────────────
  region?:   string;   // e.g. "US", "PH", "GB"
  language?: string;   // e.g. "en", "tl"

  // ── Stats (from TikTok profile) ──────────────────────────────────────────────
  followerCount?:  number;
  followingCount?: number;
  videoCount?:     number;
  heartCount?:     number;   // total likes received
  diggCount?:      number;   // total likes given
  engagementRate?: number;   // heartCount / followerCount * 100

  // ── Shop ──────────────────────────────────────────────────────────────────────
  shopId?:   string;
  shopUrl?:  string;   // https://www.tiktok.com/@handle/shop
  shopRegion?: string;

  // ── Categorisation (manual) ──────────────────────────────────────────────────
  category?: string;   // e.g. "fashion", "beauty", "electronics"
  tags:      string[];
  notes?:    string;

  // ── Monitoring config ────────────────────────────────────────────────────────
  isActive: boolean;

  // ── Live aggregate stats — updated by LiveMonitorService ─────────────────────
  liveCount:              number;
  totalEstimatedGMV:      number;
  avgPeakViewers?:        number;
  avgLiveDurationMinutes?: number;
  currency:               string;

  // ── Timestamps ───────────────────────────────────────────────────────────────
  lastCheckedAt?:       Date;
  lastLiveAt?:          Date;
  profileFetchedAt?:    Date;  // when SC getUserInfo was last called

  addedBy?: mongoose.Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

export interface ITrackedStoreDocument extends ITrackedStore, Document {}
export interface ITrackedStoreModel   extends Model<ITrackedStoreDocument> {}

// ── Schema ─────────────────────────────────────────────────────────────────────

const TrackedStoreSchema = new Schema<ITrackedStoreDocument>(
  {
    // Identity
    handle:       { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    tiktokUserId: { type: String },

    // Display
    displayName:  { type: String },
    bio:          { type: String },
    avatarThumb:  { type: String },
    avatarMedium: { type: String },
    avatarLarger: { type: String },

    // Account type
    verified:       { type: Boolean },
    privateAccount: { type: Boolean },
    hasShop:        { type: Boolean },

    // Location
    region:   { type: String },
    language: { type: String },

    // Stats
    followerCount:  { type: Number },
    followingCount: { type: Number },
    videoCount:     { type: Number },
    heartCount:     { type: Number },
    diggCount:      { type: Number },
    engagementRate: { type: Number },

    // Shop
    shopId:     { type: String },
    shopUrl:    { type: String },
    shopRegion: { type: String },

    // Categorisation
    category: { type: String },
    tags:     { type: [String], default: [] },
    notes:    { type: String },

    // Monitoring
    isActive: { type: Boolean, default: true, index: true },

    // Live aggregates
    liveCount:              { type: Number, default: 0 },
    totalEstimatedGMV:      { type: Number, default: 0 },
    avgPeakViewers:         { type: Number },
    avgLiveDurationMinutes: { type: Number },
    currency:               { type: String, default: 'USD' },

    // Timestamps
    lastCheckedAt:    { type: Date },
    lastLiveAt:       { type: Date },
    profileFetchedAt: { type: Date },

    addedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  {
    timestamps: true,
    toJSON:     { virtuals: true },
    toObject:   { virtuals: true },
  }
);

export const TrackedStore = mongoose.model<ITrackedStoreDocument, ITrackedStoreModel>(
  'TrackedStore',
  TrackedStoreSchema
);
