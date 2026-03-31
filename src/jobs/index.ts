import { runProductRefreshJob, runStaleCleanupJob } from './product-refresh.job';
import { logger } from '../logger';

const log = logger.child({ module: 'jobs' });

/**
 * Job Scheduler
 *
 * Starts all background jobs on a fixed interval.
 * Uses setInterval rather than a cron library to keep dependencies minimal.
 *
 * Schedule:
 *  Product refresh  — every 2 hours
 *  Stale cleanup    — every 30 minutes
 *
 * The first run of the product refresh is delayed by 10 seconds
 * to give the server time to fully start before making external requests.
 */

const PRODUCT_REFRESH_INTERVAL_MS  = 2 * 60 * 60 * 1000;   // 2 hours
const STALE_CLEANUP_INTERVAL_MS    = 30 * 60 * 1000;        // 30 minutes
const INITIAL_DELAY_MS             = 10 * 1000;              // 10 seconds

let productRefreshTimer: ReturnType<typeof setInterval> | null = null;
let staleCleanupTimer: ReturnType<typeof setInterval> | null = null;

export function startJobs(): void {
  log.info('Starting background jobs');

  // Product refresh — delayed first run, then every 2 hours
  setTimeout(() => {
    log.info('Running initial product refresh');
    runProductRefreshJob().catch((err) =>
      log.error('Initial product refresh failed', err)
    );

    productRefreshTimer = setInterval(() => {
      runProductRefreshJob().catch((err) =>
        log.error('Scheduled product refresh failed', err)
      );
    }, PRODUCT_REFRESH_INTERVAL_MS);
  }, INITIAL_DELAY_MS);

  // Stale cleanup — starts immediately, runs every 30 minutes
  runStaleCleanupJob().catch(() => {});
  staleCleanupTimer = setInterval(() => {
    runStaleCleanupJob().catch((err) =>
      log.error('Stale cleanup job failed', err)
    );
  }, STALE_CLEANUP_INTERVAL_MS);

  log.info('Background jobs scheduled', {
    productRefreshInterval: `${PRODUCT_REFRESH_INTERVAL_MS / 60000} minutes`,
    staleCleanupInterval:   `${STALE_CLEANUP_INTERVAL_MS / 60000} minutes`,
  });
}

export function stopJobs(): void {
  if (productRefreshTimer) clearInterval(productRefreshTimer);
  if (staleCleanupTimer)   clearInterval(staleCleanupTimer);
  log.info('Background jobs stopped');
}
