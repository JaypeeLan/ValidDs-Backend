import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
import { successResponse } from '../../utils/response.util';
import { AppError } from '../../middleware/error.middleware';
import { ScrapeCreatorsService } from '../../services/scrapecreators.service';
import { Product } from '../../models/product.model';
import { logger } from '../../logger';

const log = logger.child({ module: 'tiktok-routes' });
const router = Router();

/**
 * TikTok Routes — ScrapeCreators integration
 *
 * GET  /tiktok/live/discover          → Auto-check all known product creators, return live ones
 * GET  /tiktok/live?handle=<username> → Check a single creator
 * GET  /tiktok/live/batch?handles=    → Check up to 10 specific handles
 */

// ── Discover: who from our product creators is live right now? ────────────────

router.get(
  '/live/discover',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!ScrapeCreatorsService.isConfigured()) {
        throw new AppError(503, 'SCRAPECREATORS_API_KEY is not configured', 'SCRAPECREATORS_NOT_CONFIGURED');
      }

      // Pull distinct creator handles from products (only ones with a handle)
      const limit = Math.min(Number(req.query.limit) || 50, 100);
      const handles: string[] = await Product.distinct('primaryCreator.handle', {
        'primaryCreator.handle': { $exists: true, $ne: '' },
      });

      if (handles.length === 0) {
        res.json(successResponse(
          { live: [], liveCount: 0, totalChecked: 0 },
          'No creator handles found in products',
          200
        ));
        return;
      }

      // Cap at `limit` handles, deduplicated
      const unique = [...new Set(handles.map((h) => h.toLowerCase()))].slice(0, limit);
      log.info('TikTok live discover: checking handles', { count: unique.length });

      // Batch in groups of 10 (ScrapeCreators parallel limit)
      const BATCH = 10;
      const allResults = [];
      for (let i = 0; i < unique.length; i += BATCH) {
        const chunk = unique.slice(i, i + BATCH);
        const results = await ScrapeCreatorsService.batchGetUserLive(chunk);
        allResults.push(...results);
      }

      const live = allResults.filter((r) => r.isLive);

      res.json(successResponse(
        { live, liveCount: live.length, totalChecked: allResults.length },
        `${live.length} creator${live.length !== 1 ? 's' : ''} live`,
        200
      ));
    } catch (err) {
      next(err);
    }
  }
);

// ── Single handle ─────────────────────────────────────────────────────────────

const LiveQuerySchema = z.object({
  handle: z.string().min(1, 'handle is required').transform((v) => v.replace(/^@/, '').trim()),
});

router.get(
  '/live',
  requireAuth,
  validate(LiveQuerySchema, 'query'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { handle } = req.query as { handle: string };
      const result = await ScrapeCreatorsService.getUserLive(handle);
      res.json(successResponse(result, 'Live status fetched', 200));
    } catch (err) {
      next(err);
    }
  }
);

// ── Batch handles ─────────────────────────────────────────────────────────────

const BatchQuerySchema = z.object({
  handles: z.string().min(1, 'handles is required'),
});

router.get(
  '/live/batch',
  requireAuth,
  validate(BatchQuerySchema, 'query'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { handles } = req.query as { handles: string };
      const handleList = handles.split(',').map((h) => h.trim()).filter(Boolean);

      if (handleList.length === 0) {
        throw new AppError(400, 'At least one handle is required', 'VALIDATION_ERROR');
      }
      if (handleList.length > 10) {
        throw new AppError(400, 'Maximum 10 handles per request', 'TOO_MANY_HANDLES');
      }

      const results = await ScrapeCreatorsService.batchGetUserLive(handleList);
      const live = results.filter((r) => r.isLive);

      res.json(successResponse(
        { live, liveCount: live.length, totalChecked: results.length },
        'Batch live status fetched',
        200
      ));
    } catch (err) {
      next(err);
    }
  }
);

export default router;
