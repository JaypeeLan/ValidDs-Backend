/**
 * Shared ingest quality thresholds — keep in sync with scraper/pipeline/ingest_quality.py
 */

import type { MarketCode } from '../../utils/markets';
import { isTikTokPostUrl } from '../../utils/tiktok-url.util';

/** Baseline rules from scraper validate_product_for_insert (pre–strict tier). */
export const BASELINE_INGEST = {
  MIN_SOLD_COUNT: 1,
  MIN_REVIEWS: 1,
} as const;

/** Strict rules always enforced on product/creative ingest (scraper + backend). */
export const INGEST_QUALITY = {
  MIN_UNITS_SOLD: 300,
  MAX_POST_AGE_DAYS: 30,
  MIN_RELATED_VIDEOS: 3,
  MIN_MARKETING_ANGLES: 5,
  MIN_ANGLES_WITH_VIDEO: 2,
  MIN_REVIEWS: 10,
  MIN_SUPPLIERS: 3,
} as const;

export const MIN_PRODUCT_IMAGES = 3;
export const MAX_REVIEWS_INGEST = 25;
export const MIN_PRODUCT_RATING = 3.5;
export const MIN_VIEW_COUNT = 1000;
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

export function hasFullPriceHistory(doc: Record<string, unknown>): boolean {
  if (nonzeroPriceTrendMonths(doc.priceTrend) >= MIN_PRICE_HISTORY_MONTHS) {
    return true;
  }
  const ph = doc.priceHistory;
  if (!Array.isArray(ph)) return false;
  const months = new Set<string>();
  for (const entry of ph) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as { recordedAt?: unknown; price?: unknown };
    const price = asFiniteNumber(row.price);
    if (price === null || price <= 0) continue;
    const raw = String(row.recordedAt ?? '')
      .trim()
      .slice(0, 7);
    if (raw.length >= 7) months.add(raw);
  }
  return months.size >= MIN_PRICE_HISTORY_MONTHS;
}

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
  const anglesWithVideo = angles.filter((a) => {
    const url = a.videoUrl;
    return typeof url === 'string' && isTikTokPostUrl(url);
  }).length;
  if (anglesWithVideo < INGEST_QUALITY.MIN_ANGLES_WITH_VIDEO) {
    reasons.push(
      `need at least ${INGEST_QUALITY.MIN_ANGLES_WITH_VIDEO} angles with playable TikTok videoUrl`,
    );
  }

  const suppliers = doc.suppliers;
  if (!Array.isArray(suppliers) || suppliers.length < INGEST_QUALITY.MIN_SUPPLIERS) {
    const n = Array.isArray(suppliers) ? suppliers.length : 0;
    reasons.push(
      `need at least ${INGEST_QUALITY.MIN_SUPPLIERS} suppliers (Shopify + Google Shopping); got ${n}`,
    );
  }

  return reasons;
}

export function isMetaCreative(doc: Record<string, unknown>): boolean {
  const ext = String(doc.externalVideoId ?? '');
  return doc.platform === 'meta' || ext.startsWith('meta:');
}
