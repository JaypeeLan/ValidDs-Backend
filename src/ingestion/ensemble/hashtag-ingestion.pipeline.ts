import { EnsembleJob } from './ensemble.job';
import { TRACKED_HASHTAGS } from './hashtag.constants';
import { ProductExtractor } from '../../services/product.extractor';
import { RainforestService } from '../../services/rainforest.service';
import { ProductEnricher } from '../../services/product.enricher';
import { ProductRepository } from '../../db/repositories/product.repository';
import { FreshnessService } from '../../freshness/freshness.service';
import { logger } from '../../logger';
import { env } from '../../config/env.validation';

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
const MAX_POSTS_PROD = 50;
const MAX_POSTS_DEV  = 100;   // Enough for meaningful dev testing

export interface HashtagPipelineResult {
  postsCollected:    number;
  postsFiltered:     number;  // skipped due to low views
  aiExtractionsDone: number;
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
 *   1. Fetch TikTok posts from EnsembleData for all TRACKED_HASHTAGS
 *      — paginated (dev: 2 pages, staging/prod: all pages up to ~4000)
 *
 *   2. Filter: skip posts with < 50k views (not engaging enough to extract)
 *
 *   3. For each qualifying post:
 *      a. Fetch comments (already done during ingestion step)
 *      b. Run Gemini AI extraction → productName, productNiche, sentiment, etc.
 *      c. Search Rainforest (Amazon) with the extracted productName
 *      d. Merge + upsert the enriched product into MongoDB
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
      rainforestHits:    0,
      dbUpserts:         0,
      errors,
      durationMs:        0,
    };

    log.info('Hashtag ingestion pipeline started', {
      hashtags: TRACKED_HASHTAGS,
      minViewCount: MIN_VIEW_COUNT,
    });


    // ── Step 1: Collect posts from EnsembleData page by page ───
    await this.job.runHashtagIngestion([...TRACKED_HASHTAGS], async (posts) => {
      
      const isDev = env.NODE_ENV === 'development';
      const maxAllowed = isDev ? MAX_POSTS_DEV : MAX_POSTS_PROD;
      
      const availableCapacity = maxAllowed - result.postsCollected;
      const cappedPosts = posts.slice(0, availableCapacity);

      result.postsCollected += cappedPosts.length;

      if (cappedPosts.length < posts.length) {
        log.info(`Post cap reached: processing ${cappedPosts.length} of ${posts.length} posts on this page`);
      }

      // ── Step 2 + 3: Extract, enrich, and persist each post ───────────────────
      for (const post of cappedPosts) {

        // Filter: skip low-engagement posts
        if (post.viewCount < MIN_VIEW_COUNT) {
          result.postsFiltered++;
          continue;
        }

        // Skip: already in DB — avoid re-processing duplicates
        try {
          const alreadyExists = await ProductRepository.existsByVideoId(post.videoId);
          if (alreadyExists) {
            log.debug('Post already in DB — skipping', { videoId: post.videoId });
            result.postsFiltered++;
            continue;
          }
        } catch {
          // DB check failed — still attempt to process the post
        }

        try {
          // Fetch comments only for this specific qualifying post
          const comments = await this.job.getPostComments(post.videoId).catch(() => []);

          // Step 3a: AI extraction — if limit hit, skip this post gracefully
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

          // Step 3b: Rainforest Amazon lookup — failures are non-fatal; use empty results
          const rainforestResponse = await RainforestService.searchAmazonProducts(
            extraction.amazonSearchTerm || extraction.productName
          ).catch(() => null);

          const rainforestResults = rainforestResponse?.search_results ?? [];

          if (rainforestResults.length > 0) {
            result.rainforestHits++;
          } else {
            log.debug('Rainforest returned no results for product — continuing without Amazon data', {
              productName: extraction.productName,
            });
          }

          // Step 3c: Merge + upsert to DB (always runs, even with 0 Rainforest results)
          await ProductEnricher.mergeAndUpsert(extraction, rainforestResults, post);
          result.dbUpserts++;

        } catch (err: any) {
          const msg = `Pipeline error for post ${post.videoId}: ${String(err)}`;
          errors.push(msg);
          log.error(msg);
          // Do not throw — continue processing remaining posts
        }
      }
      
      // Stop paginating if we reached the max allowance
      return { shouldStop: result.postsCollected >= maxAllowed };
    });

    // ── Freshness update ─────────────────────────────────────────────────────
    if (result.dbUpserts > 0) {
      await FreshnessService.markUpdated('product');
    }

    result.durationMs = Date.now() - startTime;

    log.info('Hashtag ingestion pipeline complete', { ...result });

    return result;
  }
}
