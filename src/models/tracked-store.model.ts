import mongoose, { Schema, Document, Model } from 'mongoose';

// ── Interfaces ─────────────────────────────────────────────────────────────────

export interface ITrackedStore {
  handle: string;               // lowercase, no @
  displayName: string;
  avatarUrl?: string;
  followerCount?: number;
  shopUrl?: string;             // https://www.tiktok.com/@handle/shop
  notes?: string;
  tags: string[];               // e.g. ["beauty", "fashion", "gadgets"]
  isActive: boolean;

  // populated from ScrapeCreators on first add / each live check
  lastCheckedAt?: Date;
  lastLiveAt?: Date;

  // aggregate stats — updated each time a LiveSession ends
  liveCount: number;
  totalEstimatedGMV: number;   // USD sum across all sessions
  currency: string;

  addedBy?: mongoose.Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

export interface ITrackedStoreDocument extends ITrackedStore, Document {}
export interface ITrackedStoreModel extends Model<ITrackedStoreDocument> {}

// ── Schema ─────────────────────────────────────────────────────────────────────

const TrackedStoreSchema = new Schema<ITrackedStoreDocument>(
  {
    handle:        { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    displayName:   { type: String, default: '' },
    avatarUrl:     { type: String, default: null },
    followerCount: { type: Number, default: null },
    shopUrl:       { type: String, default: null },
    notes:         { type: String, default: '' },
    tags:          { type: [String], default: [] },
    isActive:      { type: Boolean, default: true, index: true },

    lastCheckedAt: { type: Date, default: null },
    lastLiveAt:    { type: Date, default: null },

    liveCount:          { type: Number, default: 0 },
    totalEstimatedGMV:  { type: Number, default: 0 },
    currency:           { type: String, default: 'USD' },

    addedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    toJSON:   { virtuals: true },
    toObject: { virtuals: true },
  }
);

export const TrackedStore = mongoose.model<ITrackedStoreDocument, ITrackedStoreModel>(
  'TrackedStore',
  TrackedStoreSchema
);
