import { runProductRefreshJob, runStaleCleanupJob } from './product-refresh.job';
import { ProductService } from '../services/product.service';
import { logger } from '../logger';
import { env } from '../config/env.validation';
import { EchoTikIngestionPipeline } from '../ingestion/echotik/echotik.pipeline';
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
 *  Daily target ingestion — 15:00 Africa/Lagos, then every 24h (hashtag pipeline → products; then creatives toward caps)
 *  Stale cleanup         — every 5 minutes
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
let lastProductRefreshSuccessAt: Date | null = null;
let lastEchoTikPipelineSuccessAt: Date | null = null;
let lastProductRefreshError: string | null = null;
let lastEchoTikPipelineError: string | null = null;
let isProductRefreshRunning = false;
let isEchoTikPipelineRunning = false;

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function triggerProductRefreshJob(): { started: boolean; reason?: string } {
  if (isProductRefreshRunning) {
    return { started: false, reason: 'Product refresh job is already running' };
  }

  isProductRefreshRunning = true;
  lastProductRefreshRun = new Date();
  lastProductRefreshError = null;

  void runProductRefreshJob()
    .then(() => {
      lastProductRefreshSuccessAt = new Date();
    })
    .catch((err) => {
      lastProductRefreshError = toErrorMessage(err);
      log.error('Product refresh job failed', err);
    })
    .finally(() => {
      isProductRefreshRunning = false;
    });

  return { started: true };
}

export async function runEchoTikPipelineJob(region = 'US'): Promise<void> {
  if (isEchoTikPipelineRunning) {
    log.warn('EchoTik pipeline trigger skipped: already running');
    return;
  }

  isEchoTikPipelineRunning = true;
  lastDailyTargetRun = new Date();
  lastEchoTikPipelineError = null;

  const pipeline = new EchoTikIngestionPipeline();
  try {
    const result = await pipeline.run({ region });

    log.info('EchoTik pipeline completed', {
      productsIngested: result.productsIngested,
      dbUpserts:        result.dbUpserts,
      errors:           result.errors.length,
    });
    lastEchoTikPipelineSuccessAt = new Date();

    const cleanupResult = await ProductService.cleanupProducts();
    log.info('EchoTik pipeline cleanup complete', cleanupResult);
  } catch (err) {
    lastEchoTikPipelineError = toErrorMessage(err);
    throw err;
  } finally {
    isEchoTikPipelineRunning = false;
  }
}

export function triggerEchoTikPipelineJob(): { started: boolean; reason?: string } {
  if (isEchoTikPipelineRunning) {
    return { started: false, reason: 'EchoTik pipeline is already running' };
  }

  isEchoTikPipelineRunning = true;
  lastDailyTargetRun = new Date();
  lastEchoTikPipelineError = null;

  const pipeline = new EchoTikIngestionPipeline();
  void pipeline.run()
    .then(async (result) => {
      log.info('EchoTik pipeline completed', {
        productsIngested: result.productsIngested,
        dbUpserts:        result.dbUpserts,
        errors:           result.errors.length,
      });
      lastEchoTikPipelineSuccessAt = new Date();
      const cleanupResult = await ProductService.cleanupProducts();
      log.info('EchoTik pipeline cleanup complete', cleanupResult);
    })
    .catch((err) => {
      lastEchoTikPipelineError = toErrorMessage(err);
      log.error('EchoTik pipeline failed', err);
    })
    .finally(() => {
      isEchoTikPipelineRunning = false;
    });

  return { started: true };
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
    outcomes: {
      productRefresh: {
        running: isProductRefreshRunning,
        lastSuccessAt: lastProductRefreshSuccessAt,
        lastError: lastProductRefreshError,
      },
      echotikPipeline: {
        running: isEchoTikPipelineRunning,
        lastSuccessAt: lastEchoTikPipelineSuccessAt,
        lastError: lastEchoTikPipelineError,
      },
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
    targetCreatives: DAILY_TARGET_CREATIVES,
    timezone: 'Africa/Lagos',
  });

  // Phase 1: EchoTik product ingestion (multi-region priority)
  const regions = [
    { id: 'US', target: DAILY_TARGET_PRODUCTS },
    // South America
    { id: 'BR', target: 50 },
    { id: 'MX', target: 50 },
    // Europe
    { id: 'GB', target: 50 },
    { id: 'FR', target: 50 },
    { id: 'DE', target: 50 },
    { id: 'ES', target: 50 },
    { id: 'IT', target: 50 },
    // Oceania
    { id: 'AU', target: 50 },
    { id: 'NZ', target: 50 },
  ];

  for (const { id: regionId, target } of regions) {
    let cycles = 0;
    while (cycles < MAX_DAILY_CYCLES) {
      const productCount = await Product.countDocuments({ status: 'active', region: regionId });
      if (productCount >= target) break;
      if (isEchoTikPipelineRunning) break;
      await runEchoTikPipelineJob(regionId);
      cycles += 1;
    }
  }

  let cycles = 0;
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

  // Stale cleanup — starts immediately, runs every 5 minutes
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
