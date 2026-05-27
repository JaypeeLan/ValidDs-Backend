/**
 * Mirrors scraper/pipeline/db_writer.py pre-insert validation.
 * Keeps scraper + backend aligned on what may be persisted.
 */

import { SUPPORTED_MARKETS, type MarketCode } from '../../utils/markets';

const MIN_RELATED_VIDEOS = 0; // optional — angles may ship without related video slots
const MIN_PRODUCT_IMAGES = 3;
const MAX_REVIEWS = 5;
const MAX_POST_AGE_DAYS = 90;

function parseDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

function postAgeRejection(value: unknown, label: string): string | null {
  const d = parseDate(value);
  if (!d) return `${label}: missing or invalid publishedAt`;
  const ageMs = Date.now() - d.getTime();
  if (ageMs < 0) return null;
  const days = ageMs / (1000 * 60 * 60 * 24);
  if (days > MAX_POST_AGE_DAYS) {
    return `${label}: older than ${MAX_POST_AGE_DAYS} days`;
  }
  return null;
}

function hasTrendCurrentWindow(trend: unknown): boolean {
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

export function validateProductForIngest(doc: Record<string, unknown>, market: MarketCode): string[] {
  const reasons: string[] = [];

  const title = doc.title;
  if (typeof title !== 'string' || title.trim().length < 8) {
    reasons.push('title too short (< 8 chars) — need TikTok Shop listing title');
  }
  const desc = doc.description;
  if (typeof desc !== 'string' || desc.trim().length < 50) {
    reasons.push('description too short (< 50 chars)');
  }
  if (!doc.categoryL1 || !doc.categoryL2 || !doc.categoryL3) {
    reasons.push('missing category levels');
  }
  if (!doc.shopName) reasons.push('missing shopName');
  const shopUrl = doc.shopUrl;
  if (typeof shopUrl !== 'string' || !shopUrl.startsWith('https://')) {
    reasons.push('shopUrl must be https');
  }

  const price = doc.price;
  if (typeof price !== 'number' || price < 1) {
    reasons.push('price must be >= $1');
  }
  const wantCurrency = SUPPORTED_MARKETS[market].currency;
  if (String(doc.currency ?? '').toUpperCase() !== wantCurrency) {
    reasons.push(`currency must be ${wantCurrency} for market ${market}`);
  }

  const rating = doc.rating;
  if (typeof rating !== 'number' || rating < 3.5) {
    reasons.push('rating must be >= 3.5');
  }
  const sold = doc.soldCount;
  if (typeof sold !== 'number' || sold < 1) {
    reasons.push('soldCount must be >= 1');
  }

  const images = doc.imageUrls;
  if (!Array.isArray(images) || images.length < MIN_PRODUCT_IMAGES) {
    reasons.push(`need at least ${MIN_PRODUCT_IMAGES} product images`);
  }

  const creator = (doc.primaryCreator ?? {}) as Record<string, unknown>;
  if (!creator.handle) reasons.push('creator.handle missing');
  const avatar = creator.avatarUrl;
  if (typeof avatar !== 'string' || !avatar.startsWith('https://')) {
    reasons.push('creator.avatarUrl must be https');
  }

  const views = doc.viewCount;
  if (typeof views !== 'number' || views < 1000) {
    reasons.push('viewCount must be >= 1000');
  }

  const reviews = doc.reviews;
  if (!Array.isArray(reviews) || reviews.length === 0) {
    reasons.push('need at least one review');
  } else if (reviews.length > MAX_REVIEWS) {
    reasons.push(`reviews must be capped at ${MAX_REVIEWS}`);
  }

  const ai = (doc.aiIntelligence ?? {}) as Record<string, unknown>;
  const rs = (ai.reviewSummary ?? {}) as Record<string, unknown>;
  const hasReviewText =
    Array.isArray(reviews) &&
    reviews.some((r) => {
      if (!r || typeof r !== 'object') return false;
      const row = r as Record<string, unknown>;
      const text = String(row.content ?? row.review ?? row.text ?? '').trim();
      return text.length >= 8;
    });
  if (hasReviewText && String(rs.summary ?? '').trim().length < 8) {
    reasons.push('missing reviewSummary for products with review text');
  }

  for (const key of ['priceTrend', 'salesTrend', 'revenueTrend'] as const) {
    if (!hasTrendCurrentWindow(doc[key])) {
      reasons.push(`${key} missing current-month window (monthsAgo=0)`);
    }
  }

  const angles = ((ai.marketingAnalysis as Record<string, unknown> | undefined)?.angles ??
    []) as unknown[];
  let validAngles = 0;
  for (const angle of angles) {
    if (!angle || typeof angle !== 'object') continue;
    const a = angle as Record<string, unknown>;
    const hook = typeof a.hook === 'string' ? a.hook.trim() : '';
    const body = typeof a.body === 'string' ? a.body.trim() : '';
    const target = typeof a.target === 'string' ? a.target.trim() : '';
    if (hook && body && target) validAngles += 1;
    const videoUrl = a.videoUrl;
    if (typeof videoUrl === 'string' && videoUrl && !videoUrl.startsWith('https://')) {
      reasons.push('angle videoUrl must be https when set');
    }
  }
  if (Array.isArray(angles) && angles.length > 0 && validAngles === 0) {
    reasons.push('angles missing hook/body/target');
  }

  const storeGmv = doc.storeGmv;
  if (typeof storeGmv !== 'number' || storeGmv <= 0) {
    reasons.push('storeGmv must be > 0');
  }
  const shopFollowers = doc.shopFollowers;
  if (typeof shopFollowers !== 'number' || shopFollowers <= 0) {
    reasons.push('shopFollowers must be > 0');
  }
  if (!doc.accountHandle) reasons.push('missing accountHandle');
  if (!doc.postCreatedAt) reasons.push('missing postCreatedAt');

  const postDate = doc.postCreatedAt ?? doc.publishedAt;
  const ageReason = postAgeRejection(postDate, 'primary post');
  if (ageReason) reasons.push(ageReason);
  if (!doc.creativeCounts) reasons.push('missing creativeCounts');

  const suppliers = doc.suppliers;
  if (!Array.isArray(suppliers) || suppliers.length < 4) {
    const n = Array.isArray(suppliers) ? suppliers.length : 0;
    reasons.push(`need at least 4 suppliers (Shopify + Google Shopping); got ${n}`);
  }

  return reasons;
}

export function validateCreativeForIngest(doc: Record<string, unknown>): string[] {
  const reasons: string[] = [];

  if (!doc.externalVideoId) reasons.push('missing externalVideoId');
  if (!doc.productId) reasons.push('missing productId');

  const externalId = String(doc.externalVideoId ?? '');
  const isMeta = externalId.startsWith('meta:');

  const postUrl = String(doc.tiktokPostUrl ?? '');
  if (isMeta) {
    if (!postUrl.startsWith('https://') || !postUrl.includes('facebook.com/ads/archive')) {
      reasons.push('tiktokPostUrl must be a Meta ad snapshot URL');
    }
  } else {
    if (!postUrl.includes('tiktok.com') || !postUrl.includes('/video/')) {
      reasons.push('tiktokPostUrl must be a TikTok video URL');
    }
  }
  const embed = String(doc.embedUrl ?? '');
  if (!embed.startsWith('https://')) reasons.push('embedUrl must be https');

  const thumb = String(doc.thumbnailUrl ?? '');
  if (!thumb.startsWith('https://') || thumb.includes('placehold.co')) {
    reasons.push('thumbnailUrl missing or placeholder');
  }

  const creator = (doc.creator ?? {}) as Record<string, unknown>;
  if (!creator.handle) reasons.push('creator.handle missing');
  const cAvatar = creator.avatarUrl;
  if (typeof cAvatar !== 'string' || !cAvatar.startsWith('https://')) {
    reasons.push('creator.avatarUrl must be https');
  }

  const metrics = (doc.metrics ?? {}) as Record<string, unknown>;
  const viewCount = metrics.viewCount;
  if (!isMeta) {
    if (typeof viewCount !== 'number' || viewCount < 1000) {
      reasons.push('viewCount must be >= 1000');
    }
  }

  const creativeAge = postAgeRejection(doc.publishedAt, 'creative');
  if (creativeAge) reasons.push(creativeAge);

  const related = doc.relatedVideos;
  if (
    MIN_RELATED_VIDEOS > 0 &&
    (!Array.isArray(related) || related.length < MIN_RELATED_VIDEOS)
  ) {
    reasons.push(`need at least ${MIN_RELATED_VIDEOS} related videos`);
  }

  const productRating = doc.productRating;
  if (typeof productRating !== 'number' || productRating < 3.5) {
    reasons.push('productRating must be >= 3.5');
  }

  if (!hasTrendCurrentWindow(doc.productSalesTrend)) {
    reasons.push('productSalesTrend missing today window');
  }

  return reasons;
}
