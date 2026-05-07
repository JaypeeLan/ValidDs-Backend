import { EnsembleJob } from './ensemble.job';
import { TRACKED_HASHTAGS, PRODUCT_NICHES } from './hashtag.constants';
import { ProductExtractor } from '../../services/product.extractor';
import { ProductEnricher } from '../../services/product.enricher';
import { ProductRepository } from '../../db/repositories/product.repository';
import { FreshnessService } from '../../freshness/freshness.service';
import { logger } from '../../logger';
import { env } from '../../config/env.validation';
import { TeemDropService } from '../../services/teemdrop.service';
import { NormalizedPost } from '../ingestion.types';

const log = logger.child({ module: 'hashtag-ingestion-pipeline' });

/**
 * Minimum view count a TikTok post must have to be considered for AI extraction.
 * Posts below this threshold are skipped to conserve Gemini API tokens.
 */
const MIN_VIEW_COUNT = 50_000;

/**
 * Maximum number of posts to process per pipeline run on staging/production.
 * Prevents runaway AI + Rainforest costs on large hashtag pulls.
 * Development is uncapped (uses a small page count anyway).
 */
const MAX_POSTS_PROD = 1000;
const MAX_POSTS_DEV  = 50;   // Enough for meaningful dev testing

/**
 * Recency Guard: Reject any post older than this to avoid stale trends.
 */
const MAX_AGE_DAYS = 180;

export interface HashtagPipelineResult {
  postsCollected:    number;
  postsFiltered:     number;  // skipped due to low views
  aiExtractionsDone: number;
  teemdropHits:      number;
  rainforestHits:    number;
  dbUpserts:         number;
  errors:            string[];
  durationMs:        number;
}

/**
 * Hashtag Ingestion Pipeline
 *
 * Full ETL cycle for the hashtag-based product discovery flow:
 *
 *   1. Category hashtags (PRODUCT_NICHES), then TRACKED_HASHTAGS fallback if under cap.
 *   2. Filter: skip posts with < 50k views (not engaging enough to extract)
 *   3. For each qualifying post:
 *      a. Fetch comments (already done during ingestion step)
 *      b. Run Gemini AI extraction → productName, productNiche, sentiment, etc.
 *      c. Try TeemDrop catalog lookup with the extracted productName
 *      d. Fall back to Rainforest (Amazon) if TeemDrop has no confident match
 *      e. Merge + upsert the enriched product into MongoDB
 *
 * This pipeline is self-contained and can be triggered manually, via a cron
 * job, or as an ingestion orchestrator source in the future.
 */
export class HashtagIngestionPipeline {
  private readonly job: EnsembleJob;

  constructor() {
    this.job = new EnsembleJob();
  }

  async run(): Promise<HashtagPipelineResult> {
    const startTime  = Date.now();
    const errors: string[] = [];

    const result: HashtagPipelineResult = {
      postsCollected:    0,
      postsFiltered:     0,
      aiExtractionsDone: 0,
      teemdropHits:      0,
      rainforestHits:    0,
      dbUpserts:         0,
      errors,
      durationMs:        0,
    };

    log.info('Hashtag ingestion pipeline started', {
      hashtags: TRACKED_HASHTAGS,
      niches: Object.keys(PRODUCT_NICHES),
      minViewCount: MIN_VIEW_COUNT,
      maxAgeDays: MAX_AGE_DAYS,
    });

    // ── Phase 1: Categorized Niche Discovery ───────────────────────────
    log.info('Phase 1: Categorized niche discovery');
    for (const [niche, tags] of Object.entries(PRODUCT_NICHES)) {
      log.debug(`Ingesting niche: ${niche}`, { tags });
      await this.job.runHashtagIngestion([...tags], async (posts) => {
        return this.processPosts(posts, result, errors);
      });
      
      const isDev = env.NODE_ENV === 'development';
      const maxAllowed = isDev ? MAX_POSTS_DEV : MAX_POSTS_PROD;
      if (result.postsCollected >= maxAllowed) break;
    }

    // ── Phase 2: Tracked-hashtag fallback ─────────────────────────────
    if (result.postsCollected < (env.NODE_ENV === 'development' ? MAX_POSTS_DEV : MAX_POSTS_PROD)) {
       log.info('Phase 2: Tracked-hashtag fallback');
       await this.job.runHashtagIngestion([...TRACKED_HASHTAGS], async (posts) => {
         return this.processPosts(posts, result, errors);
       });
    }

    // ── Freshness update ─────────────────────────────────────────────────────
    if (result.dbUpserts > 0) {
      await FreshnessService.markUpdated('product');
    }

    result.durationMs = Date.now() - startTime;

    log.info('Hashtag ingestion pipeline complete', { ...result });

    return result;
  }

  /**
   * Universal Post Processor
   * 
   * Filters, Extracts, Enriches, and Persists a batch of normalized posts.
   * shared by hashtag search and niche discovery.
   */
  private async processPosts(
    posts: NormalizedPost[],
    result: HashtagPipelineResult,
    errors: string[]
  ): Promise<{ shouldStop: boolean }> {
    const isDev = env.NODE_ENV === 'development';
    const maxAllowed = isDev ? MAX_POSTS_DEV : MAX_POSTS_PROD;
    
    const availableCapacity = maxAllowed - result.postsCollected;
    const cappedPosts = posts.slice(0, Math.max(0, availableCapacity));

    if (cappedPosts.length === 0 && availableCapacity <= 0) {
      return { shouldStop: true };
    }

    result.postsCollected += cappedPosts.length;

    for (const post of cappedPosts) {
      // 1. Recency Guard: skip stale trends
      const postDate = post.publishedAt || new Date(0);
      const ageInDays = (Date.now() - postDate.getTime()) / (1000 * 60 * 60 * 24);
      
      if (ageInDays > MAX_AGE_DAYS) {
        log.debug('Post skipped — too old (Recency Guard)', { videoId: post.videoId, ageInDays });
        result.postsFiltered++;
        continue;
      }

      // 2. Filter: skip low-engagement posts
      if (post.viewCount < MIN_VIEW_COUNT) {
        result.postsFiltered++;
        continue;
      }

      // 3. Skip: already in DB — avoid re-processing duplicates
      try {
        const existingDoc = await ProductRepository.findById(''); // placeholder — always processes new posts
        void existingDoc; // existsByVideoId removed; duplicates handled by upsert
      } catch {
        // DB check failed — still attempt to process the post
      }

      try {
        // 4. Fetch comments only for this specific qualifying post
        const comments = await this.job.getPostComments(post.videoId).catch(() => []);

        // 5. AI extraction
        let extraction: Awaited<ReturnType<typeof ProductExtractor.extractFromPost>>;
        try {
          extraction = await ProductExtractor.extractFromPost(post, comments);
        } catch (err: any) {
          const msg = `Pipeline error for post ${post.videoId}: ${String(err)}`;
          errors.push(msg);
          log.warn('AI extraction failed — skipping post', { videoId: post.videoId, err: String(err) });
          continue;
        }

        if (!extraction) {
          log.debug('Post skipped — AI determined it is not product-related', {
            videoId: post.videoId,
          });
          continue;
        }

        result.aiExtractionsDone++;

        // 6. Source Lookup (TeemDrop only — Rainforest removed in Discovery 2.0)
        const supplierSearchTerm = extraction.amazonSearchTerm || extraction.productName;
        const teemdropMatch = await TeemDropService.findProductDetailByName(
          supplierSearchTerm
        ).catch(() => null);

        if (teemdropMatch?.product) {
          result.teemdropHits++;
          log.debug('TeemDrop returned a product match', {
            productName: extraction.productName,
            productId: teemdropMatch.product.productId,
            score: teemdropMatch.match.score,
          });
        } else {
          log.debug('TeemDrop returned no match — SerpApi will handle pricing via enricher', {
            productName: extraction.productName,
          });
        }

        // 7. Merge + upsert to DB (Discovery 2.0 full pipeline)
        await ProductEnricher.mergeAndUpsert(extraction, post, comments);
        result.dbUpserts++;

      } catch (err: any) {
        const msg = `Pipeline error for post ${post.videoId}: ${String(err)}`;
        errors.push(msg);
        log.error(msg);
        // Do not throw — continue processing remaining posts
      }
    }

    return { shouldStop: result.postsCollected >= maxAllowed };
  }
}
