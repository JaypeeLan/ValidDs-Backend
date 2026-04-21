import {
  EchoTikRawProduct,
  EchoTikRawComment,
  EchoTikCoverImage,
} from './echotik.client';
import {
  getCategoryL1Name,
  getCategoryL2Name,
  getCategoryL3Name,
  buildCategoryPath,
} from './echotik.category';
import { NormalizedEchoTikProduct, NormalizedEchoTikComment } from '../ingestion.types';

// ── Product transformer ────────────────────────────────────────────────────────

/**
 * Transforms a raw EchoTik product record into NormalizedEchoTikProduct.
 *
 * Key parsing notes (from live API observation):
 *  - cover_url is a JSON-encoded string of [{url, index}] objects, or null
 *  - product_rating is already on a 0–5 scale (e.g. 4.9)
 *  - product_commission_rate is a decimal (0.13 = 13%)
 *  - desc_detail / sale_props / skus / specification are JSON-encoded strings
 *  - sales_trend_flag: 0=stable, 1=rising, 2=declining
 *  - sales_flag: 0=none, 1=video-driven, 2=live-driven
 */
export function transformEchoTikProduct(raw: EchoTikRawProduct): NormalizedEchoTikProduct {
  // ── Image gallery ──────────────────────────────────────────────────────────
  const coverImages = parseCoverUrl(raw.cover_url);
  // Sort by index ascending so index 0 (thumbnail) is first
  coverImages.sort((a, b) => a.index - b.index);
  const primaryImageUrl = coverImages[0]?.url;
  const imageUrls       = coverImages.map((img) => img.url);

  // ── Category names ─────────────────────────────────────────────────────────
  const categoryL1   = getCategoryL1Name(raw.category_id);
  const categoryL2   = getCategoryL2Name(raw.category_l2_id);
  const categoryL3   = getCategoryL3Name(raw.category_l3_id);
  const categoryPath = buildCategoryPath(raw.category_id, raw.category_l2_id, raw.category_l3_id);

  // ── Trend direction from sales_trend_flag ──────────────────────────────────
  const trendDirection: NormalizedEchoTikProduct['trendDirection'] =
    raw.sales_trend_flag === 1 ? 'rising'
    : raw.sales_trend_flag === 2 ? 'declining'
    : 'stable';

  // ── Trend score (0–100) — composite of sales velocity + creator count ──────
  const trendScore = calculateTrendScore(raw);

  // ── Sales channel ──────────────────────────────────────────────────────────
  const salesChannel: NormalizedEchoTikProduct['salesChannel'] =
    raw.sales_flag === 1 ? 'video'
    : raw.sales_flag === 2 ? 'live'
    : 'none';

  // ── Description: parse desc_detail blocks + specification ─────────────────
  const description = buildDescription(raw);

  // ── dataSourceUpdatedAt from last_crawl_dt (yyyyMMdd → Date) ──────────────
  const dataSourceUpdatedAt = parseDateInt(raw.last_crawl_dt ?? raw.first_crawl_dt);
  const firstCrawledAt      = parseDateInt(raw.first_crawl_dt);

  return {
    // Identity
    productId:   raw.product_id,
    productName: raw.product_name,
    region:      raw.region,
    sellerId:    raw.seller_id,

    // Category
    categoryId:    raw.category_id,
    categoryL2Id:  raw.category_l2_id,
    categoryL3Id:  raw.category_l3_id,
    categoryL1,
    categoryL2,
    categoryL3,
    categoryPath,

    // Media
    primaryImageUrl,
    imageUrls,

    // Pricing
    minPrice:         raw.min_price,
    maxPrice:         raw.max_price,
    avgPrice:         raw.spu_avg_price,
    commissionRate:   raw.product_commission_rate,
    freeShipping:     raw.free_shipping === 1,
    isManagedStore:   raw.is_s_shop === 1,
    isOffMarket:      raw.off_mark === 1,

    // Quality signals
    rating:      raw.product_rating,   // already 0–5
    reviewCount: raw.review_count,

    // Description
    description,

    // Sales metrics
    totalSaleCnt:       raw.total_sale_cnt,
    totalSaleGmvAmt:    raw.total_sale_gmv_amt,
    totalSale1dCnt:     raw.total_sale_1d_cnt,
    totalSale7dCnt:     raw.total_sale_7d_cnt,
    totalSale15dCnt:    raw.total_sale_15d_cnt,
    totalSale30dCnt:    raw.total_sale_30d_cnt,
    totalSale60dCnt:    raw.total_sale_60d_cnt,
    totalSale90dCnt:    raw.total_sale_90d_cnt,
    totalSaleGmv7dAmt:  raw.total_sale_gmv_7d_amt,
    totalSaleGmv30dAmt: raw.total_sale_gmv_30d_amt,
    totalSaleGmv90dAmt: raw.total_sale_gmv_90d_amt,

    // Creator & video signals
    totalIflCnt:      raw.total_ifl_cnt,
    totalVideoCnt:    raw.total_video_cnt,
    totalLiveCnt:     raw.total_live_cnt,
    totalViewsCnt:    raw.total_views_cnt,
    totalViews30dCnt: raw.total_views_30d_cnt,

    // Sales channel
    salesChannel,
    trendDirection,
    trendScore,
    isTrending: raw.sales_trend_flag === 1,

    // Timestamps
    dataSourceUpdatedAt,
    firstCrawledAt,

    // Source tracking
    source: 'echotik',
    sourceRaw: raw,
  };
}

/**
 * Transform a batch of raw products, skipping any that fail parsing.
 */
export function transformEchoTikProducts(
  rawProducts: EchoTikRawProduct[]
): NormalizedEchoTikProduct[] {
  const results: NormalizedEchoTikProduct[] = [];
  for (const raw of rawProducts) {
    try {
      results.push(transformEchoTikProduct(raw));
    } catch (err) {
      // Log and skip individual failures — don't let one bad record break the batch
      console.warn(`[echotik-transformer] Skipped product ${raw.product_id}: ${String(err)}`);
    }
  }
  return results;
}

// ── Comment transformer ────────────────────────────────────────────────────────

export function transformEchoTikComments(
  rawComments: EchoTikRawComment[],
  productId: string
): NormalizedEchoTikComment[] {
  return rawComments.map((c) => ({
    reviewId:         c.review_id,
    productId,
    text:             c.display_text || '',
    rating:           c.rating,
    sentiment:        c.rating >= 4 ? 'positive' : c.rating <= 2 ? 'negative' : 'neutral',
    skuSpecification: c.sku_specification,
    createdAt:        new Date(c.review_timestamp),
  }));
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function parseCoverUrl(raw: string | EchoTikCoverImage[] | null | undefined): EchoTikCoverImage[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      // Might be a plain URL string
      return raw.startsWith('http') ? [{ url: raw, index: 0 }] : [];
    }
  }
  return [];
}

function parseDateInt(yyyyMMdd: number | undefined): Date {
  if (!yyyyMMdd) return new Date();
  const s = String(yyyyMMdd);
  if (s.length !== 8) return new Date();
  return new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`);
}

/**
 * Builds a human-readable product description from structured EchoTik data.
 * Priority: desc_detail text blocks → specification key/values.
 */
function buildDescription(raw: EchoTikRawProduct): string {
  const parts: string[] = [];

  // desc_detail: array of {type, image/text} blocks
  if (raw.desc_detail) {
    try {
      const blocks: Array<{ type: string; content?: string; text?: string; image?: unknown }> =
        typeof raw.desc_detail === 'string' ? JSON.parse(raw.desc_detail) : raw.desc_detail;

      const textBlocks = blocks
        .filter((b) => b.type === 'text')
        .map((b) => (b.content || b.text || '').trim())
        .filter((t) => t.length > 0 && t.length < 500);

      parts.push(...textBlocks.slice(0, 3));
    } catch { /* invalid JSON — skip */ }
  }

  // specification: [{name, value}] key/value pairs
  if (raw.specification && parts.length === 0) {
    try {
      const specs: Array<{ name: string; value: string }> =
        typeof raw.specification === 'string' ? JSON.parse(raw.specification) : raw.specification;

      const specText = specs
        .slice(0, 6)
        .map((s) => `${s.name}: ${s.value}`)
        .join(' | ');

      if (specText) parts.push(specText);
    } catch { /* invalid JSON — skip */ }
  }

  return parts.join(' ').trim() || raw.product_name;
}

/**
 * Composite trend score (0–100) derived from real EchoTik metrics.
 *
 * Weights:
 *  - 30-day sales velocity (50%)
 *  - Creator adoption (25%)
 *  - Review volume as social proof (15%)
 *  - Views momentum (10%)
 *
 * Each component is normalized against practical upper bounds and capped at 100.
 */
function calculateTrendScore(raw: EchoTikRawProduct): number {
  const MAX_SALES_30D  = 50_000;   // products above this are category leaders
  const MAX_CREATORS   = 500;
  const MAX_REVIEWS    = 10_000;
  const MAX_VIEWS_30D  = 2_000_000;

  const salesComponent   = Math.min(1, (raw.total_sale_30d_cnt  || 0) / MAX_SALES_30D)  * 50;
  const creatorComponent = Math.min(1, (raw.total_ifl_cnt        || 0) / MAX_CREATORS)  * 25;
  const reviewComponent  = Math.min(1, (raw.review_count         || 0) / MAX_REVIEWS)   * 15;
  const viewsComponent   = Math.min(1, (raw.total_views_30d_cnt  || 0) / MAX_VIEWS_30D) * 10;

  return Math.round(salesComponent + creatorComponent + reviewComponent + viewsComponent);
}
