import axios, { AxiosInstance } from 'axios';
import { logger } from '../../logger';

const log = logger.child({ module: 'creative-center-client' });

/**
 * TikTok Creative Center HTTP client — v2
 *
 * Two modes:
 *
 *  Mode A — RapidAPI Creative Center (recommended, production-ready):
 *    Set RAPIDAPI_KEY in .env.
 *    Uses https://rapidapi.com/Lundehund/api/tiktok-creative-center-api
 *    Manages msToken/session automatically. Free tier available.
 *
 *  Mode B — Session cookie (dev/testing):
 *    Set TIKTOK_MS_TOKEN in .env.
 *    Open ads.tiktok.com in Chrome → DevTools → Application → Cookies → copy msToken.
 *    Tokens last several hours.
 *
 *  Mode None — Neither set: all endpoints return empty arrays (no crash).
 */

const CC_BASE = 'https://ads.tiktok.com';
const RAPIDAPI_BASE = process.env.RAPIDAPI_BASE_URL ?? 'https://tiktok-creative-center-api.p.rapidapi.com';
const RAPIDAPI_HOST = process.env.RAPIDAPI_HOST ?? 'tiktok-creative-center-api.p.rapidapi.com';
const RATE_LIMIT_MS = 1500;

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en',
  Origin: 'https://ads.tiktok.com',
};

export interface CCTopAd {
  id: string;
  video_info: { vid: string; url?: string; cover?: string; duration?: number };
  ad_title?: string;
  brand_name?: string;
  industry_name?: string;
  like_count?: number;
  comment_count?: number;
  share_count?: number;
  play_count?: number;
  first_shown_date?: number;
  last_shown_date?: number;
  country_code?: string[];
  landing_page?: string;
  cost?: number;
  ctr?: number;
}

export interface CCHashtag {
  hashtag_name: string;
  publish_cnt?: number;
  video_views?: number;
  rank?: number;
  trend?: number[];
}

export interface CCTrendingVideo {
  item_id?: string;
  desc?: string;
  create_time?: number;
  author?: { unique_id?: string; nickname?: string; follower_count?: number; verified?: boolean; region?: string };
  stats?: { play_count?: number; digg_count?: number; comment_count?: number; share_count?: number };
  video?: { cover?: string; play_addr?: { url_list?: string[] } };
  challenges?: Array<{ title?: string }>;
  textExtra?: Array<{ hashtagName?: string }>;
}

export interface CCKeywordTrend {
  keyword: string;
  search_trend?: number[];
  related_hashtags?: string[];
  country_code?: string;
}

export class CreativeCenterClient {
  private readonly client: AxiosInstance;
  private readonly region: string;
  private readonly mode: 'rapidapi' | 'session' | 'none';
  private lastRequestAt = 0;
  private readonly rapidApiPaths = {
    topAds: process.env.RAPIDAPI_TOP_ADS_PATH ?? '/api/trending/ads',
    trendingHashtags: process.env.RAPIDAPI_TRENDING_HASHTAGS_PATH ?? '/api/trending/hashtag',
    trendingVideos: process.env.RAPIDAPI_TRENDING_VIDEOS_PATH ?? '/api/trending/video',
    keywordTrends: process.env.RAPIDAPI_KEYWORD_TRENDS_PATH ?? '/api/trending/keyword',
  };

  constructor(region = 'US') {
    this.region = region;
    const rapidApiKey = process.env.RAPIDAPI_KEY;
    const msToken = process.env.TIKTOK_MS_TOKEN;

    if (rapidApiKey) {
      this.mode = 'rapidapi';
      this.client = axios.create({
        baseURL: RAPIDAPI_BASE,
        headers: {
          'X-RapidAPI-Key': rapidApiKey,
          'X-RapidAPI-Host': RAPIDAPI_HOST,
          Accept: 'application/json',
        },
        timeout: 15000,
      });
      log.info('Creative Center client: RapidAPI mode', { baseURL: RAPIDAPI_BASE, host: RAPIDAPI_HOST });
    } else if (msToken) {
      this.mode = 'session';
      this.client = axios.create({
        baseURL: CC_BASE,
        headers: { ...BROWSER_HEADERS, Cookie: `msToken=${msToken}` },
        timeout: 15000,
      });
      log.info('Creative Center client: session cookie mode');
    } else {
      this.mode = 'none';
      this.client = axios.create({ baseURL: CC_BASE, timeout: 15000 });
      log.warn('Creative Center: no RAPIDAPI_KEY or TIKTOK_MS_TOKEN — set one to get real data');
    }
  }

  private async throttle(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < RATE_LIMIT_MS) await sleep(RATE_LIMIT_MS - elapsed);
    this.lastRequestAt = Date.now();
  }

  async getTopAds(params: { period?: 7 | 30 | 180; page?: number; limit?: number; industry?: string } = {}): Promise<CCTopAd[]> {
    if (this.mode === 'none') return [];
    await this.throttle();
    const { period = 30, page = 1, limit = 20, industry } = params;
    try {
      if (this.mode === 'rapidapi') {
        const res = await this.client.get<any>(this.rapidApiPaths.topAds, {
          params: { period, page, limit, country_code: this.region, order_by: 'ctr', ...(industry ? { industry_id: industry } : {}) },
        });
        const data = res.data;
        let ads: CCTopAd[] = [];
        if (Array.isArray(data)) {
          ads = data;
        } else {
          ads = data?.data?.materials ?? data?.data?.ads ?? data?.data?.list ?? data?.data ?? data?.result ?? data?.list ?? [];
        }
        log.debug(`Fetched ${ads.length} top ads via RapidAPI`);
        return ads;
      } else {
        const res = await this.client.get<{ data?: { list?: CCTopAd[] } }>('/creative_radar_api/v1/top_ads/v2/list', {
          params: { period, page, limit, country_code: this.region, order_by: 'last_shown_date', ...(industry ? { industry_id: industry } : {}) },
        });
        const ads = res.data?.data?.list ?? [];
        log.debug(`Fetched ${ads.length} top ads via session`);
        return ads;
      }
    } catch (err) {
      log.error('getTopAds failed', err);
      return [];
    }
  }

  async getTopAdsAll(params: { period?: 7 | 30 | 180; maxPages?: number; limit?: number; industry?: string } = {}): Promise<CCTopAd[]> {
    const { maxPages = 5, ...rest } = params;
    const all: CCTopAd[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const batch = await this.getTopAds({ ...rest, page });
      all.push(...batch);
      if (batch.length < (params.limit ?? 20)) break;
    }
    log.info(`Collected ${all.length} top ads`, { mode: this.mode });
    return all;
  }

  async getTrendingHashtags(params: { period?: 7 | 30 | 120; limit?: number } = {}): Promise<CCHashtag[]> {
    if (this.mode === 'none') return [];
    await this.throttle();
    const { period = 7, limit = 50 } = params;
    try {
      if (this.mode === 'rapidapi') {
        const res = await this.client.get<any>(this.rapidApiPaths.trendingHashtags, {
          params: { period, limit, country_code: this.region },
        });
        const data = res.data;
        let tags: CCHashtag[] = [];
        if (Array.isArray(data)) {
          tags = data;
        } else {
          tags = data?.data?.list ?? data?.data ?? data?.result ?? data?.list ?? [];
        }
        log.debug(`Fetched ${tags.length} trending hashtags via RapidAPI`);
        return tags;
      } else {
        const res = await this.client.get<{ data?: { list?: CCHashtag[] } }>('/creative_radar_api/v1/popular_trend/hashtag/list', {
          params: { period, limit, country_code: this.region },
        });
        const tags = res.data?.data?.list ?? [];
        log.debug(`Fetched ${tags.length} trending hashtags via session`);
        return tags;
      }
    } catch (err) {
      log.error('getTrendingHashtags failed', err);
      return [];
    }
  }

  async getTrendingVideos(params: { count?: number } = {}): Promise<CCTrendingVideo[]> {
    if (this.mode === 'none') return [];
    await this.throttle();
    const { count = 30 } = params;
    try {
      if (this.mode === 'rapidapi') {
        const res = await this.client.get<any>(this.rapidApiPaths.trendingVideos, {
          params: { count, region: this.region },
        });
        const data = res.data;
        let videos: CCTrendingVideo[] = [];
        if (Array.isArray(data)) {
          videos = data;
        } else {
          videos = data?.data?.videos ?? data?.data?.itemList ?? data?.data?.list ?? data?.data ?? data?.result ?? data?.itemList ?? data?.list ?? [];
        }
        log.debug(`Fetched ${videos.length} trending videos via RapidAPI`);
        return videos;
      } else {
        const ttClient = axios.create({
          baseURL: 'https://www.tiktok.com',
          headers: { ...BROWSER_HEADERS, Referer: 'https://www.tiktok.com/', Origin: 'https://www.tiktok.com', Cookie: `msToken=${process.env.TIKTOK_MS_TOKEN ?? ''}` },
          timeout: 15000,
        });
        const res = await ttClient.get<{ itemList?: CCTrendingVideo[] }>('/api/explore/item_list/', {
          params: { count, id: '1', type: 5, secUid: '', maxCursor: '0', minCursor: '0', sourceType: '12', appId: '1233', region: this.region, priority_region: this.region, language: 'en' },
        });
        const videos = res.data?.itemList ?? [];
        log.debug(`Fetched ${videos.length} trending videos via session`);
        return videos;
      }
    } catch (err) {
      log.warn('getTrendingVideos failed', { err: String(err) });
      return [];
    }
  }

  async getKeywordTrends(params: { period?: 7 | 30; limit?: number } = {}): Promise<CCKeywordTrend[]> {
    if (this.mode === 'none') return [];
    await this.throttle();
    const { period = 7, limit = 30 } = params;
    try {
      if (this.mode === 'rapidapi') {
        const res = await this.client.get<any>(this.rapidApiPaths.keywordTrends, {
          params: { period, limit, country_code: this.region },
        });
        const data = res.data;
        let kw: CCKeywordTrend[] = [];
        if (Array.isArray(data)) {
          kw = data;
        } else {
          kw = data?.data?.list ?? data?.data ?? data?.result ?? [];
        }
        log.debug(`Fetched ${kw.length} keyword trends via RapidAPI`);
        return kw;
      } else {
        const res = await this.client.get<{ data?: { list?: CCKeywordTrend[] } }>('/creative_radar_api/v1/keyword_trend/list', {
          params: { period, limit, country_code: this.region },
        });
        const kw = res.data?.data?.list ?? [];
        log.debug(`Fetched ${kw.length} keyword trends via session`);
        return kw;
      }
    } catch (err) {
      log.warn('getKeywordTrends failed — skipping', { err: String(err) });
      return [];
    }
  }

  async ping(): Promise<boolean> {
    if (this.mode === 'none') {
      log.warn('Creative Center ping: no credentials — set RAPIDAPI_KEY or TIKTOK_MS_TOKEN');
      return false;
    }
    try {
      const tags = await this.getTrendingHashtags({ period: 7, limit: 1 });
      return tags.length > 0;
    } catch {
      return false;
    }
  }

  getMode(): string { return this.mode; }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
