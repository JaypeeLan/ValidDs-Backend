/**
 * Creator lobby — one row per unique product primaryCreator.handle (shop / seller).
 * Only includes products that have at least one feed-safe creative.
 */

import type { Model } from 'mongoose';
import type { PipelineStage } from 'mongoose';
import type { IProductDocument } from '../types/product.types';
import type { CreatorLobbyItem, ICreativeDocument } from '../types/creative.types';
import {
  loadCreatorAvatarEnrichmentByHandle,
  loadCreatorAvatarEnrichmentByProductId,
  type CreatorAvatarEnrichment,
} from '../utils/product-response.util';
import type { ContentMetricFilters } from '../utils/content-feed-filters.util';
import {
  applyProductCreatorMetricFilters,
  applyProductMetricFilters,
} from '../utils/content-feed-filters.util';
import { LISTABLE_PRODUCT_FILTER } from '../db/repositories/product.repository';
import { expandCategoryL1FilterValues } from '../utils/category-l1-normalize.util';
import {
  buildCreatorAvatarProxyUrl,
  hasCachedCreatorAvatarSource,
  isUsableCreatorAvatarUrl,
} from '../utils/creator-avatar.util';
import {
  creativeCollectionForProductCollection,
  productPlayableCreativeLookupStages,
} from '../utils/creative-response.util';

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

  if (metric.minGmv != null) {
    const existing = query.totalGmv as Record<string, number> | undefined;
    query.totalGmv = {
      ...(existing ?? {}),
      $gte: Math.max(existing?.$gte ?? 0, metric.minGmv),
    };
  }
  if (metric.maxGmv != null) {
    const existing = query.totalGmv as Record<string, number> | undefined;
    query.totalGmv = { ...(existing ?? {}), $lte: metric.maxGmv };
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
    case 'creator_gmv_asc':
    case 'gmv_asc':
      return { creatorGmv: 1, maxFollowers: -1 };
    case 'followers_asc':
      return { maxFollowers: 1, creatorGmv: -1 };
    case 'followers_desc':
      return { maxFollowers: -1, creatorGmv: -1 };
    case 'likes':
      return { maxTotalLikes: -1, creatorGmv: -1 };
    case 'recent':
    case 'last_ingested':
    case 'last-ingested':
    case 'ingested_desc':
      return { latestActivity: -1, creatorGmv: -1 };
    case 'engagement':
      return { maxEngagementRate: -1, creatorGmv: -1 };
    case 'creator_gmv_desc':
    case 'gmv_desc':
    case 'views':
    default:
      return { creatorGmv: -1, maxFollowers: -1 };
  }
}

type AggregatedCreator = {
  _id: string;
  handle: string;
  creator: Record<string, unknown>;
  shopName?: string;
  productCount: number;
  creatorGmv: number;
  topProductId: unknown;
  maxFollowers: number;
  maxTotalLikes: number;
  maxViews: number;
  latestActivity?: Date;
  maxEngagementRate?: number;
  topProduct?: Record<string, unknown>;
};

function formatProductCreatorFeedItem(
  row: AggregatedCreator,
  enrichment?: CreatorAvatarEnrichment | null,
): CreatorLobbyItem {
  const top = row.topProduct ?? {};
  const creatorRaw = {
    ...(row.creator ?? {}),
    ...((top.primaryCreator as Record<string, unknown> | undefined) ?? {}),
  };
  const productId = String(top._id ?? row.topProductId ?? '');
  const apiVersion = process.env.API_VERSION || 'v1';
  const creativeId = enrichment?.creativeId;
  const baseUrl = creativeId ? `/api/${apiVersion}/creatives/${creativeId}` : undefined;

  // Prefer real profile avatar URL only — never product photos / shop logos.
  const avatarUrl = [creatorRaw.avatarUrl, enrichment?.primaryImageUrl].find(
    isUsableCreatorAvatarUrl,
  );
  const avatarS3Key =
    typeof creatorRaw.avatarS3Key === 'string' && creatorRaw.avatarS3Key.trim()
      ? creatorRaw.avatarS3Key.trim()
      : undefined;
  const hasAvatar = hasCachedCreatorAvatarSource({ avatarUrl, avatarS3Key });
  const avatarProxyUrl =
    hasAvatar && baseUrl
      ? buildCreatorAvatarProxyUrl(baseUrl, 0, {
          avatarUrl,
          avatarS3Key,
          handle: row.handle,
        })
      : undefined;

  const thumb =
    typeof top.primaryImageUrl === 'string' && top.primaryImageUrl.startsWith('https://')
      ? top.primaryImageUrl
      : Array.isArray(top.imageUrls) && typeof top.imageUrls[0] === 'string'
        ? top.imageUrls[0]
        : null;

  return {
    creatorGmv: Number(row.creatorGmv) || 0,
    creator: {
      handle: row.handle,
      displayName: typeof creatorRaw.displayName === 'string' ? creatorRaw.displayName : row.handle,
      followers: Number(row.maxFollowers) || 0,
      totalLikes: Number(row.maxTotalLikes) || 0,
      ...(avatarProxyUrl ? { avatarProxyUrl } : {}),
    },
    topProduct: {
      productId,
      productName: typeof top.title === 'string' ? top.title : '',
      productRating: typeof top.rating === 'number' ? top.rating : null,
      productPrimaryImageUrl: thumb,
    },
    updatedAt:
      (row.latestActivity as Date | string | undefined) ??
      (top.updatedAt as Date | string | undefined) ??
      (top.lastIngestedAt as Date | string | undefined) ??
      null,
  };
}

function topProductSortSpec(): Record<string, -1> {
  return {
    'primaryCreator.shopGmv': -1,
    storeGmv: -1,
    totalGmv: -1,
    lastIngestedAt: -1,
  };
}

export async function findProductCreators(
  productModel: Model<IProductDocument>,
  filters: ProductCreatorFilters,
  creativeModel?: Model<ICreativeDocument>,
): Promise<{
  data: CreatorLobbyItem[];
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
    ...productPlayableCreativeLookupStages(
      creativeCollectionForProductCollection(productModel.collection.name),
    ),
    {
      $group: {
        _id: { $toLower: { $trim: { input: '$primaryCreator.handle' } } },
        handle: { $first: '$primaryCreator.handle' },
        creator: {
          $top: {
            sortBy: topProductSortSpec(),
            output: '$primaryCreator',
          },
        },
        shopName: { $first: '$shopName' },
        productCount: { $sum: 1 },
        creatorGmv: {
          // Shop-owning creators only (`primaryCreator.shopGmv` from storefront catalog).
          // Never fall back to product storeGmv — that is listing revenue, not creator GMV.
          $max: { $ifNull: ['$primaryCreator.shopGmv', 0] },
        },
        topProductId: {
          $top: {
            sortBy: topProductSortSpec(),
            output: '$_id',
          },
        },
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
    {
      $facet: {
        meta: [{ $count: 'total' }],
        data: [{ $sort: sort }, { $skip: skip }, { $limit: limit }],
      },
    },
  ];

  const [facet] = await productModel
    .aggregate(pipeline)
    .option({ maxTimeMS: 20_000 })
    .allowDiskUse(true)
    .exec();
  const total = (facet?.meta?.[0] as { total?: number } | undefined)?.total ?? 0;
  const rows = (facet?.data ?? []) as AggregatedCreator[];

  const productIds = rows
    .map((row) => String(row.topProductId ?? ''))
    .filter((id) => id.length > 0);
  const topProducts = productIds.length
    ? await productModel
        .find({ _id: { $in: productIds } })
        .select({
          title: 1,
          externalId: 1,
          primaryImageUrl: 1,
          imageUrls: 1,
          viewCount: 1,
          likeCount: 1,
          commentCount: 1,
          shareCount: 1,
          engagementRate: 1,
          categoryL1: 1,
          categoryL2: 1,
          categoryL3: 1,
          rating: 1,
          totalSales: 1,
          price: 1,
          productUrl: 1,
          shopName: 1,
          shopAvatarUrl: 1,
          primaryCreator: 1,
          publishedAt: 1,
          postCreatedAt: 1,
          lastIngestedAt: 1,
          updatedAt: 1,
        })
        .lean()
    : [];
  const topProductById = new Map(
    topProducts.map((product) => [String(product._id), product as Record<string, unknown>]),
  );

  const avatarByProduct = creativeModel
    ? await loadCreatorAvatarEnrichmentByProductId(productIds, creativeModel)
    : new Map<string, CreatorAvatarEnrichment>();

  const handlesNeedingFallback = rows
    .filter((row) => !avatarByProduct.has(String(row.topProductId ?? '')))
    .map((row) => row.handle)
    .filter((h) => typeof h === 'string' && h.trim().length > 0);
  const avatarByHandle =
    creativeModel && handlesNeedingFallback.length
      ? await loadCreatorAvatarEnrichmentByHandle(handlesNeedingFallback, creativeModel)
      : new Map<string, CreatorAvatarEnrichment>();

  return {
    data: rows.map((row) => {
      const productId = String(row.topProductId ?? '');
      const enrichment =
        avatarByProduct.get(productId) ??
        avatarByHandle.get(row.handle.trim().toLowerCase().replace(/^@/, '')) ??
        null;
      return formatProductCreatorFeedItem(
        {
          ...row,
          topProduct: topProductById.get(productId) ?? {},
        },
        enrichment,
      );
    }),
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit) || 0,
    },
    groupBy: 'creator',
  };
}
