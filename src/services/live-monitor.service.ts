/**
 * LiveMonitorService
 *
 * Orchestrates TikTok Live session tracking for tracked stores:
 *   1. discover() unions **active watchlist** handles with **open `LiveSession` handles**, re-checks live via ScrapeCreators, starts/continues sessions, and ends DB rows when no longer live
 *   2. Snapshot product sold counts at session start and end (Apify shop scraper — not ScrapeCreators)
 *   3. Compute estimated GMV delta when the session ends
 *   4. Update TrackedStore aggregate stats
 *   5. ingestLiveRoomsFromApifyDiscovery() — Apify live keyword search → upsert watchlist rows + fastStart sessions
 */

import type { Types } from 'mongoose';
import { TrackedStore }  from '../models/tracked-store.model';
import { LiveSession, IProductSnapshot } from '../models/live-session.model';
import { ScrapeCreatorsService, SCLiveResult } from './scrapecreators.service';
import { TikTokShopScraperService, ShopProduct } from './tiktok-shop-scraper.service';
import { runTikTokLiveScraper } from './apify.service';
import type { TikTokLiveScraperItem } from './apify.types';
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

/** Response for `GET /tiktok/live/discover` — read-only from MongoDB; only streams with ≥2 concurrent viewers are listed. */
export interface CachedLiveDiscoverResult {
  /** `LiveSession` documents with `status: 'live'` and at least **2** concurrent viewers (last poll or peak). */
  sessions: Array<Record<string, unknown>>;
  /**
   * Same rows as `sessions`, in the legacy `SCLiveResult` shape (ScrapeCreators live discover).
   * Clients that still read `data.live` should use this; `sessions` holds full Mongo documents.
   */
  live: SCLiveResult[];
  /** Always empty on discover (read-only). `POST /tiktok/live/reconcile` returns handles it closed in its own `data.ended`. */
  ended: string[];
  liveCount: number;
  /** Count of active tracked stores (watchlist size); mirrors legacy `discover().totalChecked`. */
  totalChecked: number;
  totalActiveStores: number;
  /** Latest `lastCheckedAt` among active tracked stores (after a sync run); null if never synced. */
  watchlistLastCheckedAt: Date | null;
}

const MIN_VIEWERS_FOR_DISCOVER = 2;

/** Concurrent viewers from last poll snapshot, else peakViewers on the persisted session. */
function liveSessionDocViewerCount(doc: Record<string, unknown>): number {
  const polls = (Array.isArray(doc.polls) ? doc.polls : []) as Array<{ viewerCount?: number }>;
  const lastPoll = polls.length > 0 ? polls[polls.length - 1] : undefined;
  return lastPoll?.viewerCount ?? (Number(doc.peakViewers ?? 0) || 0);
}

function liveSessionDocPassesViewerThreshold(doc: Record<string, unknown>): boolean {
  return liveSessionDocViewerCount(doc) >= MIN_VIEWERS_FOR_DISCOVER;
}

function scLiveResultPassesViewerThreshold(r: SCLiveResult): boolean {
  const n = r.room?.liveRoomStats?.userCount;
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  return v >= MIN_VIEWERS_FOR_DISCOVER;
}

function viewerCountFromApifyItem(item: TikTokLiveScraperItem): number {
  if (typeof item.user_count === 'number' && Number.isFinite(item.user_count)) return item.user_count;
  const t = item.stats?.total_user;
  if (typeof t === 'number' && Number.isFinite(t)) return t;
  return 0;
}

function handleFromApifyItem(item: TikTokLiveScraperItem): string | null {
  const raw = item.owner?.unique_id;
  if (!raw || typeof raw !== 'string') return null;
  const h = raw.replace(/^@/, '').trim().toLowerCase();
  return h || null;
}

/** Build an `SCLiveResult` from an Apify live-scraper row so `_handleLive` can open/poll sessions. */
function apifyLiveItemToSCLiveResult(item: TikTokLiveScraperItem, handle: string): SCLiveResult | null {
  const roomId = String(item.id_str ?? item.id ?? item.room_id ?? '').trim();
  if (!roomId) return null;
  const v = viewerCountFromApifyItem(item);
  const urls = item.cover?.url_list;
  const cover = Array.isArray(urls) && urls[0] ? String(urls[0]).trim() : undefined;
  const owner = item.owner;
  return {
    handle,
    isLive: true,
    roomId,
    user: {
      id: String(owner?.id ?? handle),
      uniqueId: handle,
      nickname: (owner?.nickname && String(owner.nickname).trim()) || handle,
      avatarThumb: owner?.avatar_thumb?.url_list?.[0],
      followerCount:
        typeof owner?.follow_info?.follower_count === 'number'
          ? owner.follow_info.follower_count
          : undefined,
    },
    room: {
      id: roomId,
      title: item.title ? String(item.title) : undefined,
      coverUrl: cover,
      squareCoverImg: cover,
      liveRoomStats: {
        userCount: v,
        enterCount: 0,
      },
    },
    watchUrl: `https://www.tiktok.com/@${handle}/live`,
  };
}

export interface IngestLiveDiscoveryResult {
  keyword: string;
  apifyItemCount: number;
  handlesProcessed: number;
  storesCreated: number;
  storesExisting: number;
  sessionsStarted: number;
  sessionsPolled: number;
  skippedNoHandle: number;
  skippedNoRoomId: number;
  skippedLowViewers: number;
}

/** Optional `TrackedStore` fields merged into discover cards when the live room has no cover yet. */
type StoreDiscoverEnrichment = {
  displayName?: string;
  avatarThumb?: string;
  avatarMedium?: string;
  avatarLarger?: string;
  followerCount?: number;
};

/** Map a persisted live session (lean) into the shape returned by ScrapeCreators live checks. */
function liveSessionLeanToSCLiveResult(
  doc: Record<string, unknown>,
  store?: StoreDiscoverEnrichment | null,
): SCLiveResult {
  const handle = String(doc.handle ?? '');
  const userCount = liveSessionDocViewerCount(doc);
  const roomRaw = doc.roomId;
  const roomId = roomRaw != null && String(roomRaw) !== '' ? String(roomRaw) : undefined;
  const ts = doc.trackedStore as { toString?: () => string } | undefined;
  const storeId = ts?.toString?.() ?? '';

  const sessionCover = doc.coverUrl != null ? String(doc.coverUrl).trim() : '';
  const roomCover =
    sessionCover ||
    (store?.avatarLarger ? String(store.avatarLarger).trim() : '') ||
    (store?.avatarMedium ? String(store.avatarMedium).trim() : '') ||
    (store?.avatarThumb ? String(store.avatarThumb).trim() : '') ||
    undefined;

  const nick = store?.displayName?.trim() || handle;

  return {
    handle,
    isLive: true,
    roomId,
    user: {
      id: storeId || handle,
      uniqueId: handle,
      nickname: nick,
      avatarThumb: store?.avatarThumb,
      avatarMedium: store?.avatarMedium || store?.avatarLarger,
      avatarLarger: store?.avatarLarger || store?.avatarMedium || store?.avatarThumb,
      followerCount: store?.followerCount,
    },
    room: {
      id: roomId,
      title: doc.title ? String(doc.title) : undefined,
      coverUrl: roomCover,
      squareCoverImg: sessionCover || undefined,
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
   * Read live sessions from MongoDB only (no ScrapeCreators). Use `reconcileOpenLiveSessions` via
   * `POST /tiktok/live/reconcile` to end stale rows first.
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

    const sessionsFiltered = sessions.filter((s) =>
      liveSessionDocPassesViewerThreshold(s as Record<string, unknown>)
    );

    const trackedIds = [
      ...new Set(
        sessionsFiltered
          .map((s) => (s as { trackedStore?: Types.ObjectId }).trackedStore)
          .filter((id): id is Types.ObjectId => Boolean(id))
      ),
    ];
    const stores = trackedIds.length
      ? await TrackedStore.find({ _id: { $in: trackedIds } })
          .select({ avatarThumb: 1, avatarMedium: 1, avatarLarger: 1, displayName: 1, followerCount: 1 })
          .lean()
      : [];
    const storeById = new Map<string, StoreDiscoverEnrichment>(
      stores.map((st) => [String(st._id), st as StoreDiscoverEnrichment])
    );

    const live = sessionsFiltered.map((s) => {
      const doc = s as Record<string, unknown>;
      const sid = doc.trackedStore != null ? String(doc.trackedStore) : '';
      const st = sid ? storeById.get(sid) : undefined;
      return liveSessionLeanToSCLiveResult(doc, st);
    });

    return {
      sessions: sessionsFiltered as unknown as Array<Record<string, unknown>>,
      live,
      ended: [],
      liveCount: sessionsFiltered.length,
      totalChecked: totalActiveStores,
      totalActiveStores,
      watchlistLastCheckedAt,
    };
  },

  /**
   * Re-verify every open `LiveSession` against ScrapeCreators; ends sessions the API reports as not live.
   * Batched to limit latency (caps unique handles per request).
   */
  async reconcileOpenLiveSessions(): Promise<string[]> {
    const openDocs = await LiveSession.find({ status: 'live' });
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
        await this._endSession(session, now);
        ended.push(r.handle);
      }
    }

    if (ended.length > 0) {
      log.info('reconcileOpenLiveSessions: ended sessions', { count: ended.length, handles: ended });
    }
    return ended;
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

    const liveResults = allResults.filter((r) => r.isLive && scLiveResultPassesViewerThreshold(r));

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
        if (!scLiveResultPassesViewerThreshold(result)) {
          log.debug('Watchlist live probe: below viewer threshold — not starting session', {
            handle: h,
            viewers: result.room?.liveRoomStats?.userCount,
          });
          return { probed: true, isLive: false };
        }
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

    if (viewers < MIN_VIEWERS_FOR_DISCOVER) {
      log.debug('Skipping new live session — below viewer threshold', { handle: result.handle, viewers });
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

  /**
   * Apify TikTok live discovery (`easyapi/tiktok-live-scraper`) for `keyword`, then upsert
   * creators into `TrackedStore` and start or poll `LiveSession` for rooms with ≥2 viewers.
   * New sessions use **fastStart** (no Apify shop baseline until the next full `discover()` run).
   */
  async ingestLiveRoomsFromApifyDiscovery(
    keyword: string,
    maxItems = 20,
  ): Promise<IngestLiveDiscoveryResult> {
    const k = keyword.trim();
    const capped = Math.min(Math.max(1, maxItems), 50);
    const items = await runTikTokLiveScraper(k, capped);

    const byHandle = new Map<string, TikTokLiveScraperItem>();
    let skippedNoHandle = 0;
    for (const item of items) {
      const h = handleFromApifyItem(item);
      if (!h) {
        skippedNoHandle += 1;
        continue;
      }
      const prev = byHandle.get(h);
      if (!prev || viewerCountFromApifyItem(item) > viewerCountFromApifyItem(prev)) {
        byHandle.set(h, item);
      }
    }

    const now = new Date();
    let storesCreated = 0;
    let storesExisting = 0;
    let sessionsStarted = 0;
    let sessionsPolled = 0;
    let skippedNoRoomId = 0;
    let skippedLowViewers = 0;

    for (const [handle, item] of byHandle) {
      const scLive = apifyLiveItemToSCLiveResult(item, handle);
      if (!scLive) {
        skippedNoRoomId += 1;
        continue;
      }

      let store = await TrackedStore.findOne({ handle });
      if (!store) {
        const profileData: Record<string, unknown> = {};
        if (ScrapeCreatorsService.isConfigured()) {
          const info = await ScrapeCreatorsService.getUserInfo(handle).catch(() => null);
          if (info) {
            if (info.id) profileData.tiktokUserId = info.id;
            if (info.nickname) profileData.displayName = info.nickname;
            if (info.bio) profileData.bio = info.bio;
            if (info.avatarThumb) profileData.avatarThumb = info.avatarThumb;
            if (info.avatarMedium) profileData.avatarMedium = info.avatarMedium;
            if (info.avatarLarger) profileData.avatarLarger = info.avatarLarger;
            if (info.verified != null) profileData.verified = info.verified;
            if (info.hasShop != null) profileData.hasShop = info.hasShop;
            if (info.followerCount != null) profileData.followerCount = info.followerCount;
            profileData.profileFetchedAt = now;
          }
        }
        const thumb = item.owner?.avatar_thumb?.url_list?.[0];
        if (!profileData.avatarThumb && thumb) profileData.avatarThumb = thumb;

        store = await TrackedStore.create({
          handle,
          ...profileData,
          shopUrl: `https://www.tiktok.com/@${handle}/shop`,
        });
        storesCreated += 1;
      } else {
        storesExisting += 1;
      }

      const storeLean: TrackedStoreLeanForLive = {
        _id: store._id as Types.ObjectId,
        handle: store.handle,
        tiktokUserId: store.tiktokUserId,
      };

      if (!scLiveResultPassesViewerThreshold(scLive)) {
        skippedLowViewers += 1;
        continue;
      }

      const hadOpen = await LiveSession.findOne({ handle, status: 'live' });
      await this._handleLive(scLive, storeLean, now, { fastStart: true });
      const open = await LiveSession.findOne({ handle, status: 'live' });
      if (open) {
        if (hadOpen) sessionsPolled += 1;
        else sessionsStarted += 1;
      }
    }

    log.info('ingestLiveRoomsFromApifyDiscovery done', {
      keyword: k,
      apifyItemCount: items.length,
      handlesProcessed: byHandle.size,
      storesCreated,
      storesExisting,
      sessionsStarted,
      sessionsPolled,
      skippedNoHandle,
      skippedNoRoomId,
      skippedLowViewers,
    });

    return {
      keyword: k,
      apifyItemCount: items.length,
      handlesProcessed: byHandle.size,
      storesCreated,
      storesExisting,
      sessionsStarted,
      sessionsPolled,
      skippedNoHandle,
      skippedNoRoomId,
      skippedLowViewers,
    };
  },
};

