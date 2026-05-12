import { env } from '../config/env.validation';
import { AppError } from '../middleware/error.middleware';
import { logger } from '../logger';

const log = logger.child({ module: 'scrapecreators-service' });

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SCUserInfo {
  id?: string;
  uniqueId?: string;
  nickname?: string;
  avatarThumb?: string;
  avatarMedium?: string;
  verified?: boolean;
  followerCount?: number;
  followingCount?: number;
  videoCount?: number;
  heartCount?: number;
  signature?: string;
  commerceUserInfo?: {
    commerceUser?: boolean;
  };
}

export interface SCShopProduct {
  productId:   string;
  title:       string;
  imageUrl:    string;
  price:       number;
  currency:    string;
  soldCount:   number;
  productUrl:  string;
  inStock?:    boolean;
  rating?:     number;
  reviewCount?: number;
}

export interface SCLiveRoomUserInfo {
  id: string;
  uniqueId: string;
  nickname: string;
  avatarThumb?: string;
  avatarMedium?: string;
  avatarLarger?: string;
  verified?: boolean;
  followerCount?: number;
  followingCount?: number;
  signature?: string;
  roomId?: string;
}

export interface SCLiveRoom {
  id?: string;              // room ID — used for webcast product fetching
  title?: string;
  coverUrl?: string;
  squareCoverImg?: string;
  startTime?: number;
  status?: number;
  liveRoomStats?: {
    userCount?: number;
    enterCount?: number;
  };
  hashTagId?: string;
  gameTagId?: string;
}

export interface SCStreamUrls {
  flv?: string;
  hls?: string;
  cmaf?: string;
}

export interface SCLiveResult {
  handle: string;
  isLive: boolean;
  roomId?: string;          // top-level for easy access
  user?: SCLiveRoomUserInfo;
  room?: SCLiveRoom;
  streams?: SCStreamUrls;
  watchUrl: string;
}

interface SCRawResponse {
  liveRoomUserInfo?: SCLiveRoomUserInfo;
  liveRoom?: SCLiveRoom & { id?: string | number };
  streamData?: {
    pull_data?: {
      stream_data?: string; // JSON string of stream URLs
    };
  };
}

// ── Service ───────────────────────────────────────────────────────────────────

export const ScrapeCreatorsService = {

  isConfigured(): boolean {
    return Boolean(env.SCRAPECREATORS_API_KEY);
  },

  assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new AppError(503, 'SCRAPECREATORS_API_KEY is not configured', 'SCRAPECREATORS_NOT_CONFIGURED');
    }
  },

  /**
   * Check if a TikTok user is currently live.
   * Returns null if the user is not live or the handle doesn't exist.
   */
  async getUserLive(handle: string): Promise<SCLiveResult> {
    this.assertConfigured();

    const cleanHandle = handle.replace(/^@/, '').trim().toLowerCase();
    const watchUrl = `https://www.tiktok.com/@${cleanHandle}/live`;

    const url = `${env.SCRAPECREATORS_BASE_URL}/v1/tiktok/user/live?handle=${encodeURIComponent(cleanHandle)}`;

    log.debug('ScrapeCreators: checking live status', { handle: cleanHandle });

    const res = await fetch(url, {
      headers: {
        'x-api-key': env.SCRAPECREATORS_API_KEY!,
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (res.status === 402) {
      throw new AppError(402, 'ScrapeCreators credits exhausted', 'SCRAPECREATORS_NO_CREDITS');
    }
    if (res.status === 401) {
      throw new AppError(401, 'Invalid ScrapeCreators API key', 'SCRAPECREATORS_INVALID_KEY');
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      log.warn('ScrapeCreators error', { status: res.status, handle: cleanHandle, body: text });
      // Treat 4xx as "not live" rather than hard-failing the whole batch
      return { handle: cleanHandle, isLive: false, watchUrl };
    }

    const data = await res.json() as SCRawResponse;

    // If there's no liveRoom or liveRoomUserInfo the user isn't live
    if (!data?.liveRoom && !data?.liveRoomUserInfo) {
      return { handle: cleanHandle, isLive: false, watchUrl };
    }

    // Parse stream URLs out of the nested JSON string TikTok returns
    const streams = parseStreamUrls(data.streamData?.pull_data?.stream_data);

    // roomId can live on liveRoom.id, liveRoomUserInfo.roomId, or nested
    const roomId: string | undefined =
      String(data.liveRoom?.id || data.liveRoomUserInfo?.roomId || '').trim() || undefined;

    return {
      handle: cleanHandle,
      isLive: true,
      roomId,
      user:   data.liveRoomUserInfo,
      room:   { ...data.liveRoom, id: roomId },
      streams,
      watchUrl,
    };
  },

  /**
   * Fetch basic profile info for a TikTok handle.
   * Returns null if the handle doesn't exist or the request fails.
   */
  async getUserInfo(handle: string): Promise<SCUserInfo | null> {
    this.assertConfigured();
    const cleanHandle = handle.replace(/^@/, '').trim().toLowerCase();
    const url = `${env.SCRAPECREATORS_BASE_URL}/v1/tiktok/user/info?handle=${encodeURIComponent(cleanHandle)}`;
    try {
      const res = await fetch(url, {
        headers: { 'x-api-key': env.SCRAPECREATORS_API_KEY!, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return null;
      const data = await res.json() as any;
      // ScrapeCreators nests user info under userInfo or directly
      const u = data?.userInfo?.user || data?.user || data;
      if (!u?.uniqueId) return null;
      const stats = data?.userInfo?.stats || data?.stats || {};
      return {
        id:             u.id,
        uniqueId:       u.uniqueId,
        nickname:       u.nickname,
        avatarThumb:    u.avatarThumb?.urlList?.[0] || u.avatarThumb,
        avatarMedium:   u.avatarMedium?.urlList?.[0] || u.avatarMedium,
        verified:       u.verified,
        followerCount:  stats.followerCount ?? u.followerCount,
        followingCount: stats.followingCount ?? u.followingCount,
        videoCount:     stats.videoCount ?? u.videoCount,
        heartCount:     stats.heartCount ?? u.heartCount,
        signature:      u.signature,
        commerceUserInfo: u.commerceUserInfo,
      };
    } catch {
      return null;
    }
  },

  /**
   * Fetch a TikTok Shop's products with sold counts.
   * Used for GMV delta snapshots — call at live start and live end.
   * Returns empty array if the store has no TikTok Shop or the endpoint fails.
   */
  async getShopProducts(handle: string): Promise<SCShopProduct[]> {
    this.assertConfigured();
    const cleanHandle = handle.replace(/^@/, '').trim().toLowerCase();
    const url = `${env.SCRAPECREATORS_BASE_URL}/v1/tiktok/shop?handle=${encodeURIComponent(cleanHandle)}`;
    try {
      const res = await fetch(url, {
        headers: { 'x-api-key': env.SCRAPECREATORS_API_KEY!, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        log.debug('ScrapeCreators: shop products not available', { handle: cleanHandle, status: res.status });
        return [];
      }
      const data = await res.json() as any;
      // Normalise whatever shape comes back
      const raw: any[] = data?.products || data?.data?.products || data?.items || data?.data || [];
      if (!Array.isArray(raw)) return [];
      return raw.map((p: any) => ({
        productId:   String(p.productId || p.id || ''),
        title:       String(p.title || p.name || ''),
        imageUrl:    String(p.imageUrl || p.image || p.cover || ''),
        price:       Number(p.price ?? p.salePrice ?? 0),
        currency:    String(p.currency || 'USD'),
        soldCount:   Number(p.soldCount ?? p.sold ?? p.sales ?? 0),
        productUrl:  String(p.productUrl || p.url || `https://www.tiktok.com/@${cleanHandle}/shop`),
        inStock:     p.inStock !== false,
        rating:      p.rating != null ? Number(p.rating) : undefined,
        reviewCount: p.reviewCount != null ? Number(p.reviewCount) : undefined,
      }));
    } catch (err) {
      log.debug('ScrapeCreators: getShopProducts failed', { handle: cleanHandle, err: String(err) });
      return [];
    }
  },

  /**
   * Check multiple handles in parallel (max 10 at a time).
   */
  async batchGetUserLive(handles: string[]): Promise<SCLiveResult[]> {
    this.assertConfigured();

    const unique = [...new Set(handles.map((h) => h.replace(/^@/, '').trim().toLowerCase()).filter(Boolean))].slice(0, 10);

    const results = await Promise.allSettled(unique.map((h) => this.getUserLive(h)));

    return results.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      log.warn('ScrapeCreators batch item failed', { handle: unique[i], error: String(r.reason) });
      return { handle: unique[i], isLive: false, watchUrl: `https://www.tiktok.com/@${unique[i]}/live` };
    });
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseStreamUrls(streamDataStr?: string): SCStreamUrls | undefined {
  if (!streamDataStr) return undefined;
  try {
    const parsed = JSON.parse(streamDataStr) as Record<string, { main?: { flv?: string; hls?: string; cmaf?: string } }>;
    // grab the best quality available: origin → hd → sd
    for (const quality of ['origin', 'hd', 'sd', 'ld']) {
      const q = parsed[quality]?.main;
      if (q) {
        return { flv: q.flv, hls: q.hls, cmaf: q.cmaf };
      }
    }
  } catch {
    // stream data not parseable — not critical
  }
  return undefined;
}
