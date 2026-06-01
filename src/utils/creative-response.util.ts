import { buildCreatorAvatarProxyUrl } from './creator-avatar.util';
import type {
  CreativeApiItem,
  CreativeCreatorFeedItem,
  CreativeFeedItem,
  CreativeSection,
  ICreativeComment,
  ICreatorProfile,
  IMetricTrend,
  IMetricTrendWindow,
  IProductTrendSnapshot,
  ISecondaryVideo,
  IVideoMetrics,
} from '../types/creative.types';
import { resolveEngagementTrend } from './product-trend.util';

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

/** TikTok UGC / shop videos — never Meta rows. */
export const CREATIVE_TRENDING_MATCH = {
  section: 'top-ads' as const,
  externalVideoId: { $not: { $regex: /^meta:/ } },
};
/** Meta Ad Library creatives only — never TikTok video ids. */
export const CREATIVE_TOP_ADS_MATCH = {
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

  if (isProductHeroThumbnail(creative) && pid) {
    return `product-card:${pid}`;
  }

  if (ext.startsWith('meta:')) {
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

/** Mongo stages: collapse duplicate ads (same video / same product hero card / Meta copy). */
export function creativeAdDedupeAggregationStages(): Record<string, unknown>[] {
  const thumb = mongoImageAssetKeyExpr('$thumbnailUrl');
  const productThumb = mongoImageAssetKeyExpr('$productPrimaryImageUrl');
  const pid = { $toString: '$productId' };

  // Order must match creativeAdDedupeKey(): product hero → meta → tiktok video id.
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
      { $concat: ['product-card:', pid] },
      {
        $cond: [
          { $regexMatch: { input: { $ifNull: ['$externalVideoId', ''] }, regex: '^meta:' } },
          mongoMetaAdDedupeKeyExpr(),
          mongoTiktokVideoDedupeKeyExpr(),
        ],
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
  const windows: IMetricTrendWindow[] = Array.isArray(o.windows)
    ? o.windows
        .filter((w): w is Record<string, unknown> => !!w && typeof w === 'object')
        .map((w) => ({
          label: String(w.label ?? ''),
          daysAgo: Number(w.daysAgo) || 0,
          value: Number(w.value) || 0,
        }))
    : [];
  return {
    direction,
    changePercent: Number(o.changePercent) || 0,
    windows,
  };
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
  const m = metrics ?? ({} as IVideoMetrics);
  return {
    viewCount: Number(m.viewCount) || 0,
    likeCount: Number(m.likeCount) || 0,
    commentCount: Number(m.commentCount) || 0,
    shareCount: Number(m.shareCount) || 0,
    engagementRate: m.engagementRate ?? null,
  };
}

function formatCreator(
  creator: ICreatorProfile | undefined,
  index: number,
  baseUrl?: string,
  resolvedAvatarUrl?: string,
): ICreatorProfile & { avatarProxyUrl?: string } {
  const c = creator ?? ({ handle: '', verified: false, tiktokPostUrl: '' } as ICreatorProfile);
  const avatarUrl = pickUrl(resolvedAvatarUrl, c.avatarUrl);
  const avatarProxyUrl = buildCreatorAvatarProxyUrl(baseUrl, index, {
    avatarUrl,
    avatarS3Key: c.avatarS3Key,
    handle: c.handle,
  });
  return {
    ...c,
    isIndependentCreator: Boolean(c.isIndependentCreator),
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(avatarProxyUrl ? { avatarProxyUrl } : {}),
  };
}

function embedUrlFor(videoId?: string): string | undefined {
  return videoId ? `https://www.tiktok.com/embed/v2/${videoId}` : undefined;
}

function formatSecondaryVideo(
  video: ISecondaryVideo,
  index: number,
  baseUrl?: string,
): CreativeApiItem['relatedVideos'][number] {
  const thumb = pickUrl(video.thumbnailUrl);
  return {
    isPrimary: false,
    externalVideoId: video.externalVideoId,
    embedUrl: pickUrl(video.embedUrl, embedUrlFor(video.externalVideoId))!,
    tiktokPostUrl: video.tiktokPostUrl,
    thumbnailUrl: video.thumbnailUrl,
    videoPlayUrl: video.videoPlayUrl,
    videoProxyUrl: baseUrl ? `${baseUrl}/video?index=${index}` : undefined,
    thumbnailProxyUrl:
      baseUrl && thumb ? `${baseUrl}/thumbnail?index=${index}&kind=thumbnail` : undefined,
    creator: formatCreator(video.creator, index, baseUrl),
    metrics: formatMetrics(video.metrics),
    topComments: video.topComments ?? [],
    publishedAt: video.publishedAt,
  };
}

export type FormatCreativeOptions = {
  includeProductDescription?: boolean;
};

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
  const thumb = pickUrl(creative.thumbnailUrl);

  const apiSection = dbSectionToApi(creative.section as string | undefined) ?? 'trending';
  const creator = creative.creator as ICreatorProfile | undefined;
  const creatorAvatarUrl = resolveCreatorAvatarUrl(creative);

  const item: CreativeApiItem = {
    id,
    productId: String(creative.productId ?? ''),
    externalVideoId,
    embedUrl: pickUrl(creative.embedUrl, embedUrlFor(externalVideoId)) ?? '',
    tiktokPostUrl: String(creative.tiktokPostUrl ?? ''),
    thumbnailUrl: creative.thumbnailUrl as string | undefined,
    videoProxyUrl: baseUrl ? `${baseUrl}/video?index=0` : undefined,
    thumbnailProxyUrl: baseUrl && thumb ? `${baseUrl}/thumbnail?index=0&kind=thumbnail` : undefined,
    creator: formatCreator(creator, 0, baseUrl, creatorAvatarUrl),
    metrics: formatMetrics(creative.metrics as IVideoMetrics | undefined),
    section: apiSection,
    isIndependentCreator: Boolean(creative.isIndependentCreator ?? creator?.isIndependentCreator),
    isPrimaryDiscovery: creative.isPrimaryDiscovery as boolean | undefined,
    isAd: creative.isAd as boolean | undefined,
    productName: creative.productName as string | undefined,
    categoryL1: creative.categoryL1 as string | undefined,
    categoryL2: creative.categoryL2 as string | undefined,
    categoryL3: creative.categoryL3 as string | undefined,
    categoryPath: creative.categoryPath as string | undefined,
    description: (creative.description as string | null | undefined) ?? null,
    angle: (creative.angle as string | null | undefined) ?? null,
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
      return slots.map((v, i) => formatSecondaryVideo(v, i + 1, baseUrl));
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
