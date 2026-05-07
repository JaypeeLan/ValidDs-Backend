import { Router } from 'express';
import { IngestionController } from './ingestion.controller';
import { requireAuth } from '../../middleware/auth.middleware';

const router = Router();

/**
 * Ingestion Admin Routes
 *
 * Provides endpoints to trigger jobs for downloading trending products,
 * parsing with EnsembleData/RapidAPI, and extracting info using DeepSeek.
 */

router.post('/trigger', requireAuth, IngestionController.trigger);

export default router;
