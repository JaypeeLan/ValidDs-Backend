import { Router } from 'express';
import { CreativeController } from './creative.controller';
import { validate } from '../../middleware/validate.middleware';
import { optionalAuth, requireAuth } from '../../middleware/auth.middleware';
import { attachMarketModels } from '../../middleware/market.middleware';
import { strictLimiter, mediaLimiter } from '../../middleware/rate-limit.middleware';
import {
  CreativeListQuerySchema,
  CreativeTopAdsListQuerySchema,
  CreativeIdParamSchema,
  CreativeIngestBodySchema,
  CreativeStreamQuerySchema,
  CreativeThumbnailQuerySchema,
} from './creative.validator';

const router = Router();

router.use(optionalAuth, attachMarketModels);

/**
 * Creative Routes
 *
 * GET /api/v1/creatives — List creatives (public discovery)
 * GET /api/v1/creatives/top-ads — Creatives from independent creators (top ads)
 * GET /api/v1/creatives/:id — Detail (public)
 * GET /api/v1/creatives/:id/related-videos — embedded secondary videos on this creative
 * POST /api/v1/creatives/ingest — requires JWT
 */

router.post(
  '/ingest',
  strictLimiter,
  requireAuth,
  validate(CreativeIngestBodySchema, 'body'),
  CreativeController.ingest
);

router.get(
  '/top-ads',
  validate(CreativeTopAdsListQuerySchema, 'query'),
  CreativeController.listTopAds
);

router.get(
  '/',
  validate(CreativeListQuerySchema, 'query'),
  CreativeController.list
);

router.get(
  '/:id/related-videos',
  validate(CreativeIdParamSchema, 'params'),
  CreativeController.relatedVideos,
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
  mediaLimiter,
  validate(CreativeIdParamSchema, 'params'),
  validate(CreativeStreamQuerySchema, 'query'),
  CreativeController.streamVideo
);

// Same proxy trick for thumbnail / avatar images (TikTok CDN also 403s
// `<img>` requests without a Referer).
router.get(
  '/:id/thumbnail',
  mediaLimiter,
  validate(CreativeIdParamSchema, 'params'),
  validate(CreativeThumbnailQuerySchema, 'query'),
  CreativeController.streamThumbnail
);

export default router;
