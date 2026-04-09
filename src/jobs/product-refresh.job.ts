import { IngestionOrchestrator } from '../ingestion/orchestrator';
import { ProductExtractor } from '../services/product.extractor';
import { ImageService } from '../services/image.service';
import { ProductRepository } from '../db/repositories/product.repository';
import { logger } from '../logger';
import { ingestionRecordsIngested } from '../monitoring/metrics';
import { Alerts } from '../monitoring/alerts';

const log = logger.child({ module: 'product-refresh-job' });

/**
 * Product Refresh Job
 *
 * The main scheduled job that runs the full pipeline:
 *
 *  1. Ingestion Orchestrator  — collects posts from Creative Center (primary)
 *                               or falls back to EnsembleData / RapidAPI
 *  2. AI Extractor            — runs each post through the AI to extract
 *                               product name, niche, trend score, sentiment
 *  3. Image Service           — finds a product image by searching the product name
 *  4. Product Repository      — upserts each extracted product into MongoDB
 *
 * Designed to run on a schedule (every 2 hours via setInterval or cron).
 * Also callable manually via: npm run test-ingestion
 *
 * A single run typically takes 3–8 minutes depending on:
 * - Number of posts collected (usually 100–150)
 * - AI latency
 * - Image search latency
 */

export async function runProductRefreshJob(): Promise<void> {
  const startTime = Date.now();
  log.info('Product refresh job started');

  try {
    // ── Step 1: Collect posts ─────────────────────────────────────────────────
    const orchestrator = new IngestionOrchestrator();
    const { posts, activeSources, overallSuccess } = await orchestrator.run();

    if (!overallSuccess || posts.length === 0) {
      log.error('Product refresh job failed — no posts collected');
      await Alerts.ingestionFailed('product-refresh', 'No posts collected from any source');
      return;
    }

    log.info(`Ingestion complete`, {
      posts: posts.length,
      sources: activeSources,
    });

    // ── Step 2: Fetch Comments for Authenticity Analysis ──────────────────────
    const { EnsembleClient } = await import('../ingestion/ensemble/ensemble.client');
    const { transformEnsembleComments } = await import('../ingestion/ensemble/ensemble.transformer');
    
    const ensembleClient = new EnsembleClient(); // Default region OK for comments
    const commentMap = new Map();
    
    if (process.env.ENSEMBLE_API_KEY) {
      log.info(`Fetching comments for ${posts.length} posts via EnsembleData...`);
      // Only fetch comments for the top posts to avoid huge API usage
      // We'll limit to top 20 posts with highest views for authenticity scoring
      const topPosts = [...posts].sort((a, b) => b.viewCount - a.viewCount).slice(0, 20);
      
      for (const post of topPosts) {
        try {
          // Note: aweme_id is typically post.videoId for TikTok
          const rawComments = await ensembleClient.getPostComments(post.videoId);
          if (rawComments.length > 0) {
            commentMap.set(post.videoId, transformEnsembleComments(rawComments, post.videoId));
          }
        } catch (err) {
          log.warn(`Failed to fetch comments for ${post.videoId}`, { err: String(err) });
        }
      }
      log.info(`Fetched comments for ${commentMap.size} posts`);
    } else {
      log.warn('ENSEMBLE_API_KEY not set - skipping comment authenticity phase');
    }

    // ── Step 3: AI extraction ─────────────────────────────────────────────────
    const extractions = await ProductExtractor.extractBatch(posts, commentMap);

    log.info(`AI extraction complete`, {
      input: posts.length,
      extracted: extractions.length,
    });

    if (extractions.length === 0) {
      log.warn('AI extraction returned 0 products — check API key or post quality');
      return;
    }

    // ── Step 4: Image search + DB upsert ─────────────────────────────────
    let saved = 0;
    let failed = 0;

    for (const extraction of extractions) {
      try {
        // Find the source post for this extraction
        const sourcePost = posts.find((p) => p.videoId === extraction.sourceVideoId);
        if (!sourcePost) continue;

        // Search for product image (best-effort — never blocks the upsert)
        if (!sourcePost.thumbnailUrl) {
          const imageUrl = await ImageService.findProductImage(extraction.productName);
          if (imageUrl) sourcePost.thumbnailUrl = imageUrl;
        }

        // Upsert into MongoDB
        await ProductRepository.upsertFromExtraction(extraction, sourcePost);
        saved++;

        ingestionRecordsIngested.inc(
          { source: sourcePost.source, entity: 'product' },
          1
        );
      } catch (err) {
        failed++;
        log.warn('Failed to save product', { err: String(err), videoId: extraction.sourceVideoId });
      }
    }

    const durationMs = Date.now() - startTime;

    log.info('Product refresh job complete', {
      postsCollected: posts.length,
      extracted: extractions.length,
      saved,
      failed,
      durationMs,
      sources: activeSources,
    });

  } catch (err) {
    log.error('Product refresh job threw an unexpected error', err);
    await Alerts.ingestionFailed('product-refresh', err);
  }
}

/**
 * Stale data cleanup job.
 * Marks products that haven't been updated in 2 hours as stale.
 * Run less frequently (every 30 minutes).
 */
export async function runStaleCleanupJob(): Promise<void> {
  log.debug('Stale cleanup job started');
  const TWO_HOURS = 2 * 60 * 60 * 1000;
  const count = await ProductRepository.markStaleProducts(TWO_HOURS);
  if (count > 0) {
    log.info(`Marked ${count} products as stale`);
  }
}
