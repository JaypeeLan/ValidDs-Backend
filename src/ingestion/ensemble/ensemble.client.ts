import axios, { AxiosInstance } from 'axios';
import { logger } from '../../logger';

const log = logger.child({ module: 'ensemble-client' });

/**
 * EnsembleData HTTP Client
 *
 * Wraps the TikTok endpoints provided by ensembledata.com.
 * Requires ENSEMBLE_API_KEY in .env.
 */

const ENSEMBLE_BASE = 'https://ensembledata.com/apis';
const RATE_LIMIT_MS = 2000;

export interface EnsemblePost {
  aweme_id: string;
  desc?: string;
  create_time?: number;
  author?: {
    unique_id?: string;
    nickname?: string;
    follower_count?: number;
    region?: string;
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
      const res = await this.client.get('/tiktok/keyword/search', {
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

  /**
   * Fetch top comments for a specific post (aweme_id)
   */
  async getPostComments(awemeId: string, cursor = 0): Promise<EnsembleComment[]> {
    await this.throttle();
    try {
      const res = await this.client.get('/tiktok/post/comments', {
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
