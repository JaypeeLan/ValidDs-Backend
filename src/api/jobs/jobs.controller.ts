import { Request, Response } from 'express';
import { runStaleCleanupJob } from '../../jobs/product-refresh.job';
import {
  getJobsStatus,
  isBackgroundJobsEnabled,
  triggerCreativeIngestionJob,
  triggerLiveMonitorDiscoverJob,
  triggerProductIngestionJob,
  triggerProductRefreshJob,
} from '../../jobs/index';
import { logger } from '../../logger';
import { successResponse } from '../../utils/response.util';

const log = logger.child({ module: 'jobs-controller' });

function respondJobsDisabled(res: Response): void {
  res.status(503).json({
    success: false,
    error: {
      code: 'JOBS_DISABLED',
      message: 'Background jobs are disabled. Set ENABLE_BACKGROUND_JOBS=true to run schedulers.',
    },
  });
}

/**
 * Jobs Controller
 * 
 * Provides endpoints to check background job status and trigger them manually.
 * Critical for Render Free Tier where internal timers (setInterval) might 
 * be cleared if the instance sleeps.
 */
export const JobsController = {
  /**
   * Helper for routes that are misconfigured as GET
   */
  getMethodWarning(req: Request, res: Response): void {
    log.warn('Job endpoint hit with GET instead of POST', { path: req.path, ip: req.ip });
    res.status(405).json({
      success: false,
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: `This endpoint requires a POST request. You sent a ${req.method}.`,
        hint: 'If you are using cron-job.org, ensure the Method is set to POST and X-API-Key header is added.'
      }
    });
  },

  /**

   * GET /jobs/status
   * Returns the current state of background timers and last run timestamps.
   */
  getStatus(req: Request, res: Response): void {
    const status = getJobsStatus();
    res.json(successResponse(status, 'Background job status retrieved'));
  },

  /**
   * POST /jobs/product-refresh
   * Triggers the full product refresh pipeline (Ingestion -> AI -> Enrichment -> DB).
   */
  async triggerProductRefresh(req: Request, res: Response): Promise<void> {
    if (!isBackgroundJobsEnabled()) {
      respondJobsDisabled(res);
      return;
    }
    log.info('Manual product refresh triggered via API', {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      hasApiKey: !!req.headers['x-api-key'],
    });
    
    // Do not block the HTTP request; run asynchronously with guard against overlaps.
    const trigger = triggerProductRefreshJob();
    if (!trigger.started) {
      res.status(409).json(successResponse({ triggered: false }, 'Product refresh already running'));
      return;
    }

    res.json(successResponse({ triggered: true }, 'Product refresh job started in background'));
  },


  /**
   * POST /jobs/product-ingestion
   * Runs the daily product ingestion flow. Same code path as the
   * 00:00 Africa/Lagos cron.
   */
  async triggerProductIngestion(req: Request, res: Response): Promise<void> {
    if (!isBackgroundJobsEnabled()) {
      respondJobsDisabled(res);
      return;
    }
    log.info('Manual product ingestion triggered via API');

    const trigger = triggerProductIngestionJob();
    if (!trigger.started) {
      res.status(409).json(successResponse({ triggered: false }, trigger.reason || 'Product ingestion already running'));
      return;
    }

    res.json(successResponse({ triggered: true }, 'Product ingestion started in background'));
  },

  /**
   * POST /jobs/creative-ingestion
   * Runs the creative ingestion job — adds up to 500 new creative videos in a
   * single pass. Same code path as the 12-hour (00:00 / 12:00 Africa/Lagos) cron.
   */
  async triggerCreativeIngestion(req: Request, res: Response): Promise<void> {
    if (!isBackgroundJobsEnabled()) {
      respondJobsDisabled(res);
      return;
    }
    log.info('Manual creative ingestion triggered via API');

    const trigger = triggerCreativeIngestionJob();
    if (!trigger.started) {
      res.status(409).json(successResponse({ triggered: false }, trigger.reason || 'Creative ingestion already running'));
      return;
    }

    res.json(successResponse({ triggered: true }, 'Creative ingestion started in background'));
  },

  /**
   * POST /jobs/live-monitor-discover
   * Runs TikTok live discovery for all active tracked stores (ScrapeCreators live checks + Apify shop snapshots for GMV).
   * Same code path as the hourly in-process cron.
   */
  async triggerLiveMonitorDiscover(req: Request, res: Response): Promise<void> {
    if (!isBackgroundJobsEnabled()) {
      respondJobsDisabled(res);
      return;
    }
    log.info('Manual live monitor discover triggered via API');

    const trigger = triggerLiveMonitorDiscoverJob();
    if (!trigger.started) {
      res.status(409).json(successResponse({ triggered: false }, trigger.reason || 'Live monitor discover already running'));
      return;
    }

    res.json(successResponse({ triggered: true }, 'Live monitor discover started in background'));
  },

  /**
   * POST /jobs/stale-cleanup
   * Triggers the DB stale data cleanup.
   */
  async triggerStaleCleanup(req: Request, res: Response): Promise<void> {
    if (!isBackgroundJobsEnabled()) {
      respondJobsDisabled(res);
      return;
    }
    log.info('Manual stale cleanup triggered via API');
    
    await runStaleCleanupJob();
    
    res.json(successResponse({ triggered: true }, 'Stale cleanup job completed'));
  }
};
