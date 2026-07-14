import { Creative, type ICreativeDocument } from '../models/creative.model';
import { Product } from '../models/product.model';
import { getMarketModels } from '../models/market-models.factory';
import type {
  CreativeCreatorFeedItem,
  CreatorLobbyItem,
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
  CREATIVE_TOP_ADS_MATCH,
  formatCreativeFeedItem,
  formatCreativeCreatorFeedItem,
  formatCreativeForApi,
  filterPlayableCreativeFeedItems,
  shouldExposeCreativeInFeed,
  isVerifiedMetaCreative,
  creativeAdDedupeAggregationStages,
  creativeFeedExposureMatchStage,
  creativeOneAdPerProductFeedStages,
} from '../utils/creative-response.util';
import { enrichCreativeRelatedVideoMetrics } from '../utils/related-video-metrics.util';
import { expandCategoryL1FilterValues } from '../utils/category-l1-normalize.util';
import { filterL1CategoriesWithProducts } from '../utils/product-category-catalog.util';
import { CacheKeys, CACHE_TTL } from '../cache/cache.keys';
import { CacheService } from '../cache/cache.service';
import { DEFAULT_MARKET } from '../utils/markets';
import { extractMetaAdIdFromUrl } from '../utils/meta-ad-url.util';
import { extractTikTokVideoId } from '../utils/tiktok-url.util';
import {
  creativeEngagementMetricSortSpec,
  recencyTierAddFields,
  sortSpecWithoutRecencyFields,
} from '../utils/product-recency.util';
import {
  creativeSortSkipsRecencyTier,
  resolveCreativeSort,
  type CreativeSortBy,
} from '../api/creatives/creative-feed-filters.util';
import {
  applyCreativeMetricFilters,
  mergeCreativeFeedExtraMatch,
  type ContentMetricFilters,
} from '../utils/content-feed-filters.util';
import { enrichCreativesWithResolvedVideoS3Keys } from './meta-video-s3-resolve.service';
import { metaAdIdFromCreative } from '../utils/meta-video-s3.util';
import { findProductCreators } from './product-creator.service';
import type { IProductDocument } from '../types/product.types';
import { excludedProductCategoryL1Filter } from '../utils/excluded-product-categories.util';

export {
  apiSectionToDb,
  dbSectionToApi,
  CREATIVE_COMMERCIAL_MATCH,
  CREATIVE_META_ADS_MATCH,
  CREATIVE_TOP_ADS_MATCH,
  CREATIVE_TRENDING_MATCH,
} from '../utils/creative-response.util';

const log = logger.child({ module: 'creative-service' });

function productModelForCreativeModel(
  creativeModel: Model<ICreativeDocument>,
): Model<IProductDocument> | undefined {
  const coll = creativeModel.collection.name;
  if (!coll.startsWith('creatives_')) {
    return Product as Model<IProductDocument>;
  }
  const market = coll.slice('creatives_'.length).toUpperCase();
  if (!/^[A-Z]{2}$/.test(market)) return undefined;
  return getMarketModels(market as MarketCode).Product;
}

function creatorHandlesMatch(a: unknown, b: unknown): boolean {
  const left = String(a ?? '')
    .trim()
    .replace(/^@/, '')
    .toLowerCase();
  const right = String(b ?? '')
    .trim()
    .replace(/^@/, '')
    .toLowerCase();
  return Boolean(left && right && left === right);
}

function creatorHasStoredAvatar(creator: Record<string, unknown>): boolean {
  const url = String(creator.avatarUrl ?? '').trim();
  if (url.startsWith('https://')) return true;
  return Boolean(String(creator.avatarS3Key ?? '').trim());
}

/** Fill missing creative.creator stats/avatars from the parent product's primaryCreator when handles match. */
async function enrichCreativesWithProductCreatorStats(
  docs: Array<Record<string, unknown>>,
  productModel?: Model<IProductDocument>,
): Promise<void> {
  if (!productModel || docs.length === 0) return;

  const needEnrich = docs.filter((doc) => {
    const creator = doc.creator as Record<string, unknown> | undefined;
    if (!creator) return false;
    return (
      Number(creator.followers) <= 0 ||
      Number(creator.totalLikes) <= 0 ||
      !creatorHasStoredAvatar(creator)
    );
  });
  if (needEnrich.length === 0) return;

  const productIds = [
    ...new Set(
      needEnrich
        .map((doc) => String(doc.productId ?? ''))
        .filter((id) => mongoose.isValidObjectId(id)),
    ),
  ];
  if (productIds.length === 0) return;

  const products = await productModel
    .find({ _id: { $in: productIds.map((id) => new mongoose.Types.ObjectId(id)) } })
    .select('primaryCreator')
    .lean();

  const primaryByProduct = new Map(
    products.map((p) => [String(p._id), p.primaryCreator as Record<string, unknown> | undefined]),
  );

  for (const doc of needEnrich) {
    const creator = doc.creator as Record<string, unknown>;
    const primary = primaryByProduct.get(String(doc.productId ?? ''));
    if (!primary || !creatorHandlesMatch(creator.handle, primary.handle)) continue;

    if (Number(creator.followers) <= 0 && Number(primary.followers) > 0) {
      creator.followers = primary.followers;
    }
    if (Number(creator.following) <= 0 && Number(primary.following) > 0) {
      creator.following = primary.following;
    }
    if (Number(creator.totalLikes) <= 0 && Number(primary.totalLikes) > 0) {
      creator.totalLikes = primary.totalLikes;
    }
    if (!creatorHasStoredAvatar(creator)) {
      const avatarUrl = [primary.avatarUrl, primary.primaryImageUrl].find(
        (v) => typeof v === 'string' && v.startsWith('https://'),
      );
      if (avatarUrl) creator.avatarUrl = avatarUrl;
      const s3Key =
        typeof primary.avatarS3Key === 'string' && primary.avatarS3Key.trim()
          ? primary.avatarS3Key.trim()
          : '';
      if (s3Key) creator.avatarS3Key = s3Key;
    }
  }
}

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

/** Delete a product and every creative linked to it (no orphans). */
export async function deleteProductAndCreatives(
  market: MarketCode,
  productId: string,
): Promise<{ productDeleted: boolean; creativesDeleted: number }> {
  if (!mongoose.isValidObjectId(productId)) {
    return { productDeleted: false, creativesDeleted: 0 };
  }

  const { Creative: MarketCreative, Product: MarketProduct } = getMarketModels(market);
  const oid = new mongoose.Types.ObjectId(productId);

  const product = await MarketProduct.findById(oid).select('_id').lean();
  if (!product) {
    return { productDeleted: false, creativesDeleted: 0 };
  }

  const creativesResult = await MarketCreative.deleteMany({ productId: oid });
  await MarketProduct.findByIdAndDelete(oid);

  log.info('Deleted product and linked creatives', {
    market,
    productId,
    creativesDeleted: creativesResult.deletedCount,
  });

  return {
    productDeleted: true,
    creativesDeleted: creativesResult.deletedCount,
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

function marketFromCreativeCollection(collectionName: string): MarketCode {
  const match = collectionName.match(/^creatives_([a-z]{2})$/i);
  return (match?.[1]?.toUpperCase() ?? DEFAULT_MARKET) as MarketCode;
}

type CreativeFeedDoc = Record<string, unknown>;

type CreativeFeedStageOpts = {
  /** Global discovery feeds: keep one creative per product. */
  oneAdPerProduct?: boolean;
};

/**
 * Large denormalized time-series arrays (per-product trends copied onto every
 * creative). They dominate document size, so we strip them BEFORE the in-memory
 * `$sort` — otherwise the sort blows past MongoDB's 32MB limit (Atlas shared
 * tiers ignore `allowDiskUse`) and the whole feed request 500s. They are
 * re-attached for the final page via `buildCreativeFeedTrendRestoreStages`.
 */
const CREATIVE_FEED_HEAVY_TREND_FIELDS = ['productRevenueTrend', 'productSalesTrend'] as const;

/** Re-join the heavy trend arrays onto the (small) final page after sorting/paging. */
function buildCreativeFeedTrendRestoreStages(collectionName: string): PipelineStage[] {
  return [
    {
      $lookup: {
        from: collectionName,
        localField: '_id',
        foreignField: '_id',
        as: '_trendSource',
        pipeline: [{ $project: { productRevenueTrend: 1, productSalesTrend: 1 } }],
      },
    },
    {
      $addFields: {
        productRevenueTrend: {
          $ifNull: [{ $arrayElemAt: ['$_trendSource.productRevenueTrend', 0] }, null],
        },
        productSalesTrend: {
          $ifNull: [{ $arrayElemAt: ['$_trendSource.productSalesTrend', 0] }, null],
        },
      },
    },
    { $unset: '_trendSource' },
  ] as unknown as PipelineStage[];
}

function buildCreativeFeedBaseStages(
  query: Record<string, unknown>,
  sortKey: string,
  sort: Record<string, unknown>,
  opts?: CreativeFeedStageOpts,
): PipelineStage[] {
  const onePerProduct = opts?.oneAdPerProduct === true;
  const now = new Date();
  return [
    { $match: query },
    creativeFeedExposureMatchStage() as PipelineStage,
    { $unset: [...CREATIVE_FEED_HEAVY_TREND_FIELDS] },
    ...(creativeSortSkipsRecencyTier(sortKey) ? [] : [{ $addFields: recencyTierAddFields(now) }]),
    { $sort: sort as PipelineStage.Sort['$sort'] },
    ...(creativeAdDedupeAggregationStages() as unknown as PipelineStage[]),
    ...(onePerProduct ? (creativeOneAdPerProductFeedStages() as unknown as PipelineStage[]) : []),
    { $unset: ['productDescription', '_recencyTier', '_postDate', 'adDedupeKey'] },
    {
      $sort: sortSpecWithoutRecencyFields(
        sort as Record<string, 1 | -1>,
      ) as PipelineStage.Sort['$sort'],
    },
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

async function fetchCreativeFeedFacetBatch(
  creativeModel: Model<ICreativeDocument>,
  baseStages: PipelineStage[],
  groupByCreator: boolean,
  sort: Record<string, unknown>,
  skip: number,
  limit: number,
): Promise<{ total: number; batch: CreativeFeedDoc[] }> {
  const trendRestoreStages = buildCreativeFeedTrendRestoreStages(creativeModel.collection.name);
  const preFacetStages = groupByCreator
    ? [...baseStages, ...buildCreativeFeedGroupByCreatorStages(sort)]
    : baseStages;

  const [facet] = (await creativeModel
    .aggregate([
      ...preFacetStages,
      {
        $facet: {
          total: [{ $count: 'count' }],
          batch: [{ $skip: skip }, { $limit: limit }, ...trendRestoreStages],
        },
      },
    ])
    .option({ maxTimeMS: 15_000 })
    .allowDiskUse(true)
    .exec()) as [{ total?: { count: number }[]; batch?: CreativeFeedDoc[] }] | [];

  return {
    total: facet?.total?.[0]?.count ?? 0,
    batch: facet?.batch ?? [],
  };
}

async function fetchCreativeFeedBatch(
  creativeModel: Model<ICreativeDocument>,
  baseStages: PipelineStage[],
  groupByCreator: boolean,
  sort: Record<string, unknown>,
  skip: number,
  limit: number,
): Promise<CreativeFeedDoc[]> {
  const trendRestoreStages = buildCreativeFeedTrendRestoreStages(creativeModel.collection.name);
  const dataStages = groupByCreator
    ? [
        ...baseStages,
        ...buildCreativeFeedGroupByCreatorStages(sort),
        { $skip: skip },
        { $limit: limit },
        ...trendRestoreStages,
      ]
    : [...baseStages, { $skip: skip }, { $limit: limit }, ...trendRestoreStages];

  return (await creativeModel
    .aggregate(dataStages)
    .option({ maxTimeMS: 15_000 })
    .allowDiskUse(true)
    .exec()) as CreativeFeedDoc[];
}

async function fillCreativeFeedPageWithTotal(
  creativeModel: Model<ICreativeDocument>,
  baseStages: PipelineStage[],
  groupByCreator: boolean,
  sort: Record<string, unknown>,
  skip: number,
  mLimit: number,
): Promise<{ total: number; docs: CreativeFeedDoc[] }> {
  const collected: CreativeFeedDoc[] = [];
  let cursor = skip;
  const batchSize = Math.max(mLimit * 2, mLimit + 4);
  let total: number | null = null;

  for (let round = 0; round < MAX_PAGE_FILL_ROUNDS && collected.length < mLimit; round++) {
    const batch =
      round === 0
        ? await fetchCreativeFeedFacetBatch(
            creativeModel,
            baseStages,
            groupByCreator,
            sort,
            cursor,
            batchSize,
          ).then((result) => {
            total = result.total;
            return result.batch;
          })
        : await fetchCreativeFeedBatch(
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

  return { total: total ?? 0, docs: collected.slice(0, mLimit) };
}

async function fillCreativeFeedPage(
  creativeModel: Model<ICreativeDocument>,
  baseStages: PipelineStage[],
  groupByCreator: boolean,
  sort: Record<string, unknown>,
  skip: number,
  mLimit: number,
): Promise<CreativeFeedDoc[]> {
  const { docs } = await fillCreativeFeedPageWithTotal(
    creativeModel,
    baseStages,
    groupByCreator,
    sort,
    skip,
    mLimit,
  );
  return docs;
}

async function loadCreativesForProduct(
  productId: string,
  creativeModel: Model<ICreativeDocument>,
  extraFilter: Record<string, unknown>,
  limit = PRODUCT_CREATIVE_LIMIT,
  excludeCreativeId?: string,
): Promise<CreativeFeedItem[]> {
  if (!mongoose.isValidObjectId(productId)) return [];

  const match: Record<string, unknown> = {
    productId: new mongoose.Types.ObjectId(productId),
    ...extraFilter,
  };
  if (excludeCreativeId && mongoose.isValidObjectId(excludeCreativeId)) {
    match._id = { $ne: new mongoose.Types.ObjectId(excludeCreativeId) };
  }

  const mLimit = Math.min(Math.max(limit, 1), 100);
  const videoSort = creativeEngagementMetricSortSpec('views');
  const baseStages = buildCreativeFeedBaseStages(match, 'views', videoSort);

  const docs = await fillCreativeFeedPage(creativeModel, baseStages, false, videoSort, 0, mLimit);
  const docRows = docs.map((doc) => ({ ...(doc as Record<string, unknown>) }));
  await enrichCreativesWithProductCreatorStats(
    docRows,
    productModelForCreativeModel(creativeModel),
  );

  const items = docRows.map((doc) => formatCreativeFeedItem(doc));
  const playable = filterPlayableCreativeFeedItems(items);
  if (!excludeCreativeId) return playable;
  return playable.filter((item) => item.id !== excludeCreativeId);
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
  excludeCreativeId?: string,
): Promise<CreativeFeedItem[]> {
  return loadCreativesForProduct(
    productId,
    creativeModel,
    CREATIVE_COMMERCIAL_MATCH,
    limit,
    excludeCreativeId,
  );
}

/** Paid ad creatives for a product (`GET /products/:id` → `relatedAds`). Meta + TikTok ads. */
export async function findRelatedAdsByProductId(
  productId: string,
  creativeModel: Model<ICreativeDocument> = Creative,
  limit = PRODUCT_CREATIVE_LIMIT,
  excludeCreativeId?: string,
): Promise<CreativeFeedItem[]> {
  return loadCreativesForProduct(
    productId,
    creativeModel,
    CREATIVE_TOP_ADS_MATCH,
    limit,
    excludeCreativeId,
  );
}

/** Other commercial creatives for the same product, excluding the anchor creative. */
export async function findSiblingCreativesForProduct(
  creativeId: string,
  creativeModel: Model<ICreativeDocument> = Creative,
  limit = PRODUCT_CREATIVE_LIMIT,
): Promise<CreativeFeedItem[] | null> {
  if (!mongoose.isValidObjectId(creativeId)) return null;

  const doc = await creativeModel.findById(creativeId).select({ productId: 1 }).lean();
  if (!doc?.productId) return null;

  return findCreativesByProductId(String(doc.productId), creativeModel, limit, creativeId);
}

/** Embedded secondary videos on a creative document (`GET /creatives/:id/related-videos`). */
export async function findRelatedVideosByCreativeId(
  creativeId: string,
  creativeModel: Model<ICreativeDocument> = Creative,
): Promise<ISecondaryVideoApi[] | null> {
  const doc = await creativeModel.findById(creativeId).lean();
  if (!doc) return null;
  const row = { ...(doc as Record<string, unknown>) };
  await enrichCreativeRelatedVideoMetrics(row, creativeModel);
  const formatted = formatCreativeForApi(row, { includeProductDescription: false });
  return formatted.relatedVideos ?? [];
}

const NON_EMPTY_CATEGORY_L1 = { $exists: true, $nin: [null, ''] };

/** Distinct raw L1 category names on creatives with a non-empty categoryL1. */
async function getDistinctCreativeCategoryL1(
  model: Model<ICreativeDocument> = Creative,
): Promise<string[]> {
  const values = await model
    .distinct('categoryL1', { categoryL1: NON_EMPTY_CATEGORY_L1 })
    .maxTimeMS(30_000);
  return (values as string[])
    .map((v) => String(v).trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
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
    productModel?: Model<IProductDocument>,
  ): Promise<{
    data: CreativeFeedItem[] | CreativeCreatorFeedItem[] | CreatorLobbyItem[];
    pagination: {
      total: number;
      page: number;
      limit: number;
      pages: number;
      totalPages: number;
      hasNextPage: boolean;
      hasPrevPage: boolean;
    };
    groupBy?: 'creator';
  }> {
    const {
      q,
      productId,
      source,
      section,
      isAd,
      minViews,
      maxViews,
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

    // Creator lobby: unique primaryCreator handles from products (not creatives / creators collections).
    if (groupBy === 'creator' && !productId && productModel) {
      return findProductCreators(
        productModel,
        {
          q: q as string | undefined,
          page: page as number | undefined,
          limit: limit as number | undefined,
          sortBy: sortBy as string | undefined,
          categoryL1: categoryL1 as string[] | undefined,
          categoryL2: categoryL2 as string[] | undefined,
          categoryL3: categoryL3 as string[] | undefined,
          _metricFilters: _metricFilters as ContentMetricFilters | undefined,
        },
        creativeModel,
      );
    }

    const pageNum = Number(page);
    const mLimit = Number(limit);
    const market = marketFromCreativeCollection(creativeModel.collection.name);
    const pageFiltersKey = JSON.stringify({
      ...filters,
      page: undefined,
      limit: undefined,
      extraMatch: extraMatch ?? null,
    });
    const pageCacheKey = CacheKeys.creativeFeed(market, pageNum, mLimit, pageFiltersKey);
    const cachedPage = await CacheService.get<{
      data: CreativeFeedItem[] | CreativeCreatorFeedItem[] | CreatorLobbyItem[];
      pagination: {
        total: number;
        page: number;
        limit: number;
        pages: number;
        totalPages: number;
        hasNextPage: boolean;
        hasPrevPage: boolean;
      };
      groupBy?: 'creator';
    }>(pageCacheKey);
    if (cachedPage) return cachedPage;

    const query: Record<string, unknown> = {
      ...excludedProductCategoryL1Filter(),
    };
    if (productId) {
      query.productId = mongoose.isValidObjectId(productId)
        ? new mongoose.Types.ObjectId(productId)
        : productId;
    }
    if (source === 'meta') query.externalVideoId = /^meta:/;
    if (source === 'tiktok') query.externalVideoId = { $not: /^meta:/ };
    if (section) query.section = apiSectionToDb(String(section));
    if (isAd !== undefined) query.isAd = isAd;
    if (minViews != null || maxViews != null) {
      query['metrics.viewCount'] = {
        ...(minViews != null ? { $gte: Number(minViews) } : {}),
        ...(maxViews != null ? { $lte: Number(maxViews) } : {}),
      };
    }
    const categoryL1List = categoryL1 as string[] | undefined;
    const categoryL2List = categoryL2 as string[] | undefined;
    const categoryL3List = categoryL3 as string[] | undefined;
    const hashtagList = hashtags as string[] | undefined;
    if (categoryL1List?.length) {
      const expandedL1 = expandCategoryL1FilterValues(categoryL1List);
      query.categoryL1 = expandedL1.length === 1 ? expandedL1[0] : { $in: expandedL1 };
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
    const metricFilters = (_metricFilters as ContentMetricFilters | undefined) ?? {};
    applyCreativeMetricFilters(query, metricFilters);

    const matchQuery =
      extraMatch && Object.keys(extraMatch).length > 0
        ? mergeCreativeFeedExtraMatch(query, extraMatch)
        : query;

    const skip = (pageNum - 1) * mLimit;
    const { sortKey, sort } = resolveCreativeSort(
      String(sortBy) as CreativeSortBy,
      source ? { source: source as 'meta' | 'tiktok' } : undefined,
    );

    // Global feeds: one card per product; extras live under relatedVideos / relatedAds.
    const oneAdPerProduct = query.productId === undefined;
    const baseStages = buildCreativeFeedBaseStages(matchQuery, sortKey, sort, {
      oneAdPerProduct,
    });
    const groupByCreator = groupBy === 'creator';

    const { total: computedTotal, docs: rawData } = await fillCreativeFeedPageWithTotal(
      creativeModel,
      baseStages,
      groupByCreator,
      sort,
      skip,
      mLimit,
    );

    const totalCacheKey = CacheKeys.creativeFeedTotal(
      market,
      JSON.stringify({
        matchQuery,
        sortKey,
        groupByCreator,
        oneAdPerProduct,
        extraMatch: extraMatch ?? null,
      }),
    );
    const total = await CacheService.stabilizeFeedTotal(
      totalCacheKey,
      computedTotal,
      CACHE_TTL.CREATIVE_FEED_TOTAL,
    );
    const totalPages = Math.ceil(total / mLimit) || 0;

    const feedDocs = rawData.map((doc) => ({ ...(doc as Record<string, unknown>) }));
    if (!groupByCreator) {
      await enrichCreativesWithProductCreatorStats(
        feedDocs,
        productModel ?? productModelForCreativeModel(creativeModel),
      );
    }

    const rawItems = groupByCreator
      ? feedDocs.map((doc) => {
          const { videoCount, ...creative } = doc;
          return formatCreativeCreatorFeedItem(
            creative,
            typeof videoCount === 'number' ? videoCount : Number(videoCount) || 0,
          );
        })
      : feedDocs.map((doc) => formatCreativeFeedItem(doc));
    const data = filterPlayableCreativeFeedItems(rawItems);
    const result = {
      data,
      pagination: {
        total,
        page: pageNum,
        limit: mLimit,
        pages: totalPages,
        totalPages,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1,
      },
      ...(groupByCreator ? { groupBy: 'creator' as const } : {}),
    };
    // Same as products: pin a non-empty page briefly so rapid refetches don't reshuffle.
    if (result.pagination.total > 0) {
      await CacheService.set(pageCacheKey, result, CACHE_TTL.CREATIVE_FEED);
    }
    return result;
  },

  /**
   * L1 categories that have at least one creative (canonical order, alias-aware).
   */
  async getCategories(
    creativeModel: Model<ICreativeDocument> = Creative,
    market: MarketCode = DEFAULT_MARKET,
  ): Promise<string[]> {
    const cacheKey = CacheKeys.creativeCategories(market);
    return CacheService.getOrSet(cacheKey, CACHE_TTL.CATEGORIES, async () => {
      const dbL1 = await getDistinctCreativeCategoryL1(creativeModel);
      return filterL1CategoriesWithProducts(dbL1);
    }) as Promise<string[]>;
  },

  async getCreativeById(id: string, creativeModel: Model<ICreativeDocument> = Creative) {
    const doc = await creativeModel.findById(id).lean();
    if (!doc) return null;
    const [enriched] = await enrichCreativesWithResolvedVideoS3Keys(
      [doc as Record<string, unknown>],
      creativeModel,
    );
    const row = { ...((enriched ?? doc) as Record<string, unknown>) };
    await enrichCreativesWithProductCreatorStats(
      [row],
      productModelForCreativeModel(creativeModel),
    );
    await enrichCreativeRelatedVideoMetrics(row, creativeModel);
    // Detail-by-id must return existing docs. Feed gates (playable + caption match)
    // apply to discovery lists only — otherwise links/bookmarks 404 as "not found".
    return formatCreativeForApi(row, { includeProductDescription: true });
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
      const profileStats = ScrapeCreatorsService.creatorStatsFromProfile(profile);

      if (!media?.thumbnailUrl && postUrl) {
        const oembedThumb = await fetchOembedThumbnail(postUrl);
        if (oembedThumb) {
          media = { ...(media ?? {}), thumbnailUrl: oembedThumb };
        }
      }

      if (!media && !profileAvatar) return false;

      const patch: AwemeMediaPatch = {
        ...(media ?? {}),
        ...(profileAvatar || media?.creator || Object.keys(profileStats).length > 0
          ? {
              creator: {
                ...(media?.creator ?? {}),
                ...profileStats,
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
