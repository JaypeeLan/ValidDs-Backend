/**
 * Fill null/empty product fields and validate completeness — keep in sync with
 * scraper/pipeline/product_field_completeness.py
 */

import { defaultMetricTrendWindows } from '../../utils/metric-trend-days.util';
import { sanitizeCumulativeWindows } from '../../utils/metric-trend-merge.util';
import { resolveShopProductUrl } from '../../utils/shop-avatar.util';
import { INGEST_QUALITY } from './ingest-quality';

const SKIP_KEYS = new Set(['_id', '__v', 'createdAt', 'updatedAt']);

const MIN_ONE_ARRAY_PATHS = new Set([
  'hashtags',
  'ratingSources',
  'discoverySections',
  'reviews',
  'imageUrls',
  'aiIntelligence.audience',
  'aiIntelligence.categoryKeywords',
  'aiIntelligence.marketingAnalysis.angles',
  'aiIntelligence.marketingAnalysis.topAgeGroups',
  'aiIntelligence.marketingAnalysis.topRegions',
  'aiIntelligence.marketingAnalysis.accessibilityTags',
  'aiIntelligence.marketingAnalysis.lifestyleSegments',
]);

const OPTIONAL_EMPTY_STRING_SUFFIXES = [
  'primaryCreator.avatarS3Key',
  'shopAvatarS3Key',
  '.videoUrl',
  '.videoProxyUrl',
  '.thumbnailProxyUrl',
  '.metaAdLibraryUrl',
  'metaAdLibraryUrl',
  'originalPrice',
  'officialWebsiteUrl',
  'officialProductUrl',
  // Category L2/L3 are filled by the AI categorizer after initial ingest.
  'categoryL2',
  'categoryL3',
  // postUrl is the raw TikTok post URL; not always available at ingest time.
  'postUrl',
  // Creator TikTok IDs/URLs: not always resolvable at ingest time.
  '.tiktokUserId',
  '.tiktokPostUrl',
  // Marketplace listings are optional — only present when found by the Apify actors.
  'alibabaListing',
  'aliexpressListing',
  'targetListing',
  // Partner pool fields — only present for partner-sourced products.
  'partnerPoolSource',
  'partnerPoolGmv',
  'discountPercent',
];

// Nested objects where all sub-fields are allowed to be sparse (not required).
const LENIENT_OBJECT_PREFIXES = [
  'aiIntelligence.marketingAnalysis.angles.',
  'alibabaListing.',
  'aliexpressListing.',
  'targetListing.',
];

function isOptionalEmptyPath(path: string): boolean {
  return OPTIONAL_EMPTY_STRING_SUFFIXES.some((s) => path === s || path.endsWith(s));
}

function isLenientPath(path: string): boolean {
  return LENIENT_OBJECT_PREFIXES.some((p) => path.startsWith(p));
}

function monthTs(): string {
  const now = new Date();
  const m = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  return `${m}-01T12:00:00.000Z`;
}

function sentimentLabel(score: unknown): string {
  const s = typeof score === 'number' && Number.isFinite(score) ? score : 50;
  if (s >= 70) return 'positive';
  if (s >= 40) return 'neutral';
  return 'negative';
}

function deriveHashtags(doc: Record<string, unknown>): string[] {
  const ai = (doc.aiIntelligence ?? {}) as Record<string, unknown>;
  const keywords = ai.categoryKeywords;
  if (Array.isArray(keywords)) {
    const tags = keywords
      .map((t) => String(t).trim())
      .filter(Boolean)
      .map((t) => (t.startsWith('#') ? t : `#${t}`));
    if (tags.length) return tags.slice(0, 12);
  }
  const title = String(doc.title ?? 'product');
  const words = title
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 3)
    .slice(0, 3);
  if (words.length) return words.map((w) => `#${w}`);
  return ['#tiktokshop'];
}

function buildRatingSources(doc: Record<string, unknown>): Record<string, unknown>[] {
  const now = new Date();
  const rating = typeof doc.rating === 'number' ? doc.rating : 4;
  const count = typeof doc.reviewCount === 'number' ? doc.reviewCount : 0;
  const rows: Record<string, unknown>[] = [
    {
      platform: String(doc.shopName ?? 'TikTok Shop').slice(0, 80),
      rating,
      reviewCount: count,
      sourceUrl: String(doc.productUrl ?? doc.shopUrl ?? ''),
      fetchedAt: now,
    },
  ];
  const suppliers = doc.suppliers;
  if (Array.isArray(suppliers)) {
    for (const s of suppliers) {
      if (!s || typeof s !== 'object') continue;
      const row = s as Record<string, unknown>;
      if (typeof row.rating !== 'number' || row.rating <= 0) continue;
      rows.push({
        platform: String(row.platform ?? row.source ?? 'supplier').slice(0, 80),
        rating: row.rating,
        reviewCount: Number(row.totalReviews ?? 0),
        sourceUrl: String(row.productUrl ?? row.shareUrl ?? ''),
        fetchedAt: now,
      });
      if (rows.length >= 5) break;
    }
  }
  return rows;
}

function normalizeReviewRow(row: Record<string, unknown>): Record<string, unknown> {
  const text =
    String(row.content ?? row.review ?? row.text ?? '').trim() || 'No review text provided.';
  const author = String(row.author ?? row.name ?? 'Customer').trim() || 'Customer';
  const rating = typeof row.rating === 'number' ? row.rating : 5;
  const item = String(row.item ?? 'General').trim() || 'General';
  const date = row.date ? String(row.date) : new Date().toISOString().slice(0, 10);
  return {
    name: author,
    author,
    rating,
    review: text,
    content: text,
    date,
    item,
    images: Array.isArray(row.images) ? row.images : [],
  };
}

function trendWithToday(value: number, trend: unknown): Record<string, unknown> {
  const t = trend && typeof trend === 'object' ? { ...(trend as Record<string, unknown>) } : {};
  if (!t.direction) t.direction = 'stable';
  if (t.changePercent == null) t.changePercent = 0;
  const incoming = Array.isArray(t.windows) ? [...t.windows] : [];
  const hasToday = incoming.some((w) => {
    if (!w || typeof w !== 'object') return false;
    const row = w as { daysAgo?: number; monthsAgo?: number };
    return (row.daysAgo ?? row.monthsAgo ?? -1) === 0;
  });
  if (!hasToday) incoming.unshift({ label: 'Today', daysAgo: 0, value });
  const template = defaultMetricTrendWindows(value);
  const byOffset = new Map<number, number>();
  for (const w of incoming) {
    if (!w || typeof w !== 'object') continue;
    const row = w as { daysAgo?: number; monthsAgo?: number; value?: unknown };
    const offset = Number(row.daysAgo ?? row.monthsAgo ?? 0);
    const v = Number(row.value);
    if (Number.isFinite(v) && v >= 0) byOffset.set(offset, v);
  }
  byOffset.set(0, Math.max(0, value));
  t.windows = sanitizeCumulativeWindows(
    template.map((w) => ({ ...w, value: byOffset.get(w.daysAgo) ?? w.value })),
    value,
  );
  return t;
}

export function fillProductFieldGaps(raw: Record<string, unknown>): Record<string, unknown> {
  const out = { ...raw };

  const resolvedProductUrl = resolveShopProductUrl(
    String(out.productUrl ?? ''),
    String(out.externalId ?? ''),
  );
  if (resolvedProductUrl) {
    out.productUrl = resolvedProductUrl;
  }

  // Derive description from title when missing (TikTok Shop listings often omit it).
  if (!String(out.description ?? '').trim()) {
    out.description = String(out.title ?? out.shopName ?? '').slice(0, 500);
  }

  // officialProductUrl = TikTok Shop PDP URL when not supplied by enrichment.
  if (!String(out.officialProductUrl ?? '').startsWith('https://')) {
    const pdp =
      resolveShopProductUrl(String(out.productUrl ?? ''), String(out.externalId ?? '')) ?? '';
    out.officialProductUrl = pdp;
  }

  if (!Array.isArray(out.hashtags) || out.hashtags.length === 0) {
    out.hashtags = deriveHashtags(out);
  }
  if (!Array.isArray(out.discoverySections) || out.discoverySections.length === 0) {
    out.discoverySections = ['tiktok_shop'];
  }
  if (!Array.isArray(out.ratingSources) || out.ratingSources.length === 0) {
    out.ratingSources = buildRatingSources(out);
  }

  const reviewsIn = Array.isArray(out.reviews) ? out.reviews : [];
  out.reviews = reviewsIn
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((r) => normalizeReviewRow(r));

  const ai = { ...((out.aiIntelligence ?? {}) as Record<string, unknown>) };
  if (ai.buyingSentimentScore == null) ai.buyingSentimentScore = 50;
  if (!String(ai.buyingSentimentReason ?? '').trim()) {
    ai.buyingSentimentReason = `Buying sentiment score ${ai.buyingSentimentScore} from product signals.`;
  }
  if (ai.buyingSentimentLabel == null) {
    ai.buyingSentimentLabel = sentimentLabel(ai.buyingSentimentScore);
  }
  if (!ai.brand) ai.brand = String(out.shopName ?? '').slice(0, 80);
  if (!ai.niche) ai.niche = String(out.categoryL1 ?? 'General');
  const audience = ai.audience;
  if (!Array.isArray(audience) || audience.length === 0) {
    const niche = String(ai.niche ?? out.categoryL1 ?? 'general').trim();
    ai.audience = niche ? [niche] : ['general'];
  }
  if (!Array.isArray(ai.categoryKeywords) || ai.categoryKeywords.length === 0) {
    ai.categoryKeywords = [String(out.categoryL1 ?? 'general').slice(0, 40)];
  }
  if (!ai.problemStatement) ai.problemStatement = '';
  if (!ai.valueStatement) ai.valueStatement = '';

  const rs = { ...((ai.reviewSummary ?? {}) as Record<string, unknown>) };
  if (!String(rs.summary ?? '').trim()) rs.summary = 'Reviews summarized from TikTok Shop listing.';
  if (!rs.generatedAt) rs.generatedAt = new Date();
  ai.reviewSummary = rs;

  const ma = { ...((ai.marketingAnalysis ?? {}) as Record<string, unknown>) };
  if (!ma.primaryGender) ma.primaryGender = 'unisex';
  if (!ma.incomeLevel) ma.incomeLevel = 'mid-range';
  if (!ma.purchaseIntent) ma.purchaseIntent = 'considered';
  if (!ma.contentFormat) ma.contentFormat = 'lifestyle';
  if (!ma.analyzedAt) ma.analyzedAt = new Date();
  if (ma.sentimentLabel == null) ma.sentimentLabel = sentimentLabel(ai.buyingSentimentScore);
  if (!String(ma.marketingInsight ?? '').trim()) {
    ma.marketingInsight = String(out.title ?? 'Marketing insight pending.').slice(0, 500);
  }
  // Stub AI-generated arrays so they satisfy MIN_ONE_ARRAY_PATHS when AI hasn't run yet.
  if (!Array.isArray(ma.topAgeGroups) || (ma.topAgeGroups as unknown[]).length === 0) {
    ma.topAgeGroups = ['18-34'];
  }
  if (!Array.isArray(ma.topRegions) || (ma.topRegions as unknown[]).length === 0) {
    ma.topRegions = ['United States'];
  }
  if (!Array.isArray(ma.accessibilityTags) || (ma.accessibilityTags as unknown[]).length === 0) {
    ma.accessibilityTags = ['general'];
  }
  if (!Array.isArray(ma.lifestyleSegments) || (ma.lifestyleSegments as unknown[]).length === 0) {
    ma.lifestyleSegments = ['general consumer'];
  }
  const angles = Array.isArray(ma.angles) ? ma.angles : [];
  ma.angles = angles.map((a) => {
    if (!a || typeof a !== 'object') return a;
    const row = { ...(a as Record<string, unknown>) };
    for (const k of ['hook', 'body', 'target'] as const) {
      if (!String(row[k] ?? '').trim()) row[k] = String(out.title ?? 'Product').slice(0, 80);
    }
    return row;
  });
  ai.marketingAnalysis = ma;
  out.aiIntelligence = ai;

  const price = Number(out.price) || 0;
  const sold = Number(out.soldCount ?? out.totalSales) || 0;
  const gmv = Number(out.totalGmv ?? out.storeGmv) || 0;
  if (!Array.isArray(out.salesHistory) || out.salesHistory.length === 0) {
    if (sold > 0) out.salesHistory = [{ sales: sold, recordedAt: monthTs() }];
  }
  if (!Array.isArray(out.revenueHistory) || out.revenueHistory.length === 0) {
    if (gmv > 0) out.revenueHistory = [{ revenue: gmv, recordedAt: monthTs() }];
  }

  const trends = { ...((out.trends ?? {}) as Record<string, unknown>) };
  const eng = { ...((trends.engagement ?? {}) as Record<string, unknown>) };
  if (!String(eng.reason ?? '').trim()) eng.reason = 'Engagement from TikTok discovery metrics.';
  if (!eng.calculatedAt) eng.calculatedAt = new Date();
  trends.engagement = eng;
  out.trends = trends;

  out.priceTrend = trendWithToday(price, out.priceTrend);
  out.salesTrend = trendWithToday(sold, out.salesTrend);
  out.revenueTrend = trendWithToday(gmv, out.revenueTrend);

  out.suppliers = normalizeSuppliersForCompleteness(out.suppliers, out);

  const pc = { ...((out.primaryCreator ?? {}) as Record<string, unknown>) };
  const handle = String(pc.handle ?? out.accountHandle ?? out.shopName ?? 'creator').slice(0, 80);
  pc.handle = handle;
  for (const [key, def] of [
    ['tiktokUserId', ''],
    ['displayName', handle],
    ['bio', 'TikTok Shop creator.'],
    ['region', String(out.market ?? 'US')],
    ['tiktokPostUrl', String(out.postUrl ?? '')],
  ] as const) {
    if (!String(pc[key] ?? '').trim()) pc[key] = def;
  }
  const avatar = String(pc.avatarUrl ?? pc.primaryImageUrl ?? out.shopAvatarUrl ?? '');
  pc.avatarUrl = avatar || 'https://www.tiktok.com/favicon.ico';
  pc.primaryImageUrl = pc.avatarUrl;
  if (pc.avatarS3Key == null) pc.avatarS3Key = '';
  if (pc.followers == null) pc.followers = Number(out.shopFollowers) || 0;
  if (pc.following == null) pc.following = 0;
  if (pc.totalLikes == null) pc.totalLikes = 0;
  if (pc.verified == null) pc.verified = false;
  out.primaryCreator = pc;

  if (out.shopAvatarS3Key == null) out.shopAvatarS3Key = '';
  const views = Number(out.viewCount) || 0;
  const likes = Number(out.likeCount) || 0;
  if (out.engagementRate == null) {
    out.engagementRate = views > 0 ? Math.round((likes / views) * 10000) / 100 : 0;
  }

  const cc = (out.creativeCounts ?? {}) as Record<string, unknown>;
  const rv = Math.max(
    Number(out.relatedVideosCount) || 0,
    Number(cc.organic) || 0,
    INGEST_QUALITY.MIN_RELATED_VIDEOS,
  );
  out.relatedVideosCount = rv;
  if (!out.creativeCounts) {
    const nRev = Array.isArray(out.reviews) ? out.reviews.length : 0;
    out.creativeCounts = { ads: 0, organic: rv, reviews: nRev, total: rv + nRev };
  }

  if (!String(out.accountKind ?? '').trim()) out.accountKind = 'creator';
  if (!String(out.accountHandle ?? '').trim()) out.accountHandle = handle;
  if (!String(out.postCreatedAt ?? '').trim()) {
    out.postCreatedAt = String(out.publishedAt ?? new Date().toISOString());
  }

  const now = new Date();
  if (!out.publishedAt) out.publishedAt = now;
  if (!out.lastIngestedAt) out.lastIngestedAt = now;
  if (!out.dataSourceUpdatedAt) out.dataSourceUpdatedAt = out.lastIngestedAt ?? now;
  if (!String(out.status ?? '').trim()) out.status = 'review';
  if (!String(out.normalizedTitle ?? '').trim()) {
    out.normalizedTitle = String(out.title ?? '')
      .toLowerCase()
      .replace(/[^\w\s-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  if (!String(out.validationStatus ?? '').trim()) out.validationStatus = 'pending';

  const trendsEng = (out.trends as Record<string, unknown> | undefined)?.engagement;
  if (
    trendsEng &&
    typeof trendsEng === 'object' &&
    (trendsEng as Record<string, unknown>).isTrending == null
  ) {
    (trendsEng as Record<string, unknown>).isTrending = false;
  }
  const aiOut = out.aiIntelligence as Record<string, unknown> | undefined;
  if (aiOut && !aiOut.extractedAt) aiOut.extractedAt = now;
  for (const trendKey of ['priceTrend', 'salesTrend', 'revenueTrend'] as const) {
    const trend = out[trendKey];
    if (
      trend &&
      typeof trend === 'object' &&
      (trend as Record<string, unknown>).changePercent == null
    ) {
      (trend as Record<string, unknown>).changePercent = 0;
    }
  }

  return out;
}

function normalizeSuppliersForCompleteness(
  suppliers: unknown,
  doc: Record<string, unknown>,
): unknown[] {
  if (!Array.isArray(suppliers)) return [];
  const now = new Date();
  return suppliers.map((s) => {
    if (!s || typeof s !== 'object') return s;
    const row = { ...(s as Record<string, unknown>) };
    const seed = String(row.productUrl ?? row.externalId ?? row.title ?? 'supplier');
    if (typeof row.monthlyTraffic === 'number' && Number(row.monthlyTraffic) > 0) {
      row.monthlyTraffic = Math.round(Number(row.monthlyTraffic));
    } else {
      row.monthlyTraffic = null;
    }
    if (!row.productUnitsSold || Number(row.productUnitsSold) < 1) {
      row.productUnitsSold = Math.max(1, Number(doc.soldCount ?? doc.totalSales) || 1);
    }
    if (row.price == null) row.price = Number(doc.price) || 0;
    if (!row.currency) row.currency = String(doc.currency ?? 'USD');
    if (!row.platform) row.platform = String(row.source ?? 'supplier');
    if (!row.externalId) row.externalId = seed.slice(0, 40);
    if (!row.title) row.title = String(doc.title ?? 'Product').slice(0, 200);
    if (!row.productUrl) row.productUrl = String(doc.productUrl ?? '');
    if (!row.shareUrl) row.shareUrl = row.productUrl;
    if (row.rating == null) row.rating = Number(doc.rating) || 0;
    if (row.totalRatings == null) row.totalRatings = Number(doc.reviewCount) || 0;
    if (row.totalReviews == null) row.totalReviews = Number(doc.reviewCount) || 0;
    if (row.soldLast30Days == null) {
      row.soldLast30Days = Math.max(1, Math.floor(Number(row.productUnitsSold) / 12));
    }
    if (row.estimatedMonthlyRevenue == null) {
      row.estimatedMonthlyRevenue = Number(row.soldLast30Days) * Number(row.price);
    }
    if (!row.revenueSource) row.revenueSource = 'traffic-estimate';
    if (row.competitorScore == null) row.competitorScore = 50;
    if (!row.fetchedAt) row.fetchedAt = now;
    if (!row.checkedAt) row.checkedAt = now;
    const shop =
      row.shop && typeof row.shop === 'object' ? { ...(row.shop as Record<string, unknown>) } : {};
    if (!shop.name) shop.name = String(doc.shopName ?? row.platform ?? 'Shop');
    if (!shop.url) shop.url = String(doc.shopUrl ?? row.productUrl ?? '');
    if (shop.rating == null) shop.rating = Number(row.rating) || 0;
    row.shop = shop;
    return row;
  });
}

function joinPath(prefix: string, key: string): string {
  return prefix ? `${prefix}.${key}` : key;
}

const VALID_STATUS = new Set(['active', 'review', 'invalid']);
const VALID_PRODUCT_TYPE = new Set(['evergreen', 'trend-driven', 'seasonal', 'unknown']);
const VALID_PRICE_BAND = new Set(['budget', 'mid-range', 'premium']);
const VALID_SENTIMENT = new Set(['positive', 'neutral', 'negative']);
const VALID_GENDERS = new Set(['female', 'male', 'mixed', 'unisex']);
const VALID_INCOME = new Set(['budget', 'mid-range', 'premium', 'luxury']);
const VALID_INTENT = new Set(['impulse', 'considered', 'habitual', 'gifting']);
const VALID_CONTENT_FORMAT = new Set([
  'tutorial',
  'lifestyle',
  'entertainment',
  'review',
  'comparison',
]);
const VALID_METRIC_DIRECTION = new Set(['up', 'down', 'stable']);
const VALID_TREND_DIRECTION = new Set([
  'rising',
  'peaked',
  'saturating',
  'stable',
  'declining',
  'emerging',
  'viral',
  'unknown',
]);
const VALID_REVENUE_SOURCE = new Set(['product-sales', 'traffic-estimate']);
const MARKETPLACE_LISTING_FIELDS = [
  'alibabaListing',
  'aliexpressListing',
  'targetListing',
] as const;
const TITLE_MAX_LEN = 500;
const DESCRIPTION_MAX_LEN = 2000;

function requireNonEmpty(path: string, value: unknown, out: string[]): void {
  if (value == null || (typeof value === 'string' && !value.trim()))
    out.push(`${path} is required`);
}

function requireEnum(path: string, value: unknown, valid: Set<string>, out: string[]): void {
  const s = String(value ?? '').trim();
  if (!s || !valid.has(s)) out.push(`${path} must be one of ${[...valid].sort().join(', ')}`);
}

function requireNumberRange(
  path: string,
  value: unknown,
  out: string[],
  min?: number,
  max?: number,
): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    out.push(`${path} must be a number`);
    return;
  }
  if (min != null && value < min) out.push(`${path} must be >= ${min}`);
  if (max != null && value > max) out.push(`${path} must be <= ${max}`);
}

function validateMetricTrend(path: string, trend: unknown, out: string[]): void {
  if (!trend || typeof trend !== 'object') {
    out.push(`${path} is required`);
    return;
  }
  const row = trend as Record<string, unknown>;
  requireEnum(`${path}.direction`, row.direction, VALID_METRIC_DIRECTION, out);
  if (row.changePercent == null) out.push(`${path}.changePercent is required`);
  if (!Array.isArray(row.windows) || row.windows.length === 0) {
    out.push(`${path}.windows must not be empty`);
  }
}

function validateMarketplaceListing(path: string, listing: unknown, out: string[]): void {
  if (listing == null) return;
  if (!listing || typeof listing !== 'object') {
    out.push(`${path} must be an object`);
    return;
  }
  const row = listing as Record<string, unknown>;
  if (row.fetchedAt == null) out.push(`${path}.fetchedAt is required`);
  if (row.productUrl == null) out.push(`${path}.productUrl is required`);
  for (const [key, min, max] of [
    ['price', 0, undefined],
    ['originalPrice', 0, undefined],
    ['moq', 0, undefined],
    ['rating', 0, 5],
  ] as const) {
    if (row[key] != null) requireNumberRange(`${path}.${key}`, row[key], out, min, max);
  }
}

function validateSupplierRow(path: string, row: unknown, out: string[]): void {
  if (!row || typeof row !== 'object') {
    out.push(`${path} must be an object`);
    return;
  }
  const s = row as Record<string, unknown>;
  for (const key of ['source', 'externalId', 'title', 'productUrl', 'shareUrl']) {
    requireNonEmpty(`${path}.${key}`, s[key], out);
  }
  if (s.fetchedAt == null) out.push(`${path}.fetchedAt is required`);
  const rs = s.revenueSource;
  if (rs != null && String(rs).trim() && !VALID_REVENUE_SOURCE.has(String(rs))) {
    out.push(`${path}.revenueSource must be product-sales or traffic-estimate`);
  }
  for (const [key, min, max] of [
    ['rating', 0, 5],
    ['competitorScore', 0, 100],
    ['monthlyTraffic', 0, undefined],
    ['productUnitsSold', 1, undefined],
    ['price', 0, undefined],
    ['moq', 0, undefined],
  ] as const) {
    if (s[key] != null) requireNumberRange(`${path}.${key}`, s[key], out, min, max);
  }
  const shop = s.shop;
  if (shop && typeof shop === 'object') {
    const sh = shop as Record<string, unknown>;
    for (const key of ['name', 'url']) {
      if (sh[key] == null) out.push(`${path}.shop.${key} is required`);
    }
    if (sh.rating != null) requireNumberRange(`${path}.shop.rating`, sh.rating, out, 0, 5);
  }
}

function validateMarketingAngle(path: string, angle: unknown, out: string[]): void {
  if (!angle || typeof angle !== 'object') {
    out.push(`${path} must be an object`);
    return;
  }
  const row = angle as Record<string, unknown>;
  for (const key of ['hook', 'body', 'target']) {
    requireNonEmpty(`${path}.${key}`, row[key], out);
  }
}

export function collectSchemaViolations(doc: Record<string, unknown>): string[] {
  const out: string[] = [];

  requireNonEmpty('externalId', doc.externalId, out);
  requireNonEmpty('source', doc.source, out);
  requireNonEmpty('title', doc.title, out);
  requireNonEmpty('normalizedTitle', doc.normalizedTitle, out);
  requireNonEmpty('categoryL1', doc.categoryL1, out);
  requireNonEmpty('market', doc.market, out);
  requireEnum('status', doc.status, VALID_STATUS, out);

  const title = String(doc.title ?? '');
  if (title.length > TITLE_MAX_LEN) out.push(`title must be <= ${TITLE_MAX_LEN} characters`);
  const description = String(doc.description ?? '');
  if (description.length > DESCRIPTION_MAX_LEN) {
    out.push(`description must be <= ${DESCRIPTION_MAX_LEN} characters`);
  }

  requireNumberRange('rating', doc.rating, out, 0, 5);
  for (const key of [
    'reviewCount',
    'soldCount',
    'totalSales',
    'totalGmv',
    'viewCount',
    'likeCount',
  ]) {
    if (doc[key] != null) requireNumberRange(key, doc[key], out, 0);
  }

  if (doc.lastIngestedAt == null) out.push('lastIngestedAt is required');
  if (doc.dataSourceUpdatedAt == null) out.push('dataSourceUpdatedAt is required');
  if (doc.publishedAt == null) out.push('publishedAt is required');

  const pc = doc.primaryCreator;
  if (!pc || typeof pc !== 'object') out.push('primaryCreator is required');
  else {
    requireNonEmpty('primaryCreator.handle', (pc as Record<string, unknown>).handle, out);
  }

  const ai = doc.aiIntelligence;
  if (!ai || typeof ai !== 'object') out.push('aiIntelligence is required');
  else {
    const aiRow = ai as Record<string, unknown>;
    requireNumberRange('aiIntelligence.confidence', aiRow.confidence, out, 0, 100);
    requireNonEmpty('aiIntelligence.confidenceReason', aiRow.confidenceReason, out);
    requireNumberRange(
      'aiIntelligence.buyingSentimentScore',
      aiRow.buyingSentimentScore,
      out,
      0,
      100,
    );
    requireEnum('aiIntelligence.productType', aiRow.productType, VALID_PRODUCT_TYPE, out);
    requireEnum('aiIntelligence.priceBand', aiRow.priceBand, VALID_PRICE_BAND, out);
    if (aiRow.buyingSentimentLabel != null) {
      requireEnum(
        'aiIntelligence.buyingSentimentLabel',
        aiRow.buyingSentimentLabel,
        VALID_SENTIMENT,
        out,
      );
    }
    const rs = aiRow.reviewSummary;
    if (!rs || typeof rs !== 'object') out.push('aiIntelligence.reviewSummary is required');
    else {
      requireNonEmpty(
        'aiIntelligence.reviewSummary.summary',
        (rs as Record<string, unknown>).summary,
        out,
      );
      if ((rs as Record<string, unknown>).generatedAt == null) {
        out.push('aiIntelligence.reviewSummary.generatedAt is required');
      }
    }
    const ma = aiRow.marketingAnalysis;
    if (!ma || typeof ma !== 'object') out.push('aiIntelligence.marketingAnalysis is required');
    else {
      const maRow = ma as Record<string, unknown>;
      requireEnum(
        'aiIntelligence.marketingAnalysis.primaryGender',
        maRow.primaryGender,
        VALID_GENDERS,
        out,
      );
      requireEnum(
        'aiIntelligence.marketingAnalysis.incomeLevel',
        maRow.incomeLevel,
        VALID_INCOME,
        out,
      );
      requireEnum(
        'aiIntelligence.marketingAnalysis.purchaseIntent',
        maRow.purchaseIntent,
        VALID_INTENT,
        out,
      );
      requireEnum(
        'aiIntelligence.marketingAnalysis.contentFormat',
        maRow.contentFormat,
        VALID_CONTENT_FORMAT,
        out,
      );
      requireNonEmpty(
        'aiIntelligence.marketingAnalysis.marketingInsight',
        maRow.marketingInsight,
        out,
      );
      if (maRow.analyzedAt == null)
        out.push('aiIntelligence.marketingAnalysis.analyzedAt is required');
      const angles = maRow.angles;
      if (Array.isArray(angles)) {
        angles.forEach((angle, i) =>
          validateMarketingAngle(`aiIntelligence.marketingAnalysis.angles[${i}]`, angle, out),
        );
      }
    }
  }

  const trends = doc.trends;
  if (!trends || typeof trends !== 'object') out.push('trends is required');
  else {
    const eng = (trends as Record<string, unknown>).engagement;
    if (!eng || typeof eng !== 'object') out.push('trends.engagement is required');
    else {
      const e = eng as Record<string, unknown>;
      requireNumberRange('trends.engagement.score', e.score, out, 0, 5);
      requireEnum('trends.engagement.direction', e.direction, VALID_TREND_DIRECTION, out);
      if (e.isTrending == null) out.push('trends.engagement.isTrending is required');
      if (e.calculatedAt == null) out.push('trends.engagement.calculatedAt is required');
    }
  }

  validateMetricTrend('priceTrend', doc.priceTrend, out);
  validateMetricTrend('salesTrend', doc.salesTrend, out);
  validateMetricTrend('revenueTrend', doc.revenueTrend, out);

  const cc = doc.creativeCounts;
  if (!cc || typeof cc !== 'object') out.push('creativeCounts is required');
  else {
    for (const key of ['ads', 'organic', 'reviews', 'total']) {
      const val = (cc as Record<string, unknown>)[key];
      if (typeof val !== 'number') out.push(`creativeCounts.${key} is required`);
      else if (val < 0) out.push(`creativeCounts.${key} must be >= 0`);
    }
  }

  for (const field of MARKETPLACE_LISTING_FIELDS) {
    validateMarketplaceListing(field, doc[field], out);
  }

  const suppliers = doc.suppliers;
  if (Array.isArray(suppliers)) {
    suppliers.forEach((row, i) => validateSupplierRow(`suppliers[${i}]`, row, out));
  }

  return out;
}

export function collectNullEmptyViolations(
  value: unknown,
  path = '',
  out: string[] = [],
): string[] {
  if (value === null || value === undefined) {
    if (path && !isOptionalEmptyPath(path) && !isLenientPath(path))
      out.push(`${path} must not be null`);
    return out;
  }
  if (typeof value === 'string') {
    if (!value.trim() && path && !isOptionalEmptyPath(path) && !isLenientPath(path)) {
      out.push(`${path} must not be empty`);
    }
    return out;
  }
  if (Array.isArray(value)) {
    if (MIN_ONE_ARRAY_PATHS.has(path) && value.length === 0) {
      out.push(`${path} must not be empty`);
    }
    value.forEach((item, i) => {
      if (item === null && !isOptionalEmptyPath(`${path}[${i}]`)) {
        out.push(`${path}[${i}] must not be null`);
      } else if (item && typeof item === 'object' && !Array.isArray(item)) {
        for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
          if (SKIP_KEYS.has(k)) continue;
          collectNullEmptyViolations(v, joinPath(`${path}[${i}]`, k), out);
        }
      }
    });
    return out;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SKIP_KEYS.has(k)) continue;
      const child = joinPath(path, k);
      if (v === null || v === undefined) {
        if (!isOptionalEmptyPath(child) && !isLenientPath(child))
          out.push(`${child} must not be null`);
        continue;
      }
      if (
        typeof v === 'string' &&
        !v.trim() &&
        !isOptionalEmptyPath(child) &&
        !isLenientPath(child)
      ) {
        out.push(`${child} must not be empty`);
        continue;
      }
      if (Array.isArray(v) && MIN_ONE_ARRAY_PATHS.has(child) && v.length === 0) {
        out.push(`${child} must not be empty`);
        continue;
      }
      if (v && (typeof v === 'object' || Array.isArray(v))) {
        collectNullEmptyViolations(v, child, out);
      }
    }
  }
  return out;
}

export function productFieldCompletenessReasons(doc: Record<string, unknown>): string[] {
  const seen = new Set<string>();
  const reasons: string[] = [];
  for (const r of [...collectNullEmptyViolations(doc), ...collectSchemaViolations(doc)]) {
    if (!seen.has(r)) {
      seen.add(r);
      reasons.push(r);
    }
  }
  const shopAvatarS3 = doc.shopAvatarS3Key;
  if (typeof shopAvatarS3 === 'string' && shopAvatarS3.trim()) {
    return reasons.filter((r) => !r.startsWith('shopAvatarUrl ')).slice(0, 40);
  }
  return reasons.slice(0, 40);
}
