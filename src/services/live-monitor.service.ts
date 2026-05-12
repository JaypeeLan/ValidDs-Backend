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
import { TikTokShopScraperService, ShopProduct } from './tiktok-shop-scraper.service';
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

    // New live session — snapshot current sold counts as baseline
    const startProducts = await TikTokShopScraperService.getSellerProducts(
      result.handle,
      store.tiktokUserId,
    );

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

