import type { Model } from 'mongoose';
import { Product } from '../models/product.model';
import { logger } from '../logger';
import type { ICreativeDocument, ICreatorProfile } from '../types/creative.types';
import { collectThumbnailProxyCandidates } from '../utils/creative-image-proxy.util';
import {
  creatorAvatarS3Key,
  downloadImageBuffer,
  shopAvatarS3Key,
  TIKTOK_IMAGE_HEADERS,
} from '../utils/creator-avatar.util';
import { getS3Object, isS3Configured, putS3Object, s3ObjectExists } from '../utils/s3-video.util';
import { ScrapeCreatorsService } from './scrapecreators.service';

const log = logger.child({ module: 'creator-avatar-cache' });

export type CachedCreatorAvatar = {
  avatarUrl?: string;
  avatarS3Key?: string;
};

function normalizeHandle(handle: string): string {
  return handle.replace(/^@/, '').trim().toLowerCase();
}

async function freshProfileAvatarUrl(handle: string): Promise<string | undefined> {
  if (!ScrapeCreatorsService.isConfigured()) return undefined;
  const profile = await ScrapeCreatorsService.getUserInfo(handle);
  return ScrapeCreatorsService.pickAvatarUrl(profile);
}

/** Download from CDN and persist to S3 — stable URL for proxy reads. */
export async function ensureCreatorAvatarCached(input: {
  handle: string;
  sourceUrls?: string[];
  market?: string;
  existingS3Key?: string;
}): Promise<CachedCreatorAvatar | null> {
  const handle = normalizeHandle(input.handle);
  if (!handle) return null;

  const market = (input.market ?? 'US').toLowerCase();
  const s3Key = input.existingS3Key?.trim() || creatorAvatarS3Key(handle, market);

  if (s3Key && isS3Configured() && (await s3ObjectExists(s3Key))) {
    return { avatarS3Key: s3Key };
  }

  const urls: string[] = [];
  const profileUrl = await freshProfileAvatarUrl(handle);
  if (profileUrl) urls.push(profileUrl);
  for (const u of input.sourceUrls ?? []) {
    if (typeof u === 'string' && u.startsWith('https://') && !urls.includes(u)) urls.push(u);
  }

  let lastAvatarUrl: string | undefined;
  for (const url of urls) {
    const downloaded = await downloadImageBuffer(url, TIKTOK_IMAGE_HEADERS);
    if (!downloaded) continue;
    lastAvatarUrl = url;

    if (isS3Configured() && s3Key) {
      try {
        await putS3Object(s3Key, downloaded.buffer, downloaded.contentType);
        log.debug('Cached creator avatar to S3', { handle, s3Key });
        return { avatarUrl: url, avatarS3Key: s3Key };
      } catch (err) {
        log.warn('S3 avatar upload failed', { handle, s3Key, err: String(err) });
      }
    }

    return { avatarUrl: url };
  }

  return lastAvatarUrl ? { avatarUrl: lastAvatarUrl } : null;
}

/** Download shop logo to S3 (same bucket prefix as creator avatars). */
export async function ensureShopAvatarCached(input: {
  shopName: string;
  sourceUrl?: string;
  market?: string;
  existingS3Key?: string;
}): Promise<{ shopAvatarS3Key?: string } | null> {
  const shopName = (input.shopName || '').trim();
  const url = (input.sourceUrl || '').trim();
  if (!shopName || !url.startsWith('https://')) return null;

  const market = (input.market ?? 'US').toLowerCase();
  const s3Key = input.existingS3Key?.trim() || shopAvatarS3Key(shopName, market);
  if (!s3Key) return null;

  if (isS3Configured() && (await s3ObjectExists(s3Key))) {
    return { shopAvatarS3Key: s3Key };
  }

  const downloaded = await downloadImageBuffer(url, TIKTOK_IMAGE_HEADERS);
  if (!downloaded) return null;

  if (isS3Configured()) {
    try {
      await putS3Object(s3Key, downloaded.buffer, downloaded.contentType);
      return { shopAvatarS3Key: s3Key };
    } catch (err) {
      log.warn('S3 shop avatar upload failed', { shopName, s3Key, err: String(err) });
    }
  }
  return null;
}

export async function persistAllCreatorAvatarsOnCreative(
  creativeId: string,
  creativeModel: Model<ICreativeDocument>,
  options: { market?: string } = {},
): Promise<void> {
  const doc = await creativeModel.findById(creativeId).select('relatedVideos').lean();
  const relatedLen = Array.isArray((doc as { relatedVideos?: unknown[] } | null)?.relatedVideos)
    ? (doc as { relatedVideos: unknown[] }).relatedVideos.length
    : 0;
  const slots = 1 + relatedLen;
  for (let index = 0; index < slots; index += 1) {
    await persistCreatorAvatarOnCreative(creativeId, creativeModel, {
      market: options.market,
      index,
    });
  }
}

function creatorFromSlot(doc: Record<string, unknown>, index: number): ICreatorProfile | undefined {
  if (index <= 0) return doc.creator as ICreatorProfile | undefined;
  const related = Array.isArray(doc.relatedVideos) ? doc.relatedVideos : [];
  const node = related[index - 1] as { creator?: ICreatorProfile } | undefined;
  return node?.creator;
}

/** Refresh avatar from profile API + S3, then persist on the creative (and product). */
export async function persistCreatorAvatarOnCreative(
  creativeId: string,
  creativeModel: Model<ICreativeDocument>,
  options: { index?: number; market?: string } = {},
): Promise<CachedCreatorAvatar | null> {
  const index = options.index ?? 0;
  const doc = await creativeModel.findById(creativeId).lean();
  if (!doc) return null;

  const plain = doc as Record<string, unknown>;
  const creator = creatorFromSlot(plain, index);
  const handle = String(creator?.handle ?? '').trim();
  if (!handle) return null;

  const existingS3Key =
    typeof (creator as ICreatorProfile & { avatarS3Key?: string })?.avatarS3Key === 'string'
      ? (creator as ICreatorProfile & { avatarS3Key?: string }).avatarS3Key
      : undefined;

  const cached = await ensureCreatorAvatarCached({
    handle,
    sourceUrls: collectThumbnailProxyCandidates(plain, index, 'avatar'),
    market: options.market,
    existingS3Key,
  });
  if (!cached) return null;

  const setFields: Record<string, unknown> = {};
  if (cached.avatarUrl) {
    if (index <= 0) {
      setFields['creator.avatarUrl'] = cached.avatarUrl;
    } else {
      setFields[`relatedVideos.${index - 1}.creator.avatarUrl`] = cached.avatarUrl;
    }
  }
  if (cached.avatarS3Key) {
    if (index <= 0) {
      setFields['creator.avatarS3Key'] = cached.avatarS3Key;
    } else {
      setFields[`relatedVideos.${index - 1}.creator.avatarS3Key`] = cached.avatarS3Key;
    }
  }

  if (Object.keys(setFields).length) {
    await creativeModel.updateOne({ _id: creativeId }, { $set: setFields });
  }

  if (index <= 0 && cached.avatarUrl && doc.productId) {
    await Product.updateOne(
      { _id: doc.productId },
      {
        $set: {
          'primaryCreator.avatarUrl': cached.avatarUrl,
          'primaryCreator.primaryImageUrl': cached.avatarUrl,
        },
      },
    ).catch(() => undefined);
  }

  return cached;
}

export async function streamCreatorAvatarFromS3(
  s3Key: string,
): Promise<Awaited<ReturnType<typeof getS3Object>> | null> {
  return getS3Object(s3Key, undefined, 'image/jpeg');
}
