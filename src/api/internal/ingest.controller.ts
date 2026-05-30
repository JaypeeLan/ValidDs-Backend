import { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import { getMarketModels } from '../../models/market-models.factory';
import { normalizeProductTitle } from '../../db/repositories/product.repository';
import { normalizePrimaryCreatorForStorage } from '../../utils/product-response.util';
import { toMarketCode, isValidMarket } from '../../utils/markets';
import { validateCreativeForIngest, validateProductForIngest } from './ingest.validation';
import { normalizeCreativePayload, normalizeProductPayload } from './ingest.normalize';
import { logger } from '../../logger';

const log = logger.child({ module: 'internal-ingest' });

function parsePublishedAt(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

function mapReviews(reviews: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(reviews)) return [];
  return reviews.slice(0, 10).map((r) => {
    if (!r || typeof r !== 'object') return { author: null, rating: null, content: null, date: null, item: null, images: [] };
    const row = r as Record<string, unknown>;
    const text = String(row.content ?? row.review ?? row.text ?? '').trim();
    const author = String(row.author ?? row.name ?? '').trim() || null;
    return {
      name: author,
      author,
      rating: typeof row.rating === 'number' ? row.rating : null,
      review: text || null,
      content: text || null,
      date: row.date ? String(row.date) : null,
      item: row.item ? String(row.item) : null,
      images: Array.isArray(row.images) ? row.images : [],
    };
  });
}

function prepareProductDoc(raw: Record<string, unknown>, market: string): Record<string, unknown> {
  const title = String(raw.title ?? '').trim().slice(0, 120);
  const now = new Date();
  const published = parsePublishedAt(raw.publishedAt ?? raw.postCreatedAt);

  const doc: Record<string, unknown> = normalizeProductPayload({
    ...raw,
    title,
    normalizedTitle: normalizeProductTitle(title),
    market,
    status: 'active',
    validationStatus: raw.validationStatus ?? 'valid',
    reviews: mapReviews(raw.reviews),
    primaryCreator: normalizePrimaryCreatorForStorage(
      (raw.primaryCreator ?? null) as Parameters<typeof normalizePrimaryCreatorForStorage>[0]
    ),
    lastIngestedAt: now,
    dataSourceUpdatedAt: now,
  });

  if (published) {
    doc.publishedAt = published;
  }

  return doc;
}

export async function ingestProduct(req: Request, res: Response, next: NextFunction): Promise<void> {
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

    const reasons = validateProductForIngest(product, market);
    if (reasons.length > 0) {
      res.status(422).json({ reasons });
      return;
    }

    const { Product } = getMarketModels(market);
    const prepared = prepareProductDoc(product, market);
    const externalId = String(prepared.externalId ?? '');
    const source = String(prepared.source ?? 'scrapecreators-shop');

    const saved = await Product.findOneAndUpdate(
      { externalId, source },
      { $set: prepared },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );

    if (!saved) {
      res.status(500).json({ success: false, error: 'upsert failed' });
      return;
    }

    log.info('Product ingested', { market, externalId, id: saved.id });
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

export async function ingestCreative(req: Request, res: Response, next: NextFunction): Promise<void> {
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

    const reasons = validateCreativeForIngest(creative);
    if (reasons.length > 0) {
      res.status(422).json({ reasons });
      return;
    }

    const productId = String(creative.productId ?? '');
    if (!Types.ObjectId.isValid(productId)) {
      res.status(422).json({ reasons: ['invalid productId'] });
      return;
    }

    const { Creative } = getMarketModels(market);
    const externalVideoId = String(creative.externalVideoId ?? '');
    const published = parsePublishedAt(creative.publishedAt);
    const payload: Record<string, unknown> = normalizeCreativePayload({
      ...creative,
      productId: new Types.ObjectId(productId),
      ingestedAt: new Date(),
    });
    if (published) payload.publishedAt = published;

    const creator = (payload.creator ?? {}) as Record<string, unknown>;
    const bio = creator.bio;
    if (!(typeof bio === 'string' && bio.trim())) {
      delete creator.bio;
      payload.creator = creator;
    }

    const saved = await Creative.findOneAndUpdate(
      { externalVideoId },
      { $set: payload },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );

    if (!saved) {
      res.status(500).json({ success: false, error: 'upsert failed' });
      return;
    }

    log.info('Creative ingested', { market, externalVideoId, id: saved.id });
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
