/**
 * Shared ingest quality thresholds — keep in sync with scraper/pipeline/ingest_quality.py
 */

import type { MarketCode } from '../../utils/markets';

/** Baseline rules from scraper validate_product_for_insert (pre–strict tier). */
export const BASELINE_INGEST = {
  MIN_SOLD_COUNT: 1,
  MIN_REVIEWS: 1,
} as const;

/** Strict rules always enforced on product/creative ingest (scraper + backend). */
export const INGEST_QUALITY = {
  MIN_UNITS_SOLD: 200,
  /** New product ingest only — scraper skips this on Mongo upsert updates. */
  MAX_POST_AGE_DAYS: 30,
  /** New non-angle creatives only — existing DB rows are not retroactively removed. */
  MAX_CREATIVE_AGE_DAYS: 90,
  MAX_CREATIVE_AGE_HOURS: 90 * 24,
  MIN_RELATED_VIDEOS: 3,
  MIN_MARKETING_ANGLES: 5,
  /** Optional at ingest — text-only angles are enough; video can be backfilled later. */
  MIN_ANGLES_WITH_VIDEO: 0,
  /** Angle promo clips: no age limit (0). Listing id must match via shop card or anchor. */
  ANGLES_PROMO_MAX_AGE_DAYS: 0,
  MIN_REVIEWS: 5,
  MIN_SUPPLIERS: 3,
} as const;

export const MIN_PRODUCT_IMAGES = 3;
export const MAX_REVIEWS_INGEST = 25;
export const MIN_PRODUCT_RATING = 3.5;
/** Minimum list price (USD or market currency) for ingest and public feeds. */
export const MIN_PRODUCT_PRICE = 10;
/** Minimum product revenue (sold × price) for ingest and public feeds. */
export const MIN_TOTAL_GMV = 1000;

/** Calendar months of price data required in priceTrend (matches scraper TREND_MONTH_COUNT). */
export const MIN_PRICE_HISTORY_MONTHS = 10;

export function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function parseIngestDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function postAgeRejection(
  value: unknown,
  label: string,
  maxDays: number = INGEST_QUALITY.MAX_POST_AGE_DAYS,
): string | null {
  const d = parseIngestDate(value);
  if (!d) return `${label}: missing or invalid publishedAt`;
  const ageMs = Date.now() - d.getTime();
  if (ageMs < 0) return null;
  const days = ageMs / (1000 * 60 * 60 * 24);
  if (days > maxDays) {
    return `${label}: older than ${maxDays} days`;
  }
  return null;
}

export function postAgeRejectionHours(
  value: unknown,
  label: string,
  maxHours: number = INGEST_QUALITY.MAX_CREATIVE_AGE_HOURS,
): string | null {
  const d = parseIngestDate(value);
  if (!d) return `${label}: missing or invalid publishedAt`;
  const ageMs = Date.now() - d.getTime();
  if (ageMs < 0) return null;
  const hours = ageMs / (1000 * 60 * 60);
  if (hours > maxHours) {
    return `${label}: older than ${maxHours} hours`;
  }
  return null;
}

export function isAngleVideoCreative(doc: Record<string, unknown>): boolean {
  return Boolean(String(doc.angle ?? '').trim());
}

export function nonzeroPriceTrendMonths(trend: unknown): number {
  if (!trend || typeof trend !== 'object') return 0;
  const windows = (trend as { windows?: unknown[] }).windows;
  if (!Array.isArray(windows)) return 0;
  return windows.filter((w) => {
    if (!w || typeof w !== 'object') return false;
    const value = asFiniteNumber((w as { value?: unknown }).value);
    return value !== null && value > 0;
  }).length;
}

/** True when priceTrend has enough monthly windows with price > 0. */
export function hasFullPriceTrend(doc: Record<string, unknown>): boolean {
  return nonzeroPriceTrendMonths(doc.priceTrend) >= MIN_PRICE_HISTORY_MONTHS;
}

/** @deprecated Use hasFullPriceTrend — priceHistory is no longer stored on products. */
export const hasFullPriceHistory = hasFullPriceTrend;

export function hasTrendCurrentWindow(trend: unknown): boolean {
  if (!trend || typeof trend !== 'object') return false;
  const windows = (trend as { windows?: unknown[] }).windows;
  if (!Array.isArray(windows)) return false;
  return windows.some((w) => {
    if (!w || typeof w !== 'object') return false;
    const row = w as { monthsAgo?: number; daysAgo?: number };
    const offset = row.monthsAgo ?? row.daysAgo;
    return offset === 0;
  });
}

export function marketingAngles(doc: Record<string, unknown>): Record<string, unknown>[] {
  const ai = (doc.aiIntelligence ?? {}) as Record<string, unknown>;
  const ma = (ai.marketingAnalysis ?? {}) as Record<string, unknown>;
  const raw = ma.angles;
  if (!Array.isArray(raw)) return [];
  return raw.filter((a): a is Record<string, unknown> => !!a && typeof a === 'object');
}

/** Pre-strict checks (soldCount ≥ 1, at least one review) — mirrors db_writer when SCRAPER_RELAX_QUALITY is off. */
export function baselineProductQualityReasons(doc: Record<string, unknown>): string[] {
  const reasons: string[] = [];

  const sold = asFiniteNumber(doc.soldCount);
  if (sold === null || sold < BASELINE_INGEST.MIN_SOLD_COUNT) {
    reasons.push(`soldCount must be >= ${BASELINE_INGEST.MIN_SOLD_COUNT}`);
  }

  const reviews = doc.reviews;
  if (!Array.isArray(reviews) || reviews.length < BASELINE_INGEST.MIN_REVIEWS) {
    reasons.push(`need at least ${BASELINE_INGEST.MIN_REVIEWS} review`);
  }

  return reasons;
}

/** Each marketing angle must include hook, body, and target (scraper ai_extractor shape). */
export function marketingAngleFieldReasons(doc: Record<string, unknown>): string[] {
  const reasons: string[] = [];
  marketingAngles(doc).forEach((angle, i) => {
    const hook = String(angle.hook ?? '').trim();
    const body = String(angle.body ?? '').trim();
    const target = String(angle.target ?? '').trim();
    if (!hook || !body || !target) {
      reasons.push(`marketing angle[${i}] must have hook, body, and target`);
    }
  });
  return reasons;
}

/** Per-supplier monthlyTraffic — always checked (db_writer loop after strict extend). */
export function supplierTrafficReasons(doc: Record<string, unknown>): string[] {
  const reasons: string[] = [];
  const suppliers = doc.suppliers;
  if (!Array.isArray(suppliers)) return reasons;

  suppliers.forEach((s, i) => {
    if (!s || typeof s !== 'object') {
      reasons.push(`supplier[${i}]: invalid row`);
      return;
    }
    const mt = asFiniteNumber((s as Record<string, unknown>).monthlyTraffic);
    if (mt === null || mt <= 0) {
      reasons.push(`supplier[${i}].monthlyTraffic must be > 0`);
    }
  });

  return reasons;
}

export function strictProductQualityReasons(
  doc: Record<string, unknown>,
  _market: MarketCode,
): string[] {
  const reasons: string[] = [];

  const price = asFiniteNumber(doc.price);
  if (price === null || price < MIN_PRODUCT_PRICE) {
    reasons.push(`price must be >= $${MIN_PRODUCT_PRICE}`);
  }

  const sold = asFiniteNumber(doc.soldCount);
  if (sold === null || sold < INGEST_QUALITY.MIN_UNITS_SOLD) {
    reasons.push(`soldCount must be >= ${INGEST_QUALITY.MIN_UNITS_SOLD}`);
  }

  const totalGmv = asFiniteNumber(doc.totalGmv);
  if (totalGmv === null || totalGmv < MIN_TOTAL_GMV) {
    reasons.push(`totalGmv must be >= ${MIN_TOTAL_GMV}`);
  }

  const reviews = doc.reviews;
  if (!Array.isArray(reviews) || reviews.length < INGEST_QUALITY.MIN_REVIEWS) {
    reasons.push(`need at least ${INGEST_QUALITY.MIN_REVIEWS} reviews`);
  }

  const angles = marketingAngles(doc);
  if (angles.length < INGEST_QUALITY.MIN_MARKETING_ANGLES) {
    reasons.push(`need at least ${INGEST_QUALITY.MIN_MARKETING_ANGLES} marketing angles`);
  }

  const suppliers = doc.suppliers;
  if (!Array.isArray(suppliers) || suppliers.length < INGEST_QUALITY.MIN_SUPPLIERS) {
    const n = Array.isArray(suppliers) ? suppliers.length : 0;
    reasons.push(
      `need at least ${INGEST_QUALITY.MIN_SUPPLIERS} suppliers (Apify Shopify store leads); got ${n}`,
    );
  } else {
    suppliers.forEach((s, i) => {
      if (!s || typeof s !== 'object') return;
      const row = s as Record<string, unknown>;
      if (row.platform === 'TikTok Shop') return;
      if (row.source !== 'apify_store_leads') {
        reasons.push(`supplier[${i}] must use apify_store_leads (got ${String(row.source ?? '')})`);
      }
    });
  }

  return reasons;
}

export function isMetaCreative(doc: Record<string, unknown>): boolean {
  const ext = String(doc.externalVideoId ?? '');
  return doc.platform === 'meta' || ext.startsWith('meta:');
}

export function isTikTokCcAdCreative(doc: Record<string, unknown>): boolean {
  const ext = String(doc.externalVideoId ?? '');
  return ext.startsWith('ttad:') || doc.platform === 'tiktok_cc';
}
