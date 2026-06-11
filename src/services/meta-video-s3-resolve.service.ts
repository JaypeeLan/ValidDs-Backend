import { Creative, type ICreativeDocument } from '../models/creative.model';
import { logger } from '../logger';
import type { Model } from 'mongoose';
import { isMetaCreative, metaAdIdFromCreative, metaAdMp4S3Key } from '../utils/meta-video-s3.util';
import { s3ObjectExists, tiktokVideoMp4S3Key } from '../utils/s3-video.util';

const log = logger.child({ module: 'meta-video-s3-resolve' });

type CreativePlain = Record<string, unknown>;

function pickStoredVideoS3Key(creative: CreativePlain, index: number): string | undefined {
  if (index <= 0) {
    const k = creative.videoS3Key;
    return typeof k === 'string' && k.trim() ? k.trim() : undefined;
  }
  const related = Array.isArray(creative.relatedVideos) ? creative.relatedVideos : [];
  const slot = related[index - 1] as CreativePlain | undefined;
  const k = slot?.videoS3Key;
  return typeof k === 'string' && k.trim() ? k.trim() : undefined;
}

async function keyExistsInS3(key: string | undefined): Promise<boolean> {
  if (!key) return false;
  return s3ObjectExists(key);
}

async function resolveMetaS3KeyForSlot(
  creative: CreativePlain,
  index: number,
): Promise<string | undefined> {
  if (index > 0) {
    const stored = pickStoredVideoS3Key(creative, index);
    return (await keyExistsInS3(stored)) ? stored : undefined;
  }

  const stored = pickStoredVideoS3Key(creative, index);
  if (stored && (await keyExistsInS3(stored))) return stored;

  if (!isMetaCreative(creative)) return undefined;
  const adId = metaAdIdFromCreative(creative);
  if (!adId) return undefined;

  const key = metaAdMp4S3Key(adId);
  if (!key) return undefined;

  return (await keyExistsInS3(key)) ? key : undefined;
}

async function resolveTikTokS3KeyForSlot(
  creative: CreativePlain,
  index: number,
): Promise<string | undefined> {
  const stored = pickStoredVideoS3Key(creative, index);
  if (stored && (await keyExistsInS3(stored))) return stored;

  if (index > 0) return undefined;

  const ext = String(creative.externalVideoId ?? '').trim();
  if (!/^\d+$/.test(ext)) return undefined;

  const key = tiktokVideoMp4S3Key(ext);
  return (await keyExistsInS3(key)) ? key : undefined;
}

async function resolvePlayableVideoS3Key(
  creative: CreativePlain,
  index: number,
): Promise<string | undefined> {
  if (isMetaCreative(creative)) return resolveMetaS3KeyForSlot(creative, index);
  return resolveTikTokS3KeyForSlot(creative, index);
}

function queuePersistVideoS3Key(
  creativeId: string,
  key: string,
  creativeModel: Model<ICreativeDocument>,
): void {
  void creativeModel
    .updateOne({ _id: creativeId }, { $set: { videoS3Key: key, videoDownloadReadyAt: new Date() } })
    .then((res) => {
      if (res.matchedCount) {
        log.debug('Backfilled videoS3Key from S3', { creativeId, key });
      }
    })
    .catch((err) => {
      log.debug('Failed to backfill videoS3Key', { creativeId, err: String(err) });
    });
}

function queueClearStaleVideoS3Key(
  creativeId: string,
  creativeModel: Model<ICreativeDocument>,
): void {
  void creativeModel
    .updateOne({ _id: creativeId }, { $unset: { videoS3Key: '' } })
    .then((res) => {
      if (res.matchedCount) {
        log.debug('Cleared stale videoS3Key (S3 object missing)', { creativeId });
      }
    })
    .catch((err) => {
      log.debug('Failed to clear stale videoS3Key', { creativeId, err: String(err) });
    });
}

async function enrichPrimaryVideoS3Key(
  doc: CreativePlain,
  creativeModel: Model<ICreativeDocument>,
): Promise<void> {
  const stored = pickStoredVideoS3Key(doc, 0);
  const resolved = await resolvePlayableVideoS3Key(doc, 0);
  const id = String(doc._id ?? doc.id ?? '');

  if (resolved) {
    doc.videoS3Key = resolved;
    if (resolved !== stored && id) queuePersistVideoS3Key(id, resolved, creativeModel);
    return;
  }

  delete doc.videoS3Key;
  if (stored && id) queueClearStaleVideoS3Key(id, creativeModel);
}

async function enrichRelatedVideoS3Keys(doc: CreativePlain): Promise<void> {
  const related = Array.isArray(doc.relatedVideos) ? doc.relatedVideos : [];
  if (!related.length) return;

  const next: CreativePlain[] = [];
  for (let i = 0; i < related.length; i++) {
    const slot = related[i];
    if (!slot || typeof slot !== 'object') continue;
    const row = { ...(slot as CreativePlain) };
    const stored =
      typeof row.videoS3Key === 'string' && row.videoS3Key.trim() ? row.videoS3Key.trim() : '';
    const resolved = await resolvePlayableVideoS3Key(doc, i + 1);
    if (resolved) {
      row.videoS3Key = resolved;
      next.push(row);
      continue;
    }
    if (stored) continue;
    // Keep slots without a stored key (legacy); they still won't get videoProxyUrl.
    next.push(row);
  }
  doc.relatedVideos = next;
}

/**
 * Verify S3 MP4 exists before exposing videoS3Key on API responses.
 * Clears stale Mongo keys when the object is missing from S3.
 */
export async function enrichCreativesWithResolvedVideoS3Keys(
  docs: CreativePlain[],
  creativeModel: Model<ICreativeDocument> = Creative,
): Promise<CreativePlain[]> {
  if (!docs.length) return docs;

  const out = docs.map((d) => ({ ...d }));
  await Promise.all(
    out.map(async (doc) => {
      await enrichPrimaryVideoS3Key(doc, creativeModel);
      await enrichRelatedVideoS3Keys(doc);
    }),
  );
  return out;
}

/** Resolve playable S3 key for GET /creatives/:id/video (primary or related slot). */
export async function resolveCreativeVideoS3Key(
  creative: CreativePlain,
  index = 0,
  creativeModel: Model<ICreativeDocument> = Creative,
): Promise<string | undefined> {
  const stored = pickStoredVideoS3Key(creative, index);
  const resolved = await resolvePlayableVideoS3Key(creative, index);
  if (!resolved) {
    if (stored && index <= 0) {
      const id = String(creative._id ?? creative.id ?? '');
      if (id) queueClearStaleVideoS3Key(id, creativeModel);
      delete creative.videoS3Key;
    }
    return undefined;
  }

  if (index <= 0) {
    creative.videoS3Key = resolved;
    const id = String(creative._id ?? creative.id ?? '');
    if (id && resolved !== stored) queuePersistVideoS3Key(id, resolved, creativeModel);
  }
  return resolved;
}
