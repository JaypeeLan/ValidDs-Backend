import { buildCreatorAvatarProxyUrl } from './creator-avatar.util';
import type {
  CreativeApiItem,
  CreativeCreatorFeedItem,
  CreativeFeedItem,
  CreativeSection,
  ICreativeComment,
  ICreatorProfile,
  ICreatorProfileApi,
  IMetricTrend,
  IProductTrendSnapshot,
  ISecondaryVideo,
  IVideoMetrics,
} from '../types/creative.types';
import { isMetaCreative, metaAdIdFromCreative } from './meta-video-s3.util';
import { normalizeMetaAdLibraryUrl } from './meta-ad-url.util';
import { mergeMetricTrendSnapshots } from './metric-trend-merge.util';
import { resolveEngagementTrend } from './product-trend.util';
import { normalizeCategoryL1 } from './category-l1-normalize.util';
import { creativeVideoMatchesProduct } from './video-product-match.util';
import { sanitizeVideoMetrics } from './video-metrics.util';
import { resolveCreativeTikTokUrl } from './tiktok-url.util';

/** API `trending` ↔ DB `top-ads`; API `top-ads` ↔ DB `trending`. */
const API_TO_DB_SECTION: Record<string, CreativeSection> = {
  trending: 'top-ads',
  'top-ads': 'trending',
};

const DB_TO_API_SECTION: Record<string, CreativeSection> = {
  'top-ads': 'trending',
  trending: 'top-ads',
};

export function apiSectionToDb(section: string): CreativeSection | string {
  return API_TO_DB_SECTION[section as CreativeSection] ?? section;
}

export function dbSectionToApi(section: string | undefined): CreativeSection | undefined {
  if (!section) return undefined;
  return (DB_TO_API_SECTION[section as CreativeSection] ?? section) as CreativeSection;
}

/**
 * Organic TikTok shop / creator videos (DB `top-ads`, API default creatives list).
 * Excludes Meta rows and TikTok posts flagged `isAd` (sponsored / ad copy).
 */
export const CREATIVE_TRENDING_MATCH = {
  section: 'top-ads' as const,
  externalVideoId: { $not: { $regex: /^(meta:|ttad:)/ } },
  isAd: { $ne: true },
};
/**
 * Paid ads bucket (DB `trending`, API `GET /creatives/top-ads`):
 * Meta Ad Library + TikTok Creative Center + TikTok with ad/sponsored signals.
 */
export const CREATIVE_TOP_ADS_MATCH = {
  section: 'trending' as const,
  $or: [
    { externalVideoId: { $regex: /^meta:/ } },
    { externalVideoId: { $regex: /^ttad:/ } },
    { isAd: true },
  ],
};
/** Meta Ad Library rows only (DB section `trending`, API top-ads / related-ads). */
export const CREATIVE_META_ADS_MATCH = {
  section: 'trending' as const,
  externalVideoId: { $regex: /^meta:/ },
};
export const CREATIVE_COMMERCIAL_MATCH = CREATIVE_TRENDING_MATCH;

const TIKTOK_VIDEO_ID_RE = /(?:\/video\/|embed\/v2\/)(\d+)/i;

type CreativePlain = Record<string, unknown>;

/** Stable key for the same TikTok CDN photo (mirrors product image dedupe). */
export function imageAssetKey(url: string): string {
  const base = url.trim().split('?')[0]?.split('~tplv-')[0]?.toLowerCase() ?? '';
  const m = base.match(/\/([a-f0-9]{32})(?:~|$)/i);
  return m ? m[1] : base;
}

function normalizeAdDescription(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Thumbnail is the listing hero (no real video cover) — feed cards look identical. */
export function isProductHeroThumbnail(creative: Record<string, unknown>): boolean {
  const thumb = imageAssetKey(String(creative.thumbnailUrl ?? ''));
  const product = imageAssetKey(String(creative.productPrimaryImageUrl ?? ''));
  return Boolean(thumb && product && thumb === product);
}

/** @deprecated Use isProductHeroThumbnail */
export const isMetaProductPlaceholderThumb = isProductHeroThumbnail;

/**
 * One key per distinct ad card in discovery feeds.
 * Meta: same copy or same page+product+hero image → one slot.
 * TikTok: same aweme id, or one card per product when only the hero image is shown.
 */
export function creativeAdDedupeKey(creative: Record<string, unknown>): string {
  const ext = String(creative.externalVideoId ?? '').trim();
  const pid = String(creative.productId ?? '').trim();
  const isMeta = ext.startsWith('meta:');
  const isTtad = ext.startsWith('ttad:');

  if (isTtad) return ext;

  // Hero listing image — collapse look-alikes within the same platform only.
  // Meta Ad Library rows must not evict TikTok videos (or vice versa) on ingest.
  if (isProductHeroThumbnail(creative) && pid) {
    return isMeta ? `meta:product-card:${pid}` : `tiktok:product-card:${pid}`;
  }

  if (isMeta) {
    const page = String(
      creative.metaPageId ??
        (creative.creator as Record<string, unknown> | undefined)?.handle ??
        '',
    )
      .trim()
      .toLowerCase();
    const thumb = imageAssetKey(String(creative.thumbnailUrl ?? ''));
    if (isProductHeroThumbnail(creative) && page && thumb && pid) {
      return `meta:visual:${page}:${pid}:${thumb}`;
    }
    const desc = normalizeAdDescription(creative.description);
    if (desc.length >= 12) {
      return `meta:text:${page}:${desc.slice(0, 240)}`;
    }
    if (page && thumb && pid) {
      return `meta:visual:${page}:${pid}:${thumb}`;
    }
    return ext;
  }

  const post = String(creative.tiktokPostUrl ?? '');
  const m = post.match(TIKTOK_VIDEO_ID_RE);
  if (m) return `tiktok:${m[1]}`;
  const embed = String(creative.embedUrl ?? '');
  const em = embed.match(TIKTOK_VIDEO_ID_RE);
  if (em) return `tiktok:${em[1]}`;
  if (/^\d+$/.test(ext)) return `tiktok:${ext}`;
  return ext || post;
}

/** Mongo expression: imageAssetKey(urlField) — mirrors imageAssetKey(). */
function mongoImageAssetKeyExpr(urlExpr: unknown): Record<string, unknown> {
  const base = {
    $toLower: {
      $let: {
        vars: {
          noQuery: { $arrayElemAt: [{ $split: [{ $ifNull: [urlExpr, ''] }, '?'] }, 0] },
        },
        in: { $arrayElemAt: [{ $split: ['$$noQuery', '~tplv-'] }, 0] },
      },
    },
  };
  const hashMatch = { $regexFind: { input: base, regex: '/([a-f0-9]{32})(?:~|$)' } };
  return {
    $let: {
      vars: { base, hashMatch },
      in: {
        $cond: [
          { $ne: ['$$hashMatch', null] },
          { $arrayElemAt: ['$$hashMatch.captures', 0] },
          '$$base',
        ],
      },
    },
  };
}

function mongoMetaAdDedupeKeyExpr(): Record<string, unknown> {
  const page = {
    $toLower: {
      $trim: {
        input: { $ifNull: ['$metaPageId', { $ifNull: ['$creator.handle', ''] }] },
      },
    },
  };
  const desc = {
    $replaceAll: {
      input: {
        $toLower: { $trim: { input: { $ifNull: ['$description', ''] } } },
      },
      find: '  ',
      replacement: ' ',
    },
  };
  const thumb = mongoImageAssetKeyExpr('$thumbnailUrl');
  const productThumb = mongoImageAssetKeyExpr('$productPrimaryImageUrl');
  const pid = { $toString: '$productId' };
  const visualKey = {
    $concat: ['meta:visual:', page, ':', pid, ':', thumb],
  };
  return {
    $let: {
      vars: { page, desc, thumb, productThumb, pid, visualKey },
      in: {
        $cond: [
          {
            $and: [
              { $ne: ['$$thumb', ''] },
              { $ne: ['$$productThumb', ''] },
              { $eq: ['$$thumb', '$$productThumb'] },
            ],
          },
          '$$visualKey',
          {
            $cond: [
              { $gte: [{ $strLenCP: '$$desc' }, 12] },
              {
                $concat: ['meta:text:', '$$page', ':', { $substrCP: ['$$desc', 0, 240] }],
              },
              {
                $cond: [
                  {
                    $and: [
                      { $ne: ['$$page', ''] },
                      { $ne: ['$$thumb', ''] },
                      { $ne: ['$$pid', ''] },
                    ],
                  },
                  '$$visualKey',
                  '$externalVideoId',
                ],
              },
            ],
          },
        ],
      },
    },
  };
}

function mongoTiktokVideoDedupeKeyExpr(): Record<string, unknown> {
  return {
    $let: {
      vars: {
        postMatch: {
          $regexFind: {
            input: { $ifNull: ['$tiktokPostUrl', ''] },
            regex: '(?:/video/|embed/v2/)(\\d+)',
            options: 'i',
          },
        },
        embedMatch: {
          $regexFind: {
            input: { $ifNull: ['$embedUrl', ''] },
            regex: '(?:/video/|embed/v2/)(\\d+)',
            options: 'i',
          },
        },
      },
      in: {
        $cond: [
          { $ne: ['$$postMatch', null] },
          { $concat: ['tiktok:', { $arrayElemAt: ['$$postMatch.captures', 0] }] },
          {
            $cond: [
              { $ne: ['$$embedMatch', null] },
              { $concat: ['tiktok:', { $arrayElemAt: ['$$embedMatch.captures', 0] }] },
              {
                $cond: [
                  {
                    $regexMatch: {
                      input: { $ifNull: ['$externalVideoId', ''] },
                      regex: '^\\d+$',
                    },
                  },
                  { $concat: ['tiktok:', '$externalVideoId'] },
                  {
                    $ifNull: ['$externalVideoId', { $ifNull: ['$tiktokPostUrl', ''] }],
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  };
}

/**
 * Mongo stages: one organic TikTok + one Meta/paid row per product in global feeds.
 * Run after $sort so the highest-ranked creative per product slot is kept.
 */
export function creativeOneAdPerProductFeedStages(): Record<string, unknown>[] {
  const isMeta = {
    $regexMatch: { input: { $ifNull: ['$externalVideoId', ''] }, regex: '^meta:' },
  };
  return [
    {
      $addFields: {
        _productFeedSlot: { $cond: [isMeta, 'meta', 'tiktok'] },
      },
    },
    {
      $group: {
        _id: { productId: '$productId', slot: '$_productFeedSlot' },
        doc: { $first: '$$ROOT' },
      },
    },
    { $replaceRoot: { newRoot: '$doc' } },
    { $unset: ['_productFeedSlot'] },
  ];
}

/** Mongo stages: collapse duplicate ads (same video / same product hero card / Meta copy). */
export function creativeAdDedupeAggregationStages(): Record<string, unknown>[] {
  const thumb = mongoImageAssetKeyExpr('$thumbnailUrl');
  const productThumb = mongoImageAssetKeyExpr('$productPrimaryImageUrl');
  const pid = { $toString: '$productId' };

  const isMeta = {
    $regexMatch: { input: { $ifNull: ['$externalVideoId', ''] }, regex: '^meta:' },
  };
  // Order must match creativeAdDedupeKey(): hero (per platform) → meta → tiktok video id.
  const computedKey = {
    $cond: [
      {
        $and: [
          { $ne: [thumb, ''] },
          { $ne: [productThumb, ''] },
          { $eq: [thumb, productThumb] },
          { $ne: [pid, ''] },
        ],
      },
      {
        $cond: [
          isMeta,
          { $concat: ['meta:product-card:', pid] },
          { $concat: ['tiktok:product-card:', pid] },
        ],
      },
      {
        $cond: [isMeta, mongoMetaAdDedupeKeyExpr(), mongoTiktokVideoDedupeKeyExpr()],
      },
    ],
  };

  // Always group by freshly computed keys. Stale stored `adDedupeKey` values
  // (e.g. meta:visual:page:…) must not bypass product-card collapse for hero thumbnails.
  return [
    { $addFields: { _feedDedupeKey: computedKey } },
    { $group: { _id: '$_feedDedupeKey', doc: { $first: '$$ROOT' } } },
    { $replaceRoot: { newRoot: '$doc' } },
  ];
}

/** Mongo expression: numeric Meta Ad Library id (mirrors metaAdIdFromCreative). */
export function mongoMetaAdIdFromCreativeExpr(): Record<string, unknown> {
  return {
    $let: {
      vars: {
        fromExt: {
          $regexFind: {
            input: { $ifNull: ['$externalVideoId', ''] },
            regex: '^meta:(\\d{5,})$',
          },
        },
        fromMetaAdId: {
          $cond: [
            { $regexMatch: { input: { $ifNull: ['$metaAdId', ''] }, regex: '^\\d{5,}$' } },
            '$metaAdId',
            '',
          ],
        },
        fromLib: {
          $regexFind: {
            input: { $ifNull: ['$metaAdLibraryUrl', ''] },
            regex: '[?&]id=(\\d{5,})',
            options: 'i',
          },
        },
        fromPost: {
          $regexFind: {
            input: { $ifNull: ['$tiktokPostUrl', ''] },
            regex: '[?&]id=(\\d{5,})',
            options: 'i',
          },
        },
        fromEmbed: {
          $regexFind: {
            input: { $ifNull: ['$embedUrl', ''] },
            regex: '[?&]id=(\\d{5,})',
            options: 'i',
          },
        },
      },
      in: {
        $cond: [
          { $ne: ['$$fromExt', null] },
          { $arrayElemAt: ['$$fromExt.captures', 0] },
          {
            $cond: [
              { $ne: ['$$fromMetaAdId', ''] },
              '$$fromMetaAdId',
              {
                $cond: [
                  { $ne: ['$$fromLib', null] },
                  { $arrayElemAt: ['$$fromLib.captures', 0] },
                  {
                    $cond: [
                      { $ne: ['$$fromPost', null] },
                      { $arrayElemAt: ['$$fromPost.captures', 0] },
                      {
                        $cond: [
                          { $ne: ['$$fromEmbed', null] },
                          { $arrayElemAt: ['$$fromEmbed.captures', 0] },
                          '',
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  };
}

/** Mongo expression: verified Meta Ad Library row (mirrors isVerifiedMetaCreative). */
export function mongoIsVerifiedMetaCreativeExpr(): Record<string, unknown> {
  const rawUrl = {
    $ifNull: [
      '$metaAdLibraryUrl',
      {
        $ifNull: [
          '$tiktokPostUrl',
          { $ifNull: ['$embedUrl', { $ifNull: ['$externalVideoId', ''] }] },
        ],
      },
    ],
  };
  const adId = mongoMetaAdIdFromCreativeExpr();
  return {
    $and: [
      { $regexMatch: { input: { $ifNull: ['$externalVideoId', ''] }, regex: '^meta:' } },
      { $regexMatch: { input: adId, regex: '^\\d{5,}$' } },
      { $not: { $regexMatch: { input: { $toLower: rawUrl }, regex: 'access_token=' } } },
      {
        $or: [
          {
            $regexMatch: {
              input: rawUrl,
              regex: 'facebook\\.com/ads/library/\\?id=',
              options: 'i',
            },
          },
          {
            $regexMatch: {
              input: { $ifNull: ['$externalVideoId', ''] },
              regex: '^meta:\\d{5,}$',
            },
          },
        ],
      },
    ],
  };
}

/** Mongo expression: playable primary slot (mirrors creativeHasPlayableVideo at index 0). */
export function mongoHasPlayableVideoExpr(): Record<string, unknown> {
  const hasStoredS3Key = {
    $and: [
      { $eq: [{ $type: '$videoS3Key' }, 'string'] },
      { $regexMatch: { input: '$videoS3Key', regex: '\\S' } },
    ],
  };
  return {
    $or: [
      hasStoredS3Key,
      // Meta rows may resolve S3 at enrich time when only the ad id is stored.
      mongoIsVerifiedMetaCreativeExpr(),
    ],
  };
}

/** Mongo expression: feed-safe creative (mirrors shouldExposeCreativeInFeed). */
export function mongoShouldExposeCreativeInFeedExpr(): Record<string, unknown> {
  const isMeta = {
    $regexMatch: { input: { $ifNull: ['$externalVideoId', ''] }, regex: '^meta:' },
  };
  return {
    $and: [
      mongoHasPlayableVideoExpr(),
      { $or: [{ $not: isMeta }, mongoIsVerifiedMetaCreativeExpr()] },
    ],
  };
}

/** $match stage: only creatives safe to show in discovery feeds (before dedupe + pagination). */
export function creativeFeedExposureMatchStage(): Record<string, unknown> {
  return { $match: { $expr: mongoShouldExposeCreativeInFeedExpr() } };
}

/** Map `products_us` → `creatives_us` (per-market collections). */
export function creativeCollectionForProductCollection(productCollection: string): string {
  if (productCollection.startsWith('products_')) {
    return productCollection.replace(/^products_/, 'creatives_');
  }
  if (productCollection === 'products') return 'creatives';
  return productCollection.replace(/^products/, 'creatives');
}

/**
 * Aggregation stages: keep only products with ≥1 feed-safe creative (playable video).
 * Insert after the product `$match`, before sort/dedupe.
 */
export function productPlayableCreativeLookupStages(
  creativeCollection: string,
): Record<string, unknown>[] {
  return [
    {
      $lookup: {
        from: creativeCollection,
        let: { pid: '$_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$productId', '$$pid'] } } },
          { $match: { $expr: mongoShouldExposeCreativeInFeedExpr() } },
          { $limit: 1 },
          { $project: { _id: 1 } },
        ],
        as: '_playableCreatives',
      },
    },
    { $match: { '_playableCreatives.0': { $exists: true } } },
    { $unset: '_playableCreatives' },
  ];
}

function pickUrl(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

/** Creator profile image on a creative doc (TikTok CDN or Meta shop avatar). */
export function resolveCreatorAvatarUrl(creative: CreativePlain): string | undefined {
  const creator = creative.creator as ICreatorProfile | undefined;
  const ext = String(creative.externalVideoId ?? '');
  const isMeta = ext.startsWith('meta:');
  return pickUrl(
    creator?.avatarUrl,
    creative.shopAvatarUrl,
    isMeta ? creative.productPrimaryImageUrl : undefined,
  );
}

function resolveProductSalesTrend(raw: unknown): IMetricTrend | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const direction = o.direction;
  if (direction !== 'up' && direction !== 'down' && direction !== 'stable') return null;

  const windows = Array.isArray(o.windows) ? o.windows : [];
  let currentValue = 0;
  for (const w of windows) {
    if (!w || typeof w !== 'object') continue;
    const row = w as Record<string, unknown>;
    if (row.daysAgo === 0 || (row.daysAgo == null && row.monthsAgo === 0)) {
      currentValue = Number(row.value) || 0;
      break;
    }
  }

  // Normalize legacy monthly windows (monthsAgo / mislabeled daysAgo) to day offsets.
  return mergeMetricTrendSnapshots(raw, null, currentValue);
}

function resolveProductTrendSnapshot(raw: unknown): IProductTrendSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.engagement && typeof o.engagement === 'object') {
    const t = resolveEngagementTrend({ trends: { engagement: o.engagement } });
    return {
      score: t.score,
      direction: t.direction,
      isTrending: t.isTrending,
      reason: t.reason,
    };
  }
  return {
    score: Number(o.score) || 0,
    direction: String(o.direction ?? 'unknown'),
    isTrending: Boolean(o.isTrending),
    reason: typeof o.reason === 'string' ? o.reason : undefined,
  };
}

function formatMetrics(metrics: IVideoMetrics | undefined): IVideoMetrics {
  return sanitizeVideoMetrics(metrics);
}

function formatCreator(
  creator: ICreatorProfile | undefined,
  index: number,
  baseUrl?: string,
  resolvedAvatarUrl?: string,
): ICreatorProfileApi {
  const c = creator ?? ({ handle: '', verified: false, tiktokPostUrl: '' } as ICreatorProfile);
  const avatarUrl = pickUrl(resolvedAvatarUrl, c.avatarUrl);
  const avatarProxyUrl = buildCreatorAvatarProxyUrl(baseUrl, index, {
    avatarUrl,
    avatarS3Key: c.avatarS3Key,
    handle: c.handle,
  });
  const displayAvatarUrl = avatarUrl ?? avatarProxyUrl;
  return {
    handle: c.handle ?? '',
    displayName: c.displayName,
    followers: typeof c.followers === 'number' ? c.followers : 0,
    following: typeof c.following === 'number' ? c.following : undefined,
    totalLikes: typeof c.totalLikes === 'number' ? c.totalLikes : undefined,
    verified: Boolean(c.verified),
    region: c.region,
    isIndependentCreator: Boolean(c.isIndependentCreator),
    ...(displayAvatarUrl ? { avatarUrl: displayAvatarUrl } : {}),
    ...(avatarProxyUrl ? { avatarProxyUrl } : {}),
  };
}

function buildCreativeProxyUrls(
  creative: CreativePlain,
  index: number,
  baseUrl?: string,
): { videoProxyUrl?: string; thumbnailProxyUrl?: string } {
  if (!baseUrl) return {};
  const hasVideo = creativeHasPlayableVideo(creative, index);
  const hasThumb = Boolean(pickCreativeThumbnailUrl(creative, index, 'thumbnail'));
  if (!hasVideo && !hasThumb) return {};
  return {
    ...(hasVideo ? { videoProxyUrl: `${baseUrl}/video?index=${index}` } : {}),
    ...(hasThumb || hasVideo
      ? { thumbnailProxyUrl: `${baseUrl}/thumbnail?index=${index}&kind=thumbnail` }
      : {}),
  };
}

/** Meta row with numeric Ad Library id and canonical viewer URL. */
export function isVerifiedMetaCreative(creative: CreativePlain): boolean {
  if (!isMetaCreative(creative)) return false;
  if (!metaAdIdFromCreative(creative)) return false;
  const rawUrl = String(
    creative.metaAdLibraryUrl ??
      creative.tiktokPostUrl ??
      creative.embedUrl ??
      creative.externalVideoId ??
      '',
  );
  if (rawUrl.toLowerCase().includes('access_token=')) return false;
  const canonical =
    normalizeMetaAdLibraryUrl(rawUrl) ??
    normalizeMetaAdLibraryUrl(String(creative.externalVideoId ?? ''));
  return Boolean(canonical?.includes('facebook.com/ads/library/?id='));
}

export function shouldExposeCreativeInFeed(creative: CreativePlain): boolean {
  if (!creativeHasPlayableVideo(creative, 0)) return false;
  if (isMetaCreative(creative) && !isVerifiedMetaCreative(creative)) return false;
  if (!creativeVideoMatchesProduct(creative as Record<string, unknown>)) return false;
  return true;
}

function formatSecondaryVideo(
  video: ISecondaryVideo,
  index: number,
  baseUrl?: string,
  parent?: CreativePlain,
): CreativeApiItem['relatedVideos'][number] {
  const thumb = pickUrl(video.thumbnailUrl);
  const proxy =
    parent && baseUrl
      ? buildCreativeProxyUrls(parent, index, baseUrl)
      : pickUrl(video.videoS3Key) && baseUrl
        ? {
            videoProxyUrl: `${baseUrl}/video?index=${index}`,
            thumbnailProxyUrl: `${baseUrl}/thumbnail?index=${index}&kind=thumbnail`,
          }
        : {};
  return {
    isPrimary: false,
    externalVideoId: video.externalVideoId,
    tiktokUrl: resolveCreativeTikTokUrl({
      tiktokPostUrl: video.tiktokPostUrl,
      embedUrl: video.embedUrl,
      externalVideoId: video.externalVideoId,
      creator: video.creator,
    }),
    thumbnailUrl: thumb,
    ...proxy,
    creator: formatCreator(video.creator, index, baseUrl),
    metrics: formatMetrics(video.metrics),
    topComments: video.topComments ?? [],
    publishedAt: video.publishedAt,
  };
}

export type FormatCreativeOptions = {
  includeProductDescription?: boolean;
};

/** True when GET /creatives/:id/video streams from S3 (`videoS3Key` set). */
export function creativeHasPlayableVideo(creative: CreativePlain, index = 0): boolean {
  return Boolean(pickCreativeVideoS3Key(creative, index));
}

export function formatCreativeForApi(
  input: unknown,
  options: FormatCreativeOptions = {},
): CreativeApiItem {
  const raw = input as CreativePlain;
  const creative =
    typeof (raw as { toObject?: () => CreativePlain }).toObject === 'function'
      ? (raw as { toObject: () => CreativePlain }).toObject()
      : raw;

  const id = String(creative._id ?? creative.id ?? '');
  const apiVersion = process.env.API_VERSION || 'v1';
  const baseUrl = id ? `/api/${apiVersion}/creatives/${id}` : undefined;
  const externalVideoId = String(creative.externalVideoId ?? '');

  const apiSection = dbSectionToApi(creative.section as string | undefined) ?? 'trending';
  const creator = creative.creator as ICreatorProfile | undefined;
  const creatorAvatarUrl = resolveCreatorAvatarUrl(creative);

  const primaryProxy = buildCreativeProxyUrls(creative, 0, baseUrl);

  const item: CreativeApiItem = {
    id,
    productId: String(creative.productId ?? ''),
    externalVideoId,
    tiktokUrl: resolveCreativeTikTokUrl({
      tiktokPostUrl: creative.tiktokPostUrl as string | undefined,
      embedUrl: creative.embedUrl as string | undefined,
      externalVideoId,
      creator,
    }),
    thumbnailUrl: creative.thumbnailUrl as string | undefined,
    ...primaryProxy,
    creator: formatCreator(creator, 0, baseUrl, creatorAvatarUrl),
    metrics: formatMetrics(creative.metrics as IVideoMetrics | undefined),
    section: apiSection,
    isIndependentCreator: Boolean(creative.isIndependentCreator ?? creator?.isIndependentCreator),
    isPrimaryDiscovery: creative.isPrimaryDiscovery as boolean | undefined,
    isAd: creative.isAd as boolean | undefined,
    productName: creative.productName as string | undefined,
    categoryL1: (() => {
      const raw = creative.categoryL1 as string | undefined;
      return raw ? normalizeCategoryL1(raw) : undefined;
    })(),
    categoryL2: creative.categoryL2 as string | undefined,
    categoryL3: creative.categoryL3 as string | undefined,
    categoryPath: creative.categoryPath as string | undefined,
    description: (creative.description as string | null | undefined) ?? null,
    angle: (creative.angle as string | null | undefined) ?? null,
    angleBody: (creative.angleBody as string | null | undefined) ?? null,
    angleTarget: (creative.angleTarget as string | null | undefined) ?? null,
    hashtags: Array.isArray(creative.hashtags) ? (creative.hashtags as string[]) : [],
    topComments: Array.isArray(creative.topComments)
      ? (creative.topComments as ICreativeComment[])
      : [],
    relatedVideos: (() => {
      const primaryId = externalVideoId.trim();
      const raw = Array.isArray(creative.relatedVideos)
        ? (creative.relatedVideos as ISecondaryVideo[])
        : [];
      const seen = new Set<string>(primaryId ? [primaryId] : []);
      const slots: ISecondaryVideo[] = [];
      for (const v of raw) {
        const vid = String(v.externalVideoId ?? '').trim();
        if (!vid || seen.has(vid)) continue;
        seen.add(vid);
        slots.push(v);
      }
      return slots
        .map((v, slotIndex) => ({ v, slotIndex: slotIndex + 1 }))
        .filter(({ v, slotIndex }) =>
          Boolean(pickCreativeVideoS3Key(creative, slotIndex) || pickUrl(v.videoS3Key)),
        )
        .map(({ v, slotIndex }) => formatSecondaryVideo(v, slotIndex, baseUrl, creative));
    })(),
    productRating: creative.productRating as number | null | undefined,
    productTotalSales: creative.productTotalSales as number | null | undefined,
    productTotalGmv: creative.productTotalGmv as number | null | undefined,
    productPrice: creative.productPrice as number | null | undefined,
    productUrl: creative.productUrl as string | null | undefined,
    shopName: creative.shopName as string | null | undefined,
    shopAvatarUrl: creative.shopAvatarUrl as string | null | undefined,
    productPrimaryImageUrl: creative.productPrimaryImageUrl as string | null | undefined,
    productSalesTrend: resolveProductSalesTrend(creative.productSalesTrend),
    productRevenueTrend: resolveProductSalesTrend(creative.productRevenueTrend),
    productTrend: resolveProductTrendSnapshot(creative.productTrend),
    publishedAt: creative.publishedAt as Date | string | undefined,
    ingestedAt: creative.ingestedAt as Date | string | undefined,
    createdAt: creative.createdAt as Date | string | undefined,
    updatedAt: creative.updatedAt as Date | string | undefined,
  };

  if (options.includeProductDescription) {
    item.productDescription = creative.productDescription as string | undefined;
  }

  return item;
}

export function formatCreativeFeedItem(input: unknown): CreativeFeedItem {
  const full = formatCreativeForApi(input, { includeProductDescription: false });
  // List endpoints return one card per creative doc; nested slots are detail-only.
  return { ...full, relatedVideos: [] };
}

/** Drop creatives that are not playable or (for Meta) not verified Ad Library rows. */
export function filterPlayableCreativeFeedItems<T extends CreativeFeedItem>(items: T[]): T[] {
  return items.filter(
    (item) => typeof item.videoProxyUrl === 'string' && item.videoProxyUrl.trim().length > 0,
  );
}

export function formatCreativeCreatorFeedItem(
  input: unknown,
  videoCount: number,
): CreativeCreatorFeedItem {
  return { ...formatCreativeFeedItem(input), videoCount: Math.max(0, videoCount) };
}

/** CDN URL for video proxy — not the embed URL. Falls back to TikTok CDN when no S3 key. */
export function pickCreativeVideoS3Key(creative: CreativePlain, index: number): string | undefined {
  if (index <= 0) {
    return pickUrl(creative.videoS3Key);
  }
  const related = Array.isArray(creative.relatedVideos)
    ? (creative.relatedVideos as ISecondaryVideo[])
    : [];
  return pickUrl(related[index - 1]?.videoS3Key);
}

export function pickCreativeStreamVideoUrl(
  creative: CreativePlain,
  index: number,
): string | undefined {
  if (index <= 0) {
    return pickUrl(creative.videoPlayUrl);
  }
  const related = Array.isArray(creative.relatedVideos)
    ? (creative.relatedVideos as ISecondaryVideo[])
    : [];
  return pickUrl(related[index - 1]?.videoPlayUrl);
}

export function pickCreativeThumbnailUrl(
  creative: CreativePlain,
  index: number,
  kind: 'thumbnail' | 'avatar',
): string | undefined {
  if (index <= 0) {
    if (kind === 'avatar') return resolveCreatorAvatarUrl(creative);
    const creator = creative.creator as ICreatorProfile | undefined;
    return pickUrl(creative.thumbnailUrl, creator?.avatarUrl);
  }
  const related = Array.isArray(creative.relatedVideos)
    ? (creative.relatedVideos as ISecondaryVideo[])
    : [];
  const node = related[index - 1];
  if (!node) return undefined;
  if (kind === 'avatar') return pickUrl(node.creator?.avatarUrl);
  return pickUrl(node.thumbnailUrl, node.creator?.avatarUrl);
}
