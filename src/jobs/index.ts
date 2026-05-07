import { runProductRefreshJob, runStaleCleanupJob } from './product-refresh.job';
import { ProductService } from '../services/product.service';
import { logger } from '../logger';
import { env } from '../config/env.validation';
import { EchoTikIngestionPipeline } from '../ingestion/echotik/echotik.pipeline';
import { Product } from '../models/product.model';
import { Creative } from '../models/creative.model';
import { CreativeService } from '../services/creative.service';
import { refreshStaleProductImages } from '../ingestion/echotik/echotik.image-refresh';

const log = logger.child({ module: 'jobs' });

/**
 * Job Scheduler
 *
 * Starts all background jobs on wall-clock schedules anchored to Africa/Lagos.
 * Uses setTimeout + setInterval rather than a cron library to keep
 * dependencies minimal.
 *
 * Schedule:
 *   Product ingestion   — daily at 00:00 Africa/Lagos
 *                          multi-region EchoTik pipeline + product cleanup
 *   Creative ingestion  — every 12h at 00:00 / 12:00 Africa/Lagos
 *                          adds up to 500 new creative videos per run
 *   Stale cleanup       — every 5 minutes
 *   EchoTik image refresh — every 30 minutes
 *
 * No boot-time ingestion: jobs only fire at their next scheduled slot.
 */

const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;               // 24 hours
const HALF_DAY_INTERVAL_MS = 12 * 60 * 60 * 1000;            // 12 hours
const STALE_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;             // 5 minutes
const ECHOTIK_IMAGE_REFRESH_INTERVAL_MS = 30 * 60 * 1000;    // 30 minutes
const ECHOTIK_IMAGE_REFRESH_BATCH = 100;

// Product ingestion — daily run, multi-region targets.
const PRODUCT_INGESTION_HOUR_LAGOS = 0;   // 00:00 (midnight) Africa/Lagos
const DAILY_TARGET_PRODUCTS = 300;

// Creative ingestion — 12-hour cadence, aligned to Lagos clock.
const CREATIVE_INGESTION_HOURS_LAGOS = [0, 12] as const;   // 00:00 and 12:00
const CREATIVES_PER_RUN = 500;

const TARGET_BATCH_SIZE = 25;
const MAX_DAILY_CYCLES = 200;

let productRefreshTimer: ReturnType<typeof setInterval> | null = null;
let staleCleanupTimer: ReturnType<typeof setInterval> | null = null;
let echotikImageRefreshTimer: ReturnType<typeof setInterval> | null = null;
let productIngestionTimeout: ReturnType<typeof setTimeout> | null = null;
let productIngestionInterval: ReturnType<typeof setInterval> | null = null;
let creativeIngestionTimeout: ReturnType<typeof setTimeout> | null = null;
let creativeIngestionInterval: ReturnType<typeof setInterval> | null = null;

let lastProductRefreshRun: Date | null = null;
let lastStaleCleanupRun: Date | null = null;
let lastProductIngestionRun: Date | null = null;
let lastCreativeIngestionRun: Date | null = null;
let lastEchoTikPipelineRun: Date | null = null;
let lastProductRefreshSuccessAt: Date | null = null;
let lastEchoTikPipelineSuccessAt: Date | null = null;
let lastProductIngestionSuccessAt: Date | null = null;
let lastCreativeIngestionSuccessAt: Date | null = null;
let lastProductRefreshError: string | null = null;
let lastEchoTikPipelineError: string | null = null;
let lastProductIngestionError: string | null = null;
let lastCreativeIngestionError: string | null = null;
let isProductRefreshRunning = false;
let isEchoTikPipelineRunning = false;
let isProductIngestionRunning = false;
let isCreativeIngestionRunning = false;

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
  lastEchoTikPipelineRun = new Date();
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
  lastEchoTikPipelineRun = new Date();
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
      echotikImageRefresh: !!echotikImageRefreshTimer,
      productIngestion: !!productIngestionInterval || !!productIngestionTimeout,
      creativeIngestion: !!creativeIngestionInterval || !!creativeIngestionTimeout,
    },
    lastRuns: {
      productRefresh: lastProductRefreshRun,
      staleCleanup: lastStaleCleanupRun,
      productIngestion: lastProductIngestionRun,
      creativeIngestion: lastCreativeIngestionRun,
      echotikPipeline: lastEchoTikPipelineRun,
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
      productIngestion: {
        running: isProductIngestionRunning,
        lastSuccessAt: lastProductIngestionSuccessAt,
        lastError: lastProductIngestionError,
      },
      creativeIngestion: {
        running: isCreativeIngestionRunning,
        lastSuccessAt: lastCreativeIngestionSuccessAt,
        lastError: lastCreativeIngestionError,
      },
    },
    intervals: {
      productRefreshMs: DAILY_INTERVAL_MS,
      staleCleanupMs: STALE_CLEANUP_INTERVAL_MS,
      echotikImageRefreshMs: ECHOTIK_IMAGE_REFRESH_INTERVAL_MS,
      productIngestionMs: DAILY_INTERVAL_MS,
      creativeIngestionMs: HALF_DAY_INTERVAL_MS,
    },
    schedules: {
      productIngestion: `${String(PRODUCT_INGESTION_HOUR_LAGOS).padStart(2, '0')}:00 Africa/Lagos (daily)`,
      creativeIngestion: `${CREATIVE_INGESTION_HOURS_LAGOS.map((h) => String(h).padStart(2, '0') + ':00').join(' / ')} Africa/Lagos (every 12h)`,
    },
    targets: {
      productsPerRegion: DAILY_TARGET_PRODUCTS,
      creativesPerRun: CREATIVES_PER_RUN,
    },
    env: env.NODE_ENV,
  };
}

/**
 * Returns the ms delay from now until the next occurrence of the given hour
 * (0–23) in Africa/Lagos local time.
 */
function getDelayUntilNextLagosHour(hour: number): number {
  const now = new Date();
  const lagosNowText = now.toLocaleString('en-US', { timeZone: 'Africa/Lagos' });
  const lagosNow = new Date(lagosNowText);
  const nextRun = new Date(lagosNow);
  nextRun.setHours(hour, 0, 0, 0);
  if (nextRun <= lagosNow) nextRun.setDate(nextRun.getDate() + 1);
  return nextRun.getTime() - lagosNow.getTime();
}

/**
 * Delay until the next of any given hours (Africa/Lagos). Used for the
 * creative schedule which fires at 00:00 and 12:00.
 */
function getDelayUntilNextLagosHours(hours: readonly number[]): number {
  if (hours.length === 0) return DAILY_INTERVAL_MS;
  const delays = hours.map((h) => getDelayUntilNextLagosHour(h));
  return Math.min(...delays);
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

/**
 * Daily product ingestion — runs the EchoTik pipeline for every configured
 * region until each region's target is met (or we hit MAX_DAILY_CYCLES as a
 * safety ceiling). Runs product cleanup at the end.
 */
export async function runProductIngestionJob(): Promise<void> {
  log.info('Daily product ingestion started', {
    targetPerUS: DAILY_TARGET_PRODUCTS,
    timezone: 'Africa/Lagos',
  });

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

  const productCleanup = await ProductService.cleanupProducts().catch((err) => {
    log.warn('Post-ingestion product cleanup failed', { err: String(err) });
    return null;
  });

  const totalProducts = await Product.countDocuments({ status: 'active' });

  log.info('Daily product ingestion complete', {
    activeProducts: totalProducts,
    cleanup: productCleanup,
  });
}

/**
 * Creative ingestion — runs every 12 hours and adds up to `CREATIVES_PER_RUN`
 * new creative videos per run by walking products ordered by how long since
 * their last creative re-ingest. Because `CreativeService.mapAndSave` now
 * overwrites existing slots, this job also refreshes TikTok CDN signatures
 * for creatives it revisits.
 */
export async function runCreativeIngestionJob(): Promise<void> {
  const startedAtCount = await getCreativeVideoTotal();
  const targetCount = startedAtCount + CREATIVES_PER_RUN;

  log.info('Creative ingestion started', {
    startCount: startedAtCount,
    targetCount,
    creativesPerRun: CREATIVES_PER_RUN,
    timezone: 'Africa/Lagos',
  });

  let cycles = 0;
  while (cycles < MAX_DAILY_CYCLES) {
    const currentCount = await getCreativeVideoTotal();
    if (currentCount >= targetCount) break;

    const products: any[] = await Product.find({ status: 'active' })
      .sort({ lastIngestedAt: 1, createdAt: 1 })
      .limit(TARGET_BATCH_SIZE);

    if (products.length === 0) {
      log.info('Creative ingestion: no active products to process');
      break;
    }

    for (const product of products) {
      const totalSoFar = await getCreativeVideoTotal();
      if (totalSoFar >= targetCount) break;

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

  const finishedAtCount = await getCreativeVideoTotal();
  log.info('Creative ingestion complete', {
    startCount: startedAtCount,
    finishCount: finishedAtCount,
    added: finishedAtCount - startedAtCount,
    cycles,
  });
}

export function triggerProductIngestionJob(): { started: boolean; reason?: string } {
  if (isProductIngestionRunning) {
    return { started: false, reason: 'Product ingestion is already running' };
  }
  isProductIngestionRunning = true;
  lastProductIngestionRun = new Date();
  lastProductIngestionError = null;

  void runProductIngestionJob()
    .then(() => {
      lastProductIngestionSuccessAt = new Date();
    })
    .catch((err) => {
      lastProductIngestionError = toErrorMessage(err);
      log.error('Daily product ingestion failed', err);
    })
    .finally(() => {
      isProductIngestionRunning = false;
    });

  return { started: true };
}

export function triggerCreativeIngestionJob(): { started: boolean; reason?: string } {
  if (isCreativeIngestionRunning) {
    return { started: false, reason: 'Creative ingestion is already running' };
  }
  isCreativeIngestionRunning = true;
  lastCreativeIngestionRun = new Date();
  lastCreativeIngestionError = null;

  void runCreativeIngestionJob()
    .then(() => {
      lastCreativeIngestionSuccessAt = new Date();
    })
    .catch((err) => {
      lastCreativeIngestionError = toErrorMessage(err);
      log.error('Creative ingestion failed', err);
    })
    .finally(() => {
      isCreativeIngestionRunning = false;
    });

  return { started: true };
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

  // EchoTik image refresh — keeps resolved temp URLs ahead of their ~24h
  // expiry so requests never have to round-trip to EchoTik. Runs every 30
  // minutes, processes a small batch each time.
  refreshStaleProductImages(ECHOTIK_IMAGE_REFRESH_BATCH).catch((err) =>
    log.warn('Initial EchoTik image refresh failed', { err: String(err) })
  );
  echotikImageRefreshTimer = setInterval(() => {
    refreshStaleProductImages(ECHOTIK_IMAGE_REFRESH_BATCH).catch((err) =>
      log.warn('Scheduled EchoTik image refresh failed', { err: String(err) })
    );
  }, ECHOTIK_IMAGE_REFRESH_INTERVAL_MS);

  // ── Daily product ingestion — 00:00 Africa/Lagos, then every 24h ─────────
  const productDelay = getDelayUntilNextLagosHour(PRODUCT_INGESTION_HOUR_LAGOS);
  productIngestionTimeout = setTimeout(() => {
    log.info('Scheduled daily product ingestion triggered');
    triggerProductIngestionJob();

    productIngestionInterval = setInterval(() => {
      log.info('Scheduled daily product ingestion triggered');
      triggerProductIngestionJob();
    }, DAILY_INTERVAL_MS);
  }, productDelay);

  log.info('Product ingestion scheduled', {
    timezone: 'Africa/Lagos',
    runAt: `${String(PRODUCT_INGESTION_HOUR_LAGOS).padStart(2, '0')}:00`,
    interval: '24 hours',
    firstRunInMinutes: Math.round(productDelay / 60000),
    targetPerRegion: { US: DAILY_TARGET_PRODUCTS, other: 50 },
  });

  // ── Creative ingestion — every 12h at 00:00 / 12:00 Africa/Lagos ─────────
  const creativeDelay = getDelayUntilNextLagosHours(CREATIVE_INGESTION_HOURS_LAGOS);
  creativeIngestionTimeout = setTimeout(() => {
    log.info('Scheduled creative ingestion triggered');
    triggerCreativeIngestionJob();

    creativeIngestionInterval = setInterval(() => {
      log.info('Scheduled creative ingestion triggered');
      triggerCreativeIngestionJob();
    }, HALF_DAY_INTERVAL_MS);
  }, creativeDelay);

  log.info('Creative ingestion scheduled', {
    timezone: 'Africa/Lagos',
    runAt: CREATIVE_INGESTION_HOURS_LAGOS
      .map((h) => `${String(h).padStart(2, '0')}:00`)
      .join(' / '),
    interval: '12 hours',
    firstRunInMinutes: Math.round(creativeDelay / 60000),
    creativesPerRun: CREATIVES_PER_RUN,
  });

  log.info('Background jobs scheduled', {
    staleCleanupInterval: `${STALE_CLEANUP_INTERVAL_MS / 60000} minutes`,
    echotikImageRefreshInterval: `${ECHOTIK_IMAGE_REFRESH_INTERVAL_MS / 60000} minutes`,
    productIngestion: `${String(PRODUCT_INGESTION_HOUR_LAGOS).padStart(2, '0')}:00 Africa/Lagos (daily)`,
    creativeIngestion: `${CREATIVE_INGESTION_HOURS_LAGOS.map((h) => String(h).padStart(2, '0') + ':00').join(' / ')} Africa/Lagos (every 12h)`,
  });
}

export function stopJobs(): void {
  if (productRefreshTimer) clearInterval(productRefreshTimer);
  if (staleCleanupTimer) clearInterval(staleCleanupTimer);
  if (echotikImageRefreshTimer) clearInterval(echotikImageRefreshTimer);
  if (productIngestionTimeout) clearTimeout(productIngestionTimeout);
  if (productIngestionInterval) clearInterval(productIngestionInterval);
  if (creativeIngestionTimeout) clearTimeout(creativeIngestionTimeout);
  if (creativeIngestionInterval) clearInterval(creativeIngestionInterval);
  log.info('Background jobs stopped');
}
