import type { Model } from 'mongoose';
import type { ICreativeDocument } from '../../types/creative.types';

/** Mongo duplicate-key error (e.g. unique index on externalVideoId / adDedupeKey). */
export function isMongoDuplicateKeyError(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === 'object' &&
    'code' in err &&
    (err as { code?: number }).code === 11000
  );
}

/**
 * Upsert filter for creatives — mirrors scraper/pipeline/mongo_ingest.py.
 * Meta/TikTok CC ads key on externalVideoId; organic rows with adDedupeKey key on that field.
 */
export function creativeUpsertFilter(payload: Record<string, unknown>): Record<string, unknown> {
  const externalVideoId = String(payload.externalVideoId ?? '').trim();
  const adDedupeKey = String(payload.adDedupeKey ?? '').trim();
  if (externalVideoId.startsWith('meta:') || externalVideoId.startsWith('ttad:')) {
    return { externalVideoId };
  }
  if (adDedupeKey) return { adDedupeKey };
  return { externalVideoId };
}

/**
 * Reject reusing a TikTok organic video on a different product (global externalVideoId index).
 * Meta / TikTok CC promos may legitimately share copy across products.
 */
export function isCrossProductVideoReuse(
  payload: Record<string, unknown>,
  existingProductId: unknown,
): boolean {
  const externalVideoId = String(payload.externalVideoId ?? '');
  if (externalVideoId.startsWith('meta:') || externalVideoId.startsWith('ttad:')) {
    return false;
  }
  return String(existingProductId ?? '') !== String(payload.productId ?? '');
}

/** Drop stale rows that would trip the adDedupeKey unique index on upsert (mainly Meta ad copy). */
export async function clearCreativeAdDedupeConflicts(
  Creative: Model<ICreativeDocument>,
  payload: Record<string, unknown>,
): Promise<void> {
  const externalVideoId = String(payload.externalVideoId ?? '').trim();
  const adDedupeKey = String(payload.adDedupeKey ?? '').trim();
  if (!adDedupeKey) return;

  await Creative.deleteMany({
    adDedupeKey,
    externalVideoId: { $ne: externalVideoId },
  });
}
