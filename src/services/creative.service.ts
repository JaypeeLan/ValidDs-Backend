import axios from 'axios';
import { Creative } from '../models/creative.model';
import { Product } from '../models/product.model';
import { ProductExtractor } from './product.extractor';
import { AIOrchestrator } from './ai.orchestrator';
import { transformEnsemblePosts } from '../ingestion/ensemble/ensemble.transformer';
import { logger } from '../logger';
import mongoose from 'mongoose';

const log = logger.child({ module: 'creative-service' });

const BASE_URL = 'https://ensembledata.com/apis';
type ProductNameCheck = {
  check1Quality: 'valid' | 'invalid';
  check2Specificity: 'specific' | 'generic';
  correctedName?: string;
  reason?: string;
  confidence?: number;
};

const PRODUCT_NAME_GUARD_PROMPT = `You are validating potential product names for a commerce intelligence pipeline.
Return ONLY valid JSON with the exact keys:
{
  "check1Quality": "valid" | "invalid",
  "check2Specificity": "specific" | "generic",
  "correctedName": "string",
  "reason": "string",
  "confidence": number
}

RULES:
1) check1Quality:
 - "invalid" when text is mostly typo/noise, malformed, gibberish, or not usable as a product name.
 - "valid" when text is linguistically usable after minor correction.
2) check2Specificity:
 - "generic" when phrase is broad/non-specific (e.g., "viral products", "top tech products", "amazon finds", "best gadgets").
 - "specific" only when it refers to a concrete product item.
3) correctedName:
 - If obvious typo exists, return corrected text.
 - If generic/invalid, keep best cleaned phrase but checks must still reflect invalid/generic.
4) Be strict: avoid passing generic trend phrases.
`;

function basicNormalize(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

async function validateProductNameWithAI(
  rawName: string,
  cache: Map<string, ProductNameCheck>
): Promise<ProductNameCheck> {
  const candidate = basicNormalize(rawName);
  if (!candidate) {
    return {
      check1Quality: 'invalid',
      check2Specificity: 'generic',
      correctedName: '',
      reason: 'Empty candidate',
      confidence: 100,
    };
  }

  if (cache.has(candidate)) {
    return cache.get(candidate)!;
  }

  const aiResult = await AIOrchestrator.extractJson<ProductNameCheck>(
    PRODUCT_NAME_GUARD_PROMPT,
    JSON.stringify({ candidate }),
    'gemini'
  );

  const validated: ProductNameCheck = {
    check1Quality: aiResult?.check1Quality === 'valid' ? 'valid' : 'invalid',
    check2Specificity: aiResult?.check2Specificity === 'specific' ? 'specific' : 'generic',
    correctedName: basicNormalize(aiResult?.correctedName || candidate),
    reason: aiResult?.reason || 'AI validation fallback',
    confidence: typeof aiResult?.confidence === 'number' ? aiResult.confidence : 0,
  };

  cache.set(candidate, validated);
  return validated;
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

type CreativeCommentInput = {
  comment: string;
  source: string;
  likeCount?: number;
  authorHandle?: string;
  collectedAt: Date;
};

async function fetchCreativeComments(videoId: string): Promise<CreativeCommentInput[]> {
  const token = process.env.ENSEMBLE_API_KEY;
  if (!token || !videoId) return [];

  try {
    const response = await axios.get(`${BASE_URL}/tt/post/comments`, {
      params: { aweme_id: videoId, cursor: 0, token },
      timeout: 15000,
    });
    const comments: any[] = response.data?.data?.comments || [];
    return comments
      .slice(0, 10)
      .map((comment: any) => ({
        comment: String(comment.text || '').trim(),
        source: 'TikTok',
        likeCount: Number(comment.digg_count || 0),
        authorHandle: comment.user?.unique_id || comment.user?.nickname || undefined,
        collectedAt: new Date(),
      }))
      .filter((c) => c.comment.length > 0);
  } catch (err) {
    log.debug('Failed to fetch creative comments', { videoId, error: String(err) });
    return [];
  }
}

export const CreativeService = {
  formatWithAllVideos(input: any) {
    const creative = typeof input?.toObject === 'function' ? input.toObject() : input;
    if (!creative) return creative;

    const primaryVideo = {
      isPrimary: true,
      externalVideoId: creative.externalVideoId,
      videoPlayUrl: creative.videoPlayUrl,
      thumbnailUrl: creative.thumbnailUrl,
      creator: creative.creator,
      metrics: creative.metrics,
      topComments: creative.topComments || [],
      publishedAt: creative.publishedAt,
    };

    const related = Array.isArray(creative.relatedVideos)
      ? creative.relatedVideos.map((video: any) => ({
          isPrimary: false,
          externalVideoId: video.externalVideoId,
          videoPlayUrl: video.videoPlayUrl,
          thumbnailUrl: video.thumbnailUrl,
          creator: video.creator,
          metrics: video.metrics,
          topComments: video.topComments || [],
          publishedAt: video.publishedAt,
        }))
      : [];

    return {
      ...creative,
      allVideos: [primaryVideo, ...related],
    };
  },

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
      productDescription?: string;
    } = {}
  ): Promise<number> {
    const token = process.env.ENSEMBLE_API_KEY;
    if (!token) {
      log.warn('ENSEMBLE_API_KEY is not configured');
      return 0;
    }

    const { brand, categoryKeywords, categoryL1, categoryL2, categoryL3, productDescription } = options;

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
        const ok = await this.mapAndSave(
          item,
          productId,
          categoryL1,
          categoryL2,
          categoryL3,
          productName,
          productDescription
        );
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
    productName?: string,
    productDescription?: string,
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
      const topComments = await fetchCreativeComments(videoId);

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

      // ── Build the secondary video object just in case we need it ───────
      const secondaryVideo = {
        externalVideoId: videoId,
        videoPlayUrl: video.play_addr?.url_list?.[0] || video.play_url || undefined,
        thumbnailUrl: video.cover?.url_list?.[0] || undefined,
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
          tiktokPostUrl,
        },
        metrics: {
          viewCount,
          likeCount,
          commentCount,
          shareCount,
          engagementRate: parseFloat(engagementRate.toFixed(4)),
          source: 'EnsembleData',
          fetchedAt: new Date(),
        },
        topComments,
        publishedAt: info.create_time ? new Date(info.create_time * 1000) : new Date()
      };

      // ── Group by Product: Does a Creative for this Product exist? ──────
      const existingProductCreative = await Creative.findOne({ productId });

      if (existingProductCreative) {
        // Is this exact video already the root/primary video?
        if (existingProductCreative.externalVideoId === videoId) {
           return true; // Already processed
        }
        
        // Is it already inside relatedVideos?
        if (existingProductCreative.relatedVideos.some(v => v.externalVideoId === videoId)) {
           return true; // Already processed
        }

        if (productName && !existingProductCreative.productName) {
          existingProductCreative.productName = productName;
        }
        if (productDescription && !existingProductCreative.productDescription) {
          existingProductCreative.productDescription = productDescription;
          // Keep legacy field aligned for existing clients expecting "description"
          existingProductCreative.description = productDescription;
        }

        // Add it to the relatedVideos array!
        existingProductCreative.relatedVideos.push(secondaryVideo);
        await existingProductCreative.save();
        return true;
      }

      // ── Doesn't exist, create the ROOT Creative ────────────────────────
      await Creative.create({
        productId,
        externalVideoId: videoId,

        // Video content
        videoPlayUrl: secondaryVideo.videoPlayUrl,
        thumbnailUrl: secondaryVideo.thumbnailUrl,

        // Full creator profile
        creator: secondaryVideo.creator,

        // Performance snapshot
        metrics: secondaryVideo.metrics,

        // Classification
        section,
        isAd: !!(info.is_ad || info.isAd),
        productName,
        productDescription,

        // Taxonomy
        categoryL1,
        categoryL2,
        categoryL3,

        // Content metadata (legacy description now stores product description)
        description: productDescription,
        hashtags:    (info.text_extra || [])
          .map((t: any) => t.hashtag_name)
          .filter(Boolean),
        topComments: secondaryVideo.topComments,

        relatedVideos: [],

        publishedAt: secondaryVideo.publishedAt,
        ingestedAt:  new Date(),
      });

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
      q,
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

    const skip = (Number(page) - 1) * Number(limit);
    const mLimit = Number(limit);

    let sort: any = { createdAt: -1 };
    if (sortBy === 'views')   sort = { 'metrics.viewCount': -1 };
    if (sortBy === 'likes')   sort = { 'metrics.likeCount': -1 };
    if (sortBy === 'engagement') sort = { 'metrics.engagementRate': -1 };
    if (sortBy === 'recent')  sort = { publishedAt: -1 };

    const [rawData, total] = await Promise.all([
      Creative.find(query).sort(sort).skip(skip).limit(mLimit).populate('productId', 'title thumbnailUrl'),
      Creative.countDocuments(query),
    ]);
    const data = rawData.map((doc) => this.formatWithAllVideos(doc));

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
    const doc = await Creative.findById(id).populate('productId', 'title thumbnailUrl');
    return doc ? this.formatWithAllVideos(doc) : null;
  },

  /**
   * Standalone creative ingestion by keyword.
   *
   * Fetches TikTok videos matching the given keyword from EnsembleData,
   * finds or creates a stub product to link against, then upserts up to
   * `limit` creatives into MongoDB.
   *
   * This allows the creatives tab to be populated independently of the
   * full product ingestion pipeline.
   */
  async ingestByKeyword(
    keyword: string,
    options: {
      limit?: number;
      period?: number;   // Days back to search (default 30)
      country?: string;  // 2-letter code (default 'us')
    } = {}
  ): Promise<{ saved: number; productId: mongoose.Types.ObjectId; productTitle: string }> {
    const token = process.env.ENSEMBLE_API_KEY;
    if (!token) throw new Error('ENSEMBLE_API_KEY is not configured');

    const { limit = 10, period = 30, country = 'us' } = options;

    // 1. Fetch from EnsembleData keyword search
    const response = await axios.get(`${BASE_URL}/tt/keyword/search`, {
      params: { name: keyword, token, cursor: 0, period, country },
      timeout: 20000,
    });

    const payload = response.data?.data || {};
    const items: any[] = (payload.items || payload.videos || payload.aweme_list || payload.data || [])
      .slice(0, limit);

    if (items.length === 0) {
      log.warn('ingestByKeyword: no videos returned', { keyword });
      // Still need a product stub to return
    }

    // 2. Find existing product by keyword match, or create a stub
    const normalizedKeyword = keyword.trim().toLowerCase();
    let product = await Product.findOne({
      $or: [
        { normalizedTitle: new RegExp(normalizedKeyword, 'i') },
        { title: new RegExp(normalizedKeyword, 'i') },
      ],
    });

    if (!product) {
      // Create a minimal stub product so creatives have a valid reference
      const stubTitle = keyword.trim().slice(0, 120);
      const stubNorm  = stubTitle.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
      product = await Product.findOneAndUpdate(
        { externalId: `stub-${stubNorm.replace(/\s/g, '-')}`, source: 'creative-ingest' },
        {
          $setOnInsert: {
            externalId:      `stub-${stubNorm.replace(/\s/g, '-')}`,
            source:          'creative-ingest',
            status:          'active',
            title:           stubTitle,
            normalizedTitle: stubNorm,
            description:     `Auto-created stub for creative keyword: ${keyword}`,
            hashtags:        [],
            categoryL1:      'Other',
            categoryPath:    'Other',
            currency:        'USD',
            suppliers:       [],
            ratingSources:   [],
            topComments:     [],
            imageUrls:       [],
            viewCount:       0,
            likeCount:       0,
            commentCount:    0,
            shareCount:      0,
            primaryCreator:  { handle: 'unknown', tiktokPostUrl: `https://www.tiktok.com` },
            aiIntelligence:  {
              confidence:       0,
              confidenceReason: 'Stub — created for standalone creative ingestion',
              categoryKeywords: [],
              extractedAt:      new Date(),
            },
            trend:           { score: 0, direction: 'unknown', isTrending: false, calculatedAt: new Date() },
            discoverySections: [],
            relatedProducts:   [],
            creativeCounts:  { ads: 0, organic: 0, reviews: 0, total: 0 },
            lastIngestedAt:      new Date(),
            dataSourceUpdatedAt: new Date(),
          },
        },
        { upsert: true, new: true }
      ) as any;
    }

    const productId = product!._id as mongoose.Types.ObjectId;
    const productTitle = product!.title;
    const defaultProductDescription = product!.description;
    const nameValidationCache = new Map<string, ProductNameCheck>();

    // 3. Transform to NormalizedPost, run Extraction, Upsert items
    let saved = 0;
    const normalizedItems = transformEnsemblePosts(items);

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const normPost = normalizedItems[i];
      let extractedName = undefined;
      let extractedDescription = undefined;

      try {
        const extraction = await ProductExtractor.extractFromPost(normPost, []);
        if (extraction && extraction.productName && extraction.productName.length > 2) {
          extractedName = extraction.productName;
        }
        if (extraction && extraction.productDescription && extraction.productDescription.length > 2) {
          extractedDescription = extraction.productDescription;
        }
      } catch (err) {
        log.warn('Failed to extract product name for creative', { videoId: normPost.videoId });
      }

      let finalProductName: string | undefined;
      if (extractedName) {
        const extractedCheck = await validateProductNameWithAI(extractedName, nameValidationCache);
        if (extractedCheck.check1Quality === 'valid' && extractedCheck.check2Specificity === 'specific') {
          finalProductName = extractedCheck.correctedName || extractedName;
        }
      }
      if (!finalProductName && productTitle) {
        const titleCheck = await validateProductNameWithAI(productTitle, nameValidationCache);
        if (titleCheck.check1Quality === 'valid' && titleCheck.check2Specificity === 'specific') {
          finalProductName = titleCheck.correctedName || productTitle;
        }
      }

      const ok = await this.mapAndSave(
        item,
        productId,
        undefined,
        undefined,
        undefined,
        finalProductName,
        extractedDescription ?? defaultProductDescription
      );
      if (ok) saved++;
    }

    // 4. Update creative counts on the product
    const [adsCount, totalCount, reviewsCount] = await Promise.all([
      Creative.countDocuments({ productId, isAd: true }),
      Creative.countDocuments({ productId }),
      Creative.countDocuments({ productId, section: 'influencer-reviews' }),
    ]);
    await Product.findByIdAndUpdate(productId, {
      $set: {
        creativeCounts: {
          ads:     adsCount,
          organic: totalCount - adsCount,
          reviews: reviewsCount,
          total:   totalCount,
        },
      },
    });

    log.info('Standalone creative ingest complete', { keyword, saved, productId, totalCount });
    return { saved, productId, productTitle };
  },
};
