/**
 * Creator lobby — one row per unique product primaryCreator.handle (shop / seller).
 * Does not use the `creators` scrape queue or require creative documents.
 */

import type { Model } from 'mongoose';
import type { PipelineStage } from 'mongoose';
import type { IProductDocument } from '../types/product.types';
import type { CreativeCreatorFeedItem } from '../types/creative.types';
import type { ContentMetricFilters } from '../utils/content-feed-filters.util';
import {
  applyProductCreatorMetricFilters,
  applyProductMetricFilters,
} from '../utils/content-feed-filters.util';
import { LISTABLE_PRODUCT_FILTER } from '../db/repositories/product.repository';
import { expandCategoryL1FilterValues } from '../utils/category-l1-normalize.util';
import { buildCreatorAvatarProxyUrl } from '../utils/creator-avatar.util';

type ProductCreatorFilters = {
  q?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  categoryL1?: string[];
  categoryL2?: string[];
  categoryL3?: string[];
  _metricFilters?: ContentMetricFilters;
};

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildProductCreatorMatch(
  filters: ProductCreatorFilters,
  metric: ContentMetricFilters,
): Record<string, unknown> {
  const query: Record<string, unknown> = {
    ...LISTABLE_PRODUCT_FILTER,
    'primaryCreator.handle': { $exists: true, $type: 'string', $regex: /\S/ },
  };

  if (filters.categoryL1?.length) {
    const expanded = expandCategoryL1FilterValues(filters.categoryL1);
    query.categoryL1 = expanded.length === 1 ? expanded[0] : { $in: expanded };
  }
  if (filters.categoryL2?.length) {
    query.categoryL2 =
      filters.categoryL2.length === 1 ? filters.categoryL2[0] : { $in: filters.categoryL2 };
  }
  if (filters.categoryL3?.length) {
    query.categoryL3 =
      filters.categoryL3.length === 1 ? filters.categoryL3[0] : { $in: filters.categoryL3 };
  }

  if (filters.q) {
    const safe = escapeRegex(String(filters.q).trim());
    const regex = new RegExp(safe, 'i');
    query.$or = [
      { 'primaryCreator.handle': regex },
      { 'primaryCreator.displayName': regex },
      { shopName: regex },
      { title: regex },
      { accountHandle: regex },
    ];
  }

  applyProductMetricFilters(query, {
    startDate: metric.startDate,
    minLikes: metric.minLikes,
    minEngagementRate: metric.minEngagementRate,
  });

  applyProductCreatorMetricFilters(query, {
    minCreatorGmv: metric.minCreatorGmv,
    maxCreatorGmv: metric.maxCreatorGmv,
    minFollowers: metric.minFollowers,
    maxFollowers: metric.maxFollowers,
    minCreatorLikes: metric.minCreatorLikes,
    maxCreatorLikes: metric.maxCreatorLikes,
  });

  const gmvFloors = [metric.minGmv, metric.minCreatorGmv].filter((n): n is number => n != null);
  if (gmvFloors.length) {
    const floor = Math.max(...gmvFloors);
    const existing = query.totalGmv as Record<string, number> | undefined;
    query.totalGmv = { ...(existing ?? {}), $gte: Math.max(existing?.$gte ?? 0, floor) };
  }
  if (metric.maxGmv != null || metric.maxCreatorGmv != null) {
    const caps = [metric.maxGmv, metric.maxCreatorGmv].filter((n): n is number => n != null);
    const cap = Math.min(...caps);
    const existing = query.totalGmv as Record<string, number> | undefined;
    query.totalGmv = { ...(existing ?? {}), $lte: cap };
  }

  if (metric.minUnits != null || metric.maxUnits != null) {
    query.totalSales = {
      ...(metric.minUnits != null ? { $gte: metric.minUnits } : {}),
      ...(metric.maxUnits != null ? { $lte: metric.maxUnits } : {}),
    };
  }

  return query;
}

function creatorSortSpec(sortBy: string): Record<string, 1 | -1> {
  switch (sortBy) {
    case 'likes':
      return { maxTotalLikes: -1, creatorGmv: -1 };
    case 'recent':
      return { latestActivity: -1, creatorGmv: -1 };
    case 'engagement':
      return { maxEngagementRate: -1, creatorGmv: -1 };
    case 'views':
    default:
      return { creatorGmv: -1, maxViews: -1 };
  }
}

type AggregatedCreator = {
  _id: string;
  handle: string;
  creator: Record<string, unknown>;
  shopName?: string;
  productCount: number;
  creatorGmv: number;
  topProduct: Record<string, unknown>;
  maxFollowers: number;
  maxTotalLikes: number;
  maxViews: number;
  latestActivity?: Date;
  maxEngagementRate?: number;
};

function formatProductCreatorFeedItem(row: AggregatedCreator): CreativeCreatorFeedItem {
  const top = row.topProduct ?? {};
  const creatorRaw = row.creator ?? {};
  const productId = String(top._id ?? '');
  const apiVersion = process.env.API_VERSION || 'v1';
  const baseUrl = productId ? `/api/${apiVersion}/creatives/${productId}` : undefined;

  const avatarUrl =
    typeof creatorRaw.avatarUrl === 'string' && creatorRaw.avatarUrl.startsWith('https://')
      ? creatorRaw.avatarUrl
      : typeof creatorRaw.primaryImageUrl === 'string' &&
          creatorRaw.primaryImageUrl.startsWith('https://')
        ? creatorRaw.primaryImageUrl
        : undefined;

  const avatarProxyUrl = buildCreatorAvatarProxyUrl(baseUrl, 0, {
    avatarUrl,
    avatarS3Key: typeof creatorRaw.avatarS3Key === 'string' ? creatorRaw.avatarS3Key : undefined,
    handle: row.handle,
  });

  const thumb =
    typeof top.primaryImageUrl === 'string' && top.primaryImageUrl.startsWith('https://')
      ? top.primaryImageUrl
      : Array.isArray(top.imageUrls) && typeof top.imageUrls[0] === 'string'
        ? top.imageUrls[0]
        : undefined;

  return {
    id: productId,
    productId,
    externalVideoId: String(top.externalId ?? top.videoId ?? ''),
    thumbnailUrl: thumb,
    creator: {
      handle: row.handle,
      displayName: typeof creatorRaw.displayName === 'string' ? creatorRaw.displayName : row.handle,
      followers: row.maxFollowers,
      following: typeof creatorRaw.following === 'number' ? creatorRaw.following : undefined,
      totalLikes: row.maxTotalLikes,
      region: typeof creatorRaw.region === 'string' ? creatorRaw.region : undefined,
      verified: Boolean(creatorRaw.verified),
      isIndependentCreator: false,
      ...(avatarUrl ? { avatarUrl } : {}),
      ...(avatarProxyUrl ? { avatarProxyUrl } : {}),
    },
    metrics: {
      viewCount: Number(top.viewCount) || row.maxViews || 0,
      likeCount: Number(top.likeCount) || 0,
      commentCount: Number(top.commentCount) || 0,
      shareCount: Number(top.shareCount) || 0,
      engagementRate: typeof top.engagementRate === 'number' ? top.engagementRate : null,
    },
    section: 'trending',
    isIndependentCreator: false,
    productName: typeof top.title === 'string' ? top.title : undefined,
    categoryL1: typeof top.categoryL1 === 'string' ? top.categoryL1 : undefined,
    categoryL2: typeof top.categoryL2 === 'string' ? top.categoryL2 : undefined,
    categoryL3: typeof top.categoryL3 === 'string' ? top.categoryL3 : undefined,
    productRating: typeof top.rating === 'number' ? top.rating : null,
    productTotalSales: typeof top.totalSales === 'number' ? top.totalSales : null,
    productTotalGmv: row.creatorGmv,
    productPrice: typeof top.price === 'number' ? top.price : null,
    productUrl: typeof top.productUrl === 'string' ? top.productUrl : null,
    shopName: row.shopName ?? (typeof top.shopName === 'string' ? top.shopName : null),
    productPrimaryImageUrl: thumb ?? null,
    publishedAt:
      (top.publishedAt as Date | string | undefined) ??
      (top.postCreatedAt as Date | string | undefined) ??
      (top.lastIngestedAt as Date | string | undefined) ??
      null,
    ingestedAt: top.lastIngestedAt as Date | string | undefined,
    updatedAt: top.updatedAt as Date | string | undefined,
    hashtags: [],
    topComments: [],
    relatedVideos: [],
    videoCount: row.productCount,
  };
}

export async function findProductCreators(
  productModel: Model<IProductDocument>,
  filters: ProductCreatorFilters,
): Promise<{
  data: CreativeCreatorFeedItem[];
  pagination: { total: number; page: number; limit: number; pages: number };
  groupBy: 'creator';
}> {
  const page = Math.max(1, Number(filters.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(filters.limit) || 20));
  const skip = (page - 1) * limit;
  const metric = filters._metricFilters ?? {};
  const match = buildProductCreatorMatch(filters, metric);
  const sort = creatorSortSpec(String(filters.sortBy ?? 'views'));

  const pipeline: PipelineStage[] = [
    { $match: match },
    { $sort: { totalGmv: -1, lastIngestedAt: -1 } },
    {
      $group: {
        _id: { $toLower: { $trim: { input: '$primaryCreator.handle' } } },
        handle: { $first: '$primaryCreator.handle' },
        creator: { $first: '$primaryCreator' },
        shopName: { $first: '$shopName' },
        productCount: { $sum: 1 },
        creatorGmv: { $sum: { $ifNull: ['$totalGmv', 0] } },
        topProduct: { $first: '$$ROOT' },
        maxFollowers: { $max: { $ifNull: ['$primaryCreator.followers', 0] } },
        maxTotalLikes: { $max: { $ifNull: ['$primaryCreator.totalLikes', 0] } },
        maxViews: { $max: { $ifNull: ['$viewCount', 0] } },
        maxEngagementRate: { $max: { $ifNull: ['$engagementRate', 0] } },
        latestActivity: {
          $max: {
            $ifNull: ['$lastIngestedAt', { $ifNull: ['$publishedAt', '$postCreatedAt'] }],
          },
        },
      },
    },
    { $sort: sort },
    {
      $facet: {
        meta: [{ $count: 'total' }],
        data: [{ $skip: skip }, { $limit: limit }],
      },
    },
  ];

  const [facet] = await productModel.aggregate(pipeline).option({ maxTimeMS: 20_000 }).exec();
  const total = (facet?.meta?.[0] as { total?: number } | undefined)?.total ?? 0;
  const rows = (facet?.data ?? []) as AggregatedCreator[];

  return {
    data: rows.map(formatProductCreatorFeedItem),
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit) || 0,
    },
    groupBy: 'creator',
  };
}
