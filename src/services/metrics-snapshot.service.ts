import { MetricsSnapshot, type IMetricsSnapshot } from '../models/metrics-snapshot.model';
import { User } from '../models/user.model';
import { Transaction } from '../models/transaction.model';
import { getInventoryAnalytics } from './admin-ops.service';
import { logger } from '../logger';

const log = logger.child({ module: 'metrics-snapshot' });

/** YYYY-MM-DD in UTC. */
export function todayDateKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Freeze today's dashboard headline numbers into `metrics_snapshots`.
 * Idempotent per day: the first capture of a day wins unless `force` is set.
 */
export async function captureDailySnapshot(force = false): Promise<IMetricsSnapshot | null> {
  const dateKey = todayDateKey();

  if (!force) {
    const existing = await MetricsSnapshot.findOne({ dateKey }).lean();
    if (existing) return existing;
  }

  const startOfDayUtc = new Date(`${dateKey}T00:00:00.000Z`);

  const [inventory, totalUsers, newUsersToday, txTotal, paidAgg] = await Promise.all([
    getInventoryAnalytics(),
    User.countDocuments(),
    User.countDocuments({ createdAt: { $gte: startOfDayUtc } }),
    Transaction.countDocuments(),
    Transaction.aggregate([
      { $match: { status: 'paid' } },
      { $group: { _id: null, count: { $sum: 1 }, revenue: { $sum: '$amount' } } },
    ]),
  ]);

  const snapshot: IMetricsSnapshot = {
    dateKey,
    capturedAt: new Date(),
    users: { total: totalUsers, newToday: newUsersToday },
    products: {
      total: inventory.products.total,
      fresh24h: inventory.products.fresh24h,
    },
    creatives: {
      total: inventory.creatives.total,
      totalVideos: inventory.creatives.totalVideos,
    },
    live: {
      activeSessions: inventory.live.activeSessions,
      totalSessions: inventory.live.totalSessions,
    },
    transactions: {
      total: txTotal,
      paid: paidAgg[0]?.count ?? 0,
      paidRevenue: paidAgg[0]?.revenue ?? 0,
    },
  };

  const saved = await MetricsSnapshot.findOneAndUpdate(
    { dateKey },
    { $set: snapshot },
    { upsert: true, new: true },
  ).lean();

  log.info('Daily metrics snapshot captured', { dateKey, forced: force });
  return saved;
}

/** Capture today's snapshot if it doesn't exist yet; never throws. */
export async function ensureTodaySnapshot(): Promise<void> {
  try {
    await captureDailySnapshot(false);
  } catch (err) {
    log.error('Failed to capture daily metrics snapshot', err);
  }
}

export async function listSnapshots(limit: number): Promise<IMetricsSnapshot[]> {
  return MetricsSnapshot.find().sort({ dateKey: -1 }).limit(limit).lean();
}
