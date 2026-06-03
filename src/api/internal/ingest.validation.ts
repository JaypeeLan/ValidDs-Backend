/**
 * Pre-insert validation for internal ingest — mirrors scraper/pipeline/db_writer.py.
 */

import { SUPPORTED_MARKETS, type MarketCode } from '../../utils/markets';
import { normalizeMetaAdLibraryUrl } from '../../utils/meta-ad-url.util';
import { isTikTokPostUrl } from '../../utils/tiktok-url.util';
import {
  INGEST_QUALITY,
  MAX_REVIEWS_INGEST,
  MIN_PRODUCT_IMAGES,
  MIN_PRODUCT_RATING,
  MIN_VIEW_COUNT,
  asFiniteNumber,
  baselineProductQualityReasons,
  hasTrendCurrentWindow,
  isMetaCreative,
  MIN_PRODUCT_PRICE,
  marketingAngleFieldReasons,
  marketingAngles,
  postAgeRejection,
  strictProductQualityReasons,
  supplierTrafficReasons,
} from './ingest-quality';
import { productFieldCompletenessReasons } from './product-field-completeness';

export {
  BASELINE_INGEST,
  INGEST_QUALITY,
  MAX_REVIEWS_INGEST,
  MIN_PRODUCT_IMAGES,
  MIN_PRODUCT_PRICE,
} from './ingest-quality';

export function validateMetaCreativeForIngest(doc: Record<string, unknown>): string[] {
  const reasons: string[] = [];

  if (!doc.externalVideoId) reasons.push('missing externalVideoId');
  if (!doc.productId) reasons.push('missing productId');

  const rawUrl = String(
    doc.metaAdLibraryUrl ?? doc.tiktokPostUrl ?? doc.embedUrl ?? doc.externalVideoId ?? '',
  );
  const canonical =
    normalizeMetaAdLibraryUrl(rawUrl) ??
    normalizeMetaAdLibraryUrl(String(doc.externalVideoId ?? ''));
  if (!canonical) {
    reasons.push('meta ad needs https Ad Library viewer URL with numeric id');
  } else {
    if (rawUrl.toLowerCase().includes('access_token=')) {
      reasons.push('meta ad URL must not contain access_token');
    }
    if (!canonical.includes('facebook.com/ads/library/?id=')) {
      reasons.push('meta ad URL must be canonical Ad Library viewer link');
    }
  }

  const thumb = String(doc.thumbnailUrl ?? '');
  if (!thumb.startsWith('https://')) {
    reasons.push('thumbnailUrl must be https');
  }

  const creator = (doc.creator ?? {}) as Record<string, unknown>;
  if (!creator.handle) reasons.push('creator.handle missing');
  const avatar = creator.avatarUrl;
  if (typeof avatar !== 'string' || !avatar.startsWith('https://')) {
    reasons.push('creator.avatarUrl must be https');
  }

  const rating = asFiniteNumber(doc.productRating);
  if (rating === null || rating < MIN_PRODUCT_RATING) {
    reasons.push(`productRating must be >= ${MIN_PRODUCT_RATING}`);
  }

  const videoS3 = doc.videoS3Key;
  if (typeof videoS3 !== 'string' || !videoS3.trim()) {
    reasons.push('videoS3Key required — Meta MP4 must be in S3 before ingest');
  }

  return reasons;
}

export function validateProductForIngest(
  doc: Record<string, unknown>,
  market: MarketCode,
): string[] {
  const reasons: string[] = [];

  if (!doc.externalId) reasons.push('missing externalId');
  if (!doc.source) reasons.push('missing source');

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

  const shopAvatar = String(doc.shopAvatarUrl ?? '');
  if (!shopAvatar.startsWith('https://')) {
    reasons.push('shopAvatarUrl must be https');
  }

  const price = asFiniteNumber(doc.price);
  if (price === null || price < MIN_PRODUCT_PRICE) {
    reasons.push(`price must be >= $${MIN_PRODUCT_PRICE}`);
  }

  const wantCurrency = SUPPORTED_MARKETS[market].currency;
  if (String(doc.currency ?? '').toUpperCase() !== wantCurrency) {
    reasons.push(`currency must be ${wantCurrency} for market ${market}`);
  }

  const rating = asFiniteNumber(doc.rating);
  if (rating === null || rating < MIN_PRODUCT_RATING) {
    reasons.push(`rating must be >= ${MIN_PRODUCT_RATING}`);
  }

  const images = doc.imageUrls;
  if (!Array.isArray(images) || images.length < MIN_PRODUCT_IMAGES) {
    reasons.push(`need at least ${MIN_PRODUCT_IMAGES} product images`);
  }

  const creator = (doc.primaryCreator ?? {}) as Record<string, unknown>;
  if (!creator.handle) reasons.push('creator.handle missing');
  const avatarS3 = creator.avatarS3Key;
  if (typeof avatarS3 !== 'string' || !avatarS3.trim()) {
    reasons.push('primaryCreator.avatarS3Key required — profile image must be in S3 before ingest');
  }

  const views = asFiniteNumber(doc.viewCount);
  if (views === null || views < MIN_VIEW_COUNT) {
    reasons.push(`viewCount must be >= ${MIN_VIEW_COUNT}`);
  }

  const reviews = doc.reviews;
  if (Array.isArray(reviews) && reviews.length > MAX_REVIEWS_INGEST) {
    reasons.push(`reviews must be capped at ${MAX_REVIEWS_INGEST}`);
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

  for (const key of ['salesTrend', 'revenueTrend'] as const) {
    if (!hasTrendCurrentWindow(doc[key])) {
      reasons.push(`${key} missing today window (daysAgo=0)`);
    }
  }

  reasons.push(...marketingAngleFieldReasons(doc));

  for (const angle of marketingAngles(doc)) {
    const videoUrl = angle.videoUrl;
    if (typeof videoUrl !== 'string' || !videoUrl) continue;
    if (!videoUrl.startsWith('https://')) {
      reasons.push('angle videoUrl must be https when set');
      continue;
    }
    if (!isTikTokPostUrl(videoUrl)) {
      reasons.push('angle videoUrl must be a TikTok post URL for playable video');
    }
  }

  const storeGmv = asFiniteNumber(doc.storeGmv);
  if (storeGmv === null || storeGmv <= 0) {
    reasons.push('storeGmv must be > 0');
  }

  const shopFollowers = asFiniteNumber(doc.shopFollowers);
  if (shopFollowers === null || shopFollowers <= 0) {
    reasons.push('shopFollowers must be > 0');
  }

  if (!doc.accountHandle) reasons.push('missing accountHandle');
  if (!doc.postCreatedAt) reasons.push('missing postCreatedAt');

  const postDate = doc.postCreatedAt ?? doc.publishedAt;
  const ageReason = postAgeRejection(postDate, 'primary post');
  if (ageReason) reasons.push(ageReason);

  if (!doc.creativeCounts) reasons.push('missing creativeCounts');

  reasons.push(...baselineProductQualityReasons(doc));
  reasons.push(...strictProductQualityReasons(doc, market));
  reasons.push(...supplierTrafficReasons(doc));
  reasons.push(...productFieldCompletenessReasons(doc));

  return reasons;
}

export function validateCreativeForIngest(doc: Record<string, unknown>): string[] {
  if (isMetaCreative(doc)) {
    return validateMetaCreativeForIngest(doc);
  }

  const reasons: string[] = [];

  if (!doc.externalVideoId) reasons.push('missing externalVideoId');
  if (!doc.productId) reasons.push('missing productId');

  const postUrl = String(doc.tiktokPostUrl ?? '');
  if (!postUrl.includes('tiktok.com') || !postUrl.includes('/video/')) {
    reasons.push('tiktokPostUrl must be a TikTok video URL');
  }

  const thumb = String(doc.thumbnailUrl ?? '');
  if (!thumb.startsWith('https://') || thumb.includes('placehold.co')) {
    reasons.push('thumbnailUrl missing or placeholder');
  }

  const creator = (doc.creator ?? {}) as Record<string, unknown>;
  if (!creator.handle) reasons.push('creator.handle missing');

  const videoS3 = doc.videoS3Key;
  if (typeof videoS3 !== 'string' || !videoS3.trim()) {
    reasons.push('videoS3Key required — TikTok MP4 must be in S3 before ingest');
  }

  const avatarS3 = creator.avatarS3Key;
  if (typeof avatarS3 !== 'string' || !avatarS3.trim()) {
    reasons.push('creator.avatarS3Key required — profile image must be in S3 before ingest');
  }

  const metrics = (doc.metrics ?? {}) as Record<string, unknown>;
  const viewCount = asFiniteNumber(metrics.viewCount);
  if (viewCount === null || viewCount < MIN_VIEW_COUNT) {
    reasons.push(`viewCount must be >= ${MIN_VIEW_COUNT}`);
  }

  const creativeAge = postAgeRejection(doc.publishedAt, 'creative');
  if (creativeAge) reasons.push(creativeAge);

  const related = doc.relatedVideos;
  if (!Array.isArray(related) || related.length < INGEST_QUALITY.MIN_RELATED_VIDEOS) {
    reasons.push(`need at least ${INGEST_QUALITY.MIN_RELATED_VIDEOS} related videos`);
  }

  const productRating = asFiniteNumber(doc.productRating);
  if (productRating === null || productRating < MIN_PRODUCT_RATING) {
    reasons.push(`productRating must be >= ${MIN_PRODUCT_RATING}`);
  }

  if (!hasTrendCurrentWindow(doc.productSalesTrend)) {
    reasons.push('productSalesTrend missing today window');
  }

  return reasons;
}
