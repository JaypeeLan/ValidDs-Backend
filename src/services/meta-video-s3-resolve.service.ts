import { Creative, type ICreativeDocument } from '../models/creative.model';
import { logger } from '../logger';
import type { Model } from 'mongoose';
import { isMetaCreative, metaAdIdFromCreative, metaAdMp4S3Key } from '../utils/meta-video-s3.util';
import { s3ObjectExists } from '../utils/s3-video.util';

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

async function resolveMetaS3KeyForSlot(
  creative: CreativePlain,
  index: number,
): Promise<string | undefined> {
  const stored = pickStoredVideoS3Key(creative, index);
  if (stored) return stored;
  if (index > 0) return undefined;

  if (!isMetaCreative(creative)) return undefined;
  const adId = metaAdIdFromCreative(creative);
  if (!adId) return undefined;

  const key = metaAdMp4S3Key(adId);
  if (!key) return undefined;

  const exists = await s3ObjectExists(key);
  return exists ? key : undefined;
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

/**
 * Attach `videoS3Key` when the MP4 exists in S3 but Mongo was never patched
 * (common after async Meta video download).
 */
export async function enrichCreativesWithResolvedVideoS3Keys(
  docs: CreativePlain[],
  creativeModel: Model<ICreativeDocument> = Creative,
): Promise<CreativePlain[]> {
  if (!docs.length) return docs;

  const out = docs.map((d) => ({ ...d }));
  await Promise.all(
    out.map(async (doc) => {
      const stored = pickStoredVideoS3Key(doc, 0);
      if (stored) return;

      const resolved = await resolveMetaS3KeyForSlot(doc, 0);
      if (!resolved) return;

      doc.videoS3Key = resolved;
      const id = String(doc._id ?? doc.id ?? '');
      if (id) queuePersistVideoS3Key(id, resolved, creativeModel);
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
  if (stored) return stored;

  const resolved = await resolveMetaS3KeyForSlot(creative, index);
  if (!resolved) return undefined;

  if (index <= 0) {
    creative.videoS3Key = resolved;
    const id = String(creative._id ?? creative.id ?? '');
    if (id) queuePersistVideoS3Key(id, resolved, creativeModel);
  }
  return resolved;
}
