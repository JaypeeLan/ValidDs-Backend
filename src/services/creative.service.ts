import { Creative, type ICreativeDocument } from '../models/creative.model';
import type { CreativeCreatorFeedItem, CreativeFeedItem, ISecondaryVideoApi } from '../types/creative.types';
import type { Model } from 'mongoose';
import { logger } from '../logger';
import mongoose, { type PipelineStage } from 'mongoose';
import {
  apiSectionToDb,
  CREATIVE_COMMERCIAL_MATCH,
  CREATIVE_TOP_ADS_MATCH,
  CREATIVE_TRENDING_MATCH,
  formatCreativeFeedItem,
  formatCreativeCreatorFeedItem,
  formatCreativeForApi,
  creativeAdDedupeAggregationStages,
} from '../utils/creative-response.util';
import {
  creativeRecencyPrioritySortSpec,
  recencyTierAddFields,
} from '../utils/product-recency.util';
import {
  applyCreativeMetricFilters,
  type ContentMetricFilters,
} from '../utils/content-feed-filters.util';

export {
  apiSectionToDb,
  dbSectionToApi,
  CREATIVE_COMMERCIAL_MATCH,
  CREATIVE_TOP_ADS_MATCH,
  CREATIVE_TRENDING_MATCH,
} from '../utils/creative-response.util';

const log = logger.child({ module: 'creative-service' });

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const PRODUCT_CREATIVE_LIMIT = 100;

async function loadCreativesForProduct(
  productId: string,
  creativeModel: Model<ICreativeDocument>,
  extraFilter: Record<string, unknown>,
  limit = PRODUCT_CREATIVE_LIMIT,
): Promise<CreativeFeedItem[]> {
  if (!mongoose.isValidObjectId(productId)) return [];

  const mLimit = Math.min(Math.max(limit, 1), 100);
  const videoSort = creativeRecencyPrioritySortSpec('views');
  const docs = (await creativeModel
    .aggregate([
      {
        $match: {
          productId: new mongoose.Types.ObjectId(productId),
          ...extraFilter,
        },
      },
      { $addFields: recencyTierAddFields() },
      { $sort: videoSort },
      ...(creativeAdDedupeAggregationStages() as unknown as PipelineStage[]),
      { $sort: videoSort },
      { $limit: mLimit },
      { $unset: ['productDescription', '_recencyTier', '_postDate'] },
    ])
    .option({ maxTimeMS: 15_000 })
    .exec()) as Record<string, unknown>[];

  return docs.map((doc) => formatCreativeFeedItem(doc));
}

/** Commercial videos for a product (`GET /products/:id` → `relatedVideos`). */
export async function findCreativesByProductId(
  productId: string,
  creativeModel: Model<ICreativeDocument> = Creative,
  limit = PRODUCT_CREATIVE_LIMIT,
): Promise<CreativeFeedItem[]> {
  return loadCreativesForProduct(productId, creativeModel, CREATIVE_COMMERCIAL_MATCH, limit);
}

/** Ad creatives only for a product (`GET /products/:id` → `relatedAds`). */
export async function findRelatedAdsByProductId(
  productId: string,
  creativeModel: Model<ICreativeDocument> = Creative,
  limit = PRODUCT_CREATIVE_LIMIT,
): Promise<CreativeFeedItem[]> {
  return loadCreativesForProduct(productId, creativeModel, CREATIVE_TOP_ADS_MATCH, limit);
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
    if (categoryL1) query.categoryL1 = categoryL1;
    if (categoryL2) query.categoryL2 = categoryL2;
    if (categoryL3) query.categoryL3 = categoryL3;
    if (hashtags) {
      const tagList = Array.isArray(hashtags) ? hashtags : [hashtags];
      query.hashtags = { $in: tagList };
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

    const baseStages: PipelineStage[] = [
      { $match: query },
      ...(sortKey === 'recent' ? [] : [{ $addFields: recencyTierAddFields() }]),
      { $sort: sort },
      ...(creativeAdDedupeAggregationStages() as unknown as PipelineStage[]),
      { $unset: ['productDescription', '_recencyTier', '_postDate', 'adDedupeKey'] },
      { $sort: sort },
    ];

    const groupByCreator = groupBy === 'creator';
    const pipeline: PipelineStage[] = groupByCreator
      ? [
          ...baseStages,
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
          { $sort: sort },
          {
            $facet: {
              data: [{ $skip: skip }, { $limit: mLimit }],
              total: [{ $count: 'count' }],
            },
          },
        ]
      : [
          ...baseStages,
          {
            $facet: {
              data: [{ $skip: skip }, { $limit: mLimit }],
              total: [{ $count: 'count' }],
            },
          },
        ];

    const [result] = (await creativeModel.aggregate(pipeline).exec()) as [
      {
        data: Record<string, unknown>[];
        total: [{ count: number }] | [];
      },
    ];

    const rawData = result?.data ?? [];
    const total = result?.total[0]?.count ?? 0;
    const data = groupByCreator
      ? rawData.map((doc) => {
          const { videoCount, ...creative } = doc;
          return formatCreativeCreatorFeedItem(
            creative,
            typeof videoCount === 'number' ? videoCount : Number(videoCount) || 0,
          );
        })
      : rawData.map((doc) => formatCreativeFeedItem(doc));
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

  async getCreativeById(
    id: string,
    creativeModel: Model<ICreativeDocument> = Creative,
  ) {
    const doc = await creativeModel.findById(id).lean();
    if (!doc) return null;
    return formatCreativeForApi(doc, { includeProductDescription: true });
  },

  findByProductId: findCreativesByProductId,
  findRelatedAdsByProductId,

  async refreshCreativeMedia(
    _creativeId?: string | mongoose.Types.ObjectId,
    _index = 0,
  ): Promise<boolean> {
    return false;
  },

  async refreshAllSlotsForCreative(
    _creativeId: string | mongoose.Types.ObjectId,
  ): Promise<{ scanned: number; refreshed: number; slots: number }> {
    return { scanned: 0, refreshed: 0, slots: 0 };
  },

  async ingestByKeyword(
    _keyword?: string,
    _options?: { limit?: number; period?: number; country?: string },
  ): Promise<{ saved: number; productId: mongoose.Types.ObjectId; productTitle: string }> {
    throw new Error('Creative keyword ingestion is disabled');
  },
};
