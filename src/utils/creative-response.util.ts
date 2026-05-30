import type {
  CreativeApiItem,
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

export const CREATIVE_TRENDING_MATCH = { section: 'top-ads' as const };
export const CREATIVE_TOP_ADS_MATCH = { section: 'trending' as const };
export const CREATIVE_COMMERCIAL_MATCH = CREATIVE_TRENDING_MATCH;

/** Facebook/Instagram Ad Library rows — excluded from product related ads/videos. */
export const EXCLUDE_META_CREATIVES_MATCH = {
  externalVideoId: { $not: /^meta:/ },
} as const;

type CreativePlain = Record<string, unknown>;

function pickUrl(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
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
): ICreatorProfile & { avatarProxyUrl?: string } {
  const c = creator ?? ({ handle: '', verified: false, tiktokPostUrl: '' } as ICreatorProfile);
  const avatarUrl = pickUrl(c.avatarUrl);
  const avatarProxyUrl =
    baseUrl && avatarUrl ? `${baseUrl}/thumbnail?index=${index}&kind=avatar` : undefined;
  return {
    ...c,
    isIndependentCreator: Boolean(c.isIndependentCreator),
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
    thumbnailProxyUrl: baseUrl && thumb ? `${baseUrl}/thumbnail?index=${index}&kind=thumbnail` : undefined,
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
  const creative = typeof (raw as { toObject?: () => CreativePlain }).toObject === 'function'
    ? (raw as { toObject: () => CreativePlain }).toObject()
    : raw;

  const id = String(creative._id ?? creative.id ?? '');
  const apiVersion = process.env.API_VERSION || 'v1';
  const baseUrl = id ? `/api/${apiVersion}/creatives/${id}` : undefined;
  const externalVideoId = String(creative.externalVideoId ?? '');
  const thumb = pickUrl(creative.thumbnailUrl);

  const apiSection = dbSectionToApi(creative.section as string | undefined) ?? 'trending';
  const creator = creative.creator as ICreatorProfile | undefined;

  const item: CreativeApiItem = {
    id,
    productId: String(creative.productId ?? ''),
    externalVideoId,
    embedUrl: pickUrl(creative.embedUrl, embedUrlFor(externalVideoId)) ?? '',
    tiktokPostUrl: String(creative.tiktokPostUrl ?? ''),
    thumbnailUrl: creative.thumbnailUrl as string | undefined,
    videoProxyUrl: baseUrl ? `${baseUrl}/video?index=0` : undefined,
    thumbnailProxyUrl: baseUrl && thumb ? `${baseUrl}/thumbnail?index=0&kind=thumbnail` : undefined,
    creator: formatCreator(creator, 0, baseUrl),
    metrics: formatMetrics(creative.metrics as IVideoMetrics | undefined),
    section: apiSection,
    isIndependentCreator: Boolean(
      creative.isIndependentCreator ?? creator?.isIndependentCreator,
    ),
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
  const { productDescription: _pd, relatedVideos: _rv, ...feed } = full;
  // List endpoints return one card per creative doc; nested slots are detail-only.
  return { ...feed, relatedVideos: [] };
}

/** CDN URL for video proxy — not the embed URL. */
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
    const creator = creative.creator as ICreatorProfile | undefined;
    if (kind === 'avatar') return pickUrl(creator?.avatarUrl);
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
