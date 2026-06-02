import type { Model } from 'mongoose';
import { Product } from '../models/product.model';
import type { IProductDocument } from '../types/product.types';
import { logger } from '../logger';
import type { ICreativeDocument, ICreatorProfile } from '../types/creative.types';
import { collectThumbnailProxyCandidates } from '../utils/creative-image-proxy.util';
import { creatorAvatarS3Key, shopAvatarS3Key } from '../utils/creator-avatar.util';
import { cacheImageToS3, collectHttpsUrls } from '../utils/image-s3-cache.util';
import { isSuspiciousShopAvatarUrl } from '../utils/shop-avatar.util';
import { getS3Object, isS3Configured } from '../utils/s3-video.util';
import { fetchFreshShopLogoUrls } from './scrapecreators-shop.service';
import { ScrapeCreatorsService } from './scrapecreators.service';

const log = logger.child({ module: 'creator-avatar-cache' });

export type CachedCreatorAvatar = {
  avatarUrl?: string;
  avatarS3Key?: string;
};

export type CachedShopAvatar = {
  shopAvatarUrl?: string;
  shopAvatarS3Key?: string;
};

function normalizeHandle(handle: string): string {
  return handle.replace(/^@/, '').trim().toLowerCase();
}

async function freshProfileAvatarUrls(handle: string): Promise<string[]> {
  if (!ScrapeCreatorsService.isConfigured()) return [];
  const profile = await ScrapeCreatorsService.getUserInfo(handle);
  const url = ScrapeCreatorsService.pickAvatarUrl(profile);
  return url ? [url] : [];
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
  if (!s3Key) return null;

  const profileUrls = await freshProfileAvatarUrls(handle);
  const sourceUrls = collectHttpsUrls(...profileUrls, ...(input.sourceUrls ?? []));

  const cached = await cacheImageToS3({
    s3Key,
    sourceUrls,
    logLabel: `creator:${handle}`,
    fetchFreshUrls: async () => freshProfileAvatarUrls(handle),
  });
  if (!cached) return null;

  return {
    ...(cached.sourceUrl ? { avatarUrl: cached.sourceUrl } : {}),
    ...(cached.s3Key ? { avatarS3Key: cached.s3Key } : {}),
  };
}

/** Download shop logo to S3 — validates CDN URL before upload, fetches fresh logo on failure. */
export async function ensureShopAvatarCached(input: {
  shopName: string;
  sourceUrl?: string;
  sourceUrls?: string[];
  shopUrl?: string;
  creatorHandle?: string;
  creatorAvatarUrl?: string;
  primaryImageUrl?: string;
  market?: string;
  existingS3Key?: string;
  forceRefresh?: boolean;
}): Promise<CachedShopAvatar | null> {
  const shopName = (input.shopName || '').trim();
  if (!shopName) return null;

  const market = (input.market ?? 'US').toLowerCase();
  const s3Key = input.existingS3Key?.trim() || shopAvatarS3Key(shopName, market);
  if (!s3Key) return null;

  const storedSource = String(input.sourceUrl ?? '').trim();
  const useStoredSource =
    storedSource.startsWith('https://') &&
    !isSuspiciousShopAvatarUrl({
      shopAvatarUrl: storedSource,
      creatorAvatarUrl: input.creatorAvatarUrl,
      primaryImageUrl: input.primaryImageUrl,
    });

  const sourceUrls = useStoredSource
    ? collectHttpsUrls(storedSource, ...(input.sourceUrls ?? []))
    : collectHttpsUrls(...(input.sourceUrls ?? []));

  const cached = await cacheImageToS3({
    s3Key,
    sourceUrls,
    logLabel: `shop:${shopName}`,
    forceRefresh: input.forceRefresh,
    fetchFreshUrls: () =>
      fetchFreshShopLogoUrls({
        shopName,
        shopUrl: input.shopUrl,
        region: market.toUpperCase(),
      }),
  });
  if (!cached) return null;

  return {
    ...(cached.sourceUrl ? { shopAvatarUrl: cached.sourceUrl } : {}),
    ...(cached.s3Key ? { shopAvatarS3Key: cached.s3Key } : {}),
  };
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

  if (index <= 0 && doc.productId) {
    const productSet: Record<string, unknown> = {};
    if (cached.avatarUrl) {
      productSet['primaryCreator.avatarUrl'] = cached.avatarUrl;
      productSet['primaryCreator.primaryImageUrl'] = cached.avatarUrl;
    }
    if (cached.avatarS3Key) {
      productSet['primaryCreator.avatarS3Key'] = cached.avatarS3Key;
    }
    if (Object.keys(productSet).length) {
      await Product.updateOne({ _id: doc.productId }, { $set: productSet }).catch(() => undefined);
    }
  }

  return cached;
}

export async function persistShopAvatarOnCreative(
  creativeId: string,
  creativeModel: Model<ICreativeDocument>,
  options: { market?: string; forceRefresh?: boolean } = {},
): Promise<CachedShopAvatar | null> {
  const doc = await creativeModel.findById(creativeId).lean();
  if (!doc) return null;

  const plain = doc as Record<string, unknown>;
  const shopName = String(plain.shopName ?? '').trim();
  if (!shopName) return null;

  const creatorHandle = String((plain.creator as ICreatorProfile | undefined)?.handle ?? '').trim();

  const creator = plain.creator as ICreatorProfile | undefined;
  const cached = await ensureShopAvatarCached({
    shopName,
    sourceUrl: String(plain.shopAvatarUrl ?? ''),
    shopUrl: String(plain.shopUrl ?? ''),
    creatorHandle,
    creatorAvatarUrl: creator?.avatarUrl,
    market: options.market,
    existingS3Key: typeof plain.shopAvatarS3Key === 'string' ? plain.shopAvatarS3Key : undefined,
    forceRefresh: options.forceRefresh,
  });
  if (!cached) return null;

  const setFields: Record<string, unknown> = {};
  if (cached.shopAvatarUrl) setFields.shopAvatarUrl = cached.shopAvatarUrl;
  if (cached.shopAvatarS3Key) setFields.shopAvatarS3Key = cached.shopAvatarS3Key;

  if (Object.keys(setFields).length) {
    await creativeModel.updateOne({ _id: creativeId }, { $set: setFields });
  }

  if (doc.productId) {
    const productSet: Record<string, unknown> = {};
    if (cached.shopAvatarUrl) productSet.shopAvatarUrl = cached.shopAvatarUrl;
    if (cached.shopAvatarS3Key) productSet.shopAvatarS3Key = cached.shopAvatarS3Key;
    if (Object.keys(productSet).length) {
      await Product.updateOne({ _id: doc.productId }, { $set: productSet }).catch(() => undefined);
    }
  }

  return cached;
}

export async function persistShopAvatarOnProduct(
  productId: string,
  productModel: Model<IProductDocument>,
  creativeModel: Model<ICreativeDocument>,
  options: { market?: string; forceRefresh?: boolean } = {},
): Promise<CachedShopAvatar | null> {
  const doc = await productModel.findById(productId).lean();
  if (!doc) return null;

  const plain = doc as Record<string, unknown>;
  const shopName = String(plain.shopName ?? '').trim();
  if (!shopName) return null;

  const pc = plain.primaryCreator as Record<string, unknown> | undefined;
  const creatorHandle = typeof pc?.handle === 'string' ? pc.handle : undefined;

  const cached = await ensureShopAvatarCached({
    shopName,
    sourceUrl: String(plain.shopAvatarUrl ?? ''),
    shopUrl: String(plain.shopUrl ?? ''),
    creatorHandle,
    creatorAvatarUrl: typeof pc?.avatarUrl === 'string' ? pc.avatarUrl : undefined,
    primaryImageUrl:
      typeof plain.primaryImageUrl === 'string'
        ? plain.primaryImageUrl
        : typeof pc?.primaryImageUrl === 'string'
          ? pc.primaryImageUrl
          : undefined,
    market: options.market,
    existingS3Key: typeof plain.shopAvatarS3Key === 'string' ? plain.shopAvatarS3Key : undefined,
    forceRefresh: options.forceRefresh,
  });
  if (!cached) return null;

  const setFields: Record<string, unknown> = {};
  if (cached.shopAvatarUrl) setFields.shopAvatarUrl = cached.shopAvatarUrl;
  if (cached.shopAvatarS3Key) setFields.shopAvatarS3Key = cached.shopAvatarS3Key;

  if (Object.keys(setFields).length) {
    await productModel.updateOne({ _id: productId }, { $set: setFields });
  }

  await creativeModel.updateMany({ productId }, { $set: setFields }).catch((err) => {
    log.warn('Failed to sync shop avatar to creatives', { productId, err: String(err) });
  });

  return cached;
}

export async function streamCreatorAvatarFromS3(
  s3Key: string,
): Promise<Awaited<ReturnType<typeof getS3Object>> | null> {
  return getS3Object(s3Key, undefined, 'image/jpeg');
}

export async function streamShopAvatarFromS3(
  s3Key: string,
): Promise<Awaited<ReturnType<typeof getS3Object>> | null> {
  return getS3Object(s3Key, undefined, 'image/jpeg');
}

export function isShopAvatarS3Configured(): boolean {
  return isS3Configured();
}
