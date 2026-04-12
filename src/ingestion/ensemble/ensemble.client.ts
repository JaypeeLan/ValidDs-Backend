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
      const data = res.data?.data?.items || res.data?.data?.videos || [];
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
      const posts = payload?.items ?? payload?.videos ?? payload?.aweme_list ?? [];
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
      const posts      = inner?.data ?? [];       // the actual posts array
      const nextCursor = inner?.nextCursor ?? null;
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
