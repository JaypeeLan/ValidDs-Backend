/**
 * LiveMonitorService
 *
 * Orchestrates TikTok Live session tracking for tracked stores:
 *   1. When discover() finds a store is live → start or continue a LiveSession
 *   2. Snapshot product sold counts at session start and end
 *   3. Compute estimated GMV delta when the session ends
 *   4. Update TrackedStore aggregate stats
 */

import { TrackedStore }  from '../models/tracked-store.model';
import { LiveSession, IProductSnapshot } from '../models/live-session.model';
import { ScrapeCreatorsService, SCLiveResult, SCShopProduct } from './scrapecreators.service';
import { logger } from '../logger';

const log = logger.child({ module: 'live-monitor' });

// ── Types ──────────────────────────────────────────────────────────────────────

export interface DiscoverResult {
  live:         SCLiveResult[];
  ended:        string[];           // handles whose sessions just ended
  liveCount:    number;
  totalChecked: number;
}

// ── Service ───────────────────────────────────────────────────────────────────

export const LiveMonitorService = {

  /**
   * Full discover cycle:
   *  • Load all active TrackedStore handles
   *  • Check each via ScrapeCreators
   *  • Start sessions for newly-live stores
   *  • Poll (update viewers) for already-live stores
   *  • End sessions for stores that are no longer live
   */
  async discover(): Promise<DiscoverResult> {
    const stores = await TrackedStore.find({ isActive: true }).lean();
    if (stores.length === 0) {
      return { live: [], ended: [], liveCount: 0, totalChecked: 0 };
    }

    const handles = stores.map((s) => s.handle);

    // Check in batches of 10
    const BATCH = 10;
    const allResults: SCLiveResult[] = [];
    for (let i = 0; i < handles.length; i += BATCH) {
      const chunk = handles.slice(i, i + BATCH);
      const results = await ScrapeCreatorsService.batchGetUserLive(chunk);
      allResults.push(...results);
    }

    const now = new Date();
    const liveHandles  = new Set(allResults.filter((r) => r.isLive).map((r) => r.handle));

    // ── Handle newly live / still live stores ─────────────────────────────────
    for (const result of allResults) {
      if (!result.isLive) continue;
      await this._handleLive(result, stores.find((s) => s.handle === result.handle)!, now);
    }

    // ── End sessions for stores that are no longer live ───────────────────────
    const activeSessions = await LiveSession.find({ status: 'live' });
    const ended: string[] = [];
    for (const session of activeSessions) {
      if (!liveHandles.has(session.handle)) {
        await this._endSession(session, now);
        ended.push(session.handle);
      }
    }

    // Update lastCheckedAt for all stores
    await TrackedStore.updateMany(
      { handle: { $in: handles } },
      { $set: { lastCheckedAt: now } }
    );

    const liveResults = allResults.filter((r) => r.isLive);

    return {
      live:         liveResults,
      ended,
      liveCount:    liveResults.length,
      totalChecked: allResults.length,
    };
  },

  // ── Private helpers ──────────────────────────────────────────────────────────

  async _handleLive(result: SCLiveResult, store: any, now: Date): Promise<void> {
    const viewers = result.room?.liveRoomStats?.userCount ?? 0;
    const entered = result.room?.liveRoomStats?.enterCount ?? 0;

    // Check for an already-active session
    const existing = await LiveSession.findOne({ handle: result.handle, status: 'live' });

    if (existing) {
      // Poll: add viewer snapshot, update peak
      existing.polls.push({ takenAt: now, viewerCount: viewers });
      if (viewers > existing.peakViewers) existing.peakViewers = viewers;
      if (entered > existing.totalJoined)  existing.totalJoined = entered;
      existing.title    = result.room?.title || existing.title;
      existing.coverUrl = result.room?.coverUrl || existing.coverUrl;
      await existing.save();
      log.debug('Live session polled', { handle: result.handle, viewers });
      return;
    }

    // New live session — snapshot products for GMV start baseline
    const startSnaps = await this._snapshotProducts(result.handle);

    const session = await LiveSession.create({
      trackedStore: store._id,
      handle:       result.handle,
      status:       'live',
      title:        result.room?.title || '',
      coverUrl:     result.room?.coverUrl || result.room?.squareCoverImg || '',
      startedAt:    now,
      peakViewers:  viewers,
      totalJoined:  entered,
      roomId:       result.room ? String((result.room as any).id || '') : '',
      productSnapshots: startSnaps.map((p) => ({
        ...p,
        soldAtStart: p.soldCount,
        soldAtEnd:   0,
        soldDelta:   0,
        estimatedRevenue: 0,
      })),
      polls: [{ takenAt: now, viewerCount: viewers }],
      currency: 'USD',
    });

    await TrackedStore.findByIdAndUpdate(store._id, {
      $set: { lastLiveAt: now },
    });

    log.info('Live session started', { handle: result.handle, sessionId: session._id });
  },

  async _endSession(session: any, now: Date): Promise<void> {
    const endSnaps = await this._snapshotProducts(session.handle);
    const durationMinutes = Math.round((now.getTime() - session.startedAt.getTime()) / 60_000);

    // Compute sold delta per product
    let estimatedGMV = 0;
    const updatedSnapshots: IProductSnapshot[] = session.productSnapshots.map((snap: IProductSnapshot) => {
      const end = endSnaps.find((p) => p.productId === snap.productId);
      const soldAtEnd = end?.soldCount ?? snap.soldAtStart;
      const soldDelta = Math.max(0, soldAtEnd - snap.soldAtStart);
      const estimatedRevenue = soldDelta * snap.price;
      estimatedGMV += estimatedRevenue;
      return { ...snap, soldAtEnd, soldDelta, estimatedRevenue };
    });

    // If we had no start snapshots but have end snapshots, add them with 0 delta
    if (updatedSnapshots.length === 0 && endSnaps.length > 0) {
      for (const p of endSnaps) {
        updatedSnapshots.push({
          ...p,
          soldAtStart: p.soldCount,
          soldAtEnd:   p.soldCount,
          soldDelta:   0,
          estimatedRevenue: 0,
        });
      }
    }

    session.status           = 'ended';
    session.endedAt          = now;
    session.durationMinutes  = durationMinutes;
    session.productSnapshots = updatedSnapshots;
    session.estimatedGMV     = estimatedGMV;
    await session.save();

    // Update store aggregate
    await TrackedStore.findByIdAndUpdate(session.trackedStore, {
      $inc: { liveCount: 1, totalEstimatedGMV: estimatedGMV },
    });

    log.info('Live session ended', {
      handle: session.handle,
      durationMinutes,
      estimatedGMV,
      sessionId: session._id,
    });
  },

  async _snapshotProducts(handle: string): Promise<(SCShopProduct & { soldCount: number })[]> {
    try {
      const products = await ScrapeCreatorsService.getShopProducts(handle);
      return products.map((p) => ({ ...p, soldCount: p.soldCount }));
    } catch (err) {
      log.debug('Product snapshot failed (non-critical)', { handle, err: String(err) });
      return [];
    }
  },
};
