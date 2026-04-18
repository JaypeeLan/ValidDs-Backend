import { Router } from 'express';
import { CreativeController } from './creative.controller';
import { validate } from '../../middleware/validate.middleware';
import { requireAuth } from '../../middleware/auth.middleware';
import { CreativeListQuerySchema, CreativeIdParamSchema, CreativeIngestBodySchema } from './creative.validator';

const router = Router();

/**
 * Creative Routes
 *
 * GET /api/v1/creatives — List creatives (public discovery)
 * GET /api/v1/creatives/:id — Detail (public)
 * POST /api/v1/creatives/ingest — requires JWT
 */

router.post(
  '/ingest',
  requireAuth,
  validate(CreativeIngestBodySchema, 'body'),
  CreativeController.ingest
);

router.get(
  '/',
  validate(CreativeListQuerySchema, 'query'),
  CreativeController.list
);

router.get(
  '/:id',
  validate(CreativeIdParamSchema, 'params'),
  CreativeController.detail
);

export default router;
