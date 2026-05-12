import mongoose, { Schema, Document, Model } from 'mongoose';

// ── Sub-types ──────────────────────────────────────────────────────────────────

export interface IProductSnapshot {
  productId:    string;
  productUrl:   string;
  title:        string;
  imageUrl:     string;
  price:        number;
  currency:     string;
  soldAtStart:  number;   // sold count when session started
  soldAtEnd:    number;   // sold count when session ended (0 if live still)
  soldDelta:    number;   // soldAtEnd - soldAtStart
  estimatedRevenue: number; // soldDelta * price
}

export interface IViewerPoll {
  takenAt:     Date;
  viewerCount: number;    // concurrent viewers at that moment
}

// ── Interfaces ─────────────────────────────────────────────────────────────────

export interface ILiveSession {
  trackedStore: mongoose.Types.ObjectId;
  handle:       string;   // denormalised for quick queries

  status:  'live' | 'ended';
  title:   string;    // live room title
  coverUrl?: string;

  startedAt:       Date;
  endedAt?:        Date;
  durationMinutes: number;

  peakViewers:  number;
  totalJoined:  number;   // cumulative enter count at session end

  // GMV
  productSnapshots: IProductSnapshot[];
  estimatedGMV:     number;   // sum of estimatedRevenue
  currency:         string;

  // viewer count history
  polls: IViewerPoll[];

  // raw live room data at last check
  roomId?: string;

  createdAt: Date;
  updatedAt: Date;
}

export interface ILiveSessionDocument extends ILiveSession, Document {}
export interface ILiveSessionModel extends Model<ILiveSessionDocument> {}

// ── Sub-schemas ────────────────────────────────────────────────────────────────

const ProductSnapshotSchema = new Schema<IProductSnapshot>(
  {
    productId:   { type: String, default: '' },
    productUrl:  { type: String, default: '' },
    title:       { type: String, default: '' },
    imageUrl:    { type: String, default: '' },
    price:       { type: Number, default: 0 },
    currency:    { type: String, default: 'USD' },
    soldAtStart: { type: Number, default: 0 },
    soldAtEnd:   { type: Number, default: 0 },
    soldDelta:   { type: Number, default: 0 },
    estimatedRevenue: { type: Number, default: 0 },
  },
  { _id: false }
);

const ViewerPollSchema = new Schema<IViewerPoll>(
  {
    takenAt:     { type: Date, required: true },
    viewerCount: { type: Number, default: 0 },
  },
  { _id: false }
);

// ── Schema ─────────────────────────────────────────────────────────────────────

const LiveSessionSchema = new Schema<ILiveSessionDocument>(
  {
    trackedStore: { type: Schema.Types.ObjectId, ref: 'TrackedStore', required: true, index: true },
    handle:       { type: String, required: true, lowercase: true, trim: true, index: true },

    status:  { type: String, enum: ['live', 'ended'], default: 'live', index: true },
    title:   { type: String, default: '' },
    coverUrl: { type: String, default: null },

    startedAt:       { type: Date, required: true },
    endedAt:         { type: Date, default: null },
    durationMinutes: { type: Number, default: 0 },

    peakViewers:  { type: Number, default: 0 },
    totalJoined:  { type: Number, default: 0 },

    productSnapshots: { type: [ProductSnapshotSchema], default: [] },
    estimatedGMV:     { type: Number, default: 0 },
    currency:         { type: String, default: 'USD' },

    polls: { type: [ViewerPollSchema], default: [] },

    roomId: { type: String, default: null },
  },
  {
    timestamps: true,
    toJSON:   { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Compound index for "active session per handle"
LiveSessionSchema.index({ handle: 1, status: 1 });
LiveSessionSchema.index({ startedAt: -1 });

export const LiveSession = mongoose.model<ILiveSessionDocument, ILiveSessionModel>(
  'LiveSession',
  LiveSessionSchema
);
