import { runProductRefreshJob, runStaleCleanupJob } from './product-refresh.job';
import { Product } from '../models/product.model';
import { Creative } from '../models/creative.model';
import { CreativeService } from '../services/creative.service';
import { LiveMonitorService } from '../services/live-monitor.service';
import { ScrapeCreatorsService } from '../services/scrapecreators.service';
import { logger } from '../logger';
import { env } from '../config/env.validation';

const log = logger.child({ module: 'jobs' });

const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;
const HALF_DAY_INTERVAL_MS = 12 * 60 * 60 * 1000;
const LIVE_MONITOR_INTERVAL_MS = 60 * 60 * 1000;
const LIVE_MONITOR_INITIAL_DELAY_MS = 30_000;
const STALE_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const PRODUCT_INGESTION_HOUR_LAGOS = 0;
const CREATIVE_INGESTION_HOURS_LAGOS = [0, 12] as const;
const CREATIVES_PER_RUN = 500;
const TARGET_BATCH_SIZE = 25;
const MAX_DAILY_CYCLES = 200;

let staleCleanupTimer: ReturnType<typeof setInterval> | null = null;
let productIngestionTimeout: ReturnType<typeof setTimeout> | null = null;
let productIngestionInterval: ReturnType<typeof setInterval> | null = null;
let creativeIngestionTimeout: ReturnType<typeof setTimeout> | null = null;
let creativeIngestionInterval: ReturnType<typeof setInterval> | null = null;
let liveMonitorTimeout: ReturnType<typeof setTimeout> | null = null;
let liveMonitorInterval: ReturnType<typeof setInterval> | null = null;
let lastProductRefreshRun: Date | null = null;
let lastStaleCleanupRun: Date | null = null;
let lastProductIngestionRun: Date | null = null;
let lastCreativeIngestionRun: Date | null = null;
let lastLiveMonitorRun: Date | null = null;
let lastProductRefreshSuccessAt: Date | null = null;
let lastProductIngestionSuccessAt: Date | null = null;
let lastCreativeIngestionSuccessAt: Date | null = null;
let lastLiveMonitorSuccessAt: Date | null = null;
let lastProductRefreshError: string | null = null;
let lastProductIngestionError: string | null = null;
let lastCreativeIngestionError: string | null = null;
let lastLiveMonitorError: string | null = null;
let isProductRefreshRunning = false;
let isProductIngestionRunning = false;
let isCreativeIngestionRunning = false;
let isLiveMonitorRunning = false;

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function getDelayUntilNextLagosHour(hour: number): number {
  const now = new Date();
  const lagosNowText = now.toLocaleString('en-US', { timeZone: 'Africa/Lagos' });
  const lagosNow = new Date(lagosNowText);
  const nextRun = new Date(lagosNow);
  nextRun.setHours(hour, 0, 0, 0);
  if (nextRun <= lagosNow) nextRun.setDate(nextRun.getDate() + 1);
  return nextRun.getTime() - lagosNow.getTime();
}

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

export function isBackgroundJobsEnabled(): boolean {
  if (!env.ENABLE_BACKGROUND_JOBS) return false;
  if (env.NODE_ENV === 'development' && !env.ENABLE_DEV_JOBS) return false;
  return true;
}

export function triggerProductRefreshJob(): { started: boolean; reason?: string } {
  if (!isBackgroundJobsEnabled()) {
    return { started: false, reason: 'Background jobs are disabled' };
  }
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

export async function runProductIngestionJob(): Promise<void> {
  log.info('Product ingestion job is disabled');
}

export async function runCreativeIngestionJob(): Promise<void> {
  const startedAtCount = await getCreativeVideoTotal();
  const targetCount = startedAtCount + CREATIVES_PER_RUN;

  let cycles = 0;
  while (cycles < MAX_DAILY_CYCLES) {
    const currentCount = await getCreativeVideoTotal();
    if (currentCount >= targetCount) break;

    const products: any[] = await Product.find({ status: 'active' })
      .sort({ lastIngestedAt: 1, createdAt: 1 })
      .limit(TARGET_BATCH_SIZE);

    if (products.length === 0) break;

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
}

export function triggerProductIngestionJob(): { started: boolean; reason?: string } {
  if (!isBackgroundJobsEnabled()) {
    return { started: false, reason: 'Background jobs are disabled' };
  }
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
      log.error('Product ingestion failed', err);
    })
    .finally(() => {
      isProductIngestionRunning = false;
    });

  return { started: true };
}

export function triggerCreativeIngestionJob(): { started: boolean; reason?: string } {
  if (!isBackgroundJobsEnabled()) {
    return { started: false, reason: 'Background jobs are disabled' };
  }
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

/**
 * Polls ScrapeCreators for **live status** on the union of active tracked stores and handles with open `LiveSession` rows;
 * starts/ends `LiveSession` docs, updates viewer polls.
 * Shop sold-count baselines use Apify (`TikTokShopScraperService`), not ScrapeCreators.
 * Syncs data later read by `GET /tiktok/live/discover`; runs on an hourly timer and via POST `/jobs/live-monitor-discover`.
 */
export function triggerLiveMonitorDiscoverJob(): { started: boolean; reason?: string } {
  if (!isBackgroundJobsEnabled()) {
    return { started: false, reason: 'Background jobs are disabled' };
  }
  if (isLiveMonitorRunning) {
    return { started: false, reason: 'Live monitor discover is already running' };
  }
  isLiveMonitorRunning = true;
  lastLiveMonitorRun = new Date();
  lastLiveMonitorError = null;

  void (async () => {
    try {
      if (!ScrapeCreatorsService.isConfigured()) {
        log.debug('Live monitor discover skipped — SCRAPECREATORS_API_KEY not set');
        return;
      }
      const result = await LiveMonitorService.discover();
      lastLiveMonitorSuccessAt = new Date();
      log.info('Live monitor discover finished', {
        liveCount: result.liveCount,
        totalChecked: result.totalChecked,
        ended: result.ended.length,
      });
    } catch (err) {
      lastLiveMonitorError = toErrorMessage(err);
      log.error('Live monitor discover failed', err);
    } finally {
      isLiveMonitorRunning = false;
    }
  })();

  return { started: true };
}

export function getJobsStatus() {
  return {
    timers: {
      staleCleanup: !!staleCleanupTimer,
      productIngestion: !!productIngestionInterval || !!productIngestionTimeout,
      creativeIngestion: !!creativeIngestionInterval || !!creativeIngestionTimeout,
      liveMonitorDiscover: !!liveMonitorInterval || !!liveMonitorTimeout,
    },
    lastRuns: {
      productRefresh:    lastProductRefreshRun,
      staleCleanup:      lastStaleCleanupRun,
      productIngestion:  lastProductIngestionRun,
      creativeIngestion: lastCreativeIngestionRun,
      liveMonitorDiscover: lastLiveMonitorRun,
    },
    outcomes: {
      productRefresh: {
        running: isProductRefreshRunning,
        lastSuccessAt: lastProductRefreshSuccessAt,
        lastError: lastProductRefreshError,
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
      liveMonitorDiscover: {
        running: isLiveMonitorRunning,
        lastSuccessAt: lastLiveMonitorSuccessAt,
        lastError: lastLiveMonitorError,
      },
    },
    intervals: {
      staleCleanupMs: STALE_CLEANUP_INTERVAL_MS,
      productIngestionMs: DAILY_INTERVAL_MS,
      creativeIngestionMs: HALF_DAY_INTERVAL_MS,
      liveMonitorDiscoverMs: LIVE_MONITOR_INTERVAL_MS,
    },
    env: env.NODE_ENV,
    enabled: isBackgroundJobsEnabled(),
  };
}

export function startJobs(): void {
  if (!isBackgroundJobsEnabled()) {
    log.info('Background jobs disabled', {
      enableBackgroundJobs: env.ENABLE_BACKGROUND_JOBS,
      enableDevJobs: env.ENABLE_DEV_JOBS,
      nodeEnv: env.NODE_ENV,
    });
    return;
  }

  staleCleanupTimer = setInterval(() => {
    lastStaleCleanupRun = new Date();
    runStaleCleanupJob().catch((err) => log.error('Stale cleanup job failed', err));
  }, STALE_CLEANUP_INTERVAL_MS);

  const productDelay = getDelayUntilNextLagosHour(PRODUCT_INGESTION_HOUR_LAGOS);
  productIngestionTimeout = setTimeout(() => {
    triggerProductIngestionJob();
    productIngestionInterval = setInterval(() => triggerProductIngestionJob(), DAILY_INTERVAL_MS);
  }, productDelay);

  const creativeDelay = getDelayUntilNextLagosHours(CREATIVE_INGESTION_HOURS_LAGOS);
  creativeIngestionTimeout = setTimeout(() => {
    triggerCreativeIngestionJob();
    creativeIngestionInterval = setInterval(() => triggerCreativeIngestionJob(), HALF_DAY_INTERVAL_MS);
  }, creativeDelay);

  liveMonitorTimeout = setTimeout(() => {
    triggerLiveMonitorDiscoverJob();
    liveMonitorInterval = setInterval(() => triggerLiveMonitorDiscoverJob(), LIVE_MONITOR_INTERVAL_MS);
  }, LIVE_MONITOR_INITIAL_DELAY_MS);
}

export function stopJobs(): void {
  if (staleCleanupTimer) clearInterval(staleCleanupTimer);
  if (productIngestionTimeout) clearTimeout(productIngestionTimeout);
  if (productIngestionInterval) clearInterval(productIngestionInterval);
  if (creativeIngestionTimeout) clearTimeout(creativeIngestionTimeout);
  if (creativeIngestionInterval) clearInterval(creativeIngestionInterval);
  if (liveMonitorTimeout) clearTimeout(liveMonitorTimeout);
  if (liveMonitorInterval) clearInterval(liveMonitorInterval);
  log.info('Background jobs stopped');
}
