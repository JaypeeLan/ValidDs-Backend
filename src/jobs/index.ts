import { runProductRefreshJob, runStaleCleanupJob } from './product-refresh.job';
import { ProductService } from '../services/product.service';
import { logger } from '../logger';
import { env } from '../config/env.validation';
import { HashtagIngestionPipeline } from '../ingestion/ensemble/hashtag-ingestion.pipeline';
import { Product } from '../models/product.model';
import { Creative } from '../models/creative.model';
import { CreativeService } from '../services/creative.service';

const log = logger.child({ module: 'jobs' });

/**
 * Job Scheduler
 *
 * Starts all background jobs on a fixed interval.
 * Uses setInterval rather than a cron library to keep dependencies minimal.
 *
 * Schedule:
 *  Product refresh  — every 24 hours
 *  Stale cleanup    — every 30 minutes
 *
 * The first run of the product refresh is delayed by 10 seconds
 * to give the server time to fully start before making external requests.
 */

const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;               // 24 hours
const STALE_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;            // 5 minutes
const DAILY_TARGET_PRODUCTS = 300;
const DAILY_TARGET_CREATIVES = 300;
const TARGET_BATCH_SIZE = 25;
const MAX_DAILY_CYCLES = 200;

let productRefreshTimer: ReturnType<typeof setInterval> | null = null;
let staleCleanupTimer: ReturnType<typeof setInterval> | null = null;
let dailyTargetIngestionTimeout: ReturnType<typeof setTimeout> | null = null;
let dailyTargetIngestionInterval: ReturnType<typeof setInterval> | null = null;

let lastProductRefreshRun: Date | null = null;
let lastStaleCleanupRun: Date | null = null;
let lastDailyTargetRun: Date | null = null;

export async function runHashtagPipelineJob(): Promise<void> {
  const pipeline = new HashtagIngestionPipeline();
  const result = await pipeline.run();

  log.info('Hashtag pipeline completed', {
    postsCollected: result.postsCollected,
    dbUpserts: result.dbUpserts,
    errors: result.errors.length,
  });

  const cleanupResult = await ProductService.cleanupProducts();
  log.info('Hashtag pipeline cleanup complete', cleanupResult);
}

export function getJobsStatus() {
  return {
    timers: {
      productRefresh: !!productRefreshTimer,
      staleCleanup: !!staleCleanupTimer,
      dailyTargetIngestion: !!dailyTargetIngestionInterval || !!dailyTargetIngestionTimeout,
    },
    lastRuns: {
      productRefresh: lastProductRefreshRun,
      staleCleanup: lastStaleCleanupRun,
      dailyTargetIngestion: lastDailyTargetRun,
    },
    intervals: {
      productRefreshMs: DAILY_INTERVAL_MS,
      staleCleanupMs: STALE_CLEANUP_INTERVAL_MS,
      dailyTargetIngestionMs: DAILY_INTERVAL_MS,
    },
    env: env.NODE_ENV,
  };
}

function getDelayUntilNextLagos3PM(): number {
  const now = new Date();
  const lagosNowText = now.toLocaleString('en-US', { timeZone: 'Africa/Lagos' });
  const lagosNow = new Date(lagosNowText);
  const nextRun = new Date(lagosNow);
  nextRun.setHours(15, 0, 0, 0);
  if (nextRun <= lagosNow) nextRun.setDate(nextRun.getDate() + 1);
  return nextRun.getTime() - lagosNow.getTime();
}

async function getCreativeVideoTotal(): Promise<number> {
  const rows = await Creative.aggregate([
    {
      $project: {
        videoCount: {
          $add: [1, { $size: { $ifNull: ['$relatedVideos', []] } }],
        },
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$videoCount' },
      },
    },
  ]);
  return rows[0]?.total || 0;
}

async function runDailyTargetIngestionJob(): Promise<void> {
  log.info('Daily target ingestion job started', {
    targetProducts: DAILY_TARGET_PRODUCTS,
    targetCreatives: DAILY_TARGET_CREATIVES,
    timezone: 'Africa/Lagos',
  });

  const pipeline = new HashtagIngestionPipeline();
  let cycles = 0;

  while (cycles < MAX_DAILY_CYCLES) {
    const productCount = await Product.countDocuments({ status: 'active' });
    if (productCount >= DAILY_TARGET_PRODUCTS) break;
    await pipeline.run();
    cycles += 1;
  }

  cycles = 0;
  while (cycles < MAX_DAILY_CYCLES) {
    const creativeTotal = await getCreativeVideoTotal();
    if (creativeTotal >= DAILY_TARGET_CREATIVES) break;

    const products: any[] = await Product.find({ status: 'active' })
      .sort({ lastIngestedAt: 1, createdAt: 1 })
      .limit(TARGET_BATCH_SIZE);

    if (products.length === 0) break;

    for (const product of products) {
      await CreativeService.fetchAndIngestCreatives(product.title, product._id, {
        brand: product.aiIntelligence?.brand,
        categoryKeywords: product.aiIntelligence?.categoryKeywords || [],
        categoryL1: product.categoryL1,
        categoryL2: product.categoryL2,
        categoryL3: product.categoryL3,
        productDescription: product.description,
      });
    }

    cycles += 1;
  }

  const [products, creatives, creativeVideos] = await Promise.all([
    Product.countDocuments({ status: 'active' }),
    Creative.countDocuments({}),
    getCreativeVideoTotal(),
  ]);

  log.info('Daily target ingestion job complete', {
    products,
    creativeDocs: creatives,
    creativeVideos,
  });
}

export function startJobs(): void {
  if (env.NODE_ENV === 'development' && !env.ENABLE_DEV_JOBS) {
    log.info('Background jobs disabled in development (ENABLE_DEV_JOBS=false)');
    return;
  }

  log.info('Starting background jobs');

  // Product refresh remains available for manual/API trigger only.
  productRefreshTimer = null;

  // Stale cleanup — starts immediately, runs every 30 minutes
  lastStaleCleanupRun = new Date();
  runStaleCleanupJob().catch(() => { });
  staleCleanupTimer = setInterval(() => {
    log.info('Scheduled stale cleanup triggered');
    lastStaleCleanupRun = new Date();
    runStaleCleanupJob().catch((err) =>
      log.error('Stale cleanup job failed', err)
    );
  }, STALE_CLEANUP_INTERVAL_MS);

  // Daily target ingestion at 3:00 PM Africa/Lagos. No boot-time ingestion.
  const initialDelay = getDelayUntilNextLagos3PM();
  dailyTargetIngestionTimeout = setTimeout(() => {
    log.info('Scheduled daily target ingestion triggered');
    lastDailyTargetRun = new Date();
    runDailyTargetIngestionJob().catch((err) =>
      log.error('Daily target ingestion failed', err)
    );

    dailyTargetIngestionInterval = setInterval(() => {
      log.info('Scheduled daily target ingestion triggered');
      lastDailyTargetRun = new Date();
      runDailyTargetIngestionJob().catch((err) =>
        log.error('Daily target ingestion failed', err)
      );
    }, DAILY_INTERVAL_MS);
  }, initialDelay);

  log.info('Daily target ingestion scheduled', {
    timezone: 'Africa/Lagos',
    runAt: '15:00',
    interval: '24 hours',
    targets: { products: DAILY_TARGET_PRODUCTS, creatives: DAILY_TARGET_CREATIVES },
  });

  log.info('Background jobs scheduled', {
    productRefreshInterval: `${DAILY_INTERVAL_MS / 60000} minutes`,
    staleCleanupInterval: `${STALE_CLEANUP_INTERVAL_MS / 60000} minutes`,
    dailyTargetIngestion: '15:00 Africa/Lagos (daily)',
  });
}

export function stopJobs(): void {
  if (productRefreshTimer) clearInterval(productRefreshTimer);
  if (staleCleanupTimer) clearInterval(staleCleanupTimer);
  if (dailyTargetIngestionTimeout) clearTimeout(dailyTargetIngestionTimeout);
  if (dailyTargetIngestionInterval) clearInterval(dailyTargetIngestionInterval);
  log.info('Background jobs stopped');
}
