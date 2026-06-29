import { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import { getMarketModels } from '../../models/market-models.factory';
import { normalizeProductTitle } from '../../db/repositories/product.repository';
import { normalizePrimaryCreatorForStorage } from '../../utils/product-response.util';
import { toMarketCode, isValidMarket } from '../../utils/markets';
import {
  MAX_REVIEWS_INGEST,
  validateCreativeForIngest,
  validateProductForIngest,
} from './ingest.validation';
import { INGEST_QUALITY, hasTrendCurrentWindow, isAngleVideoCreative } from './ingest-quality';
import { normalizeCreativePayload, normalizeProductPayload } from './ingest.normalize';
import { persistAllCreatorAvatarsOnCreative } from '../../services/creator-avatar-cache.service';
import {
  enrichCreativeShopAvatarForIngest,
  enrichCreativeVideoS3ForIngest,
  enrichProductMediaForIngest,
  normalizeCreativeVideoIds,
  stripExternalPlaybackUrls,
  stripProductCdnAvatars,
} from '../../services/ingest-media-s3.service';
import { isProductHeroThumbnail } from '../../utils/creative-response.util';
import { mergeMetricTrendSnapshots } from '../../utils/metric-trend-merge.util';
import { isDailyRollDue, todayRollDate } from '../../utils/metric-trend-days.util';
import { extractMetaAdIdFromUrl } from '../../utils/meta-ad-url.util';
import { extractTikTokVideoId } from '../../utils/tiktok-url.util';
import { recomputeProductGmvFields } from './product-field-completeness';
import { logger } from '../../logger';

const log = logger.child({ module: 'internal-ingest' });

/** One organic primary-discovery video per product (matches product.postUrl when set). */
async function resolvePrimaryDiscoveryFlag(
  Creative: ReturnType<typeof getMarketModels>['Creative'],
  Product: ReturnType<typeof getMarketModels>['Product'],
  productId: Types.ObjectId,
  payload: Record<string, unknown>,
): Promise<void> {
  const externalVideoId = String(payload.externalVideoId ?? '');
  if (externalVideoId.startsWith('meta:') || externalVideoId.startsWith('ttad:')) {
    payload.isPrimaryDiscovery = false;
    return;
  }

  const product = await Product.findById(productId).select('postUrl').lean();
  const canonicalVideoId = extractTikTokVideoId(String(product?.postUrl ?? ''));
  const incomingVideoId =
    extractTikTokVideoId(String(payload.tiktokPostUrl ?? '')) ?? externalVideoId;

  const existingPrimary = await Creative.findOne({
    productId,
    isPrimaryDiscovery: true,
    externalVideoId: { $not: /^(meta:|ttad:)/ },
  })
    .select('_id externalVideoId tiktokPostUrl')
    .lean();

  if (!existingPrimary) {
    payload.isPrimaryDiscovery = true;
    return;
  }

  const existingId = String(existingPrimary.externalVideoId ?? '');
  if (existingId === externalVideoId) {
    payload.isPrimaryDiscovery = true;
    return;
  }

  if (canonicalVideoId && incomingVideoId === canonicalVideoId) {
    await Creative.updateOne({ _id: existingPrimary._id }, { $set: { isPrimaryDiscovery: false } });
    payload.isPrimaryDiscovery = true;
    return;
  }

  payload.isPrimaryDiscovery = false;
}

function parsePublishedAt(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

function mapReviews(reviews: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(reviews)) return [];
  return reviews.slice(0, MAX_REVIEWS_INGEST).map((r) => {
    if (!r || typeof r !== 'object')
      return { author: null, rating: null, content: null, date: null, item: null, images: [] };
    const row = r as Record<string, unknown>;
    const text = String(row.content ?? row.review ?? row.text ?? '').trim();
    const author = String(row.author ?? row.name ?? '').trim() || null;
    const rating = typeof row.rating === 'number' ? row.rating : 5;
    const item = String(row.item ?? 'General').trim() || 'General';
    const date = row.date ? String(row.date) : new Date().toISOString().slice(0, 10);
    const body = text || 'No review text provided.';
    return {
      name: author,
      author,
      rating,
      review: body,
      content: body,
      date,
      item,
      images: Array.isArray(row.images) ? row.images : [],
    };
  });
}

function prepareProductDoc(raw: Record<string, unknown>, market: string): Record<string, unknown> {
  const listingTitleRaw = String(raw.listingTitleRaw ?? raw.title ?? '')
    .trim()
    .slice(0, 500);
  const title = listingTitleRaw;
  const now = new Date();
  const published = parsePublishedAt(raw.publishedAt ?? raw.postCreatedAt);

  const doc: Record<string, unknown> = normalizeProductPayload({
    ...raw,
    title,
    listingTitleRaw,
    normalizedTitle: normalizeProductTitle(title),
    market,
    status: 'active',
    validationStatus: raw.validationStatus ?? 'valid',
    reviews: mapReviews(raw.reviews),
    primaryCreator: normalizePrimaryCreatorForStorage(
      (raw.primaryCreator ?? null) as Parameters<typeof normalizePrimaryCreatorForStorage>[0],
    ),
    lastIngestedAt: now,
    dataSourceUpdatedAt: raw.dataSourceUpdatedAt ?? now,
  });

  if (published) {
    doc.publishedAt = published;
  }

  return doc;
}

export async function ingestProduct(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = req.body as { market?: string; product?: Record<string, unknown> };
    const marketRaw = body.market ?? body.product?.market;
    if (!marketRaw || !isValidMarket(String(marketRaw).toUpperCase())) {
      res.status(422).json({ reasons: ['invalid or missing market'] });
      return;
    }
    const market = toMarketCode(String(marketRaw).toUpperCase());
    const product = body.product;
    if (!product || typeof product !== 'object') {
      res.status(422).json({ reasons: ['missing product payload'] });
      return;
    }

    const prepared = prepareProductDoc(product, market);
    await enrichProductMediaForIngest(prepared, market);
    stripProductCdnAvatars(prepared);

    const _sold = Number(prepared.soldCount ?? prepared.totalSales ?? 0) || 0;
    const _price = Number(prepared.price ?? 0);
    if (_price > 0 && _sold > 0) {
      Object.assign(prepared, recomputeProductGmvFields(prepared));
    }
    const _gmv = Number(prepared.totalGmv ?? prepared.storeGmv ?? 0) || 0;
    // Initialize missing metrics before validation so new products always have a today window.
    if (!prepared.storeGmv || Number(prepared.storeGmv) <= 0) {
      prepared.storeGmv = _gmv;
    }
    if (!hasTrendCurrentWindow(prepared.salesTrend)) {
      prepared.salesTrend = mergeMetricTrendSnapshots(prepared.salesTrend, undefined, _sold);
    }
    if (!hasTrendCurrentWindow(prepared.revenueTrend)) {
      prepared.revenueTrend = mergeMetricTrendSnapshots(prepared.revenueTrend, undefined, _gmv);
    }

    const reasons = validateProductForIngest(prepared, market);
    if (reasons.length > 0) {
      log.warn('Product rejected', {
        market,
        externalId: String(prepared.externalId ?? ''),
        reasons,
      });
      res.status(422).json({ reasons });
      return;
    }

    const { Product } = getMarketModels(market);
    const externalId = String(prepared.externalId ?? '');
    const source = String(prepared.source ?? 'scrapecreators-shop');

    const existing = await Product.findOne({ externalId, source }).lean();
    if (existing) {
      const sold = Number(prepared.soldCount ?? prepared.totalSales ?? 0) || 0;
      const gmv = Number(prepared.totalGmv ?? prepared.storeGmv ?? 0) || 0;
      const rollDue = isDailyRollDue(existing as Record<string, unknown>);
      prepared.salesTrend = mergeMetricTrendSnapshots(
        prepared.salesTrend,
        existing.salesTrend,
        sold,
        rollDue,
      );
      prepared.revenueTrend = mergeMetricTrendSnapshots(
        prepared.revenueTrend,
        existing.revenueTrend,
        gmv,
        rollDue,
      );
      if (rollDue) {
        prepared.metricTrendLastRollDate = todayRollDate();
      }
    }

    const saved = await Product.findOneAndUpdate(
      { externalId, source },
      { $set: prepared },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
    );

    if (!saved) {
      res.status(500).json({ success: false, error: 'upsert failed' });
      return;
    }

    log.info('Product ingested', { market, externalId, id: saved.id });

    try {
      const { Creative } = getMarketModels(market);
      const { syncCreativeProductTrends } =
        await import('../../services/sync-creative-product-trends.service.js');
      await syncCreativeProductTrends(
        saved._id,
        Creative,
        saved.toObject() as Record<string, unknown>,
      );
    } catch (err) {
      log.warn('Failed to sync product trends to creatives', {
        market,
        productId: String(saved._id),
        err: String(err),
      });
    }

    res.status(200).json({ success: true, id: String(saved._id) });
  } catch (err) {
    if (err && typeof err === 'object' && (err as { name?: string }).name === 'ValidationError') {
      const ve = err as { errors?: Record<string, { message?: string }> };
      const reasons = Object.values(ve.errors ?? {}).map((e) => e.message ?? 'validation error');
      res.status(422).json({ reasons: reasons.length ? reasons : ['mongoose validation failed'] });
      return;
    }
    next(err);
  }
}

export async function ingestCreative(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = req.body as { market?: string; creative?: Record<string, unknown> };
    const marketRaw = body.market;
    if (!marketRaw || !isValidMarket(String(marketRaw).toUpperCase())) {
      res.status(422).json({ reasons: ['invalid or missing market'] });
      return;
    }
    const market = toMarketCode(String(marketRaw).toUpperCase());
    const creative = body.creative;
    if (!creative || typeof creative !== 'object') {
      res.status(422).json({ reasons: ['missing creative payload'] });
      return;
    }

    const productId = String(creative.productId ?? '');
    if (!Types.ObjectId.isValid(productId)) {
      res.status(422).json({ reasons: ['invalid productId'] });
      return;
    }

    const published = parsePublishedAt(creative.publishedAt);
    const payload: Record<string, unknown> = normalizeCreativePayload({
      ...creative,
      productId: new Types.ObjectId(productId),
      ingestedAt: new Date(),
    });

    normalizeCreativeVideoIds(payload);
    await enrichCreativeVideoS3ForIngest(payload);
    await enrichCreativeShopAvatarForIngest(payload, market);
    stripExternalPlaybackUrls(payload);

    // Clamp stale publishedAt to yesterday instead of rejecting — mirrors Python finalize_creative_doc.
    // Angle-video creatives skip the age check entirely so they are not touched here.
    if (!isAngleVideoCreative(payload)) {
      const pubDate = parsePublishedAt(payload.publishedAt);
      const ageHours =
        pubDate === null ? Infinity : (Date.now() - pubDate.getTime()) / (1000 * 60 * 60);
      if (ageHours > INGEST_QUALITY.MAX_CREATIVE_AGE_HOURS) {
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
        yesterday.setUTCHours(12, 0, 0, 0);
        payload.publishedAt = yesterday;
      }
    }

    const reasons = validateCreativeForIngest(payload);
    if (reasons.length > 0) {
      res.status(422).json({ reasons });
      return;
    }

    const { Creative, Product } = getMarketModels(market);
    const externalVideoId = String(payload.externalVideoId ?? '');
    if (published) payload.publishedAt = published;

    await resolvePrimaryDiscoveryFlag(
      Creative,
      Product,
      payload.productId as Types.ObjectId,
      payload,
    );

    const creator = (payload.creator ?? {}) as Record<string, unknown>;
    const bio = creator.bio;
    if (!(typeof bio === 'string' && bio.trim())) {
      delete creator.bio;
      payload.creator = creator;
    }

    const adDedupeKey = String(payload.adDedupeKey ?? '').trim();
    const isMetaAd = externalVideoId.startsWith('meta:');
    // Always upsert on externalVideoId — unique index. adDedupeKey cleanup below handles same-ad dupes.
    const saved = await Creative.findOneAndUpdate(
      { externalVideoId },
      { $set: payload },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
    );

    if (!saved) {
      res.status(500).json({ success: false, error: 'upsert failed' });
      return;
    }

    if (isMetaAd && externalVideoId.includes(':')) {
      const adId = extractMetaAdIdFromUrl(externalVideoId);
      if (adId) {
        const legacyRemoved = await Creative.deleteMany({
          productId: payload.productId,
          externalVideoId: `meta:${adId}`,
          _id: { $ne: saved._id },
        });
        if (legacyRemoved.deletedCount > 0) {
          log.info('Removed legacy Meta creative row', {
            market,
            productId: String(payload.productId),
            adId,
            deletedCount: legacyRemoved.deletedCount,
          });
        }
      }
    }

    if (adDedupeKey) {
      const removed = await Creative.deleteMany({
        adDedupeKey,
        productId: payload.productId,
        _id: { $ne: saved._id },
      });
      if (removed.deletedCount > 0) {
        log.info('Removed duplicate creatives for adDedupeKey', {
          market,
          adDedupeKey,
          deletedCount: removed.deletedCount,
        });
      }
    }

    // Hero-thumbnail Meta ads look identical in feeds — keep one per product.
    if (isMetaAd && isProductHeroThumbnail(payload)) {
      const removedMeta = await Creative.deleteMany({
        productId: payload.productId,
        externalVideoId: { $regex: /^meta:/ },
        _id: { $ne: saved._id },
      });
      if (removedMeta.deletedCount > 0) {
        log.info('Removed extra Meta ads for product hero card', {
          market,
          productId: String(payload.productId),
          deletedCount: removedMeta.deletedCount,
        });
      }
    }

    try {
      await persistAllCreatorAvatarsOnCreative(String(saved._id), Creative, { market });
    } catch (err) {
      log.warn('Avatar cache on ingest failed', { id: saved.id, err: String(err) });
    }

    log.info('Creative ingested', { market, externalVideoId, adDedupeKey, id: saved.id });
    res.status(200).json({ success: true, id: String(saved._id) });
  } catch (err) {
    if (err && typeof err === 'object' && (err as { name?: string }).name === 'ValidationError') {
      const ve = err as { errors?: Record<string, { message?: string }> };
      const reasons = Object.values(ve.errors ?? {}).map((e) => e.message ?? 'validation error');
      res.status(422).json({ reasons: reasons.length ? reasons : ['mongoose validation failed'] });
      return;
    }
    next(err);
  }
}
