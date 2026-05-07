import { Router } from 'express';
import { CreativeController } from './creative.controller';
import { validate } from '../../middleware/validate.middleware';
import { requireAuth } from '../../middleware/auth.middleware';
import {
  CreativeListQuerySchema,
  CreativeIdParamSchema,
  CreativeIngestBodySchema,
  CreativeStreamQuerySchema,
  CreativeThumbnailQuerySchema,
} from './creative.validator';

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

// Streams the TikTok CDN video through the API to bypass the CDN's
// `Referer`-required 403. Public so <video> tags can hit it directly.
router.get(
  '/:id/video',
  validate(CreativeIdParamSchema, 'params'),
  validate(CreativeStreamQuerySchema, 'query'),
  CreativeController.streamVideo
);

// Same proxy trick for thumbnail / avatar images (TikTok CDN also 403s
// `<img>` requests without a Referer).
router.get(
  '/:id/thumbnail',
  validate(CreativeIdParamSchema, 'params'),
  validate(CreativeThumbnailQuerySchema, 'query'),
  CreativeController.streamThumbnail
);

export default router;
