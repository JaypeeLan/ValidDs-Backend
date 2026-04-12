import { Request, Response } from 'express';
import { runProductRefreshJob, runStaleCleanupJob } from '../../jobs/product-refresh.job';
import { HashtagIngestionPipeline } from '../../ingestion/ensemble/hashtag-ingestion.pipeline';
import { getJobsStatus } from '../../jobs/index';
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
    log.info('Manual product refresh triggered via API');
    
    // We don't await this because it can take 5+ minutes
    runProductRefreshJob().catch((err) => 
      log.error('Manual product refresh failed', err)
    );

    res.json(successResponse({ triggered: true }, 'Product refresh job started in background'));
  },

  /**
   * POST /jobs/hashtag-pipeline
   * Triggers the deep hashtag ingestion pipeline.
   */
  async triggerHashtagPipeline(req: Request, res: Response): Promise<void> {
    log.info('Manual hashtag pipeline triggered via API');
    
    new HashtagIngestionPipeline().run().catch((err) => 
      log.error('Manual hashtag pipeline failed', err)
    );

    res.json(successResponse({ triggered: true }, 'Hashtag pipeline started in background'));
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
