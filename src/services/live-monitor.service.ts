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
import { ScrapeCreatorsService, SCLiveResult } from './scrapecreators.service';
import { TikTokWebcastService, WebcastProduct } from './tiktok-webcast.service';
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
    const roomId  = result.roomId || result.room?.id || '';

    // Check for an already-active session
    const existing = await LiveSession.findOne({ handle: result.handle, status: 'live' });

    if (existing) {
      // Poll: viewer snapshot + refresh product sold counts mid-live
      existing.polls.push({ takenAt: now, viewerCount: viewers });
      if (viewers > existing.peakViewers) existing.peakViewers = viewers;
      if (entered > existing.totalJoined)  existing.totalJoined = entered;
      existing.title    = result.room?.title || existing.title;
      existing.coverUrl = result.room?.coverUrl || existing.coverUrl;

      // Refresh product sold counts (soldInLive is the live-running counter)
      if (roomId) {
        const liveProducts = await TikTokWebcastService.getLiveProducts(String(roomId), result.handle);
        if (liveProducts.length > 0) {
          existing.productSnapshots = mergeWebcastProducts(
            existing.productSnapshots as IProductSnapshot[],
            liveProducts,
          );
          existing.estimatedGMV = existing.productSnapshots.reduce(
            (sum, p) => sum + (p.estimatedRevenue || 0), 0
          );
        }
      }

      await existing.save();
      log.debug('Live session polled', { handle: result.handle, viewers, roomId });
      return;
    }

    // New live session — fetch products from webcast API
    const liveProducts = roomId
      ? await TikTokWebcastService.getLiveProducts(String(roomId), result.handle)
      : [];

    const productSnapshots: IProductSnapshot[] = liveProducts.map((p) => ({
      productId:        p.productId,
      productUrl:       p.productUrl,
      title:            p.title,
      imageUrl:         p.imageUrl,
      price:            p.price,
      currency:         p.currency,
      soldAtStart:      p.soldInLive,   // baseline at session start
      soldAtEnd:        p.soldInLive,   // will be updated on polls / end
      soldDelta:        0,              // delta grows as live progresses
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
      currency: 'USD',
    });

    await TrackedStore.findByIdAndUpdate(store._id, {
      $set: { lastLiveAt: now },
    });

    log.info('Live session started', {
      handle:       result.handle,
      sessionId:    session._id,
      roomId,
      productCount: liveProducts.length,
    });
  },

  async _endSession(session: any, now: Date): Promise<void> {
    const durationMinutes = Math.round((now.getTime() - session.startedAt.getTime()) / 60_000);

    // Final product snapshot from webcast API
    let finalProducts: WebcastProduct[] = [];
    if (session.roomId) {
      finalProducts = await TikTokWebcastService.getLiveProducts(session.roomId, session.handle);
    }

    let estimatedGMV = 0;
    let updatedSnapshots: IProductSnapshot[];

    if (finalProducts.length > 0) {
      // We have webcast data — soldInLive is the authoritative in-session count
      updatedSnapshots = session.productSnapshots.map((snap: IProductSnapshot) => {
        const final = finalProducts.find((p) => p.productId === snap.productId);
        if (!final) return snap;
        const soldAtEnd      = final.soldInLive;
        const soldDelta      = Math.max(0, soldAtEnd - snap.soldAtStart);
        const estimatedRevenue = soldDelta * snap.price;
        estimatedGMV += estimatedRevenue;
        return { ...snap, soldAtEnd, soldDelta, estimatedRevenue };
      });

      // Add any new products that appeared mid-live
      for (const fp of finalProducts) {
        if (!updatedSnapshots.find((s) => s.productId === fp.productId)) {
          updatedSnapshots.push({
            productId:        fp.productId,
            productUrl:       fp.productUrl,
            title:            fp.title,
            imageUrl:         fp.imageUrl,
            price:            fp.price,
            currency:         fp.currency,
            soldAtStart:      0,
            soldAtEnd:        fp.soldInLive,
            soldDelta:        fp.soldInLive,
            estimatedRevenue: fp.soldInLive * fp.price,
          });
          estimatedGMV += fp.soldInLive * fp.price;
        }
      }
    } else {
      // No final data — keep whatever we had from polls
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function mergeWebcastProducts(
  existing: IProductSnapshot[],
  live: WebcastProduct[],
): IProductSnapshot[] {
  const merged = existing.map((snap) => {
    const current = live.find((p) => p.productId === snap.productId);
    if (!current) return snap;
    const soldAtEnd        = current.soldInLive;
    const soldDelta        = Math.max(0, soldAtEnd - snap.soldAtStart);
    const estimatedRevenue = soldDelta * snap.price;
    return { ...snap, soldAtEnd, soldDelta, estimatedRevenue };
  });

  for (const lp of live) {
    if (!merged.find((s) => s.productId === lp.productId)) {
      merged.push({
        productId:        lp.productId,
        productUrl:       lp.productUrl,
        title:            lp.title,
        imageUrl:         lp.imageUrl,
        price:            lp.price,
        currency:         lp.currency,
        soldAtStart:      lp.soldInLive,
        soldAtEnd:        lp.soldInLive,
        soldDelta:        0,
        estimatedRevenue: 0,
      });
    }
  }

  return merged;
}
