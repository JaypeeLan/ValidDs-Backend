import { Router } from 'express';
import { JobsController } from './jobs.controller';
import { requireApiKey } from '../../middleware/auth.middleware';

const router = Router();

/**
 * Background Job Management Routes
 * 
 * Provides endpoints to check and trigger background jobs.
 * Authentication: Requires X-API-Key header with INTERNAL_API_KEY value.
 */

// Status endpoint - good for monitoring if timers are still alive
router.get('/status', requireApiKey, JobsController.getStatus);

// Ingestion triggers - use these to run jobs externally via cron-job.org
router.post('/product-refresh', requireApiKey, JobsController.triggerProductRefresh);
router.post('/product-ingestion', requireApiKey, JobsController.triggerProductIngestion);
router.post('/creative-ingestion', requireApiKey, JobsController.triggerCreativeIngestion);
router.post('/stale-cleanup', requireApiKey, JobsController.triggerStaleCleanup);

// GET warnings — helps users diagnose misconfigured cron jobs (which default to GET)
router.get('/product-refresh', JobsController.getMethodWarning);
router.get('/product-ingestion', JobsController.getMethodWarning);
router.get('/creative-ingestion', JobsController.getMethodWarning);
router.get('/stale-cleanup', JobsController.getMethodWarning);


export default router;
