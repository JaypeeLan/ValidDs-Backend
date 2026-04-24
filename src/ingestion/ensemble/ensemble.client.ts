import axios, { AxiosInstance } from 'axios';
import { logger } from '../../logger';

const log = logger.child({ module: 'ensemble-client' });

/**
 * EnsembleData HTTP Client
 *
 * Wraps the TikTok endpoints provided by ensembledata.com.
 * Requires ENSEMBLE_API_KEY in .env.
 */

const ENSEMBLE_BASE = 'https://ensembledata.com/apis/tt';
const RATE_LIMIT_MS = 2000;

export interface EnsemblePost {
  aweme_id: string;
  desc?: string;
  create_time?: number;
  author?: {
    uid?: string;
    sec_uid?: string;
    unique_id?: string;
    nickname?: string;
    signature?: string;
    follower_count?: number;
    following_count?: number;
    total_favorited?: number;
    region?: string;
    verification_type?: number;
    avatar_thumb?: { url_list?: string[] };
  };
  statistics?: {
    play_count?: number;
    digg_count?: number;
    comment_count?: number;
    share_count?: number;
  };
  video?: {
    cover?: { url_list?: string[] };
    play_addr?: { url_list?: string[] };
  };
  text_extra?: Array<{ hashtag_name?: string }>;
}

export interface EnsembleComment {
  cid: string;
  text: string;
  digg_count: number;
  create_time: number;
  reply_comment_total: number;
}

export interface KeywordFullSearchParams {
  name: string;
  days: 1 | 7 | 30 | 90 | 180;
  cursor?: number;
  period?: 1 | 7 | 30 | 90 | 180;
  sorting?: 0 | 1;
  country?: string;
  matchExactly?: boolean;
}

export class EnsembleClient {
  private readonly client: AxiosInstance;
  private readonly region: string;
  private lastRequestAt = 0;

  constructor(region = 'US') {
    this.region = region;
    const apiKey = process.env.ENSEMBLE_API_KEY;

    if (!apiKey) {
      log.warn('EnsembleData client initialized without an API key. Requests will fail.');
    }

    this.client = axios.create({
      baseURL: ENSEMBLE_BASE,
      params: { token: apiKey },
      timeout: 15000,
    });
  }

  private async throttle(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < RATE_LIMIT_MS) await sleep(RATE_LIMIT_MS - elapsed);
    this.lastRequestAt = Date.now();
  }

  /**
   * Search posts by keyword
   */
  async searchPosts(keyword: string, cursor = 0): Promise<EnsemblePost[]> {
    await this.throttle();
    try {
      const res = await this.client.get('/keyword/search', {
        params: {
          name: keyword,
          cursor,
          period: 7,
          country: this.region,
        },
      });
      const items = res.data?.data?.items || res.data?.data?.videos || res.data?.data?.data || [];
      const data = items.map((item: any) => item.aweme_info ? item.aweme_info : item);
      
      if (data.length === 0) {
        log.warn(`EnsembleData searchPosts returned 0 items for "${keyword}"`, { 
          response: JSON.stringify(res.data).slice(0, 500),
          region: this.region 
        });
      }
      log.debug(`Fetched ${data.length} posts for keyword ${keyword} via EnsembleData`);
      return data;
    } catch (err) {
      log.error('EnsembleData searchPosts failed', err);
      return [];
    }
  }

  async searchKeywordFull(params: KeywordFullSearchParams): Promise<{ posts: EnsemblePost[]; nextCursor: number | null }> {
    await this.throttle();
    try {
      const res = await this.client.get('/keyword/full-search', {
        params: {
          name: params.name,
          days: params.days,
          cursor: params.cursor ?? 0,
          period: params.period ?? params.days,
          sorting: params.sorting ?? 0,
          country: (params.country ?? this.region).toLowerCase(),
          match_exactly: params.matchExactly ?? false,
        },
      });

      const payload = res.data?.data ?? {};
      const rawPosts = payload?.items ?? payload?.videos ?? payload?.aweme_list ?? payload?.data ?? [];
      const posts = rawPosts.map((item: any) => item.aweme_info ? item.aweme_info : item);
      const nextCursor = payload?.nextCursor ?? payload?.cursor ?? null;

      log.debug(`Fetched ${posts.length} posts via keyword/full-search for "${params.name}"`);
      return { posts, nextCursor };
    } catch (err: any) {
      const details = err.response?.data || String(err);
      log.warn('EnsembleData keyword/full-search failed', { err: details, name: params.name });
      return { posts: [], nextCursor: null };
    }
  }

  /**
   * Fetch metadata for a single TikTok post by its public TikTok URL.
   * EnsembleData's `/post/info` takes the post URL (not the aweme_id) as a
   * query parameter, e.g.
   *   GET /tt/post/info?url=https://www.tiktok.com/@handle/video/1234567890
   *
   * Used to refresh signed video / thumbnail / avatar URLs that have aged
   * past the TikTok CDN signature expiry (~1–6h).
   *
   * Returns `null` when the post can't be fetched.
   */
  async getPostInfo(postUrl: string): Promise<EnsemblePost | null> {
    if (!postUrl) return null;
    await this.throttle();
    try {
      const res = await this.client.get('/post/info', {
        params: { url: postUrl },
      });
      // EnsembleData wraps the post in `{ data: [post] }` (single-element array).
      const raw = res.data?.data;
      const candidate: any = Array.isArray(raw)
        ? raw[0]
        : (raw?.aweme_detail || raw?.aweme_info || raw?.post || raw?.detail || raw);
      if (candidate && (candidate.aweme_id || candidate.id)) {
        if (!candidate.aweme_id && candidate.id) candidate.aweme_id = candidate.id;
        return candidate as EnsemblePost;
      }
      log.debug('EnsembleData getPostInfo returned no post', { postUrl });
      return null;
    } catch (err: any) {
      const status = err.response?.status;
      log.warn('EnsembleData getPostInfo failed', {
        postUrl,
        status,
        err: err.response?.data || String(err),
      });
      return null;
    }
  }

  /**
   * Fetch full user profile (incl. stats: follower/following/heart counts)
   * via `/tt/user/info?username=<handle>`.
   *
   * The `/post/info` response DOES NOT include real follower counts — the
   * `author` block returned there is a trimmed post-level snapshot. This call
   * is the only way we get authoritative follower/following/totalLikes/diggs
   * for a primaryCreator.
   *
   * Response shape (observed):
   *   {
   *     data: {
   *       user:  { unique_id, nickname, signature, avatar_*, custom_verify, … },
   *       stats: { followerCount, followingCount, heartCount, diggCount, … }
   *     }
   *   }
   */
  async getUserInfo(username: string): Promise<{
    handle?: string;
    displayName?: string;
    bio?: string;
    avatarUrl?: string;
    verified?: boolean;
    region?: string;
    tiktokUserId?: string;
    followers?: number;
    following?: number;
    totalLikes?: number;
    totalDiggs?: number;
  } | null> {
    if (!username) return null;
    await this.throttle();
    try {
      const res = await this.client.get('/user/info', { params: { username } });
      const payload = res.data?.data;
      if (!payload) return null;

      const user  = payload.user  ?? {};
      const stats = payload.stats ?? {};

      return {
        handle:       user.unique_id,
        displayName:  user.nickname,
        bio:          user.signature,
        avatarUrl:    user.avatar_thumb?.url_list?.[0] ?? user.avatar_medium?.url_list?.[0],
        verified:     typeof user.verification_type === 'number'
                        ? user.verification_type > 0
                        : Boolean(user.custom_verify) || Boolean(user.verified),
        region:       user.region,
        tiktokUserId: user.uid ?? user.sec_uid,
        followers:    stats.followerCount  ?? stats.follower_count,
        following:    stats.followingCount ?? stats.following_count,
        totalLikes:   stats.heartCount     ?? stats.heart_count,
        totalDiggs:   stats.diggCount      ?? stats.digg_count,
      };
    } catch (err: any) {
      const status = err.response?.status;
      log.warn('EnsembleData getUserInfo failed', {
        username,
        status,
        err: err.response?.data || String(err),
      });
      return null;
    }
  }

  /**
   * Fetch top comments for a specific post (aweme_id)
   */
  async getPostComments(awemeId: string, cursor = 0): Promise<EnsembleComment[]> {
    await this.throttle();
    try {
      const res = await this.client.get('/post/comments', {
        params: {
          aweme_id: awemeId,
          cursor,
        },
      });
      const comments = res.data?.data?.comments || [];
      log.debug(`Fetched ${comments.length} comments for post ${awemeId} via EnsembleData`);
      return comments;
    } catch (err: any) {
      // It's normal for some posts to have comments disabled or fail
      const details = err.response?.data || String(err);
      log.warn(`EnsembleData getPostComments failed for ${awemeId}`, { err: details });
      return [];
    }
  }

  /**
   * Fetch posts for a specific hashtag with cursor-based pagination.
   * Returns posts and the nextCursor provided by EnsembleData for the next page.
   * Response structure: { data: { nextCursor: number, data: EnsemblePost[] } }
   */
  async getHashtagPosts(
    hashtag: string,
    cursor = 0
  ): Promise<{ posts: EnsemblePost[]; nextCursor: number | null }> {
    await this.throttle();
    try {
      const res   = await this.client.get('/hashtag/posts', {
        params: { name: hashtag, cursor },
      });
      const inner      = res.data?.data;          // { nextCursor, data: [...] }
      const rawPosts   = inner?.data ?? [];       // the actual posts array
      const posts      = rawPosts.map((item: any) => item.aweme_info ? item.aweme_info : item);
      const nextCursor = inner?.nextCursor ?? null;
      
      if (posts.length === 0) {
        log.warn(`EnsembleData getHashtagPosts returned 0 items for #${hashtag}`, {
          response: JSON.stringify(res.data).slice(0, 500)
        });
      }
      
      log.debug(`Fetched ${posts.length} posts for #${hashtag} at cursor=${cursor}, nextCursor=${nextCursor}`);
      return { posts, nextCursor };
    } catch (err: any) {
      const status  = err.response?.status;
      const body    = JSON.stringify(err.response?.data ?? null);
      const message = err.message ?? String(err);
      const url     = err.config?.url ?? '/hashtag/posts';
      log.error(`EnsembleData getHashtagPosts failed for #${hashtag} cursor=${cursor}`, {
        status, message, body, url,
      });
      return { posts: [], nextCursor: null };
    }
  }

  async ping(): Promise<boolean> {
    if (!process.env.ENSEMBLE_API_KEY) return false;
    try {
      // Just a light request to check auth
      const data = await this.searchPosts('test');
      return data.length >= 0;
    } catch {
      return false;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
