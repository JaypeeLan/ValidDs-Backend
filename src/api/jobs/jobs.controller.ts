import { Request, Response } from 'express';
import { runStaleCleanupJob } from '../../jobs/product-refresh.job';
import {
  getJobsStatus,
  triggerEchoTikPipelineJob,
  triggerProductRefreshJob,
} from '../../jobs/index';
import { logger } from '../../logger';
import { successResponse } from '../../utils/response.util';

const log = logger.child({ module: 'jobs-controller' });

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
   * POST /jobs/echotik-pipeline
   * Triggers the EchoTik ingestion pipeline.
   */
  async triggerEchoTikPipeline(req: Request, res: Response): Promise<void> {
    log.info('Manual EchoTik pipeline triggered via API');

    const trigger = triggerEchoTikPipelineJob();
    if (!trigger.started) {
      res.status(409).json(successResponse({ triggered: false }, 'EchoTik pipeline already running'));
      return;
    }

    res.json(successResponse({ triggered: true }, 'EchoTik pipeline started in background'));
  },

  /**
   * POST /jobs/stale-cleanup
   * Triggers the DB stale data cleanup.
   */
  async triggerStaleCleanup(req: Request, res: Response): Promise<void> {
    log.info('Manual stale cleanup triggered via API');
    
    await runStaleCleanupJob();
    
    res.json(successResponse({ triggered: true }, 'Stale cleanup job completed'));
  }
};
