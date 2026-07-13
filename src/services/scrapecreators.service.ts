import { env } from '../config/env.validation';
import { AppError } from '../middleware/error.middleware';
import { logger } from '../logger';
import { extractAwemeMedia, resolveAwemeId } from '../utils/aweme-media.util';
import type { AwemeMediaPatch } from '../utils/aweme-media.util';
import type { IVideoMetrics } from '../types/creative.types';

const log = logger.child({ module: 'scrapecreators-service' });

/**
 * ScrapeCreators HTTP client — **live** (`/v1/tiktok/user/live`, batch) and **profile** (`/v1/tiktok/profile`).
 * TikTok Shop product lists / sold counts for GMV use `TikTokShopScraperService` (Apify), not this module.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SCUserInfo {
  // Identity
  id?: string;
  uniqueId?: string;
  nickname?: string;

  // Avatar
  avatarThumb?: string;
  avatarMedium?: string;
  avatarLarger?: string;

  // Profile
  bio?: string; // signature
  verified?: boolean;
  region?: string; // e.g. "US"
  language?: string; // e.g. "en"
  privateAccount?: boolean;

  // Stats
  followerCount?: number;
  followingCount?: number;
  videoCount?: number;
  heartCount?: number; // total likes received
  diggCount?: number; // total likes given

  // Commerce
  hasShop?: boolean; // true if TikTok Shop is enabled
  shopId?: string;
  shopRegion?: string;

  // Engagement rate (computed if stats available)
  engagementRate?: number; // heartCount / followerCount * 100
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
  id?: string; // room ID — used for webcast product fetching
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
  roomId?: string; // top-level for easy access
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
      throw new AppError(
        503,
        'SCRAPECREATORS_API_KEY is not configured',
        'SCRAPECREATORS_NOT_CONFIGURED',
      );
    }
  },

  /**
   * Check if a TikTok user is currently live.
   * Requires a non-empty **room id** in the ScrapeCreators payload; otherwise returns `isLive: false`
   * (stale `liveRoomUserInfo` after a stream ends is common).
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
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (res.status === 402) {
      const { sendOpsAlert } = await import('./ops-alert.service');
      void sendOpsAlert({
        issue: 'ScrapeCreators credits exhausted',
        service: 'backend',
        detail: 'HTTP 402 from ScrapeCreators while checking live status',
        fix: [
          'Top up credits at https://scrapecreators.com',
          'Confirm SCRAPECREATORS_API_KEY on the backend Render service',
        ],
        dedupeKey: 'backend:scrapecreators:credits',
        audience: 'billing',
      });
      throw new AppError(402, 'ScrapeCreators credits exhausted', 'SCRAPECREATORS_NO_CREDITS');
    }
    if (res.status === 401) {
      const { sendOpsAlert } = await import('./ops-alert.service');
      void sendOpsAlert({
        issue: 'ScrapeCreators API key rejected',
        service: 'backend',
        detail: 'HTTP 401 from ScrapeCreators',
        fix: ['Rotate SCRAPECREATORS_API_KEY on the backend Render service'],
        dedupeKey: 'backend:scrapecreators:auth',
        audience: 'ops',
      });
      throw new AppError(401, 'Invalid ScrapeCreators API key', 'SCRAPECREATORS_INVALID_KEY');
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      log.warn('ScrapeCreators error', { status: res.status, handle: cleanHandle, body: text });
      // Treat 4xx as "not live" rather than hard-failing the whole batch
      return { handle: cleanHandle, isLive: false, watchUrl };
    }

    const data = (await res.json()) as SCRawResponse;

    // If there's no liveRoom or liveRoomUserInfo the user isn't live
    if (!data?.liveRoom && !data?.liveRoomUserInfo) {
      return { handle: cleanHandle, isLive: false, watchUrl };
    }

    // roomId can live on liveRoom.id, liveRoomUserInfo.roomId, or nested
    const roomId: string | undefined =
      String(data.liveRoom?.id || data.liveRoomUserInfo?.roomId || '').trim() || undefined;

    // Stale payloads after a stream has ended sometimes still include user/room stubs without a real room id.
    // Only treat as live when we can anchor a webcast room (same rule used by GMV / live-products flows).
    if (!roomId) {
      log.debug('ScrapeCreators: live-shaped payload but no roomId — treating as not live', {
        handle: cleanHandle,
      });
      return { handle: cleanHandle, isLive: false, watchUrl };
    }

    // Parse stream URLs out of the nested JSON string TikTok returns
    const streams = parseStreamUrls(data.streamData?.pull_data?.stream_data);

    return {
      handle: cleanHandle,
      isLive: true,
      roomId,
      user: data.liveRoomUserInfo,
      room: { ...data.liveRoom, id: roomId },
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

    // ScrapeCreators exposes /v1/tiktok/profile (not /user/info)
    const url = `${env.SCRAPECREATORS_BASE_URL}/v1/tiktok/profile?handle=${encodeURIComponent(cleanHandle)}`;
    try {
      const res = await fetch(url, {
        headers: { 'x-api-key': env.SCRAPECREATORS_API_KEY!, Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return null;
      const raw = (await res.json()) as any;

      // Profile endpoint: raw.user + raw.stats / raw.statsV2
      const u = raw?.user;
      if (!u?.uniqueId) return null;

      // Prefer statsV2 (string values) → parse to number; fall back to stats
      const sv2 = raw?.statsV2 || {};
      const stats = raw?.stats || {};
      const fc = (s: any, k: string) => pos(Number(sv2[k] ?? stats[k]));

      const avatarThumb = firstUrl(u.avatarThumb) || undefined;
      const avatarMedium = firstUrl(u.avatarMedium) || undefined;
      const avatarLarger = firstUrl(u.avatarLarger) || undefined;

      const followerCount = fc(stats, 'followerCount');
      const heartCount = fc(stats, 'heart') || fc(stats, 'heartCount');
      const engagementRate =
        followerCount && heartCount
          ? Math.round((heartCount / followerCount) * 10) / 10
          : undefined;

      // Commerce — ttSeller flag is the most reliable indicator
      const commerce = u.commerceUserInfo || {};
      const hasShop = u.ttSeller === true || commerce.commerceUser === true || undefined;
      const shopId = str(commerce.shopId || commerce.sellerId) || undefined;
      const shopRegion = str(commerce.mcnRegion || commerce.region) || undefined;

      // Nickname must differ from handle — if they're the same, it's not useful as a display name
      const nickname = str(u.nickname);
      const displayNickname = nickname?.toLowerCase() !== cleanHandle ? nickname : undefined;

      return strip<SCUserInfo>({
        id: str(u.id),
        uniqueId: str(u.uniqueId),
        nickname: displayNickname,
        avatarThumb,
        avatarMedium,
        avatarLarger,
        bio: str(u.signature) || undefined,
        verified: u.verified === true || undefined,
        region: str(u.region) || undefined,
        language: str(u.language) || undefined,
        privateAccount: u.privateAccount === true || undefined,
        followerCount,
        followingCount: fc(stats, 'followingCount'),
        videoCount: fc(stats, 'videoCount'),
        heartCount,
        diggCount: fc(stats, 'diggCount'),
        hasShop,
        shopId,
        shopRegion,
        engagementRate,
      });
    } catch {
      return null;
    }
  },

  /**
   * Locate a single aweme in a creator's profile/videos feed and extract fresh media URLs.
   * Paginates up to `maxPages` (default 5) before giving up.
   */
  async findAwemeEngagement(
    handle: string,
    awemeId: string,
    options: { region?: string; maxPages?: number } = {},
  ): Promise<IVideoMetrics | null> {
    const aweme = await this.findAwemeRaw(handle, awemeId, options);
    if (!aweme) return null;
    const { extractAwemeEngagement } = await import('../utils/video-metrics.util');
    const metrics = extractAwemeEngagement(aweme);
    return metrics.viewCount > 0 ? metrics : null;
  },

  async findAwemeRaw(
    handle: string,
    awemeId: string,
    options: { region?: string; maxPages?: number } = {},
  ): Promise<Record<string, unknown> | null> {
    if (!this.isConfigured()) return null;

    const cleanHandle = handle.replace(/^@/, '').trim().toLowerCase();
    const targetId = String(awemeId || '').trim();
    if (!cleanHandle || !targetId || targetId.startsWith('meta:')) return null;

    const region = (options.region || 'US').trim() || 'US';
    const maxPages = Math.min(Math.max(options.maxPages ?? 5, 1), 10);
    let cursor: string | undefined;

    for (let page = 0; page < maxPages; page += 1) {
      const params = new URLSearchParams({
        handle: cleanHandle,
        sort_by: 'latest',
        region,
        trim: 'false',
      });
      if (cursor) params.set('max_cursor', cursor);

      const url = `${env.SCRAPECREATORS_BASE_URL}/v3/tiktok/profile/videos?${params.toString()}`;
      try {
        const res = await fetch(url, {
          headers: { 'x-api-key': env.SCRAPECREATORS_API_KEY!, Accept: 'application/json' },
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) return null;

        const raw = (await res.json()) as Record<string, unknown>;
        const batch = Array.isArray(raw.aweme_list) ? raw.aweme_list : [];
        for (const item of batch) {
          if (!item || typeof item !== 'object') continue;
          const aweme = item as Record<string, unknown>;
          if (resolveAwemeId(aweme) !== targetId) continue;
          return aweme;
        }

        if (!raw.has_more) break;
        const nextCursor = raw.max_cursor;
        cursor = nextCursor != null && String(nextCursor).trim() ? String(nextCursor) : undefined;
        if (!cursor) break;
      } catch {
        return null;
      }
    }

    return null;
  },

  async findAwemeMedia(
    handle: string,
    awemeId: string,
    options: { region?: string; maxPages?: number } = {},
  ): Promise<AwemeMediaPatch | null> {
    const aweme = await this.findAwemeRaw(handle, awemeId, options);
    return aweme ? extractAwemeMedia(aweme) : null;
  },

  /** Profile stats for creator cards — lifetime likes across all posts, not one video. */
  creatorStatsFromProfile(profile: SCUserInfo | null | undefined): {
    followers?: number;
    following?: number;
    totalLikes?: number;
    verified?: boolean;
  } {
    if (!profile) return {};
    const out: {
      followers?: number;
      following?: number;
      totalLikes?: number;
      verified?: boolean;
    } = {};
    if (profile.followerCount != null && profile.followerCount > 0) {
      out.followers = profile.followerCount;
    }
    if (profile.followingCount != null && profile.followingCount > 0) {
      out.following = profile.followingCount;
    }
    if (profile.heartCount != null && profile.heartCount > 0) {
      out.totalLikes = profile.heartCount;
    }
    if (profile.verified) out.verified = true;
    return out;
  },

  /** Best avatar URL from a profile lookup (largest available). */
  pickAvatarUrl(profile: SCUserInfo | null | undefined): string | undefined {
    return profile?.avatarLarger || profile?.avatarMedium || profile?.avatarThumb;
  },

  /**
   * Check multiple handles in parallel (max 10 at a time).
   */
  async batchGetUserLive(handles: string[]): Promise<SCLiveResult[]> {
    this.assertConfigured();

    const unique = [
      ...new Set(handles.map((h) => h.replace(/^@/, '').trim().toLowerCase()).filter(Boolean)),
    ].slice(0, 10);

    const results = await Promise.allSettled(unique.map((h) => this.getUserLive(h)));

    return results.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      log.warn('ScrapeCreators batch item failed', { handle: unique[i], error: String(r.reason) });
      return {
        handle: unique[i],
        isLive: false,
        watchUrl: `https://www.tiktok.com/@${unique[i]}/live`,
      };
    });
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extract first URL from TikTok's { urlList: [...] } or plain string */
function firstUrl(val: any): string | undefined {
  if (!val) return undefined;
  if (typeof val === 'string') return val || undefined;
  if (Array.isArray(val?.urlList) && val.urlList.length > 0) return val.urlList[0];
  if (Array.isArray(val) && val.length > 0) return val[0];
  return undefined;
}

/** Return value only if it's a positive number */
function pos(val: any): number | undefined {
  const n = Number(val);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Return trimmed string or undefined */
function str(val: any): string | undefined {
  const s = String(val ?? '').trim();
  return s && s !== 'undefined' && s !== 'null' ? s : undefined;
}

/** Remove all undefined / null / false (except explicit false booleans) keys from object */
function strip<T extends object>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  ) as T;
}

function parseStreamUrls(streamDataStr?: string): SCStreamUrls | undefined {
  if (!streamDataStr) return undefined;
  try {
    const parsed = JSON.parse(streamDataStr) as Record<
      string,
      { main?: { flv?: string; hls?: string; cmaf?: string } }
    >;
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
