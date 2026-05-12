/**
 * TikTokWebcastService
 *
 * Hits TikTok's internal webcast / live API endpoints directly to fetch
 * products pinned to an active live room and their in-session sold counts.
 *
 * TikTok doesn't publish these endpoints publicly, but they're the same ones
 * the TikTok app and browser use — so they work for any public live room
 * without authentication, as long as we send realistic browser headers.
 *
 * Endpoints tried (in order):
 *   1. webcast.us.tiktok.com/webcast/room/product/list/   — primary, US CDN
 *   2. webcast.tiktok.com/webcast/room/product/list/      — global fallback
 *   3. www.tiktok.com/api/live/detail/                    — room detail fallback
 *      (sometimes embeds product list in `promProductList`)
 */

import { logger } from '../logger';

const log = logger.child({ module: 'tiktok-webcast' });

// ── Types ──────────────────────────────────────────────────────────────────────

export interface WebcastProduct {
  productId:   string;
  title:       string;
  imageUrl:    string;
  price:       number;       // in USD (or local currency)
  currency:    string;
  soldInLive:  number;       // units sold during THIS live session (resets per live)
  totalSold:   number;       // all-time sold count on the product page
  stock:       number | null;
  productUrl:  string;
  inStock:     boolean;
  rating?:     number;
}

interface RawWebcastProduct {
  product_id?: string | number;
  id?: string | number;
  name?: string;
  title?: string;
  images?: Array<{ url_list?: string[] }>;
  cover?: { url_list?: string[] };
  price_info?: Array<{ currency?: string; price?: string | number; price_type?: number }>;
  price?: string | number;
  sold_count?: number;          // in-live sales
  real_sold_count?: number;     // total sales
  sales?: number;
  total_sales?: number;
  stock?: number;
  stock_info?: { stock_count?: number; out_of_stock?: boolean };
  product_link?: string;
  url?: string;
  comment_count?: number;
  star?: number;
  score?: string;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept':          'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer':         'https://www.tiktok.com/',
  'Origin':          'https://www.tiktok.com',
  'sec-ch-ua':       '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  'sec-ch-ua-mobile':'?0',
  'sec-ch-ua-platform': '"macOS"',
  'sec-fetch-dest':  'empty',
  'sec-fetch-mode':  'cors',
  'sec-fetch-site':  'same-site',
};

const AID = '1988'; // TikTok web app ID

// ── Service ───────────────────────────────────────────────────────────────────

export const TikTokWebcastService = {

  /**
   * Fetch products pinned to a live room.
   * Returns [] if the room has no products or if all endpoints fail.
   *
   * @param roomId  The live room ID (from ScrapeCreators liveRoomUserInfo.roomId / liveRoom.id)
   * @param handle  The creator handle — used for product URL construction and logging
   */
  async getLiveProducts(roomId: string, handle: string): Promise<WebcastProduct[]> {
    if (!roomId) {
      log.debug('getLiveProducts: no roomId', { handle });
      return [];
    }

    const cleanHandle = handle.replace(/^@/, '').trim().toLowerCase();

    // ── Attempt 1: webcast product list (US CDN) ────────────────────────────
    try {
      const products = await this._fetchProductList(
        `https://webcast.us.tiktok.com/webcast/room/product/list/`,
        roomId,
        cleanHandle,
      );
      if (products.length > 0) return products;
    } catch (err) {
      log.debug('webcast US endpoint failed', { handle: cleanHandle, err: String(err) });
    }

    // ── Attempt 2: webcast product list (global CDN) ────────────────────────
    try {
      const products = await this._fetchProductList(
        `https://webcast.tiktok.com/webcast/room/product/list/`,
        roomId,
        cleanHandle,
      );
      if (products.length > 0) return products;
    } catch (err) {
      log.debug('webcast global endpoint failed', { handle: cleanHandle, err: String(err) });
    }

    // ── Attempt 3: room detail endpoint (sometimes includes product list) ───
    try {
      const products = await this._fetchFromRoomDetail(roomId, cleanHandle);
      if (products.length > 0) return products;
    } catch (err) {
      log.debug('room detail endpoint failed', { handle: cleanHandle, err: String(err) });
    }

    log.info('getLiveProducts: all endpoints failed or returned empty', { handle: cleanHandle, roomId });
    return [];
  },

  // ── Private ────────────────────────────────────────────────────────────────

  async _fetchProductList(
    baseUrl: string,
    roomId: string,
    handle: string,
  ): Promise<WebcastProduct[]> {
    const params = new URLSearchParams({
      aid:            AID,
      room_id:        roomId,
      count:          '30',
      cursor:         '0',
      priority_region: 'US',
      region:         'US',
    });

    const url = `${baseUrl}?${params.toString()}`;
    log.debug('Fetching webcast products', { url: baseUrl, roomId });

    const res = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal:  AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      log.debug('webcast product list non-ok', { status: res.status, url: baseUrl });
      return [];
    }

    const json = await res.json() as any;

    // status_code 0 = success in TikTok's internal API
    if (json?.status_code !== 0 && json?.statusCode !== 0 && !json?.data?.products) {
      log.debug('webcast product list bad status', { status_code: json?.status_code, url: baseUrl });
      return [];
    }

    const raw: RawWebcastProduct[] = json?.data?.products || json?.products || [];
    return raw.map((p) => normalizeProduct(p, handle));
  },

  async _fetchFromRoomDetail(roomId: string, handle: string): Promise<WebcastProduct[]> {
    const params = new URLSearchParams({
      aid:    AID,
      roomID: roomId,
    });

    const url = `https://www.tiktok.com/api/live/detail/?${params.toString()}`;
    log.debug('Fetching room detail', { roomId });

    const res = await fetch(url, {
      headers: { ...BROWSER_HEADERS, 'Referer': `https://www.tiktok.com/@${handle}/live` },
      signal:  AbortSignal.timeout(10_000),
    });

    if (!res.ok) return [];

    const json = await res.json() as any;
    const roomData = json?.LiveRoomInfo || json?.data || json;

    // Products sometimes appear under promProductList or product_list
    const raw: RawWebcastProduct[] =
      roomData?.promProductList || roomData?.product_list || roomData?.products || [];

    return Array.isArray(raw) ? raw.map((p) => normalizeProduct(p, handle)) : [];
  },
};

// ── Normalizer ────────────────────────────────────────────────────────────────

function normalizeProduct(p: RawWebcastProduct, handle: string): WebcastProduct {
  const productId = String(p.product_id || p.id || '');

  // Image: products come with url_list arrays
  const imageUrl =
    p.images?.[0]?.url_list?.[0] ||
    p.cover?.url_list?.[0] ||
    '';

  // Price: price_info array with price_type (0 = original, 1 = sale)
  let price = 0;
  let currency = 'USD';
  if (Array.isArray(p.price_info) && p.price_info.length > 0) {
    // prefer sale price (type 1), fall back to original (type 0)
    const sale     = p.price_info.find((pi) => pi.price_type === 1);
    const original = p.price_info.find((pi) => pi.price_type === 0);
    const chosen   = sale || original || p.price_info[0];
    price    = Number(chosen.price ?? 0) / 100; // TikTok stores in cents
    currency = chosen.currency || 'USD';
  } else if (p.price != null) {
    price = Number(p.price) / 100;
  }

  // Sales
  const soldInLive = Number(p.sold_count ?? p.sales ?? 0);
  const totalSold  = Number(p.real_sold_count ?? p.total_sales ?? soldInLive);

  // Stock
  const stock =
    p.stock_info?.stock_count != null ? Number(p.stock_info.stock_count) :
    p.stock != null ? Number(p.stock) : null;

  const inStock = p.stock_info?.out_of_stock !== true && (stock == null || stock > 0);

  // Product URL
  const productUrl =
    p.product_link ||
    p.url ||
    (productId ? `https://www.tiktok.com/@${handle}/shop?productId=${productId}` : `https://www.tiktok.com/@${handle}/shop`);

  // Rating
  const rating = p.star != null ? Number(p.star) / 10 : // TikTok stores as 0-50
                 p.score != null ? Number(p.score) : undefined;

  return {
    productId,
    title:      p.name || p.title || '',
    imageUrl,
    price,
    currency,
    soldInLive,
    totalSold,
    stock,
    inStock,
    productUrl,
    rating,
  };
}
