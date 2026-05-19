import { Creative, type ICreativeDocument } from '../models/creative.model';
import type { Model } from 'mongoose';
import { logger } from '../logger';
import mongoose from 'mongoose';

const log = logger.child({ module: 'creative-service' });

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const CreativeService = {
  formatWithAllVideos(input: any) {
    const creative = typeof input?.toObject === 'function' ? input.toObject() : input;
    if (!creative) return creative;

    const apiVersion = process.env.API_VERSION || 'v1';
    const creativeId = String(creative._id || '');
    const baseUrl = creativeId ? `/api/${apiVersion}/creatives/${creativeId}` : undefined;
    const videoProxy = (index: number) => (baseUrl ? `${baseUrl}/video?index=${index}` : undefined);
    const thumbProxy = (index: number, hasUrl?: unknown) =>
      baseUrl && hasUrl ? `${baseUrl}/thumbnail?index=${index}&kind=thumbnail` : undefined;
    const avatarProxy = (index: number, hasUrl?: unknown) =>
      baseUrl && hasUrl ? `${baseUrl}/thumbnail?index=${index}&kind=avatar` : undefined;
    const embedUrl = (videoId?: string) => (videoId ? `https://www.tiktok.com/embed/v2/${videoId}` : undefined);

    const decorateCreator = (creator: any, index: number) => {
      if (!creator) return creator;
      return { ...creator, avatarProxyUrl: avatarProxy(index, creator.avatarUrl) };
    };

    const trimMetrics = (metrics: any) => {
      if (!metrics) return metrics;
      const { source: _s, fetchedAt: _f, ...rest } = metrics;
      return rest;
    };

    const related = Array.isArray(creative.relatedVideos)
      ? creative.relatedVideos.map((video: any, i: number) => ({
          isPrimary: false,
          externalVideoId: video.externalVideoId,
          videoPlayUrl: video.videoPlayUrl,
          videoProxyUrl: videoProxy(i + 1),
          embedUrl: embedUrl(video.externalVideoId),
          thumbnailUrl: video.thumbnailUrl,
          thumbnailProxyUrl: thumbProxy(i + 1, video.thumbnailUrl),
          creator: decorateCreator(video.creator, i + 1),
          metrics: trimMetrics(video.metrics),
          topComments: video.topComments || [],
          publishedAt: video.publishedAt,
        }))
      : [];

    return {
      ...creative,
      videoProxyUrl: videoProxy(0),
      embedUrl: embedUrl(creative.externalVideoId),
      thumbnailProxyUrl: thumbProxy(0, creative.thumbnailUrl),
      creator: decorateCreator(creative.creator, 0),
      metrics: trimMetrics(creative.metrics),
      relatedVideos: related,
    } as Record<string, unknown>;
  },

  async fetchAndIngestCreatives(
    _productName?: string,
    _productId?: mongoose.Types.ObjectId,
    _options?: Record<string, unknown>
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
    _productDescription?: string
  ): Promise<boolean> {
    log.info('Creative map-and-save via external providers is disabled');
      return false;
  },

  async findCreatives(
    filters: any,
    extraMatch?: Record<string, unknown>,
    /** Market-specific Creative model from req.models.Creative. Defaults to global model (US). */
    creativeModel: Model<ICreativeDocument> = Creative,
  ) {
    const { q, productId, section, isAd, region, minViews, hashtags, page = 1, limit = 20, sortBy = 'views', categoryL1, categoryL2, categoryL3 } = filters;
    const query: any = {};
    if (productId) query.productId = productId;
    if (section) query.section = section;
    if (isAd !== undefined) query.isAd = isAd;
    if (region) query['creator.region'] = region.toUpperCase();
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
      query.$or = [{ productName: regex }, { productDescription: regex }, { description: regex }, { hashtags: regex }, { 'creator.handle': regex }, { externalVideoId: regex }];
    }
    if (extraMatch && Object.keys(extraMatch).length > 0) {
      Object.assign(query, extraMatch);
    }

    const skip = (Number(page) - 1) * Number(limit);
    const mLimit = Number(limit);
    const sortMap: Record<string, Record<string, 1 | -1>> = {
      views:      { 'metrics.viewCount': -1, publishedAt: -1 },
      likes:      { 'metrics.likeCount': -1, publishedAt: -1 },
      engagement: { 'metrics.engagementRate': -1, publishedAt: -1 },
      recent:     { publishedAt: -1 },
    };
    const sort = sortMap[sortBy] ?? sortMap.views;

    const [rawData, total] = await Promise.all([
      creativeModel.find(query, { productDescription: 0 }).sort(sort).skip(skip).limit(mLimit).lean(),
      creativeModel.countDocuments(query),
    ]);
    const data = rawData.map((doc) => this.formatWithAllVideos(doc));
    return { data, pagination: { total, page: Number(page), limit: mLimit, pages: Math.ceil(total / mLimit) } };
  },

  async getCreativeById(
    id: string,
    /** Market-specific Creative model from req.models.Creative. Defaults to global model (US). */
    creativeModel: Model<ICreativeDocument> = Creative,
  ) {
    const doc = await creativeModel.findById(id).lean();
    if (!doc) return null;
    return this.formatWithAllVideos(doc);
  },

  async refreshCreativeMedia(_creativeId?: string | mongoose.Types.ObjectId, _index = 0): Promise<boolean> {
      return false;
  },

  async refreshAllSlotsForCreative(_creativeId: string | mongoose.Types.ObjectId): Promise<{ scanned: number; refreshed: number; slots: number }> {
    return { scanned: 0, refreshed: 0, slots: 0 };
  },

  async ingestByKeyword(
    _keyword?: string,
    _options?: { limit?: number; period?: number; country?: string }
  ): Promise<{ saved: number; productId: mongoose.Types.ObjectId; productTitle: string }> {
    throw new Error('Creative keyword ingestion is disabled');
  },
};
