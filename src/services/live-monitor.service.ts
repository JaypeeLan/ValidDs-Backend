/**
 * LiveMonitorService
 *
 * Stub implementation — TrackedStore concept removed.
 * Routes that remain:
 *   GET  /tiktok/live/discover   → getCachedLiveDiscover()
 *   POST /tiktok/live/reconcile  → reconcileOpenLiveSessions()
 */

import { LiveSession, type ILiveSessionModel } from '../models/live-session.model';
import { ScrapeCreatorsService, SCLiveResult } from './scrapecreators.service';
import { logger } from '../logger';

const log = logger.child({ module: 'live-monitor' });

// ── Types ──────────────────────────────────────────────────────────────────────

export interface DiscoverResult {
  live:         SCLiveResult[];
  ended:        string[];
  liveCount:    number;
  totalChecked: number;
}

/** Response for `GET /tiktok/live/discover` */
export interface CachedLiveDiscoverResult {
  sessions:              Array<Record<string, unknown>>;
  live:                  SCLiveResult[];
  ended:                 string[];
  liveCount:             number;
  totalChecked:          number;
  totalActiveStores:     number;
  watchlistLastCheckedAt: Date | null;
}

export interface IngestLiveDiscoveryResult {
  keyword:           string;
  apifyItemCount:    number;
  handlesProcessed:  number;
  storesCreated:     number;
  storesExisting:    number;
  sessionsStarted:   number;
  sessionsPolled:    number;
  skippedNoHandle:   number;
  skippedNoRoomId:   number;
  skippedLowViewers: number;
}

// ── Service ───────────────────────────────────────────────────────────────────

export const LiveMonitorService = {

  /**
   * Read live sessions from MongoDB only (no ScrapeCreators). Use `reconcileOpenLiveSessions` via
   * `POST /tiktok/live/reconcile` to end stale rows first.
   */
  async getCachedLiveDiscover(
    liveSessionModel: ILiveSessionModel = LiveSession,
  ): Promise<CachedLiveDiscoverResult> {
    const sessions = await liveSessionModel
      .find({ status: 'live' })
      .sort({ startedAt: -1 })
      .lean();

    return {
      sessions: sessions as unknown as Array<Record<string, unknown>>,
      live: [],
      ended: [],
      liveCount: sessions.length,
      totalChecked: 0,
      totalActiveStores: 0,
      watchlistLastCheckedAt: null,
    };
  },

  /**
   * Re-verify every open `LiveSession` against ScrapeCreators; ends sessions the API reports as not live.
   */
  async reconcileOpenLiveSessions(
    liveSessionModel: ILiveSessionModel = LiveSession,
  ): Promise<string[]> {
    const openDocs = await liveSessionModel.find({ status: 'live' });
    if (openDocs.length === 0) return [];

    const uniqueHandles = [...new Set(openDocs.map((s) => s.handle))];
    const MAX = 50;
    const handles = uniqueHandles.slice(0, MAX);
    if (uniqueHandles.length > MAX) {
      log.warn('reconcileOpenLiveSessions: capping handles', { total: uniqueHandles.length, max: MAX });
    }

    const BATCH = 10;
    const now = new Date();
    const ended: string[] = [];

    for (let i = 0; i < handles.length; i += BATCH) {
      const chunk = handles.slice(i, i + BATCH);
      const results = await ScrapeCreatorsService.batchGetUserLive(chunk);

      for (const r of results) {
        if (r.isLive) continue;
        const session = openDocs.find((s) => s.handle === r.handle && s.status === 'live');
        if (!session) continue;
        const durationMinutes = Math.round((now.getTime() - session.startedAt.getTime()) / 60_000);
        session.status          = 'ended' as 'live' | 'ended';
        session.endedAt         = now;
        session.durationMinutes = durationMinutes;
        await session.save();
        ended.push(r.handle);
      }
    }

    if (ended.length > 0) {
      log.info('reconcileOpenLiveSessions: ended sessions', { count: ended.length, handles: ended });
    }
    return ended;
  },

  /**
   * No-op — full watchlist discovery was removed with TrackedStore.
   * Kept so schedulers and `POST /jobs/live-monitor-discover` still compile and exit cleanly.
   */
  async discover(): Promise<DiscoverResult> {
    log.debug('discover() skipped — TrackedStore removed');
    return { live: [], ended: [], liveCount: 0, totalChecked: 0 };
  },

  /**
   * No-op stub — watchlist routes have been removed.
   * Kept to avoid breaking any existing callers at compile time.
   */
  async probeWatchlistHandle(_handle: string): Promise<{ probed: boolean; isLive: boolean }> {
    return { probed: false, isLive: false };
  },
};
