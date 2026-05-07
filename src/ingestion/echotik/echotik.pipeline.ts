import { EchoTikJob } from './echotik.job';
import { NormalizedEchoTikProduct, NormalizedEchoTikComment } from '../ingestion.types';
import { ProductRepository, EnrichedProductInput } from '../../db/repositories/product.repository';
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
import { ECHOTIK_IMAGE_HOST, resolveEchoTikImageUrls } from './echotik.image';
import { ensureCategoriesLoaded } from './echotik.categories';

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

  async run(
    params: Omit<EchoTikListParams, 'page_num'> = {},
    options: { maxProducts?: number } = {}
  ): Promise<EchoTikPipelineResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    let productsIngested = 0;
    let productsSkipped  = 0;
    let dbUpserts        = 0;

    const isDev          = env.NODE_ENV === 'development';
    const defaultMax     = isDev ? MAX_PRODUCTS_DEV : MAX_PRODUCTS_PROD;
    const maxAllowed     = options.maxProducts && options.maxProducts > 0
      ? Math.min(options.maxProducts, defaultMax)
      : defaultMax;

    log.info('EchoTik pipeline started', {
      maxAllowed,
      params,
    });

    // Make sure the EchoTik category tree is loaded so the transformer can
    // resolve raw category IDs (e.g. `600028`) to human-readable names
    // (e.g. "Skin Care") instead of falling back to "Uncategorised".
    await ensureCategoriesLoaded().catch((err) => {
      log.warn('ensureCategoriesLoaded failed at pipeline start (non-fatal)', { err: String(err) });
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

        // EchoTik volces.com URLs are exchanged for short-lived temp URLs
        // inside persistProduct() before the document is saved, and the
        // originals are kept so they can be refreshed when temp URLs expire.
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
   * Builds the full, enriched input document for a product — exactly what
   * would be written to Mongo if this run were not a dry run. This includes:
   *
   *   - image URL resolution (EchoTik /batch/cover/download + Search-API fallback)
   *   - Google Shopping reviews + related products (SearchApi)
   *   - Real TikTok creator lookup (EnsembleData keyword search)
   *
   * Discovery section tagging and creative counts are NOT included here since
   * those depend on the persisted document's _id; they are computed in
   * `persistProduct` after the upsert.
   *
   * Exposed publicly so dry-run scripts can preview documents without hitting
   * the DB.
   */
  async buildEnrichedInput(
    product: NormalizedEchoTikProduct,
    comments: NormalizedEchoTikComment[]
  ): Promise<EnrichedProductInput> {
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

    // ── Resolve EchoTik image URLs at ingest time ─────────────────────────────
    // EchoTik volces.com URLs are not directly accessible — they must be
    // exchanged for short-lived (~24h) signed URLs via /batch/cover/download.
    // We do that here so the document we save already has working image URLs,
    // and we keep the originals so we can refresh later when they expire.
    const sourcePrimaryImageUrl = product.primaryImageUrl;
    const sourceImageUrls       = Array.isArray(product.imageUrls) ? [...product.imageUrls] : [];

    const candidateUrls = [
      ...(sourcePrimaryImageUrl ? [sourcePrimaryImageUrl] : []),
      ...sourceImageUrls,
    ];

    let resolvedPrimaryImageUrl = sourcePrimaryImageUrl;
    let resolvedImageUrls       = sourceImageUrls;
    let imagesResolvedAt: Date | undefined;

    if (candidateUrls.length > 0) {
      try {
        const urlMap = await resolveEchoTikImageUrls(candidateUrls);
        if (Object.keys(urlMap).length > 0) {
          resolvedPrimaryImageUrl = sourcePrimaryImageUrl
            ? urlMap[sourcePrimaryImageUrl] ?? sourcePrimaryImageUrl
            : sourcePrimaryImageUrl;
          resolvedImageUrls = sourceImageUrls.map((url) => urlMap[url] ?? url);
          imagesResolvedAt  = now;
        }
      } catch (err) {
        log.warn('Failed to resolve EchoTik image URLs at ingest', {
          productId: product.productId,
          err: String(err),
        });
      }
    }

    // ── Probe the EchoTik primary to see if it actually loads ────────────────
    // EchoTik sometimes returns "resolved" URLs (non-volces host) that still
    // 403/404 or serve HTML instead of an image. Only trust EchoTik when the
    // primary URL returns an actual image. If it doesn't, fall back to
    // SearchApi for both the primary AND the gallery, and keep the original
    // EchoTik URLs on the doc so a later refresh can still upgrade.
    let echotikPrimaryLoads = false;
    if (
      typeof resolvedPrimaryImageUrl === 'string'
      && !resolvedPrimaryImageUrl.includes(ECHOTIK_IMAGE_HOST)
    ) {
      echotikPrimaryLoads = await ImageService.probe(resolvedPrimaryImageUrl);
    }

    if (!echotikPrimaryLoads) {
      try {
        const searchImages = await ImageService.findProductImages(product.productName);
        if (searchImages.length > 0) {
          resolvedPrimaryImageUrl = searchImages[0];
          resolvedImageUrls       = searchImages;
          imagesResolvedAt        = now;
          log.debug('Used SearchApi images as primary + gallery (EchoTik primary did not load)', {
            productId: product.productId,
            count: searchImages.length,
          });
        } else {
          log.debug('Both EchoTik probe and SearchApi returned no usable images', {
            productId: product.productId,
          });
        }
      } catch (err) {
        log.warn('SearchApi image fallback failed at ingest', {
          productId: product.productId,
          err: String(err),
        });
      }
    }

    // ── Assemble input ────────────────────────────────────────────────────────
    const input: EnrichedProductInput = {
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
      thumbnailUrl:  resolvedPrimaryImageUrl,
      isAd:          false,

      // Content
      title:       product.productName,
      description: product.description,

      // Taxonomy
      categoryL1:   product.categoryL1,
      categoryL2:   product.categoryL2,
      categoryL3:   product.categoryL3,
      categoryPath: product.categoryPath,

      // Media — full gallery from EchoTik, no SerpApi needed.
      // Resolved temp URLs are stored as the primary fields (so consumers
      // see working URLs immediately). Originals are kept so we can refresh
      // them when the temp URLs expire.
      primaryImageUrl:       resolvedPrimaryImageUrl,
      imageUrls:             resolvedImageUrls,
      sourcePrimaryImageUrl,
      sourceImageUrls,
      imagesResolvedAt,

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

    // ── Google Shopping reviews + related products ────────────────────────────
    // Non-blocking: skip gracefully if the product has no Google Shopping presence.
    try {
      const { reviews, relatedProducts } = await SearchApiService.fetchProductReviews(product.productName);

      if (reviews.length > 0) {
        input.reviews = reviews.map((r) => ({
          source:      r.source,
          text:        r.text,
          collectedAt: new Date(),
        }));
      }

      if (relatedProducts.length > 0) {
        input.relatedProducts = relatedProducts.map((r) => ({
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

    // ── Brand extraction (local heuristic, no external call) ─────────────────
    // Runs before creator resolution so the /hashtag/posts fallback can use
    // the extracted brand as a search tag when the product has no hashtags.
    input.aiIntelligence.brand = extractBrand(product.productName, product.description);

    // ── Creator + TikTok video resolution (multi-stage fallback) ─────────────
    // Stage 1: EchoTik /product/video/list gives us hashtags + engagement
    //          metrics + up to 10 candidate (video_id, user_id) pairs ordered
    //          by views.
    // Stage 2: Walk those candidates (up to MAX_VIDEO_CANDIDATES) through
    //          EnsembleData /post/info until one resolves to a live post.
    //          This is what handles the "top video got deleted on TikTok"
    //          failure mode we saw on ~10% of products.
    // Stage 3: If no EchoTik video resolves (or list was empty), fall back to
    //          EnsembleData /hashtag/posts using an extracted hashtag (brand
    //          or first product-video hashtag). /hashtag/posts already returns
    //          full post data — no second call needed.
    // If every stage fails we keep the EchoTik seller as primaryCreator and
    // leave videoPlayUrl empty.
    const MAX_VIDEO_CANDIDATES = 5;

    let echotikVideos: Array<{ videoId: string; userId: string }> = [];
    try {
      const rawVideos = await this.job.client.getProductVideos(product.productId, product.region, 1, 10);
      const videos = Array.isArray(rawVideos) ? rawVideos : [];

      if (videos.length > 0) {
        const sorted = [...videos].sort(
          (a, b) => (Number(b.total_views_cnt) || 0) - (Number(a.total_views_cnt) || 0)
        );

        // Engagement counts + hashtags always come from the #1 video (EchoTik's
        // cached values are correct even when the TikTok post itself is gone).
        const top = sorted[0];
        applyEchoTikVideoMetrics(input, top);

        echotikVideos = sorted.map((v) => ({ videoId: v.video_id, userId: v.user_id }));

        log.debug('EchoTik videos fetched', {
          productId: product.productId,
          count:     videos.length,
          topVideoId: top.video_id,
          views:     Number(top.total_views_cnt ?? 0),
        });
      }
    } catch (err) {
      log.warn('EchoTik /product/video/list failed — skipping', {
        productId: product.productId,
        err: String(err),
      });
    }

    // Stage 2: try up to N EchoTik videos via /post/info until one resolves.
    let resolvedVia: 'echotik-video' | 'hashtag-fallback' | 'none' = 'none';

    for (let i = 0; i < Math.min(echotikVideos.length, MAX_VIDEO_CANDIDATES); i++) {
      const { videoId, userId } = echotikVideos[i];
      try {
        const post = await this.ensemble.getPostInfo(`https://www.tiktok.com/@/video/${videoId}`);
        if (post && applyEnsemblePost(input, post, videoId, userId)) {
          resolvedVia = 'echotik-video';
          log.debug('Creator resolved via EchoTik video', {
            productId: product.productId,
            rank: i + 1,
            videoId,
            handle: input.primaryCreator.handle,
          });
          break;
        }
      } catch (err) {
        log.warn('EnsembleData /post/info failed for candidate', {
          productId: product.productId,
          videoId,
          rank: i + 1,
          err: String(err),
        });
      }
    }

    // Stage 3: hashtag fallback when every EchoTik video candidate missed.
    if (resolvedVia === 'none') {
      const tag = pickFallbackHashtag(input.hashtags, input.aiIntelligence?.brand, product.productName);
      if (tag) {
        try {
          const { posts } = await this.ensemble.getHashtagPosts(tag, 0);
          const ranked = posts
            .filter((p) => p?.aweme_id && p?.author?.unique_id)
            .sort(
              (a, b) => (b.statistics?.play_count ?? 0) - (a.statistics?.play_count ?? 0)
            )
            .slice(0, MAX_VIDEO_CANDIDATES);

          for (const candidate of ranked) {
            const videoId = candidate.aweme_id;
            const userId  = (candidate.author as any)?.uid;
            if (applyEnsemblePost(input, candidate, videoId, userId)) {
              resolvedVia = 'hashtag-fallback';
              log.debug('Creator resolved via hashtag fallback', {
                productId: product.productId,
                tag,
                videoId,
                handle: input.primaryCreator.handle,
              });
              break;
            }
          }
        } catch (err) {
          log.warn('EnsembleData /hashtag/posts fallback failed', {
            productId: product.productId,
            tag,
            err: String(err),
          });
        }
      }
    }

    if (resolvedVia === 'none') {
      log.warn('No creator resolved for product — seller will be used as primaryCreator', {
        productId: product.productId,
        hadEchoTikVideos: echotikVideos.length > 0,
      });
    }

    // ── EnsembleData /user/info: enrich follower counts on the resolved handle ─
    // /post/info and /hashtag/posts both return a trimmed post-level author
    // snapshot with follower_count=0. The real numbers come from /user/info.
    // One extra call per product when a handle is known; silent fallback to
    // trimmed values if the call fails.
    if (resolvedVia !== 'none' && input.primaryCreator.handle) {
      try {
        const profile = await this.ensemble.getUserInfo(input.primaryCreator.handle);
        if (profile) {
          input.primaryCreator = {
            ...input.primaryCreator,
            displayName:  profile.displayName ?? input.primaryCreator.displayName,
            bio:          profile.bio         ?? input.primaryCreator.bio,
            avatarUrl:    profile.avatarUrl   ?? input.primaryCreator.avatarUrl,
            verified:     typeof profile.verified === 'boolean'
                            ? profile.verified
                            : input.primaryCreator.verified,
            region:       profile.region       ?? input.primaryCreator.region,
            tiktokUserId: profile.tiktokUserId ?? input.primaryCreator.tiktokUserId,
            followers:    profile.followers  ?? input.primaryCreator.followers,
            following:    profile.following  ?? input.primaryCreator.following,
            totalLikes:   profile.totalLikes ?? input.primaryCreator.totalLikes,
          };
          log.debug('Creator stats enriched via /user/info', {
            productId: product.productId,
            handle:    input.primaryCreator.handle,
            followers: input.primaryCreator.followers,
            totalLikes: input.primaryCreator.totalLikes,
          });
        }
      } catch (err) {
        log.warn('EnsembleData /user/info failed — keeping trimmed stats', {
          productId: product.productId,
          handle:    input.primaryCreator.handle,
          err:       String(err),
        });
      }
    }

    return input;
  }

  /**
   * Maps a NormalizedEchoTikProduct → EnrichedProductInput and upserts to MongoDB.
   * Also handles Discovery section tagging and creative count sync.
   */
  private async persistProduct(
    product: NormalizedEchoTikProduct,
    comments: NormalizedEchoTikComment[]
  ): Promise<void> {
    const input = await this.buildEnrichedInput(product, comments);

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

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Copies engagement + hashtag + thumbnail data from the top EchoTik video onto
 * the enriched product input. EchoTik's cached counters remain authoritative
 * even when the underlying TikTok post gets deleted later.
 */
function applyEchoTikVideoMetrics(
  input: EnrichedProductInput,
  top: import('./echotik.client').EchoTikRawVideo
): void {
  const views    = Number(top.total_views_cnt    ?? 0);
  const likes    = Number(top.total_digg_cnt     ?? 0);
  const comments = Number(top.total_comments_cnt ?? 0);
  const shares   = Number(top.total_shares_cnt   ?? 0);

  input.viewCount      = views || input.viewCount;
  input.likeCount      = likes;
  input.commentCount   = comments;
  input.shareCount     = shares;
  input.engagementRate = views > 0
    ? Number(((likes + comments + shares) / views).toFixed(6))
    : undefined;

  if (top.reflow_cover)  input.thumbnailUrl = top.reflow_cover;
  input.hashtags         = parseHashtags(top.hash_tag, top.video_desc);
  input.primaryCreator.tiktokUserId  = top.user_id ?? input.primaryCreator.tiktokUserId;
  input.primaryCreator.tiktokPostUrl = `https://www.tiktok.com/@/video/${top.video_id}`;
}

/**
 * Maps an EnsembleData post onto the enriched product input. Returns `true`
 * when the post supplied a usable creator handle (the minimum signal required
 * to count as "resolved"); otherwise returns `false` so callers can try the
 * next candidate.
 */
function applyEnsemblePost(
  input: EnrichedProductInput,
  post: import('../ensemble/ensemble.client').EnsemblePost,
  videoId?: string,
  fallbackUserId?: string
): boolean {
  const author    = post.author ?? {};
  const authorAny = author as any;
  const handle    = author.unique_id ?? authorAny.uniqueId;
  if (!handle) return false;

  const resolvedVideoId = videoId ?? post.aweme_id;
  const avatarUrl       = author.avatar_thumb?.url_list?.[0];

  input.primaryCreator = {
    handle,
    displayName:   author.nickname ?? authorAny.nickName,
    bio:           author.signature,
    followers:     author.follower_count ?? authorAny.followerCount,
    following:     author.following_count ?? authorAny.followingCount,
    totalLikes:    author.total_favorited ?? authorAny.heartCount,
    region:        author.region,
    verified:      typeof author.verification_type === 'number'
                     ? author.verification_type > 0
                     : false,
    avatarUrl,
    tiktokPostUrl: resolvedVideoId
      ? `https://www.tiktok.com/@${handle}/video/${resolvedVideoId}`
      : input.primaryCreator.tiktokPostUrl,
    tiktokUserId:  authorAny.uid ?? authorAny.sec_uid ?? fallbackUserId ?? input.primaryCreator.tiktokUserId,
  };

  const livePlayAddr = post.video?.play_addr?.url_list?.[0];
  if (livePlayAddr) input.videoPlayUrl = livePlayAddr;

  const liveCover = post.video?.cover?.url_list?.[0];
  if (liveCover && !input.thumbnailUrl) input.thumbnailUrl = liveCover;

  return true;
}

/**
 * Picks a searchable hashtag for the `/hashtag/posts` fallback. Priority:
 *   1. First non-generic hashtag extracted from the top EchoTik video.
 *   2. Brand extracted from the product title (lowercased, whitespace-stripped).
 *   3. First clean word from the product title (>3 chars, alphanumeric).
 * Returns `undefined` when nothing searchable can be derived.
 */
function pickFallbackHashtag(
  hashtags: string[] | undefined,
  brand: string | undefined,
  productName: string
): string | undefined {
  const GENERIC = new Set([
    'tiktok', 'fyp', 'foryou', 'foryoupage', 'viral', 'trending',
    'tiktokmademebuyit', 'amazonfinds', 'shop', 'shopping', 'sale',
  ]);

  for (const tag of hashtags ?? []) {
    const clean = tag.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (clean.length >= 3 && !GENERIC.has(clean)) return clean;
  }

  if (brand) {
    const clean = brand.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (clean.length >= 3) return clean;
  }

  const word = (productName ?? '')
    .replace(/\[[^\]]*\]/g, ' ')
    .split(/[\s|,/\-]+/)
    .map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, ''))
    .find((w) => w.length >= 4 && !GENERIC.has(w));

  return word;
}

/**
 * Extracts an array of hashtag strings (without the `#` prefix) from the
 * `hash_tag` and/or `video_desc` fields returned by EchoTik `/product/video/list`.
 * Deduplicates while preserving order and caps at 20 tags.
 */
function parseHashtags(hashTag?: string, videoDesc?: string): string[] {
  const combined = `${hashTag ?? ''} ${videoDesc ?? ''}`;
  const matches  = combined.match(/#[\p{L}\p{N}_]+/gu) ?? [];
  const seen     = new Set<string>();
  const tags: string[] = [];
  for (const raw of matches) {
    const tag = raw.slice(1).toLowerCase();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(raw.slice(1));
    if (tags.length >= 20) break;
  }
  return tags;
}

/**
 * Best-effort brand extraction. Priority:
 *   1. Bracketed brand tokens in the product name (e.g. "[NEW] [medicube] ..." → "medicube").
 *      We skip common marketing-only tokens like NEW, HOT, LIMITED, SALE.
 *   2. A "Brand"/"Brand Name" key inside the specification JSON (parsed upstream
 *      into the description string — we regex it out of the raw description).
 *   3. `undefined` if nothing confident.
 */
function extractBrand(productName: string, description?: string): string | undefined {
  if (!productName) return undefined;

  const MARKETING_TOKENS = new Set([
    'new', 'hot', 'sale', 'limited', 'bestseller', 'best', 'gift', 'free',
    'pro', 'plus', 'premium', 'bundle', 'pack', 'set', 'official',
  ]);

  const bracketed = productName.match(/\[([^\]]+)\]/g) ?? [];
  for (const raw of bracketed) {
    const token = raw.slice(1, -1).trim();
    if (!token) continue;
    const lower = token.toLowerCase();
    if (MARKETING_TOKENS.has(lower)) continue;
    // Skip pure numbers / unit-like tokens (e.g. [10g], [2 PACK])
    if (/^[\d\s./-]+$/.test(token)) continue;
    if (/\d/.test(token) && token.length <= 4) continue;
    return token;
  }

  if (description) {
    const specMatch = description.match(/\bBrand(?:\s*Name)?\s*[:|=]\s*([\w\s.&'-]{2,40})/i);
    if (specMatch?.[1]) {
      const val = specMatch[1].trim().replace(/\s*\|.*$/, '').trim();
      if (val && val.toLowerCase() !== 'n/a') return val;
    }
  }

  return undefined;
}
