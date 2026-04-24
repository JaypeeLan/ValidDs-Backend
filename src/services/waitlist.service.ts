import { FilterQuery } from 'mongoose';
import { WaitlistEntry, IWaitlistEntry, IWaitlistEntryDocument } from '../models/waitlist.model';
import { AppError } from '../middleware/error.middleware';
import { logger } from '../logger';

const log = logger.child({ module: 'waitlist-service' });

export interface WaitlistJoinContext {
  source?: string;
  ipAddress?: string;
  userAgent?: string;
  referrer?: string;
}

export interface WaitlistJoinResult {
  entry: IWaitlistEntryDocument;
  alreadyOnWaitlist: boolean;
}

export interface WaitlistListQuery {
  page?: number;
  limit?: number;
  q?: string;
  source?: string;
  from?: Date;
  to?: Date;
}

export interface WaitlistListResult {
  entries: IWaitlistEntry[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  stats: {
    total: number;
    last7Days: number;
    last24Hours: number;
  };
}

export const WaitlistService = {
  /**
   * Adds an email to the waitlist. If the email is already present we return
   * the existing record with `alreadyOnWaitlist: true` so the caller can
   * respond with a 409 — this is checked explicitly (not via Mongo's duplicate
   * key error) so a single well-typed response is returned.
   */
  async join(email: string, ctx: WaitlistJoinContext = {}): Promise<WaitlistJoinResult> {
    const normalized = email.trim().toLowerCase();
    if (!normalized) {
      throw new AppError(400, 'Email is required', 'EMAIL_REQUIRED');
    }

    const existing = await WaitlistEntry.findOne({ email: normalized });
    if (existing) {
      log.info('Waitlist join rejected — email already on waitlist', { email: normalized });
      return { entry: existing, alreadyOnWaitlist: true };
    }

    try {
      const entry = await WaitlistEntry.create({
        email: normalized,
        source:    ctx.source,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        referrer:  ctx.referrer,
      });
      log.info('Waitlist join accepted', { email: normalized, id: entry.id });
      return { entry, alreadyOnWaitlist: false };
    } catch (err: any) {
      if (err?.code === 11000) {
        // Lost a race against a concurrent insert — treat as already-joined.
        const entry = await WaitlistEntry.findOne({ email: normalized });
        if (entry) return { entry, alreadyOnWaitlist: true };
      }
      throw err;
    }
  },

  /**
   * Admin-only paginated list of waitlist entries. Supports:
   *   - `q`       case-insensitive substring match on email
   *   - `source`  exact match (e.g. `landing-hero`)
   *   - `from`/`to` inclusive `createdAt` window
   *
   * Returns the paginated page alongside summary counts so the admin UI can
   * render a simple analytics header without a second call.
   */
  async list(query: WaitlistListQuery = {}): Promise<WaitlistListResult> {
    const page  = Math.max(1, query.page  ?? 1);
    const limit = Math.min(200, Math.max(1, query.limit ?? 50));
    const skip  = (page - 1) * limit;

    const filter: FilterQuery<IWaitlistEntryDocument> = {};
    if (query.q)      filter.email  = { $regex: query.q.trim(), $options: 'i' };
    if (query.source) filter.source = query.source;
    if (query.from || query.to) {
      filter.createdAt = {};
      if (query.from) (filter.createdAt as any).$gte = query.from;
      if (query.to)   (filter.createdAt as any).$lte = query.to;
    }

    const now       = Date.now();
    const day24Ago  = new Date(now - 24  * 60 * 60 * 1000);
    const day7Ago   = new Date(now - 7   * 24 * 60 * 60 * 1000);

    const [entries, total, statsTotal, statsLast7d, statsLast24h] = await Promise.all([
      WaitlistEntry.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      WaitlistEntry.countDocuments(filter),
      WaitlistEntry.estimatedDocumentCount(),
      WaitlistEntry.countDocuments({ createdAt: { $gte: day7Ago } }),
      WaitlistEntry.countDocuments({ createdAt: { $gte: day24Ago } }),
    ]);

    return {
      entries,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
      stats: {
        total:      statsTotal,
        last7Days:  statsLast7d,
        last24Hours: statsLast24h,
      },
    };
  },
};
