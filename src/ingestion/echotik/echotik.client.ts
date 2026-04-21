import axios, { AxiosInstance } from 'axios';
import { logger } from '../../logger';

const log = logger.child({ module: 'echotik-client' });

const ECHOTIK_BASE  = 'https://open.echotik.live/api/v3/echotik/';
const RATE_LIMIT_MS = 1_100; // ~1 req/s — safe under their limits

// ── Raw API shapes ─────────────────────────────────────────────────────────────

export interface EchoTikCoverImage {
  url: string;
  index: number;
}

/**
 * Raw product record from /product/list or /product/detail.
 * cover_url is a JSON-encoded string of EchoTikCoverImage[].
 * desc_detail, sale_props, skus, specification are also JSON strings.
 */
export interface EchoTikRawProduct {
  product_id: string;
  product_name: string;
  region: string;

  category_id: string;
  category_l2_id: string;
  category_l3_id: string;

  /** JSON-encoded EchoTikCoverImage[] */
  cover_url: string | EchoTikCoverImage[] | null;

  min_price: number;
  max_price: number;
  spu_avg_price: number;
  product_commission_rate: number; // decimal — e.g. 0.13 = 13%

  product_rating: number;          // 0–5 scale (e.g. 4.9)
  review_count: number;

  free_shipping: 0 | 1;
  is_s_shop: 0 | 1;
  off_mark: 0 | 1;
  sales_trend_flag: 0 | 1 | 2;    // 0=stable 1=up 2=down
  sales_flag: 0 | 1 | 2;          // 0=none 1=video 2=live

  seller_id: string;
  discount: number | null;

  first_crawl_dt: number;          // yyyyMMdd
  last_crawl_dt: number;

  /** JSON-encoded description blocks */
  desc_detail: string | null;
  /** JSON-encoded variant property definitions */
  sale_props: string | null;
  /** JSON-encoded SKU records */
  skus: string | null;
  /** JSON-encoded spec key/value pairs */
  specification: string | null;

  // ── All time ──────────────────────────────────────────────────────────────
  total_sale_cnt: number;
  total_sale_gmv_amt: number;
  total_ifl_cnt: number;
  total_video_cnt: number;
  total_live_cnt: number;
  total_views_cnt: number;

  // ── Windowed (1d / 7d / 15d / 30d / 60d / 90d) ────────────────────────
  total_sale_1d_cnt: number;
  total_sale_7d_cnt: number;
  total_sale_15d_cnt: number;
  total_sale_30d_cnt: number;
  total_sale_60d_cnt: number;
  total_sale_90d_cnt: number;

  total_sale_gmv_1d_amt: number;
  total_sale_gmv_7d_amt: number;
  total_sale_gmv_15d_amt: number;
  total_sale_gmv_30d_amt: number;
  total_sale_gmv_60d_amt: number;
  total_sale_gmv_90d_amt: number;

  total_video_1d_cnt: number;
  total_video_7d_cnt: number;
  total_video_30d_cnt: number;
  total_video_90d_cnt: number;

  total_ifl_video_1d_cnt: number;
  total_ifl_video_7d_cnt: number;
  total_ifl_video_30d_cnt: number;
  total_ifl_video_90d_cnt: number;

  total_ifl_live_1d_cnt: number;
  total_ifl_live_7d_cnt: number;
  total_ifl_live_30d_cnt: number;
  total_ifl_live_90d_cnt: number;

  total_live_1d_cnt: number;
  total_live_7d_cnt: number;
  total_live_30d_cnt: number;
  total_live_90d_cnt: number;

  total_live_sale_7d_cnt: number;
  total_live_sale_30d_cnt: number;
  total_live_sale_gmv_7d_amt: number;
  total_live_sale_gmv_30d_amt: number;

  total_views_1d_cnt: number;
  total_views_7d_cnt: number;
  total_views_30d_cnt: number;
  total_views_90d_cnt: number;
}

export interface EchoTikRawComment {
  review_id: string;
  product_id: string;
  display_text: string;
  rating: number;                   // 1–5
  review_timestamp: number;         // ms epoch
  sku_id: string;
  sku_specification: string;
}

export interface EchoTikRawVideo {
  video_id: string;
  video_title: string;
  cover_url: string;
  play_cnt: number;
  like_cnt: number;
  comment_cnt: number;
  share_cnt: number;
  sale_cnt: number;
  sale_gmv_amt: number;
  user_id: string;
  unique_id: string;
  create_time: number;
}

export interface EchoTikListParams {
  region?: string;
  page_num?: number;
  page_size?: number;
  /** Sort field: 1=total_sale_cnt 2=gmv 3=avg_price 4=7d_sales 5=30d_sales 6=7d_gmv 7=30d_gmv */
  product_sort_field?: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  /** Sort order: 0=asc 1=desc */
  sort_type?: 0 | 1;
  category_id?: string;
  category_l2_id?: string;
  category_l3_id?: string;
  min_total_sale_30d_cnt?: number;
  sales_trend_flag?: 0 | 1 | 2;
  sales_flag?: 0 | 1 | 2;
  min_product_rating?: number;
}

export interface EchoTikRanklistParams {
  region?: string;
  date: string;              // yyyy-MM-dd (daily=any date, weekly=Monday, monthly=1st)
  rank_type: 1 | 2 | 3;     // 1=daily 2=weekly 3=monthly
  product_rank_field: 1 | 2; // 1=sales_cnt 2=creator_cnt
  page_num?: number;
  page_size?: number;
  category_id?: string;
}

// ── Client ────────────────────────────────────────────────────────────────────

export class EchoTikClient {
  private readonly client: AxiosInstance;
  private readonly region: string;
  private lastRequestAt = 0;

  constructor(region = 'US') {
    this.region = region;

    const username = process.env.ECHOTIK_USERNAME;
    const password = process.env.ECHOTIK_PASSWORD;

    if (!username || !password) {
      log.warn('EchoTikClient: ECHOTIK_USERNAME or ECHOTIK_PASSWORD not set — requests will fail.');
    }

    const token = username && password
      ? Buffer.from(`${username}:${password}`).toString('base64')
      : '';

    this.client = axios.create({
      baseURL: ECHOTIK_BASE,
      timeout: 20_000,
      headers: {
        Authorization: `Basic ${token}`,
        Accept: 'application/json',
      },
    });
  }

  // ── Rate limiting ──────────────────────────────────────────────────────────

  private async throttle(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < RATE_LIMIT_MS) {
      await sleep(RATE_LIMIT_MS - elapsed);
    }
    this.lastRequestAt = Date.now();
  }

  private async request<T>(
    path: string,
    params: Record<string, unknown> = {}
  ): Promise<T | null> {
    await this.throttle();
    try {
      const res = await this.client.get<{ code: number; message: string; data: T; requestId: string }>(path, { params });
      if (res.data?.code !== 0) {
        log.warn(`EchoTik non-zero code on ${path}`, { code: res.data?.code, message: res.data?.message });
        return null;
      }
      return res.data.data;
    } catch (err: any) {
      const status  = err.response?.status;
      const message = err.response?.data?.message || err.message;
      log.error(`EchoTik request failed: ${path}`, { status, message });
      return null;
    }
  }

  // ── Product endpoints ──────────────────────────────────────────────────────

  /**
   * GET /product/list — Primary ingestion source.
   * T+1 updated. Returns a full product record including desc_detail, skus, etc.
   * page_size max is 10.
   */
  async listProducts(params: EchoTikListParams = {}): Promise<EchoTikRawProduct[]> {
    const data = await this.request<EchoTikRawProduct[]>('product/list', {
      region: params.region ?? this.region,
      page_num:  params.page_num  ?? 1,
      page_size: params.page_size ?? 10,
      ...(params.product_sort_field !== undefined && { product_sort_field: params.product_sort_field }),
      ...(params.sort_type          !== undefined && { sort_type: params.sort_type }),
      ...(params.category_id        !== undefined && { category_id: params.category_id }),
      ...(params.category_l2_id     !== undefined && { category_l2_id: params.category_l2_id }),
      ...(params.category_l3_id     !== undefined && { category_l3_id: params.category_l3_id }),
      ...(params.min_total_sale_30d_cnt !== undefined && { min_total_sale_30d_cnt: params.min_total_sale_30d_cnt }),
      ...(params.sales_trend_flag   !== undefined && { sales_trend_flag: params.sales_trend_flag }),
      ...(params.sales_flag         !== undefined && { sales_flag: params.sales_flag }),
      ...(params.min_product_rating !== undefined && { min_product_rating: params.min_product_rating }),
    });
    return data ?? [];
  }

  /**
   * GET /product/ranklist — Best-selling or most-promoted product rankings.
   * Returns incremental data for the selected period (not cumulative totals).
   */
  async getRanklist(params: EchoTikRanklistParams): Promise<EchoTikRawProduct[]> {
    const data = await this.request<EchoTikRawProduct[]>('product/ranklist', {
      region:              params.region ?? this.region,
      date:                params.date,
      rank_type:           params.rank_type,
      product_rank_field:  params.product_rank_field,
      page_num:            params.page_num  ?? 1,
      page_size:           params.page_size ?? 10,
      ...(params.category_id && { category_id: params.category_id }),
    });
    return data ?? [];
  }

  /**
   * GET /product/detail — Full product enrichment for up to 10 product IDs.
   * Returns desc_detail, sale_props, specification, skus with real_price.
   * NOTE: /product/list already includes these fields, so this is only
   * needed if you have IDs from ranklist (which doesn't return them).
   */
  async getProductDetail(productIds: string[]): Promise<EchoTikRawProduct[]> {
    if (productIds.length === 0) return [];
    const ids = productIds.slice(0, 10).join(',');
    const data = await this.request<EchoTikRawProduct[]>('product/detail', { product_ids: ids });
    return data ?? [];
  }

  /**
   * GET /product/comment — Verified buyer reviews for a product.
   * page_size max is 10.
   */
  async getProductComments(
    productId: string,
    region?: string,
    pageNum = 1,
    pageSize = 10
  ): Promise<EchoTikRawComment[]> {
    const data = await this.request<EchoTikRawComment[]>('product/comment', {
      product_id: productId,
      region:     region ?? this.region,
      page_num:   pageNum,
      page_size:  pageSize,
    });
    return data ?? [];
  }

  /**
   * GET /product/video/list — TikTok videos driving sales for this product.
   */
  async getProductVideos(
    productId: string,
    region?: string,
    pageNum = 1,
    pageSize = 10
  ): Promise<EchoTikRawVideo[]> {
    const data = await this.request<EchoTikRawVideo[]>('product/video/list', {
      product_id: productId,
      region:     region ?? this.region,
      page_num:   pageNum,
      page_size:  pageSize,
    });
    return data ?? [];
  }

  /**
   * Connectivity check — fetches 1 product with minimal params.
   */
  async ping(): Promise<boolean> {
    if (!process.env.ECHOTIK_USERNAME || !process.env.ECHOTIK_PASSWORD) return false;
    try {
      const products = await this.listProducts({ page_num: 1, page_size: 1 });
      return products.length >= 0; // even 0 is a valid response
    } catch {
      return false;
    }
  }
  /**
   * Exchanges volces.com cover URLs for 24-hour temporary accessible URLs.
   * Does NOT consume API credits.
   */
  async getTempCoverUrls(coverUrls: string[]): Promise<Record<string, string>> {
    const eligibleUrls = coverUrls.filter(url => 
      url.includes('echosell-images.tos-ap-southeast-1.volces.com')
    );
    if (eligibleUrls.length === 0) return {};

    try {
      await this.throttle();
      const params = new URLSearchParams();
      // Append each URL as a separate 'cover_urls' query param
      eligibleUrls.forEach(url => params.append('cover_urls', url));
      
      const res = await this.client.get<{ code: number; data: Record<string, string> }>(
        `batch/cover/download?${params.toString()}`
      );
      return res.data?.data || {};
    } catch (err: any) {
      log.error('Failed to exchange cover URLs', { message: err.message });
      return {};
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
