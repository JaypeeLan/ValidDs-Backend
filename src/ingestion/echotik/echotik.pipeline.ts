import { EchoTikJob } from './echotik.job';
import { NormalizedEchoTikProduct, NormalizedEchoTikComment } from '../ingestion.types';
import { ProductRepository } from '../../db/repositories/product.repository';
import { FreshnessService } from '../../freshness/freshness.service';
import { DiscoveryService } from '../../services/discovery.service';
import { CreativeService } from '../../services/creative.service';
import { ImageService } from '../../services/image.service';
import { SearchApiService } from '../../services/search.service';
import { EnsembleClient } from '../ensemble/ensemble.client';
import { Creative } from '../../models/creative.model';
import { logger } from '../../logger';
import { env } from '../../config/env.validation';
import { EchoTikListParams } from './echotik.client';

const log = logger.child({ module: 'echotik-pipeline' });

// ── Limits ────────────────────────────────────────────────────────────────────

const MAX_PRODUCTS_DEV  = 30;
const MAX_PRODUCTS_PROD = 300;

// ── Result shape ──────────────────────────────────────────────────────────────

export interface EchoTikPipelineResult {
  productsIngested: number;
  productsSkipped:  number;
  dbUpserts:        number;
  errors:           string[];
  durationMs:       number;
}

// ── Pipeline ──────────────────────────────────────────────────────────────────

/**
 * EchoTik Product Ingestion Pipeline
 *
 * Full ETL cycle for TikTok Shop products from EchoTik:
 *
 *  1. Paginate /product/list (sorted by 30-day sales desc)
 *  2. Skip off-market products (off_mark = 1)
 *  3. Persist each product as an IProduct record in MongoDB
 *     — No AI extraction needed (data is already structured)
 *     — Real price, rating, review count, sales figures, image gallery
 *  4. Optionally enrich with Discovery section tagging
 *  5. Optionally fetch creatives (TikTok videos linked to this product)
 *
 * This pipeline is a drop-in replacement for HashtagIngestionPipeline.
 * It is called from src/jobs/index.ts via triggerEchoTikPipelineJob().
 */
export class EchoTikIngestionPipeline {
  private readonly job: EchoTikJob;
  private readonly ensemble: EnsembleClient;

  constructor() {
    this.job = new EchoTikJob();
    this.ensemble = new EnsembleClient();
  }

  async run(params: Omit<EchoTikListParams, 'page_num'> = {}): Promise<EchoTikPipelineResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    let productsIngested = 0;
    let productsSkipped  = 0;
    let dbUpserts        = 0;

    const isDev      = env.NODE_ENV === 'development';
    const maxAllowed = isDev ? MAX_PRODUCTS_DEV : MAX_PRODUCTS_PROD;

    log.info('EchoTik pipeline started', {
      maxAllowed,
      params,
    });

    await this.job.runPaginated(
      {
        product_sort_field: 5,   // sort by 30d sales
        sort_type:          1,   // descending
        min_total_sale_30d_cnt: 50,
        ...params,
      },
      async (
        products: NormalizedEchoTikProduct[],
        comments: Map<string, NormalizedEchoTikComment[]>
      ) => {
        const remaining = maxAllowed - productsIngested;
        const batch     = products.slice(0, Math.max(0, remaining));

        if (batch.length === 0) return { shouldStop: true };

        // Original volces.com URLs are stored in the DB.
        // Temp URL exchange (24h expiry) happens at serve time via echotik.image.ts.
        for (const product of batch) {
          // Skip off-market / archived products
          if (product.isOffMarket) {
            productsSkipped++;
            continue;
          }

          try {
            const productComments = comments.get(product.productId) ?? [];
            await this.persistProduct(product, productComments);
            dbUpserts++;
            productsIngested++;
          } catch (err) {
            const msg = `EchoTik pipeline error for product ${product.productId}: ${String(err)}`;
            errors.push(msg);
            log.error(msg);
          }
        }

        log.debug(`Batch processed: ${batch.length} products, total=${productsIngested}`);
        return { shouldStop: productsIngested >= maxAllowed };
      }
    );

    if (dbUpserts > 0) {
      await FreshnessService.markUpdated('product');
    }

    const result: EchoTikPipelineResult = {
      productsIngested,
      productsSkipped,
      dbUpserts,
      errors,
      durationMs: Date.now() - startTime,
    };

    log.info('EchoTik pipeline complete', { ...result });
    return result;
  }

  /**
   * Maps a NormalizedEchoTikProduct → EnrichedProductInput and upserts to MongoDB.
   * Also handles Discovery section tagging and creative count sync.
   */
  private async persistProduct(
    product: NormalizedEchoTikProduct,
    comments: NormalizedEchoTikComment[]
  ): Promise<void> {
    const now = new Date();

    // ── Build top comments from EchoTik verified reviews ──────────────────────
    const topComments = comments.slice(0, 10).map((c) => ({
      comment:      c.text,
      text:         c.text,
      likeCount:    0,                          // EchoTik reviews don't expose likes
      authorHandle: undefined,
      sentiment:    c.sentiment,
      source:       'TikTok Shop (Verified)',
      collectedAt:  c.createdAt,
    }));

    // ── Build rating source record ────────────────────────────────────────────
    const ratingSources = product.rating > 0 && product.reviewCount > 0
      ? [{
          platform:    'TikTok Shop',
          rating:      product.rating,
          reviewCount: product.reviewCount,
          fetchedAt:   now,
        }]
      : [];

    // ── Sales evidence from real 30-day data ──────────────────────────────────
    const salesEvidence = {
      unitsSold:  product.totalSale30dCnt,
      store:      'TikTok Shop',
      storeUrl:   `https://www.tiktok.com/view/product/${product.productId}`,
      timeframe:  'last 30 days',
      sourceBreakdown: [{
        source:    'TikTok Shop (EchoTik)',
        unitsSold: product.totalSale30dCnt,
      }],
      fetchedAt:  now,
    };

    // ── Trend mapping ─────────────────────────────────────────────────────────
    const trendDirectionMap: Record<string, 'rising' | 'peaked' | 'saturating' | 'stable' | 'declining' | 'emerging' | 'viral' | 'unknown'> = {
      rising:   'rising',
      stable:   'stable',
      declining:'declining',
    };
    const trendDirection = trendDirectionMap[product.trendDirection] ?? 'unknown';

    // ── Assemble input ────────────────────────────────────────────────────────
    const input = {
      // Identity — EchoTik products use product_id as externalId
      videoId:  product.productId,
      source:   'echotik' as const,
      hashtags: [],
      publishedAt: product.firstCrawledAt,
      collectedAt: now,

      // No TikTok post engagement — use video view metrics instead
      viewCount:     product.totalViewsCnt,
      likeCount:     0,
      commentCount:  product.reviewCount,
      shareCount:    0,
      engagementRate: undefined,
      videoPlayUrl:  undefined,
      thumbnailUrl:  product.primaryImageUrl,
      isAd:          false,

      // Content
      title:       product.productName,
      description: product.description,

      // Taxonomy
      categoryL1:   product.categoryL1,
      categoryL2:   product.categoryL2,
      categoryL3:   product.categoryL3,
      categoryPath: product.categoryPath,

      // Media — full gallery from EchoTik, no SerpApi needed
      primaryImageUrl: product.primaryImageUrl,
      imageUrls:       product.imageUrls,

      // Pricing — real TikTok Shop price
      price:    product.avgPrice,
      currency: 'USD',
      suppliers: [],

      // Market evidence — all real data
      salesEvidence,
      ratingSources,
      rating:      product.rating > 0 ? product.rating : undefined,
      reviewCount: product.reviewCount > 0 ? product.reviewCount : undefined,
      topComments: topComments as any,
      reviews:     comments.slice(0, 10).map((c) => ({
        source:      'TikTok Shop (Verified)',
        text:        c.text,
        collectedAt: c.createdAt,
      })),

      // Discovery origin — seller as primary creator
      primaryCreator: {
        handle:        product.sellerId,
        displayName:   undefined,
        bio:           undefined,
        followers:     undefined,
        following:     undefined,
        totalLikes:    undefined,
        region:        product.region,
        verified:      product.isManagedStore,
        avatarUrl:     undefined,
        tiktokPostUrl: `https://www.tiktok.com/view/product/${product.productId}`,
        tiktokUserId:  product.sellerId,
      },

      // AI intelligence — structured data, high confidence
      aiIntelligence: {
        confidence:            95,
        confidenceReason:      'Structured TikTok Shop data from EchoTik (verified product)',
        brand:                 undefined,
        categoryKeywords:      [product.categoryL1, product.categoryL2 ?? '', product.categoryL3 ?? ''].filter(Boolean),
        buyingSentimentScore:  product.rating > 0 ? Math.round((product.rating / 5) * 100) : undefined,
        buyingSentimentReason: product.rating > 0 ? `Average TikTok Shop rating: ${product.rating}/5 from ${product.reviewCount} verified reviews` : undefined,
        extractedAt:           now,
      },

      // Trend — from real sales velocity data
      trend: {
        score:       product.trendScore,
        direction:   trendDirection,
        reason:      `${product.totalSale30dCnt.toLocaleString()} sales in last 30 days, ${product.totalIflCnt} creators, trend flag: ${product.trendDirection}`,
        isTrending:  product.isTrending,
        calculatedAt: now,
      },

      relatedProducts:   [],
      discoverySections: [],
      creativeCounts:    { ads: 0, organic: 0, reviews: 0, total: 0 },

      // EchoTik-specific shop metrics
      echotikProductId: product.productId,
      region:           product.region,
      commissionRate:   product.commissionRate,
      totalSale30d:     product.totalSale30dCnt,
      totalSale7d:      product.totalSale7dCnt,
      totalGmv:         product.totalSaleGmvAmt,
      totalGmv30d:      product.totalSaleGmv30dAmt,
      totalCreators:    product.totalIflCnt,
      salesChannel:     product.salesChannel,
      freeShipping:     product.freeShipping,
      isManagedStore:   product.isManagedStore,
    };

    // ── Persist ───────────────────────────────────────────────────────────────
    const saved = await ProductRepository.upsertEnrichedProduct(input);
    if (!saved) {
      throw new Error(`upsertEnrichedProduct returned null for product ${product.productId}`);
    }

    // ── Discovery section tagging ─────────────────────────────────────────────
    const sections = await DiscoveryService.categorizeProduct(saved, null);

    // ── Creative counts from EchoTik metrics ─────────────────────────────────
    const [adsCount, totalCount, reviewsCount] = await Promise.all([
      Creative.countDocuments({ productId: saved._id, isAd: true }),
      Creative.countDocuments({ productId: saved._id }),
      Creative.countDocuments({ productId: saved._id, section: 'influencer-reviews' }),
    ]);

    saved.discoverySections = sections;
    saved.creativeCounts = {
      ads:     adsCount     || product.totalIflCnt,
      organic: totalCount   || product.totalVideoCnt,
      reviews: reviewsCount || 0,
      total:   totalCount   || product.totalVideoCnt,
    };

    // ── Google Shopping reviews + related products ────────────────────────────
    // Non-blocking: skip gracefully if the product has no Google Shopping presence.
    try {
      const { reviews, relatedProducts } = await SearchApiService.fetchProductReviews(product.productName);

      if (reviews.length > 0) {
        saved.reviews = reviews.map((r) => ({
          source:      r.source,
          text:        r.text,
          collectedAt: new Date(),
        }));
      }

      if (relatedProducts.length > 0) {
        saved.relatedProducts = relatedProducts.map((r) => ({
          title:     r.title,
          price:     r.price,
          thumbnail: r.thumbnail,
          link:      r.link,
          store:     r.store,
        }));
      }
    } catch (err) {
      log.warn('SearchApi review fetch failed — skipping', { productId: product.productId, err: String(err) });
    }

    // ── EnsembleData: find real TikTok creator promoting this product ─────────
    // Non-blocking: seller remains as fallback if no creator post is found.
    try {
      const { posts } = await this.ensemble.searchKeywordFull({
        name:    product.productName,
        days:    30,
        sorting: 1,
      });

      if (posts.length > 0) {
        const topPost = posts.sort(
          (a, b) => (b.statistics?.play_count ?? 0) - (a.statistics?.play_count ?? 0)
        )[0];

        const author  = topPost.author ?? {};
        const handle  = author.unique_id ?? (author as any).uniqueId;
        const videoId = topPost.aweme_id ?? (topPost as any).id;

        if (handle && videoId) {
          saved.primaryCreator = {
            handle,
            displayName:   author.nickname ?? (author as any).nickName,
            bio:           author.signature,
            followers:     author.follower_count ?? (author as any).followerCount,
            following:     author.following_count ?? (author as any).followingCount,
            totalLikes:    author.total_favorited ?? (author as any).heartCount,
            region:        author.region,
            verified:      typeof author.verification_type === 'number'
                             ? author.verification_type > 0
                             : false,
            avatarUrl:     author.avatar_thumb?.url_list?.[0],
            tiktokPostUrl: `https://www.tiktok.com/@${handle}/video/${videoId}`,
            tiktokUserId:  author.uid ?? author.sec_uid,
          };

          // Reflect real post engagement on the product
          saved.viewCount    = topPost.statistics?.play_count    ?? saved.viewCount;
          saved.likeCount    = topPost.statistics?.digg_count    ?? saved.likeCount;
          saved.commentCount = topPost.statistics?.comment_count ?? saved.commentCount;
          saved.shareCount   = topPost.statistics?.share_count   ?? saved.shareCount;

          log.debug('Creator resolved via EnsembleData', {
            productId: product.productId,
            handle,
            views: saved.viewCount,
          });
        }
      }
    } catch (err) {
      log.warn('EnsembleData creator lookup failed — skipping', { productId: product.productId, err: String(err) });
    }

    await saved.save();

    log.debug('Product persisted', {
      productId:    product.productId,
      title:        product.productName,
      sections:     sections.join(','),
      sale30d:      product.totalSale30dCnt,
      reviews:      saved.reviews?.length ?? 0,
      relatedCount: saved.relatedProducts?.length ?? 0,
    });
  }
}
