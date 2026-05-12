import { env } from '../config/env.validation';
import { AppError } from '../middleware/error.middleware';
import { logger } from '../logger';

const log = logger.child({ module: 'scrapecreators-service' });

// ── Types ─────────────────────────────────────────────────────────────────────

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
  user?: SCLiveRoomUserInfo;
  room?: SCLiveRoom;
  streams?: SCStreamUrls;
  watchUrl: string;
}

interface SCRawResponse {
  liveRoomUserInfo?: SCLiveRoomUserInfo;
  liveRoom?: SCLiveRoom;
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

    // Parse stream URLs out of the nested JSON string Shopify returns
    const streams = parseStreamUrls(data.streamData?.pull_data?.stream_data);

    return {
      handle: cleanHandle,
      isLive: true,
      user: data.liveRoomUserInfo,
      room: data.liveRoom,
      streams,
      watchUrl,
    };
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
