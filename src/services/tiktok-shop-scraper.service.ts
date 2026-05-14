/**
 * TikTokShopScraperService
 *
 * Gets TikTok Shop product sold counts for a creator/store.
 * Used for pre/post live snapshot delta → estimated GMV.
 *
 * **ScrapeCreators is not used here** — shop catalog / sold counts come from Apify only
 * (see `pro100chok/tiktok-shop-scraper-usage`). ScrapeCreators remains for **live** endpoints only
 * (`getUserLive`, `batchGetUserLive`) and optional profile enrichment (`getUserInfo`).
 *
 * Strategy:
 *   1. Apify `pro100chok/tiktok-shop-scraper-usage` (store type) when `tiktokUserId` is known
 *   2. Apify same actor (creator type) — profile-level fallback
 *
 * The `salesVolume` field is a lifetime total sold count.
 * Delta between two snapshots = units sold during that window = live GMV basis.
 *
 * Non-US stores (PH, ID, TH, etc.) may not be supported by the Apify shop scraper.
 * For those we return [] and GMV shows as "unavailable".
 */

import { ApifyClient } from 'apify-client';
import { env } from '../config/env.validation';
import { logger } from '../logger';

const log = logger.child({ module: 'tiktok-shop-scraper' });

const APIFY_ACTOR = 'pro100chok/tiktok-shop-scraper-usage';
const APIFY_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 3_000;

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ShopProduct {
  productId:   string;
  title:       string;
  imageUrl:    string;
  price:       number;
  currency:    string;
  soldCount:   number;   // lifetime total — delta between snapshots = live sales
  productUrl:  string;
  rating?:     number;
  reviewCount?: number;
  sellerName?: string;
}

// ── Service ───────────────────────────────────────────────────────────────────

export const TikTokShopScraperService = {

  /**
   * Get all products for a TikTok Shop creator with their current sold counts.
   * Returns [] if the store isn't available in a supported region (non-US).
   */
  async getSellerProducts(handle: string, userId?: string): Promise<ShopProduct[]> {
    const cleanHandle = handle.replace(/^@/, '').trim().toLowerCase();

    if (!env.APIFY_API_TOKEN) {
      log.debug('No APIFY_API_TOKEN — cannot fetch shop products', { handle: cleanHandle });
      return [];
    }

    const client = new ApifyClient({ token: env.APIFY_API_TOKEN });

    // Try store URL first (most product data), fall back to creator type
    const storeUrl = userId
      ? `https://www.tiktok.com/shop/store/${userId}`
      : undefined;

    const inputs = [
      ...(storeUrl ? [{
        scrapeType: 'store',
        storeUrls:  [storeUrl],
        maxItems:   50,
      }] : []),
      {
        scrapeType:       'creator',
        creatorUsernames: [cleanHandle],
        maxItems:         50,
      },
    ];

    for (const input of inputs) {
      try {
        const products = await runApifyShopScraper(client, input, cleanHandle);
        if (products.length > 0) return products;
      } catch (err) {
        log.debug('Apify shop scraper attempt failed', { handle: cleanHandle, input: input.scrapeType, err: String(err) });
      }
    }

    log.info('No shop products found — store may be non-US or not have TikTok Shop', { handle: cleanHandle });
    return [];
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function runApifyShopScraper(
  client: ApifyClient,
  input: Record<string, unknown>,
  handle: string,
): Promise<ShopProduct[]> {
  log.debug('Starting Apify shop scraper', { handle, scrapeType: input.scrapeType });

  const run = await client.actor(APIFY_ACTOR).start(input);
  const runClient = client.run(run.id);
  const deadline = Date.now() + APIFY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const current = await runClient.get();
    const status = current?.status;

    if (status === 'SUCCEEDED' || status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
      if (status !== 'SUCCEEDED') {
        log.warn('Apify shop scraper did not succeed', { handle, status });
        return [];
      }
      break;
    }
  }

  const { items } = await client.dataset(run.defaultDatasetId).listItems({ limit: 100 });
  return normalizeApifyItems(items as any[], handle);
}

function normalizeApifyItems(items: any[], handle: string): ShopProduct[] {
  const products: ShopProduct[] = [];

  for (const item of items) {
    // Skip creator profile cards (scrapeType=creator returns one profile card first)
    if (item.type === 'creator' || !item.productId) continue;

    const soldCount = Number(item.salesVolume ?? item.soldLast30Days ?? item.sold_count ?? 0);
    const price     = Number(item.currentPrice ?? item.price ?? 0);
    const productId = String(item.productId || '');
    const title     = String(item.title || '');

    if (!productId || !title) continue;

    const imageUrl = Array.isArray(item.imageUrls) && item.imageUrls.length > 0
      ? item.imageUrls[0]
      : (item.imageUrl || '');

    const productUrl = item.productUrl
      || (productId ? `https://www.tiktok.com/shop/pdp/${productId}` : `https://www.tiktok.com/@${handle}/shop`);

    products.push({
      productId,
      title,
      imageUrl,
      price,
      currency:    item.currency || 'USD',
      soldCount,
      productUrl,
      rating:      item.rating    != null ? Number(item.rating)    : undefined,
      reviewCount: item.reviewCount != null ? Number(item.reviewCount) : undefined,
      sellerName:  item.sellerName || undefined,
    });
  }

  return products;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
