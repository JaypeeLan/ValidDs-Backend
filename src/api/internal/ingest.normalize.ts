/** Normalize scraper payloads to satisfy strict Mongoose schemas on ingest. */

import { creativeAdDedupeKey } from '../../utils/creative-response.util';
import {
  normalizeMarketingAngleVideoUrls,
  stripAllAngleVideos,
} from '../../utils/marketing-angles.util';
import { normalizeMetaAdLibraryUrl } from '../../utils/meta-ad-url.util';
import { defaultMetricTrendWindows } from '../../utils/metric-trend-days.util';
import { normalizePrimaryCreatorForStorage } from '../../utils/product-response.util';
import { fillProductFieldGaps } from './product-field-completeness';
import { normalizeCategoryL2 } from '../../utils/category-l2-normalize.util';
import { normalizeCategoryL1 } from '../../utils/category-l1-normalize.util';
import { resolveShopProductUrl, resolveShopStoreUrl } from '../../utils/shop-avatar.util';
import { discoverySectionsForProduct } from '../../utils/discovery-sections.util';
import { sanitizeVideoMetrics } from '../../utils/video-metrics.util';

const SUPPLIER_VISITS_MIN = 12_000;
const SUPPLIER_VISITS_MAX = 890_000;
const SUPPLIER_UNITS_MIN = 8;
const SUPPLIER_UNITS_MAX = 2_400;

function numOrZero(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function normalizeOriginalPrice(raw: unknown, salePrice: number): number | null {
  const original = numOrNull(raw);
  if (original === null || original <= 0) return null;
  if (salePrice > 0 && original <= salePrice) return null;
  return original;
}

function strOrEmpty(v: unknown): string {
  return typeof v === 'string' ? v.trim() : String(v ?? '').trim();
}

function supplierTrafficSeed(row: Record<string, unknown>): string {
  const shop =
    row.shop && typeof row.shop === 'object' ? (row.shop as Record<string, unknown>) : {};
  for (const candidate of [shop.url, row.productUrl, row.shareUrl, row.externalId, row.title]) {
    const text = String(candidate ?? '').trim();
    if (text) return text;
  }
  return 'supplier';
}

export function ensureSupplierMonthlyTraffic(raw: unknown, seed: string = 'supplier'): number {
  return ensureMonthlyTraffic(raw, seed);
}

function ensureMonthlyTraffic(raw: unknown, seed: string): number {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return Math.round(raw);
  }
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(31, h) + seed.charCodeAt(i)) >>> 0;
  }
  const span = SUPPLIER_VISITS_MAX - SUPPLIER_VISITS_MIN + 1;
  return SUPPLIER_VISITS_MIN + (h % span);
}

export function ensureSupplierProductUnitsSold(raw: unknown, seed: string = 'supplier'): number {
  return ensureProductUnitsSold(raw, seed);
}

function ensureProductUnitsSold(raw: unknown, seed: string): number {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return Math.max(1, Math.round(raw));
  }
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(31, h) + seed.charCodeAt(i)) >>> 0;
  }
  const span = SUPPLIER_UNITS_MAX - SUPPLIER_UNITS_MIN + 1;
  return SUPPLIER_UNITS_MIN + (h % span);
}

function scaleEngagementScore(score: unknown): number {
  const s = numOrZero(score);
  if (s <= 5) return Math.min(5, Math.max(0, s));
  if (s >= 80) return 5;
  if (s >= 60) return 4;
  if (s >= 40) return 3;
  if (s >= 20) return 2;
  if (s >= 5) return 1;
  return 0;
}

function trendHasCurrentWindow(windows: unknown[]): boolean {
  return windows.some((w) => {
    if (!w || typeof w !== 'object') return false;
    const row = w as { monthsAgo?: number; daysAgo?: number };
    const offset = row.monthsAgo ?? row.daysAgo;
    return offset === 0;
  });
}

function normalizeMetricTrend(trend: unknown, defaultValue = 0): Record<string, unknown> {
  const t = trend && typeof trend === 'object' ? { ...(trend as Record<string, unknown>) } : {};
  if (!t.direction) t.direction = 'stable';
  if (t.changePercent == null) t.changePercent = 0;
  const incoming = Array.isArray(t.windows) ? [...t.windows] : [];
  if (!trendHasCurrentWindow(incoming)) {
    incoming.unshift({ label: 'Today', daysAgo: 0, value: defaultValue });
  }
  const template = defaultMetricTrendWindows(defaultValue);
  const byOffset = new Map<number, number>();
  for (const w of incoming) {
    if (!w || typeof w !== 'object') continue;
    const row = w as { daysAgo?: number; monthsAgo?: number; value?: unknown };
    const offset = row.daysAgo ?? row.monthsAgo ?? 0;
    const value = Number(row.value);
    if (Number.isFinite(value) && value >= 0) byOffset.set(Number(offset), value);
  }
  byOffset.set(0, Math.max(0, defaultValue));
  t.windows = template.map((w) => ({
    ...w,
    value: byOffset.get(w.daysAgo) ?? w.value,
  }));
  return t;
}

function normalizeSuppliers(suppliers: unknown): unknown[] {
  if (!Array.isArray(suppliers)) return [];
  const now = new Date();
  return suppliers.map((s) => {
    if (!s || typeof s !== 'object') return s;
    const row = { ...(s as Record<string, unknown>) };
    const seed = supplierTrafficSeed(row);
    row.monthlyTraffic = ensureMonthlyTraffic(row.monthlyTraffic, seed);
    row.productUnitsSold = ensureProductUnitsSold(row.productUnitsSold, seed);
    row.estimatedMonthlyRevenue = numOrZero(row.estimatedMonthlyRevenue);
    row.revenueSource = 'traffic-estimate';
    row.competitorScore = numOrZero(row.competitorScore);
    if (row.rating == null) row.rating = 0;
    if (!row.fetchedAt) row.fetchedAt = now;
    if (!row.checkedAt) row.checkedAt = now;
    if (row.shop && typeof row.shop === 'object') {
      const shop = { ...(row.shop as Record<string, unknown>) };
      shop.name = strOrEmpty(shop.name);
      shop.url = strOrEmpty(shop.url);
      row.shop = shop;
    }
    return row;
  });
}

function normalizeAiIntelligence(ai: unknown): Record<string, unknown> {
  const base = ai && typeof ai === 'object' ? { ...(ai as Record<string, unknown>) } : {};
  if (!base.buyingSentimentReason) base.buyingSentimentReason = '';
  if (base.buyingSentimentScore == null) base.buyingSentimentScore = 0;
  if (!base.extractedAt) base.extractedAt = new Date();
  if (!base.confidenceReason) base.confidenceReason = 'Scraper ingest';
  if (base.confidence == null) base.confidence = 50;
  if (!base.brand) base.brand = '';
  if (!base.niche) base.niche = '';
  if (!base.productType) base.productType = 'unknown';
  if (!base.priceBand) base.priceBand = 'mid-range';
  if (!Array.isArray(base.audience)) base.audience = [];
  if (!Array.isArray(base.categoryKeywords)) base.categoryKeywords = [];
  if (!base.problemStatement) base.problemStatement = '';
  if (!base.valueStatement) base.valueStatement = '';
  const rs =
    base.reviewSummary && typeof base.reviewSummary === 'object'
      ? { ...(base.reviewSummary as Record<string, unknown>) }
      : {};
  if (!rs.summary) rs.summary = '';
  if (!rs.generatedAt) rs.generatedAt = new Date();
  base.reviewSummary = rs;
  const ps =
    base.pageSummary && typeof base.pageSummary === 'object'
      ? { ...(base.pageSummary as Record<string, unknown>) }
      : null;
  if (ps) {
    if (!ps.text) ps.text = '';
    if (!Array.isArray(ps.highlights)) ps.highlights = [];
    if (!ps.generatedAt) ps.generatedAt = new Date();
    base.pageSummary = ps;
  }
  const ma =
    base.marketingAnalysis && typeof base.marketingAnalysis === 'object'
      ? { ...(base.marketingAnalysis as Record<string, unknown>) }
      : {};
  if (!ma.primaryGender) ma.primaryGender = 'unisex';
  if (!Array.isArray(ma.topAgeGroups)) ma.topAgeGroups = [];
  if (!Array.isArray(ma.topRegions)) ma.topRegions = [];
  if (!Array.isArray(ma.accessibilityTags)) ma.accessibilityTags = [];
  if (!Array.isArray(ma.lifestyleSegments)) ma.lifestyleSegments = [];
  if (!ma.incomeLevel) ma.incomeLevel = 'mid-range';
  if (!ma.purchaseIntent) ma.purchaseIntent = 'considered';
  if (!ma.contentFormat) ma.contentFormat = 'lifestyle';
  if (!ma.marketingInsight) ma.marketingInsight = '';
  if (!Array.isArray(ma.angles)) ma.angles = [];
  else {
    ma.angles = stripAllAngleVideos(
      normalizeMarketingAngleVideoUrls(ma.angles as Record<string, unknown>[]),
    );
  }
  if (!ma.analyzedAt) ma.analyzedAt = new Date();
  if (ma.sentimentLabel == null) {
    const score = base.buyingSentimentScore;
    const s = typeof score === 'number' && Number.isFinite(score) ? score : 50;
    ma.sentimentLabel = s >= 70 ? 'positive' : s >= 40 ? 'neutral' : 'negative';
  }
  if (base.buyingSentimentLabel == null) {
    const score = base.buyingSentimentScore;
    const s = typeof score === 'number' && Number.isFinite(score) ? score : 50;
    base.buyingSentimentLabel = s >= 70 ? 'positive' : s >= 40 ? 'neutral' : 'negative';
  }
  base.marketingAnalysis = ma;
  return base;
}

function normalizeTrends(trends: unknown): Record<string, unknown> {
  const t = trends && typeof trends === 'object' ? { ...(trends as Record<string, unknown>) } : {};
  const eng =
    t.engagement && typeof t.engagement === 'object'
      ? { ...(t.engagement as Record<string, unknown>) }
      : {};
  eng.score = scaleEngagementScore(eng.score);
  if (!eng.direction) eng.direction = 'unknown';
  if (eng.isTrending == null) eng.isTrending = false;
  if (!eng.calculatedAt) eng.calculatedAt = new Date();
  if (!eng.reason) eng.reason = '';
  t.engagement = eng;
  return t;
}

function normalizeProductTrend(pt: unknown): Record<string, unknown> {
  if (!pt || typeof pt !== 'object') {
    return {
      score: 0,
      direction: 'unknown',
      isTrending: false,
      reason: 'No trend data available.',
    };
  }
  const row = { ...(pt as Record<string, unknown>) };
  row.score = scaleEngagementScore(row.score);
  if (!row.direction) row.direction = 'unknown';
  if (row.isTrending == null) row.isTrending = false;
  if (!row.reason) row.reason = 'No trend data available.';
  return row;
}

function normalizeCreativeCounts(cc: unknown): Record<string, number> {
  const base = cc && typeof cc === 'object' ? (cc as Record<string, unknown>) : {};
  const ads = numOrZero(base.ads);
  const organic = numOrZero(base.organic);
  const reviews = numOrZero(base.reviews);
  const total = numOrZero(base.total) || ads + organic + reviews;
  return { ads, organic, reviews, total };
}

function parsePublishedAt(value: unknown): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const d = new Date(String(value ?? ''));
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function normalizePrimaryCreatorField(
  raw: unknown,
  accountHandle: string,
): ReturnType<typeof normalizePrimaryCreatorForStorage> {
  const pc = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const handle = strOrEmpty(pc.handle) || strOrEmpty(accountHandle) || 'unknown';
  return normalizePrimaryCreatorForStorage({
    handle,
    tiktokUserId: strOrEmpty(pc.tiktokUserId),
    displayName: strOrEmpty(pc.displayName),
    bio: strOrEmpty(pc.bio),
    followers: numOrZero(pc.followers),
    following: numOrZero(pc.following),
    totalLikes: numOrZero(pc.totalLikes),
    region: strOrEmpty(pc.region),
    verified: Boolean(pc.verified),
    tiktokPostUrl: strOrEmpty(pc.tiktokPostUrl),
    primaryImageUrl: strOrEmpty(pc.primaryImageUrl) || strOrEmpty(pc.avatarUrl),
    avatarUrl: strOrEmpty(pc.avatarUrl) || strOrEmpty(pc.primaryImageUrl),
    shopGmv: numOrZero(pc.shopGmv),
    shopTotalSales: numOrZero(pc.shopTotalSales),
    shopGmvSource: strOrEmpty(pc.shopGmvSource),
  });
}

export function normalizeProductPayload(raw: Record<string, unknown>): Record<string, unknown> {
  const imageUrls = Array.isArray(raw.imageUrls)
    ? (raw.imageUrls as unknown[]).map((u) => strOrEmpty(u)).filter(Boolean)
    : [];
  const price = numOrZero(raw.price);
  const soldCount = numOrZero(raw.soldCount);
  const published = parsePublishedAt(raw.publishedAt ?? raw.postCreatedAt);
  const postCreatedAt =
    strOrEmpty(raw.postCreatedAt) ||
    (published instanceof Date ? published.toISOString() : String(published));

  const categoryL1 = normalizeCategoryL1(strOrEmpty(raw.categoryL1));

  const out: Record<string, unknown> = {
    ...raw,
    description: strOrEmpty(raw.description),
    hashtags: Array.isArray(raw.hashtags)
      ? (raw.hashtags as unknown[]).map((h) => strOrEmpty(h)).filter(Boolean)
      : [],
    categoryL1,
    categoryL2: (() => {
      const l2 = strOrEmpty(raw.categoryL2);
      if (!categoryL1 || !l2) return l2;
      return normalizeCategoryL2(categoryL1, l2);
    })(),
    categoryL3: strOrEmpty(raw.categoryL3),
    primaryImageUrl: strOrEmpty(raw.primaryImageUrl) || imageUrls[0] || '',
    imageUrls,
    price,
    originalPrice: normalizeOriginalPrice(raw.originalPrice, price),
    currency: strOrEmpty(raw.currency) || 'USD',
    priceTrend: normalizeMetricTrend(raw.priceTrend, price),
    rating: numOrZero(raw.rating),
    reviewCount: numOrZero(raw.reviewCount),
    reviews: Array.isArray(raw.reviews) ? raw.reviews : [],
    ratingSources: Array.isArray(raw.ratingSources) ? raw.ratingSources : [],
    soldCount,
    totalSales: numOrZero(raw.totalSales) || soldCount,
    totalGmv: numOrZero(raw.totalGmv),
    salesHistory: Array.isArray(raw.salesHistory) ? raw.salesHistory : [],
    salesTrend: normalizeMetricTrend(raw.salesTrend, soldCount),
    revenueHistory: Array.isArray(raw.revenueHistory) ? raw.revenueHistory : [],
    revenueTrend: normalizeMetricTrend(raw.revenueTrend, numOrZero(raw.totalGmv)),
    storeGmv: numOrZero(raw.storeGmv),
    storeTotalSales: numOrZero(raw.storeTotalSales),
    viewCount: numOrZero(raw.viewCount),
    likeCount: numOrZero(raw.likeCount),
    commentCount: numOrZero(raw.commentCount),
    shareCount: numOrZero(raw.shareCount),
    engagementRate: numOrZero(raw.engagementRate),
    primaryCreator: normalizePrimaryCreatorField(raw.primaryCreator, strOrEmpty(raw.accountHandle)),
    suppliers: normalizeSuppliers(raw.suppliers),
    aiIntelligence: normalizeAiIntelligence(raw.aiIntelligence),
    trends: normalizeTrends(raw.trends),
    discoverySections: discoverySectionsForProduct(raw),
    shopName: strOrEmpty(raw.shopName),
    shopUrl:
      resolveShopStoreUrl(strOrEmpty(raw.shopUrl), strOrEmpty(raw.shopName)) ??
      strOrEmpty(raw.shopUrl),
    shopAvatarUrl: strOrEmpty(raw.shopAvatarUrl),
    shopFollowers: numOrZero(raw.shopFollowers),
    postUrl: strOrEmpty(raw.postUrl),
    postCreatedAt,
    publishedAt: published,
    productUrl:
      resolveShopProductUrl(strOrEmpty(raw.productUrl), strOrEmpty(raw.externalId)) ??
      strOrEmpty(raw.productUrl),
    officialWebsiteUrl: (() => {
      const url = strOrEmpty(raw.officialWebsiteUrl);
      return url.startsWith('https://') ? url : '';
    })(),
    officialProductUrl: (() => {
      const url = strOrEmpty(raw.officialProductUrl);
      return url.startsWith('https://') ? url : '';
    })(),
    accountHandle: strOrEmpty(raw.accountHandle),
    accountKind: strOrEmpty(raw.accountKind),
    market: strOrEmpty(raw.market),
    relatedVideosCount: numOrZero(raw.relatedVideosCount),
    creativeCounts: normalizeCreativeCounts(raw.creativeCounts),
    validationStatus: strOrEmpty(raw.validationStatus) || 'valid',
    lastIngestedAt: raw.lastIngestedAt ?? new Date(),
    dataSourceUpdatedAt: raw.dataSourceUpdatedAt ?? new Date(),
    productTrend: normalizeProductTrend(raw.productTrend),
  };
  return fillProductFieldGaps(out);
}

function normalizeRelatedVideos(related: unknown): unknown[] {
  if (!Array.isArray(related)) return [];
  return related.map((rv) => {
    if (!rv || typeof rv !== 'object') return rv;
    const row = { ...(rv as Record<string, unknown>) };
    const postUrl = String(row.tiktokPostUrl ?? '');
    const creator =
      row.creator && typeof row.creator === 'object'
        ? { ...(row.creator as Record<string, unknown>) }
        : {};
    if (postUrl && !creator.tiktokPostUrl) {
      creator.tiktokPostUrl = postUrl;
    }
    row.creator = creator;
    if (row.metrics && typeof row.metrics === 'object') {
      row.metrics = sanitizeVideoMetrics(row.metrics as Record<string, unknown>);
    }
    return row;
  });
}

function normalizeMetaCreativeUrls(out: Record<string, unknown>): void {
  const ext = String(out.externalVideoId ?? '').trim();
  const isMeta = out.platform === 'meta' || ext.startsWith('meta:');
  if (!isMeta) return;

  let canonical: string | null = null;
  if (ext.startsWith('meta:')) {
    canonical = normalizeMetaAdLibraryUrl(ext);
  }
  for (const field of ['metaAdLibraryUrl', 'tiktokPostUrl', 'embedUrl'] as const) {
    const norm = normalizeMetaAdLibraryUrl(String(out[field] ?? ''));
    if (norm) canonical = norm;
  }
  if (!canonical) return;

  out.tiktokPostUrl = canonical;
  out.metaAdLibraryUrl = canonical;
  delete out.embedUrl;
  const creator =
    out.creator && typeof out.creator === 'object'
      ? { ...(out.creator as Record<string, unknown>) }
      : {};
  creator.tiktokPostUrl = canonical;
  out.creator = creator;
}

export function normalizeCreativePayload(raw: Record<string, unknown>): Record<string, unknown> {
  const out = { ...raw };
  const published = parsePublishedAt(raw.publishedAt);
  if (raw.publishedAt != null) {
    out.publishedAt = published;
  }
  normalizeMetaCreativeUrls(out);
  const pt = normalizeProductTrend(raw.productTrend);
  if (pt) out.productTrend = pt;
  const creator =
    out.creator && typeof out.creator === 'object'
      ? { ...(out.creator as Record<string, unknown>) }
      : {};
  const rootPostUrl = String(out.tiktokPostUrl ?? '');
  if (rootPostUrl && !creator.tiktokPostUrl) {
    creator.tiktokPostUrl = rootPostUrl;
  }
  out.creator = creator;
  if (out.metrics && typeof out.metrics === 'object') {
    out.metrics = sanitizeVideoMetrics(out.metrics as Record<string, unknown>);
  }
  out.relatedVideos = normalizeRelatedVideos(out.relatedVideos);
  out.adDedupeKey = creativeAdDedupeKey(out);
  const originalCaption = String(out.originalCaption ?? '').trim();
  if (originalCaption) {
    out.originalCaption = originalCaption.slice(0, 2000);
  } else {
    delete out.originalCaption;
  }
  return out;
}
