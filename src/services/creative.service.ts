import { Creative, type ICreativeDocument } from '../models/creative.model';
import { Product } from '../models/product.model';
import { getMarketModels } from '../models/market-models.factory';
import type {
  CreativeCreatorFeedItem,
  CreativeFeedItem,
  ISecondaryVideoApi,
} from '../types/creative.types';
import type { ICreatorProfile } from '../types/creative.types';
import type { Model } from 'mongoose';
import { logger } from '../logger';
import mongoose, { type PipelineStage } from 'mongoose';
import { ScrapeCreatorsService } from './scrapecreators.service';
import { persistCreatorAvatarOnCreative } from './creator-avatar-cache.service';
import type { MarketCode } from '../utils/markets';
import type { AwemeMediaPatch } from '../utils/aweme-media.util';
import {
  apiSectionToDb,
  CREATIVE_COMMERCIAL_MATCH,
  CREATIVE_META_ADS_MATCH,
  formatCreativeFeedItem,
  formatCreativeCreatorFeedItem,
  formatCreativeForApi,
  filterPlayableCreativeFeedItems,
  shouldExposeCreativeInFeed,
  isVerifiedMetaCreative,
  creativeAdDedupeAggregationStages,
  creativeFeedExposureMatchStage,
} from '../utils/creative-response.util';
import { extractMetaAdIdFromUrl } from '../utils/meta-ad-url.util';
import { extractTikTokVideoId } from '../utils/tiktok-url.util';
import {
  creativeRecencyPrioritySortSpec,
  recencyTierAddFields,
} from '../utils/product-recency.util';
import {
  applyCreativeMetricFilters,
  type ContentMetricFilters,
} from '../utils/content-feed-filters.util';
import { enrichCreativesWithResolvedVideoS3Keys } from './meta-video-s3-resolve.service';
import { metaAdIdFromCreative } from '../utils/meta-video-s3.util';

export {
  apiSectionToDb,
  dbSectionToApi,
  CREATIVE_COMMERCIAL_MATCH,
  CREATIVE_META_ADS_MATCH,
  CREATIVE_TOP_ADS_MATCH,
  CREATIVE_TRENDING_MATCH,
} from '../utils/creative-response.util';

const log = logger.child({ module: 'creative-service' });

/** Delete a creative; remove its product when that was the only linked creative. */
export async function deleteCreativeAndOrphanProduct(
  market: MarketCode,
  creativeId: string,
): Promise<{ creativeDeleted: boolean; productDeleted: boolean; productId?: string }> {
  const { Creative: MarketCreative, Product: MarketProduct } = getMarketModels(market);
  const creative = await MarketCreative.findById(creativeId).select('productId').lean();
  if (!creative?.productId) {
    return { creativeDeleted: false, productDeleted: false };
  }

  const productId = creative.productId;
  await MarketCreative.findByIdAndDelete(creativeId);

  const remaining = await MarketCreative.countDocuments({ productId });
  let productDeleted = false;
  if (remaining === 0) {
    await MarketProduct.findByIdAndDelete(productId);
    productDeleted = true;
    log.info('Deleted product — last creative removed', {
      market,
      productId: String(productId),
      creativeId,
    });
  }

  return {
    creativeDeleted: true,
    productDeleted,
    productId: String(productId),
  };
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function pickUrl(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

function slotPostUrl(slot: {
  creator?: ICreatorProfile;
  externalVideoId?: string;
  tiktokPostUrl?: string;
}): string | undefined {
  const stored = pickUrl(slot.creator?.tiktokPostUrl, slot.tiktokPostUrl);
  if (stored) return stored;
  const awemeId = String(slot.externalVideoId ?? '').trim();
  const handle = String(slot.creator?.handle ?? '')
    .replace(/^@/, '')
    .trim();
  if (handle && awemeId && !awemeId.startsWith('meta:')) {
    return `https://www.tiktok.com/@${handle}/video/${awemeId}`;
  }
  return undefined;
}

async function fetchOembedThumbnail(postUrl: string): Promise<string | undefined> {
  try {
    const res = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(postUrl)}`, {
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { thumbnail_url?: string };
    const url = data.thumbnail_url;
    return typeof url === 'string' && url.startsWith('https://') ? url : undefined;
  } catch {
    return undefined;
  }
}

function mergeCreatorPatch(
  existing: ICreatorProfile | undefined,
  patch: AwemeMediaPatch['creator'] | undefined,
  avatarUrl?: string,
): ICreatorProfile | undefined {
  const base =
    existing && typeof (existing as { toObject?: unknown }).toObject === 'function'
      ? ((existing as unknown as { toObject: () => ICreatorProfile }).toObject() as ICreatorProfile)
      : existing
        ? ({ ...(existing as unknown as Record<string, unknown>) } as unknown as ICreatorProfile)
        : undefined;
  const nextAvatar = pickUrl(avatarUrl, patch?.avatarUrl, base?.avatarUrl);
  // If the creator subdocument is missing entirely (corrupt legacy rows), do NOT
  // synthesize a new creator object from partial patch fields; the Creative schema
  // requires creator.handle + creator.tiktokPostUrl.
  if (!base) {
    return undefined;
  }
  if (!nextAvatar && !patch) return base;
  return {
    handle: base.handle ?? '',
    verified: patch?.verified ?? base.verified ?? false,
    tiktokPostUrl: base.tiktokPostUrl ?? '',
    ...(base.displayName ? { displayName: base.displayName } : {}),
    ...(base.bio ? { bio: base.bio } : {}),
    ...(base.region ? { region: base.region } : {}),
    ...(base.isIndependentCreator != null
      ? { isIndependentCreator: base.isIndependentCreator }
      : {}),
    ...(nextAvatar ? { avatarUrl: nextAvatar } : {}),
    ...(patch?.followers != null ? { followers: patch.followers } : {}),
    ...(patch?.following != null ? { following: patch.following } : {}),
    ...(patch?.totalLikes != null ? { totalLikes: patch.totalLikes } : {}),
  };
}

function applyMediaPatch(
  target: {
    videoPlayUrl?: string;
    thumbnailUrl?: string;
    creator?: ICreatorProfile;
  },
  media: AwemeMediaPatch,
  avatarUrl?: string,
): boolean {
  let changed = false;
  if (media.videoPlayUrl && media.videoPlayUrl !== target.videoPlayUrl) {
    target.videoPlayUrl = media.videoPlayUrl;
    changed = true;
  }
  if (media.thumbnailUrl && media.thumbnailUrl !== target.thumbnailUrl) {
    target.thumbnailUrl = media.thumbnailUrl;
    changed = true;
  }
  const merged = mergeCreatorPatch(target.creator, media.creator, avatarUrl);
  if (merged && JSON.stringify(merged) !== JSON.stringify(target.creator ?? {})) {
    target.creator = merged;
    changed = true;
  }
  return changed;
}

async function syncProductCreatorAvatar(
  productId: mongoose.Types.ObjectId | string | undefined,
  avatarUrl: string | undefined,
): Promise<void> {
  if (!avatarUrl || !productId || !mongoose.isValidObjectId(productId)) return;
  await Product.updateOne(
    { _id: productId },
    {
      $set: {
        'primaryCreator.avatarUrl': avatarUrl,
        'primaryCreator.primaryImageUrl': avatarUrl,
      },
    },
  ).catch((err) => {
    log.debug('Failed to sync product creator avatar', {
      productId: String(productId),
      err: String(err),
    });
  });
}

const PRODUCT_CREATIVE_LIMIT = 100;
const MAX_PAGE_FILL_ROUNDS = 8;

type CreativeFeedDoc = Record<string, unknown>;

function buildCreativeFeedBaseStages(
  query: Record<string, unknown>,
  sortKey: string,
  sort: Record<string, unknown>,
): PipelineStage[] {
  return [
    { $match: query },
    creativeFeedExposureMatchStage() as PipelineStage,
    ...(sortKey === 'recent' ? [] : [{ $addFields: recencyTierAddFields() }]),
    { $sort: sort as PipelineStage.Sort['$sort'] },
    ...(creativeAdDedupeAggregationStages() as unknown as PipelineStage[]),
    { $unset: ['productDescription', '_recencyTier', '_postDate', 'adDedupeKey'] },
    { $sort: sort as PipelineStage.Sort['$sort'] },
  ];
}

function buildCreativeFeedGroupByCreatorStages(sort: Record<string, unknown>): PipelineStage[] {
  return [
    {
      $match: {
        'creator.handle': { $type: 'string', $regex: /\S/ },
      },
    },
    {
      $group: {
        _id: { $toLower: { $trim: { input: '$creator.handle' } } },
        creative: { $first: '$$ROOT' },
        videoCount: { $sum: 1 },
      },
    },
    {
      $replaceRoot: {
        newRoot: {
          $mergeObjects: ['$creative', { videoCount: '$videoCount' }],
        },
      },
    },
    { $sort: sort as PipelineStage.Sort['$sort'] },
  ];
}

async function countCreativeFeed(
  creativeModel: Model<ICreativeDocument>,
  baseStages: PipelineStage[],
  groupByCreator: boolean,
  sort: Record<string, unknown>,
): Promise<number> {
  const countStages = groupByCreator
    ? [...baseStages, ...buildCreativeFeedGroupByCreatorStages(sort)]
    : baseStages;
  const [result] = (await creativeModel
    .aggregate([...countStages, { $count: 'count' }])
    .option({ maxTimeMS: 15_000 })
    .exec()) as [{ count: number }] | [];
  return result?.count ?? 0;
}

async function fetchCreativeFeedBatch(
  creativeModel: Model<ICreativeDocument>,
  baseStages: PipelineStage[],
  groupByCreator: boolean,
  sort: Record<string, unknown>,
  skip: number,
  limit: number,
): Promise<CreativeFeedDoc[]> {
  const dataStages = groupByCreator
    ? [
        ...baseStages,
        ...buildCreativeFeedGroupByCreatorStages(sort),
        { $skip: skip },
        { $limit: limit },
      ]
    : [...baseStages, { $skip: skip }, { $limit: limit }];

  return (await creativeModel
    .aggregate(dataStages)
    .option({ maxTimeMS: 15_000 })
    .exec()) as CreativeFeedDoc[];
}

async function fillCreativeFeedPage(
  creativeModel: Model<ICreativeDocument>,
  baseStages: PipelineStage[],
  groupByCreator: boolean,
  sort: Record<string, unknown>,
  skip: number,
  mLimit: number,
): Promise<CreativeFeedDoc[]> {
  const collected: CreativeFeedDoc[] = [];
  let cursor = skip;
  const batchSize = Math.max(mLimit * 2, mLimit + 4);

  for (let round = 0; round < MAX_PAGE_FILL_ROUNDS && collected.length < mLimit; round++) {
    const batch = await fetchCreativeFeedBatch(
      creativeModel,
      baseStages,
      groupByCreator,
      sort,
      cursor,
      batchSize,
    );
    if (!batch.length) break;

    const enriched = await enrichCreativesWithResolvedVideoS3Keys(batch, creativeModel);
    const filtered = enriched.filter((doc) => shouldExposeCreativeInFeed(doc));
    collected.push(...filtered);
    cursor += batch.length;
    if (batch.length < batchSize) break;
  }

  return collected.slice(0, mLimit);
}

async function loadCreativesForProduct(
  productId: string,
  creativeModel: Model<ICreativeDocument>,
  extraFilter: Record<string, unknown>,
  limit = PRODUCT_CREATIVE_LIMIT,
): Promise<CreativeFeedItem[]> {
  if (!mongoose.isValidObjectId(productId)) return [];

  const mLimit = Math.min(Math.max(limit, 1), 100);
  const videoSort = creativeRecencyPrioritySortSpec('views');
  const baseStages = buildCreativeFeedBaseStages(
    {
      productId: new mongoose.Types.ObjectId(productId),
      ...extraFilter,
    },
    'views',
    videoSort,
  );

  const docs = await fillCreativeFeedPage(creativeModel, baseStages, false, videoSort, 0, mLimit);

  const items = docs.map((doc) => formatCreativeFeedItem(doc));
  return filterPlayableCreativeFeedItems(items);
}

/** TikTok video id or Meta ad id → creative Mongo id for angle videoProxyUrl. */
export async function loadPlayableVideoIndexForProduct(
  productId: string,
  creativeModel: Model<ICreativeDocument> = Creative,
): Promise<Map<string, string>> {
  if (!mongoose.Types.ObjectId.isValid(productId)) return new Map();

  const pid = new mongoose.Types.ObjectId(productId);
  const s3VideoFilter = { videoS3Key: { $exists: true, $nin: [null, ''] } };

  const [tiktokDocs, metaDocsRaw] = await Promise.all([
    creativeModel
      .find({
        productId: pid,
        externalVideoId: { $not: /^meta:/ },
        ...s3VideoFilter,
      })
      .select({ tiktokPostUrl: 1, embedUrl: 1, externalVideoId: 1 })
      .lean(),
    creativeModel
      .find({
        productId: pid,
        externalVideoId: { $regex: /^meta:/ },
      })
      .select({
        externalVideoId: 1,
        metaAdId: 1,
        metaAdLibraryUrl: 1,
        tiktokPostUrl: 1,
        embedUrl: 1,
        videoS3Key: 1,
      })
      .lean(),
  ]);
  const metaDocs = await enrichCreativesWithResolvedVideoS3Keys(
    metaDocsRaw as Record<string, unknown>[],
    creativeModel,
  );

  const index = new Map<string, string>();
  for (const doc of tiktokDocs) {
    const creativeId = String(doc._id);
    const urls = [doc.tiktokPostUrl, doc.embedUrl].filter(
      (u): u is string => typeof u === 'string' && u.length > 0,
    );
    for (const url of urls) {
      const vid = extractTikTokVideoId(url);
      if (vid) index.set(vid, creativeId);
    }
    const ext = String(doc.externalVideoId ?? '').trim();
    if (/^\d+$/.test(ext)) index.set(ext, creativeId);
  }

  for (const doc of metaDocs) {
    if (!isVerifiedMetaCreative(doc as Record<string, unknown>)) continue;
    const storedKey =
      typeof doc.videoS3Key === 'string' && doc.videoS3Key.trim() ? doc.videoS3Key.trim() : '';
    if (!storedKey) continue;

    const creativeId = String(doc._id);
    const adId = metaAdIdFromCreative(doc as Record<string, unknown>);
    if (adId) index.set(adId, creativeId);
    const ext = String(doc.externalVideoId ?? '').trim();
    const fromExt = extractMetaAdIdFromUrl(ext);
    if (fromExt) index.set(fromExt, creativeId);
    for (const field of [doc.metaAdLibraryUrl, doc.tiktokPostUrl, doc.embedUrl] as const) {
      const u = field;
      if (typeof u !== 'string' || !u.trim()) continue;
      const idFromUrl = extractMetaAdIdFromUrl(u);
      if (idFromUrl) index.set(idFromUrl, creativeId);
    }
  }
  return index;
}

/** Commercial videos for a product (`GET /products/:id` → `relatedVideos`). */
export async function findCreativesByProductId(
  productId: string,
  creativeModel: Model<ICreativeDocument> = Creative,
  limit = PRODUCT_CREATIVE_LIMIT,
): Promise<CreativeFeedItem[]> {
  return loadCreativesForProduct(productId, creativeModel, CREATIVE_COMMERCIAL_MATCH, limit);
}

/** Ad creatives only for a product (`GET /products/:id` → `relatedAds`). Meta + playable only. */
export async function findRelatedAdsByProductId(
  productId: string,
  creativeModel: Model<ICreativeDocument> = Creative,
  limit = PRODUCT_CREATIVE_LIMIT,
): Promise<CreativeFeedItem[]> {
  return loadCreativesForProduct(productId, creativeModel, CREATIVE_META_ADS_MATCH, limit);
}

/** Embedded secondary videos on a creative document (`GET /creatives/:id/related-videos`). */
export async function findRelatedVideosByCreativeId(
  creativeId: string,
  creativeModel: Model<ICreativeDocument> = Creative,
): Promise<ISecondaryVideoApi[] | null> {
  const doc = await creativeModel.findById(creativeId).lean();
  if (!doc) return null;
  const formatted = formatCreativeForApi(doc, { includeProductDescription: false });
  return formatted.relatedVideos ?? [];
}

export const CreativeService = {
  formatWithAllVideos(input: unknown) {
    return formatCreativeForApi(input, { includeProductDescription: true });
  },

  async fetchAndIngestCreatives(
    _productName?: string,
    _productId?: mongoose.Types.ObjectId,
    _options?: Record<string, unknown>,
  ): Promise<number> {
    log.info('Creative ingestion via external providers is disabled');
    return 0;
  },

  async mapAndSave(
    _item?: unknown,
    _productId?: mongoose.Types.ObjectId,
    _categoryL1?: string,
    _categoryL2?: string,
    _categoryL3?: string,
    _productName?: string,
    _productDescription?: string,
  ): Promise<boolean> {
    log.info('Creative map-and-save via external providers is disabled');
    return false;
  },

  async findCreatives(
    filters: Record<string, unknown>,
    extraMatch?: Record<string, unknown>,
    creativeModel: Model<ICreativeDocument> = Creative,
  ): Promise<{
    data: CreativeFeedItem[] | CreativeCreatorFeedItem[];
    pagination: { total: number; page: number; limit: number; pages: number };
    groupBy?: 'creator';
  }> {
    const {
      q,
      productId,
      source,
      section,
      isAd,
      minViews,
      hashtags,
      page = 1,
      limit = 20,
      sortBy = 'views',
      groupBy,
      categoryL1,
      categoryL2,
      categoryL3,
      _metricFilters,
    } = filters;
    const query: Record<string, unknown> = {};
    if (productId) {
      query.productId = mongoose.isValidObjectId(productId)
        ? new mongoose.Types.ObjectId(productId)
        : productId;
    }
    if (source === 'meta') query.externalVideoId = /^meta:/;
    if (source === 'tiktok') query.externalVideoId = { $not: /^meta:/ };
    if (section) query.section = apiSectionToDb(String(section));
    if (isAd !== undefined) query.isAd = isAd;
    if (minViews) query['metrics.viewCount'] = { $gte: Number(minViews) };
    const categoryL1List = categoryL1 as string[] | undefined;
    const categoryL2List = categoryL2 as string[] | undefined;
    const categoryL3List = categoryL3 as string[] | undefined;
    const hashtagList = hashtags as string[] | undefined;
    if (categoryL1List?.length) {
      query.categoryL1 = categoryL1List.length === 1 ? categoryL1List[0] : { $in: categoryL1List };
    }
    if (categoryL2List?.length) {
      query.categoryL2 = categoryL2List.length === 1 ? categoryL2List[0] : { $in: categoryL2List };
    }
    if (categoryL3List?.length) {
      query.categoryL3 = categoryL3List.length === 1 ? categoryL3List[0] : { $in: categoryL3List };
    }
    if (hashtagList?.length) {
      query.hashtags = { $in: hashtagList };
    }
    if (q) {
      const safeSearch = escapeRegex(String(q).trim());
      const regex = new RegExp(safeSearch, 'i');
      query.$or = [
        { productName: regex },
        { productDescription: regex },
        { description: regex },
        { hashtags: regex },
        { 'creator.handle': regex },
        { externalVideoId: regex },
      ];
    }
    if (extraMatch && Object.keys(extraMatch).length > 0) {
      Object.assign(query, extraMatch);
    }

    const metricFilters = (_metricFilters as ContentMetricFilters | undefined) ?? {};
    applyCreativeMetricFilters(query, metricFilters);

    const skip = (Number(page) - 1) * Number(limit);
    const mLimit = Number(limit);
    const sortKey = String(sortBy);
    const sort =
      sortKey === 'recent'
        ? { publishedAt: -1 as const }
        : creativeRecencyPrioritySortSpec(
            sortKey === 'likes' ? 'likes' : sortKey === 'engagement' ? 'engagement' : 'views',
          );

    const baseStages = buildCreativeFeedBaseStages(query, sortKey, sort);
    const groupByCreator = groupBy === 'creator';

    const [total, rawData] = await Promise.all([
      countCreativeFeed(creativeModel, baseStages, groupByCreator, sort),
      fillCreativeFeedPage(creativeModel, baseStages, groupByCreator, sort, skip, mLimit),
    ]);

    const rawItems = groupByCreator
      ? rawData.map((doc) => {
          const { videoCount, ...creative } = doc;
          return formatCreativeCreatorFeedItem(
            creative,
            typeof videoCount === 'number' ? videoCount : Number(videoCount) || 0,
          );
        })
      : rawData.map((doc) => formatCreativeFeedItem(doc));
    const data = filterPlayableCreativeFeedItems(rawItems);
    return {
      data,
      pagination: {
        total,
        page: Number(page),
        limit: mLimit,
        pages: Math.ceil(total / mLimit) || 0,
      },
      ...(groupByCreator ? { groupBy: 'creator' as const } : {}),
    };
  },

  async getCreativeById(id: string, creativeModel: Model<ICreativeDocument> = Creative) {
    const doc = await creativeModel.findById(id).lean();
    if (!doc) return null;
    const [enriched] = await enrichCreativesWithResolvedVideoS3Keys(
      [doc as Record<string, unknown>],
      creativeModel,
    );
    return formatCreativeForApi(enriched ?? doc, { includeProductDescription: true });
  },

  findByProductId: findCreativesByProductId,
  findRelatedAdsByProductId,

  async refreshCreativeMedia(
    creativeId: string | mongoose.Types.ObjectId,
    index = 0,
    market: MarketCode = 'US',
    creativeModel: Model<ICreativeDocument> = Creative,
  ): Promise<boolean> {
    try {
      const doc = await creativeModel.findById(creativeId);
      if (!doc) return false;

      const isRoot = index <= 0;
      const slotIndex = isRoot ? -1 : index - 1;
      const slot = isRoot ? doc : doc.relatedVideos?.[slotIndex];
      if (!slot) {
        log.debug('Creative refresh skipped: slot missing', {
          creativeId: String(creativeId),
          index,
        });
        return false;
      }

      const awemeId = String(slot.externalVideoId ?? '').trim();
      const handle = String(slot.creator?.handle ?? '')
        .replace(/^@/, '')
        .trim();
      const postUrl = slotPostUrl(slot);
      const region = String(slot.creator?.region ?? 'US').trim() || 'US';

      if (!handle && !postUrl) {
        log.debug('Creative refresh skipped: no handle or post url', {
          creativeId: String(creativeId),
          index,
        });
        return false;
      }

      if (!ScrapeCreatorsService.isConfigured()) {
        log.debug('Creative refresh skipped: ScrapeCreators not configured');
        return false;
      }

      let media: AwemeMediaPatch | null = null;
      if (handle && awemeId && !awemeId.startsWith('meta:')) {
        media = await ScrapeCreatorsService.findAwemeMedia(handle, awemeId, { region });
      } else if (awemeId.startsWith('meta:')) {
        const productThumb = pickUrl(String(doc.productPrimaryImageUrl ?? ''));
        if (productThumb) {
          media = { thumbnailUrl: productThumb };
        }
      }

      const profile = handle ? await ScrapeCreatorsService.getUserInfo(handle) : null;
      const profileAvatar = ScrapeCreatorsService.pickAvatarUrl(profile);

      if (!media?.thumbnailUrl && postUrl) {
        const oembedThumb = await fetchOembedThumbnail(postUrl);
        if (oembedThumb) {
          media = { ...(media ?? {}), thumbnailUrl: oembedThumb };
        }
      }

      if (!media && !profileAvatar) return false;

      const patch: AwemeMediaPatch = {
        ...(media ?? {}),
        ...(profileAvatar || media?.creator
          ? {
              creator: {
                ...(media?.creator ?? {}),
                ...(profileAvatar ? { avatarUrl: profileAvatar } : {}),
              },
            }
          : {}),
      };

      let changed = false;
      if (isRoot) {
        changed = applyMediaPatch(doc, patch, profileAvatar);
      } else {
        const related = doc.relatedVideos?.[slotIndex];
        if (!related) return false;
        changed = applyMediaPatch(related, patch, profileAvatar);
        if (changed) doc.markModified('relatedVideos');
      }

      if (changed) {
        await doc.save();
        if (isRoot && profileAvatar) {
          await syncProductCreatorAvatar(doc.productId, profileAvatar);
        }
      }

      let avatarCached = false;
      if (handle) {
        const cached = await persistCreatorAvatarOnCreative(String(creativeId), creativeModel, {
          index,
          market,
        });
        avatarCached = Boolean(cached?.avatarS3Key || cached?.avatarUrl);
      }

      if (!changed && !avatarCached) return false;

      log.info('Creative media refreshed', {
        creativeId: String(creativeId),
        index,
        awemeId: awemeId || undefined,
        handle: handle || undefined,
        avatarCached,
      });
      return true;
    } catch (err) {
      log.warn('Failed to refresh creative media', {
        creativeId: String(creativeId),
        index,
        err: String(err),
      });
      return false;
    }
  },

  async refreshAllSlotsForCreative(
    creativeId: string | mongoose.Types.ObjectId,
  ): Promise<{ scanned: number; refreshed: number; slots: number }> {
    const doc = await Creative.findById(creativeId).lean();
    if (!doc) return { scanned: 0, refreshed: 0, slots: 0 };

    const slots = 1 + (Array.isArray(doc.relatedVideos) ? doc.relatedVideos.length : 0);
    let refreshed = 0;
    let scanned = 0;

    for (let i = 0; i < slots; i += 1) {
      scanned += 1;
      const ok = await this.refreshCreativeMedia(creativeId, i);
      if (ok) refreshed += 1;
    }

    return { scanned, refreshed, slots };
  },

  async ingestByKeyword(
    _keyword?: string,
    _options?: { limit?: number; period?: number; country?: string },
  ): Promise<{ saved: number; productId: mongoose.Types.ObjectId; productTitle: string }> {
    throw new Error('Creative keyword ingestion is disabled');
  },
};
