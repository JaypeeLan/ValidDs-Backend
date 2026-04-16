import axios from 'axios';
import { Creative } from '../models/creative.model';
import { logger } from '../logger';
import mongoose from 'mongoose';

const log = logger.child({ module: 'creative-service' });

const BASE_URL = 'https://ensembledata.com/apis';

export const CreativeService = {
  /**
   * Fetches TikTok videos mentioning the product by keyword search,
   * maps each to the ICreative schema, and upserts into MongoDB.
   *
   * Creator intelligence (full profile + verified TikTok post URL) is the
   * primary value here. Every creative MUST have a tiktokPostUrl.
   */
  async fetchAndIngestCreatives(
    productName: string,
    productId: mongoose.Types.ObjectId,
    options: {
      brand?: string;
      categoryKeywords?: string[];
      categoryL1?: string;
      categoryL2?: string;
      categoryL3?: string;
    } = {}
  ): Promise<number> {
    const token = process.env.ENSEMBLE_API_KEY;
    if (!token) {
      log.warn('ENSEMBLE_API_KEY is not configured');
      return 0;
    }

    const { brand, categoryKeywords, categoryL1, categoryL2, categoryL3 } = options;

    try {
      // 1. SURGICAL SEARCH: If a brand is known, lead with it.
      const searchQuery = brand ? `${brand} ${productName}` : productName;

      const response = await axios.get(`${BASE_URL}/tt/keyword/search`, {
        params: { name: searchQuery, token, cursor: 0, period: 30, country: 'us' },
        timeout: 20000,
      });

      const payload = response.data?.data || {};
      let items: any[] = payload.items || payload.videos || payload.aweme_list || payload.data || [];
      
      // 2. SOFT RELEVANCE FILTERING
      const filteredItems = items.filter(item => {
        if (!categoryKeywords || categoryKeywords.length === 0) return true;
        
        // Handle nested aweme_info structure from search results
        const info = item.aweme_info || item;
        const description = (info.desc || '').toLowerCase();
        const hashtags = (info.text_extra || []).map((t: any) => (t.hashtag_name || '').toLowerCase());
        const combinedText = `${description} ${hashtags.join(' ')}`;
        
        // Count how many of our category keywords appear in this video
        const matchCount = categoryKeywords.filter(k => combinedText.includes(k.toLowerCase())).length;
        
        // Soft Threshold: At least one category keyword must be present if keywords were provided
        return matchCount > 0;
      });

      const finalItems = filteredItems.slice(0, 5); // Limit to 5 high-fidelity creatives

      log.info(`Filtered ${items.length} -> ${finalItems.length} creatives for ${productName}`);

      let saved = 0;
      for (const item of finalItems) {
        const ok = await this.mapAndSave(item, productId, categoryL1, categoryL2, categoryL3);
        if (ok) saved++;
      }

      return saved;

    } catch (err: any) {
      log.error('EnsembleData creative fetch failed', { error: err.message });
      return 0;
    }
  },

  async mapAndSave(
    item: any,
    productId: mongoose.Types.ObjectId,
    categoryL1?: string,
    categoryL2?: string,
    categoryL3?: string,
  ): Promise<boolean> {
    try {
      // Handle nested aweme_info structure if present
      const info   = item.aweme_info || item;
      const author = info.author || {};
      const stats  = info.statistics || {};
      const video  = info.video || {};

      const videoId = info.aweme_id || info.id;
      const handle  = author.unique_id || author.uniqueId || '';

      // ── tiktokPostUrl is required — skip if we cannot construct it ─────
      if (!videoId || !handle) {
        log.debug('Skipping creative: missing videoId or creator handle', { videoId, handle });
        return false;
      }
      const tiktokPostUrl = `https://www.tiktok.com/@${handle}/video/${videoId}`;

      // ── Engagement calculation ─────────────────────────────────────────
      const viewCount    = stats.play_count    || 0;
      const likeCount    = stats.digg_count    || 0;
      const commentCount = stats.comment_count || 0;
      const shareCount   = stats.share_count   || 0;
      const engagementRate = viewCount > 0
        ? ((likeCount + commentCount + shareCount) / viewCount) * 100
        : 0;

      // ── Section classification ─────────────────────────────────────────
      let section: 'top-ads' | 'trending' | 'influencer-reviews' | 'tutorials' | 'viral-unboxings' = 'trending';
      if (info.is_ad || info.isAd) {
        section = 'top-ads';
      } else if ((author.follower_count || 0) > 100_000 || author.verification_type > 0) {
        section = 'influencer-reviews';
      } else if (engagementRate > 10) {
        section = 'viral-unboxings';
      }

      await Creative.findOneAndUpdate(
        { externalVideoId: videoId },
        {
          $set: {
            productId,
            externalVideoId: videoId,

            // Video content
            videoPlayUrl: video.play_addr?.url_list?.[0] || video.play_url || undefined,
            thumbnailUrl: video.cover?.url_list?.[0] || undefined,

            // Full creator profile
            creator: {
              tiktokUserId:  author.uid || author.userId || handle,
              handle,
              displayName:   author.nickname || author.nickName || undefined,
              bio:           author.signature || undefined,
              avatarUrl:     author.avatar_thumb?.url_list?.[0] || undefined,
              followers:     author.follower_count || author.followerCount || 0,
              following:     author.following_count || undefined,
              totalLikes:    author.total_favorited || undefined,
              region:        author.region || undefined,
              verified:      !!(author.verification_type || author.verified),
              tiktokPostUrl,             // ← the verified link to THIS video
            },

            // Performance snapshot
            metrics: {
              viewCount,
              likeCount,
              commentCount,
              shareCount,
              engagementRate: parseFloat(engagementRate.toFixed(4)),
            },

            // Classification
            section,
            isAd: !!(info.is_ad || info.isAd),

            // Taxonomy
            categoryL1,
            categoryL2,
            categoryL3,

            // Content metadata
            description: info.desc || info.text || undefined,
            hashtags:    (info.text_extra || [])
              .map((t: any) => t.hashtag_name)
              .filter(Boolean),

            publishedAt: info.create_time ? new Date(info.create_time * 1000) : new Date(),
            ingestedAt:  new Date(),
          },
        },
        { upsert: true, new: true }
      );

      return true;
    } catch (err) {
      log.error('Failed to map/save creative', { error: String(err) });
      return false;
    }
  },

  /**
   * Retrieves a paginated list of creatives from the database based on filters.
   */
  async findCreatives(filters: any) {
    const { 
      productId, 
      section, 
      isAd, 
      region, 
      minViews, 
      hashtags, 
      page = 1, 
      limit = 20, 
      sortBy = 'recent',
      categoryL1,
      categoryL2,
      categoryL3 
    } = filters;

    const query: any = {};

    if (productId) query.productId = productId;
    if (section)   query.section = section;
    if (isAd !== undefined) query.isAd = isAd;
    if (region)    query['creator.region'] = region.toUpperCase();
    if (minViews)  query['metrics.viewCount'] = { $gte: Number(minViews) };
    if (categoryL1) query.categoryL1 = categoryL1;
    if (categoryL2) query.categoryL2 = categoryL2;
    if (categoryL3) query.categoryL3 = categoryL3;
    if (hashtags) {
      const tagList = Array.isArray(hashtags) ? hashtags : [hashtags];
      query.hashtags = { $in: tagList };
    }

    const skip = (Number(page) - 1) * Number(limit);
    const mLimit = Number(limit);

    let sort: any = { createdAt: -1 };
    if (sortBy === 'views')   sort = { 'metrics.viewCount': -1 };
    if (sortBy === 'likes')   sort = { 'metrics.likeCount': -1 };
    if (sortBy === 'engagement') sort = { 'metrics.engagementRate': -1 };
    if (sortBy === 'recent')  sort = { publishedAt: -1 };

    const [data, total] = await Promise.all([
      Creative.find(query).sort(sort).skip(skip).limit(mLimit).populate('productId', 'title thumbnailUrl'),
      Creative.countDocuments(query),
    ]);

    return {
      data,
      pagination: {
        total,
        page: Number(page),
        limit: mLimit,
        pages: Math.ceil(total / mLimit),
      },
    };
  },

  /**
   * Retrieves a single creative by its database ID.
   */
  async getCreativeById(id: string) {
    return Creative.findById(id).populate('productId', 'title thumbnailUrl');
  },
};
