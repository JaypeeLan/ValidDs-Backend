import mongoose, { Schema, type Document, type Model } from 'mongoose';

/**
 * One document per calendar day (UTC): the dashboard's visible headline
 * numbers frozen at capture time, so admins can see how the platform
 * looked on any given day.
 */
export interface IMetricsSnapshot {
  /** YYYY-MM-DD in UTC — one snapshot per day. */
  dateKey: string;
  capturedAt: Date;
  users: { total: number; newToday: number };
  products: { total: number; fresh24h: number };
  creatives: { total: number; totalVideos: number };
  live: { activeSessions: number; totalSessions: number };
  transactions: { total: number; paid: number; paidRevenue: number };
}

export interface IMetricsSnapshotDocument extends IMetricsSnapshot, Document {}

const MetricsSnapshotSchema = new Schema<IMetricsSnapshotDocument>(
  {
    dateKey: { type: String, required: true, unique: true, index: true },
    capturedAt: { type: Date, required: true },
    users: {
      total: { type: Number, required: true, default: 0 },
      newToday: { type: Number, required: true, default: 0 },
    },
    products: {
      total: { type: Number, required: true, default: 0 },
      fresh24h: { type: Number, required: true, default: 0 },
    },
    creatives: {
      total: { type: Number, required: true, default: 0 },
      totalVideos: { type: Number, required: true, default: 0 },
    },
    live: {
      activeSessions: { type: Number, required: true, default: 0 },
      totalSessions: { type: Number, required: true, default: 0 },
    },
    transactions: {
      total: { type: Number, required: true, default: 0 },
      paid: { type: Number, required: true, default: 0 },
      paidRevenue: { type: Number, required: true, default: 0 },
    },
  },
  { timestamps: true, collection: 'metrics_snapshots' },
);

export const MetricsSnapshot: Model<IMetricsSnapshotDocument> =
  mongoose.models.MetricsSnapshot ||
  mongoose.model<IMetricsSnapshotDocument>('MetricsSnapshot', MetricsSnapshotSchema);
