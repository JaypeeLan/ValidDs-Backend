import { Router } from 'express';
import { CreativeController } from './creative.controller';
import { validate } from '../../middleware/validate.middleware';
import { requireAuth } from '../../middleware/auth.middleware';
import { CreativeListQuerySchema, CreativeIdParamSchema } from './creative.validator';

const router = Router();

/**
 * Creative Routes
 * 
 * GET /api/v1/creatives      — List all creatives with filters
 * GET /api/v1/creatives/:id  — Get detail for a single creative
 */

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
