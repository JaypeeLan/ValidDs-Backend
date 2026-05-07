import { Router } from 'express';
import { IngestionController } from './ingestion.controller';
import { requireAuth } from '../../middleware/auth.middleware';

const router = Router();

/**
 * Ingestion Admin Routes
 *
 * Provides endpoint for ingestion control.
 */

router.post('/trigger', requireAuth, IngestionController.trigger);

export default router;
