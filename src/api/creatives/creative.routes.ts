import { Router } from 'express';
import { CreativeController } from './creative.controller';
import { validate } from '../../middleware/validate.middleware';
import { requireAuth } from '../../middleware/auth.middleware';
import { attachMarketModels } from '../../middleware/market.middleware';
import { strictLimiter, mediaLimiter } from '../../middleware/rate-limit.middleware';
import {
  CreativeListQuerySchema,
  CreativeTopAdsListQuerySchema,
  CreativeIdParamSchema,
  CreativeIngestBodySchema,
  CreativeProductRelatedVideosQuerySchema,
  CreativeStreamQuerySchema,
  CreativeThumbnailQuerySchema,
} from './creative.validator';

const router = Router();

router.use(requireAuth, attachMarketModels);

/**
 * Creative Routes — JWT required on all routes.
 *
 * GET /api/v1/creatives — List creatives
 * GET /api/v1/creatives/categories — L1 categories with creatives (canonical, alias-aware)
 * GET /api/v1/creatives/top-ads — Creatives from independent creators (top ads)
 * GET /api/v1/creatives/:id — Detail
 * GET /api/v1/creatives/:id/related-videos — embedded secondary videos on this creative
 * GET /api/v1/creatives/:id/product-related-videos — other creatives for the same product
 * POST /api/v1/creatives/ingest — trigger creative discovery ingest
 */

router.post(
  '/ingest',
  strictLimiter,
  validate(CreativeIngestBodySchema, 'body'),
  CreativeController.ingest,
);

router.get('/categories', CreativeController.categories);

router.get(
  '/top-ads',
  validate(CreativeTopAdsListQuerySchema, 'query'),
  CreativeController.listTopAds,
);

router.get('/', validate(CreativeListQuerySchema, 'query'), CreativeController.list);

router.get(
  '/:id/product-related-videos',
  validate(CreativeIdParamSchema, 'params'),
  validate(CreativeProductRelatedVideosQuerySchema, 'query'),
  CreativeController.productRelatedVideos,
);

router.get(
  '/:id/related-videos',
  validate(CreativeIdParamSchema, 'params'),
  CreativeController.relatedVideos,
);

router.get('/:id', validate(CreativeIdParamSchema, 'params'), CreativeController.detail);

// Streams the TikTok CDN video through the API to bypass the CDN's
// `Referer`-required 403. Requires JWT (same as other creative routes).
router.get(
  '/:id/video',
  mediaLimiter,
  validate(CreativeIdParamSchema, 'params'),
  validate(CreativeStreamQuerySchema, 'query'),
  CreativeController.streamVideo,
);

// Same proxy trick for thumbnail / avatar images (TikTok CDN also 403s
// `<img>` requests without a Referer).
router.get(
  '/:id/thumbnail',
  mediaLimiter,
  validate(CreativeIdParamSchema, 'params'),
  validate(CreativeThumbnailQuerySchema, 'query'),
  CreativeController.streamThumbnail,
);

export default router;
