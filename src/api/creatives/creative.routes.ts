import { Router } from 'express';
import { CreativeController } from './creative.controller';
import { validate } from '../../middleware/validate.middleware';
import { requireAuth } from '../../middleware/auth.middleware';
import { CreativeListQuerySchema, CreativeIdParamSchema, CreativeIngestBodySchema } from './creative.validator';

const router = Router();

/**
 * Creative Routes
 * 
 * GET /api/v1/creatives      — List all creatives with filters
 * POST /api/v1/creatives/ingest — Standalone ingestion of creatives by keyword
 * GET /api/v1/creatives/:id  — Get detail for a single creative
 */

router.post(
  '/ingest',
  requireAuth,
  validate(CreativeIngestBodySchema, 'body'),
  CreativeController.ingest
);

router.get(
  '/',
  requireAuth,
  validate(CreativeListQuerySchema, 'query'),
  CreativeController.list
);

router.get(
  '/:id',
  requireAuth,
  validate(CreativeIdParamSchema, 'params'),
  CreativeController.detail
);

export default router;
