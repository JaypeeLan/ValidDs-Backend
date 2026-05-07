import { ProductRepository } from '../db/repositories/product.repository';
import { logger } from '../logger';

const log = logger.child({ module: 'product-refresh-job' });

/**
 * Product Refresh Job
 *
 * The main scheduled job that runs the full pipeline:
 *
 *  1. Ingestion Orchestrator  — collects source posts
 *  2. AI Extractor            — runs each post through the AI to extract
 *                               product name, niche, trend score, sentiment
 *  3. Image Service           | finds a product image by searching the product name
 *  4. Product Repository      | upserts each extracted product into MongoDB
 *
 * Designed to run on a schedule (every 1 hour via setInterval or cron).
 * Also callable manually via `POST /api/v1/jobs/product-refresh`.
 *
 * A single run typically takes 3–8 minutes depending on:
 * - Number of posts collected (usually 100–150)
 * - AI latency
 * - Image search latency
 */

export async function runProductRefreshJob(): Promise<void> {
  log.info('Product refresh job is disabled');
}

/**
 * Stale data cleanup job.
 * Marks products that haven't been updated in a few minutes as stale.
 */
export async function runStaleCleanupJob(): Promise<void> {
  log.debug('Stale cleanup job started');
  const count = await ProductRepository.markStaleProducts(1440); // 24 hours — products re-ingested daily
  if (count > 0) {
    log.info(`Marked ${count} products as stale`);
  }
}
