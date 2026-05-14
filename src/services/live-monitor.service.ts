/**
 * LiveMonitorService
 *
 * Orchestrates TikTok Live session tracking for tracked stores:
 *   1. discover() unions **active watchlist** handles with **open `LiveSession` handles**, re-checks live via ScrapeCreators, starts/continues sessions, and ends DB rows when no longer live
 *   2. Snapshot product sold counts at session start and end (Apify shop scraper — not ScrapeCreators)
 *   3. Compute estimated GMV delta when the session ends
 *   4. Update TrackedStore aggregate stats
 */

import type { Types } from 'mongoose';
import { TrackedStore }  from '../models/tracked-store.model';
import { LiveSession, IProductSnapshot } from '../models/live-session.model';
import { ScrapeCreatorsService, SCLiveResult } from './scrapecreators.service';
import { TikTokShopScraperService, ShopProduct } from './tiktok-shop-scraper.service';
import { logger } from '../logger';

const log = logger.child({ module: 'live-monitor' });

/** TrackedStore fields used when opening or polling a live session */
type TrackedStoreLeanForLive = {
  _id: Types.ObjectId;
  handle: string;
  tiktokUserId?: string;
};

// ── Types ──────────────────────────────────────────────────────────────────────

export interface DiscoverResult {
  live:         SCLiveResult[];
  ended:        string[];           // handles whose sessions just ended
  liveCount:    number;
  totalChecked: number;
}

/** Response for `GET /tiktok/live/discover` — read-only from MongoDB (synced by hourly job). */
export interface CachedLiveDiscoverResult {
  /** `LiveSession` documents with `status: 'live'`. */
  sessions: Array<Record<string, unknown>>;
  /**
   * Same rows as `sessions`, in the legacy `SCLiveResult` shape (ScrapeCreators live discover).
   * Clients that still read `data.live` should use this; `sessions` holds full Mongo documents.
   */
  live: SCLiveResult[];
  /** Always empty for this endpoint (no per-request “just ended” diff vs a prior response). */
  ended: string[];
  liveCount: number;
  /** Count of active tracked stores (watchlist size); mirrors legacy `discover().totalChecked`. */
  totalChecked: number;
  totalActiveStores: number;
  /** Latest `lastCheckedAt` among active tracked stores (after a sync run); null if never synced. */
  watchlistLastCheckedAt: Date | null;
}

/** Map a persisted live session (lean) into the shape returned by ScrapeCreators live checks. */
function liveSessionLeanToSCLiveResult(doc: Record<string, unknown>): SCLiveResult {
  const handle = String(doc.handle ?? '');
  const polls = (Array.isArray(doc.polls) ? doc.polls : []) as Array<{ viewerCount?: number }>;
  const lastPoll = polls.length > 0 ? polls[polls.length - 1] : undefined;
  const userCount = lastPoll?.viewerCount ?? (Number(doc.peakViewers ?? 0) || 0);
  const roomRaw = doc.roomId;
  const roomId = roomRaw != null && String(roomRaw) !== '' ? String(roomRaw) : undefined;
  const ts = doc.trackedStore as { toString?: () => string } | undefined;
  const storeId = ts?.toString?.() ?? '';

  return {
    handle,
    isLive: true,
    roomId,
    user: {
      id: storeId || handle,
      uniqueId: handle,
      nickname: handle,
    },
    room: {
      id: roomId,
      title: doc.title ? String(doc.title) : undefined,
      coverUrl: doc.coverUrl ? String(doc.coverUrl) : undefined,
      liveRoomStats: {
        userCount,
        enterCount: Number(doc.totalJoined ?? 0) || 0,
      },
    },
    watchUrl: `https://www.tiktok.com/@${handle}/live`,
  };
}

// ── Service ───────────────────────────────────────────────────────────────────

export const LiveMonitorService = {

  /**
   * Read live sessions from the database only (no external API).
   * Populated by the hourly `runLiveMonitorDiscoverJob` / `discover()` sync.
   */
  async getCachedLiveDiscover(): Promise<CachedLiveDiscoverResult> {
    const [sessions, totalActiveStores, agg] = await Promise.all([
      LiveSession.find({ status: 'live' }).sort({ startedAt: -1 }).lean(),
      TrackedStore.countDocuments({ isActive: true }),
      TrackedStore.aggregate([
        { $match: { isActive: true, lastCheckedAt: { $exists: true, $ne: null } } },
        { $group: { _id: null, maxChecked: { $max: '$lastCheckedAt' } } },
      ]),
    ]);

    const row = agg[0] as { maxChecked?: Date } | undefined;
    const watchlistLastCheckedAt = row?.maxChecked ?? null;

    const live = sessions.map((s) => liveSessionLeanToSCLiveResult(s as Record<string, unknown>));

    return {
      sessions: sessions as unknown as Array<Record<string, unknown>>,
      live,
      ended: [],
      liveCount: sessions.length,
      totalChecked: totalActiveStores,
      totalActiveStores,
      watchlistLastCheckedAt,
    };
  },

  /**
   * Full discover cycle:
   *  • Load active TrackedStore handles **and** handles with `LiveSession` status `live`
   *    (union) so open sessions are re-checked even if the store is paused or missing from the batch
   *  • Check each via ScrapeCreators (live status only)
   *  • Start sessions for newly-live stores (requires a TrackedStore row)
   *  • Poll (update viewers) for already-live sessions
   *  • End sessions when the API says that handle is no longer live
   */
  async discover(): Promise<DiscoverResult> {
    const activeStores = await TrackedStore.find({ isActive: true }).lean();
    const liveSessionHandleList = await LiveSession.distinct('handle', { status: 'live' });
    const liveSessionHandles = [
      ...new Set(
        liveSessionHandleList.map((h) =>
          String(h ?? '')
            .replace(/^@/, '')
            .trim()
            .toLowerCase()
        ).filter(Boolean)
      ),
    ];

    const activeHandleSet = new Set(activeStores.map((s) => s.handle));
    const extraHandles = liveSessionHandles.filter((h) => !activeHandleSet.has(h));
    const extraStores = extraHandles.length
      ? await TrackedStore.find({ handle: { $in: extraHandles } }).lean()
      : [];

    const storeByHandle = new Map<string, TrackedStoreLeanForLive>();
    for (const s of extraStores) storeByHandle.set(s.handle, s);
    for (const s of activeStores) storeByHandle.set(s.handle, s);

    const handlesUnion = [...new Set([...activeStores.map((s) => s.handle), ...liveSessionHandles])];

    if (handlesUnion.length === 0) {
      return { live: [], ended: [], liveCount: 0, totalChecked: 0 };
    }

    const BATCH = 10;
    const allResults: SCLiveResult[] = [];
    for (let i = 0; i < handlesUnion.length; i += BATCH) {
      const chunk = handlesUnion.slice(i, i + BATCH);
      const results = await ScrapeCreatorsService.batchGetUserLive(chunk);
      allResults.push(...results);
    }

    const now = new Date();
    const liveHandles = new Set(allResults.filter((r) => r.isLive).map((r) => r.handle));

    for (const result of allResults) {
      if (!result.isLive) continue;
      await this._handleLive(result, storeByHandle.get(result.handle), now);
    }

    const activeSessions = await LiveSession.find({ status: 'live' });
    const ended: string[] = [];
    for (const session of activeSessions) {
      if (!liveHandles.has(session.handle)) {
        await this._endSession(session, now);
        ended.push(session.handle);
      }
    }

    await TrackedStore.updateMany(
      { handle: { $in: activeStores.map((s) => s.handle) } },
      { $set: { lastCheckedAt: now } }
    );

    const liveResults = allResults.filter((r) => r.isLive);

    return {
      live:         liveResults,
      ended,
      liveCount:    liveResults.length,
      totalChecked: handlesUnion.length,
    };
  },

  /**
   * One-handle live check (ScrapeCreators). Used after adding a store to the watchlist so
   * `GET /tiktok/live/discover` can reflect a current broadcast without waiting for the hourly job.
   * Opens a `LiveSession` with **`fastStart`** (no Apify wait); the next full `discover()` run fills product baselines when applicable.
   */
  async probeWatchlistHandle(handle: string): Promise<{ probed: boolean; isLive: boolean }> {
    const h = handle.replace(/^@/, '').trim().toLowerCase();
    if (!h || !ScrapeCreatorsService.isConfigured()) {
      return { probed: false, isLive: false };
    }

    try {
      const store = await TrackedStore.findOne({ handle: h }).lean();
      if (!store) return { probed: false, isLive: false };

      const result = await ScrapeCreatorsService.getUserLive(h);
      const now = new Date();

      const storeLean: TrackedStoreLeanForLive = {
        _id: store._id as Types.ObjectId,
        handle: store.handle,
        tiktokUserId: store.tiktokUserId,
      };

      if (result.isLive) {
        await this._handleLive({ ...result, handle: h }, storeLean, now, { fastStart: true });
        if (store.isActive !== false) {
          await TrackedStore.updateOne({ handle: h }, { $set: { lastCheckedAt: now } });
        }
        log.info('Watchlist live probe: live', { handle: h });
        return { probed: true, isLive: true };
      }

      const open = await LiveSession.findOne({ handle: h, status: 'live' });
      if (open) {
        await this._endSession(open, now);
        log.info('Watchlist live probe: ended stale session', { handle: h });
      }

      if (store.isActive !== false) {
        await TrackedStore.updateOne({ handle: h }, { $set: { lastCheckedAt: now } });
      }

      return { probed: true, isLive: false };
    } catch (e) {
      log.warn('probeWatchlistHandle failed', { handle: h, err: String(e) });
      return { probed: false, isLive: false };
    }
  },

  // ── Private helpers ──────────────────────────────────────────────────────────

  async _handleLive(
    result: SCLiveResult,
    store: TrackedStoreLeanForLive | undefined,
    now: Date,
    options?: { fastStart?: boolean },
  ): Promise<void> {
    const viewers = result.room?.liveRoomStats?.userCount ?? 0;
    const entered = result.room?.liveRoomStats?.enterCount ?? 0;
    const roomId  = result.roomId || result.room?.id || '';

    // Check for an already-active session
    const existing = await LiveSession.findOne({ handle: result.handle, status: 'live' });

    if (existing) {
      // Poll: viewer snapshot only — product deltas computed at session end
      existing.polls.push({ takenAt: now, viewerCount: viewers });
      if (viewers > existing.peakViewers) existing.peakViewers = viewers;
      if (entered > existing.totalJoined)  existing.totalJoined = entered;
      existing.title    = result.room?.title || existing.title;
      existing.coverUrl = result.room?.coverUrl || existing.coverUrl;
      await existing.save();
      log.debug('Live session polled', { handle: result.handle, viewers });
      return;
    }

    if (!store) {
      log.warn('Skipping new live session — no TrackedStore for handle', { handle: result.handle });
      return;
    }

    // New live session — snapshot current sold counts as baseline (skipped on fastStart from watchlist probe)
    let startProducts: ShopProduct[];
    if (options?.fastStart) {
      startProducts = [];
    } else {
      startProducts = await TikTokShopScraperService.getSellerProducts(
        result.handle,
        store.tiktokUserId,
      );
    }

    const productSnapshots: IProductSnapshot[] = startProducts.map((p) => ({
      productId:        p.productId,
      productUrl:       p.productUrl,
      title:            p.title,
      imageUrl:         p.imageUrl,
      price:            p.price,
      currency:         p.currency || 'USD',
      soldAtStart:      p.soldCount,   // baseline — compare at session end
      soldAtEnd:        p.soldCount,
      soldDelta:        0,
      estimatedRevenue: 0,
    }));

    const session = await LiveSession.create({
      trackedStore: store._id,
      handle:       result.handle,
      status:       'live',
      title:        result.room?.title || '',
      coverUrl:     result.room?.coverUrl || result.room?.squareCoverImg || '',
      startedAt:    now,
      peakViewers:  viewers,
      totalJoined:  entered,
      roomId:       String(roomId),
      productSnapshots,
      polls: [{ takenAt: now, viewerCount: viewers }],
      currency:     startProducts[0]?.currency || 'USD',
    });

    await TrackedStore.findByIdAndUpdate(store._id, {
      $set: { lastLiveAt: now },
    });

    log.info('Live session started', {
      handle:       result.handle,
      sessionId:    session._id,
      productCount: startProducts.length,
      hasBaseline:  startProducts.length > 0,
    });
  },

  async _endSession(session: any, now: Date): Promise<void> {
    const durationMinutes = Math.round((now.getTime() - session.startedAt.getTime()) / 60_000);

    // Final snapshot — compare against baseline to compute delta
    const store = await TrackedStore.findById(session.trackedStore).lean();
    const finalProducts = await TikTokShopScraperService.getSellerProducts(
      session.handle,
      store?.tiktokUserId,
    );

    let estimatedGMV = 0;
    let updatedSnapshots: IProductSnapshot[];

    if (finalProducts.length > 0 && session.productSnapshots.length > 0) {
      // Both snapshots available — compute deltas
      updatedSnapshots = session.productSnapshots.map((snap: IProductSnapshot) => {
        const final = finalProducts.find((p) => p.productId === snap.productId);
        if (!final) return snap;
        const soldAtEnd        = final.soldCount;
        const soldDelta        = Math.max(0, soldAtEnd - snap.soldAtStart);
        const estimatedRevenue = soldDelta * snap.price;
        estimatedGMV += estimatedRevenue;
        return { ...snap, soldAtEnd, soldDelta, estimatedRevenue };
      });

      // Products that appeared in the final snapshot but not at start
      for (const fp of finalProducts) {
        if (!updatedSnapshots.find((s) => s.productId === fp.productId)) {
          const estimatedRevenue = fp.soldCount * fp.price;
          estimatedGMV += estimatedRevenue;
          updatedSnapshots.push({
            productId:        fp.productId,
            productUrl:       fp.productUrl,
            title:            fp.title,
            imageUrl:         fp.imageUrl,
            price:            fp.price,
            currency:         fp.currency || 'USD',
            soldAtStart:      0,
            soldAtEnd:        fp.soldCount,
            soldDelta:        fp.soldCount,
            estimatedRevenue,
          });
        }
      }
    } else if (finalProducts.length > 0 && session.productSnapshots.length === 0) {
      // No baseline — record final counts but can't compute delta
      updatedSnapshots = finalProducts.map((fp) => ({
        productId:        fp.productId,
        productUrl:       fp.productUrl,
        title:            fp.title,
        imageUrl:         fp.imageUrl,
        price:            fp.price,
        currency:         fp.currency || 'USD',
        soldAtStart:      fp.soldCount,
        soldAtEnd:        fp.soldCount,
        soldDelta:        0,
        estimatedRevenue: 0,
      }));
    } else {
      // No product data available — keep whatever baseline we had
      updatedSnapshots = session.productSnapshots;
      estimatedGMV = session.estimatedGMV || 0;
    }

    session.status           = 'ended';
    session.endedAt          = now;
    session.durationMinutes  = durationMinutes;
    session.productSnapshots = updatedSnapshots;
    session.estimatedGMV     = estimatedGMV;
    await session.save();

    // Recompute aggregate averages across all sessions for this store
    const allSessions = await LiveSession.find({
      trackedStore: session.trackedStore,
      status: 'ended',
      peakViewers: { $gt: 0 },
    }).lean();

    const newLiveCount  = allSessions.length + 1; // +1 for this session
    const totalGMV      = allSessions.reduce((s, x) => s + (x.estimatedGMV || 0), 0) + estimatedGMV;
    const avgPeakViewers = allSessions.length > 0
      ? Math.round((allSessions.reduce((s, x) => s + (x.peakViewers || 0), 0) + (session.peakViewers || 0)) / newLiveCount)
      : session.peakViewers || undefined;
    const avgDuration = allSessions.length > 0
      ? Math.round((allSessions.reduce((s, x) => s + (x.durationMinutes || 0), 0) + durationMinutes) / newLiveCount)
      : durationMinutes || undefined;

    const storeUpdate: Record<string, unknown> = {
      liveCount:         newLiveCount,
      totalEstimatedGMV: totalGMV,
    };
    if (avgPeakViewers) storeUpdate.avgPeakViewers         = avgPeakViewers;
    if (avgDuration)    storeUpdate.avgLiveDurationMinutes = avgDuration;

    await TrackedStore.findByIdAndUpdate(session.trackedStore, { $set: storeUpdate });

    log.info('Live session ended', {
      handle: session.handle,
      durationMinutes,
      estimatedGMV,
      sessionId: session._id,
    });
  },
};

