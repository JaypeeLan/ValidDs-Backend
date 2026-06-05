import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { optionalAuth, requireAuth, requireRole } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
import { successResponse } from '../../utils/response.util';
import { AppError } from '../../middleware/error.middleware';
import { ScrapeCreatorsService } from '../../services/scrapecreators.service';
import { attachMarketModels } from '../../middleware/market.middleware';
import { LiveMonitorService } from '../../services/live-monitor.service';
import { TikTokWebcastService } from '../../services/tiktok-webcast.service';
const router = Router();

router.use(optionalAuth, attachMarketModels);

/**
 * TikTok Routes
 *
 * Live discovery
 *   GET    /tiktok/live/discover         → live `LiveSession` rows from DB (read-only)
 *   POST   /tiktok/live/reconcile        → re-check open sessions via ScrapeCreators; ends rows no longer live
 *
 * One-off checks
 *   GET    /tiktok/live?handle=          → check a single handle
 *   GET    /tiktok/live/batch?handles=   → check up to 10 handles
 *
 * Sessions (GMV history)
 *   GET    /tiktok/sessions              → list all sessions (paginated)
 *   GET    /tiktok/sessions/:id          → single session detail
 */

// ────────────────────────────────────────────────────────────────────────────────
// Live discovery — manages sessions automatically
// ────────────────────────────────────────────────────────────────────────────────

router.get(
  '/live/discover',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await LiveMonitorService.getCachedLiveDiscover(req.models.LiveSession);

      res.json(
        successResponse(
          result,
          `${result.liveCount} live session${result.liveCount !== 1 ? 's' : ''} in database`,
          200,
        ),
      );
    } catch (err) {
      next(err);
    }
  },
);

/** POST /tiktok/live/reconcile — ScrapeCreators pass to end stale open sessions (same logic as hourly job) */
router.post(
  '/live/reconcile',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!ScrapeCreatorsService.isConfigured()) {
        throw new AppError(
          503,
          'Live reconciliation requires ScrapeCreators (SCRAPECREATORS_API_KEY)',
          'SCRAPECREATORS_NOT_CONFIGURED',
        );
      }
      const ended = await LiveMonitorService.reconcileOpenLiveSessions(req.models.LiveSession);
      res.json(
        successResponse(
          { ended },
          ended.length === 0
            ? 'No sessions ended; all open rows still report live'
            : `${ended.length} session(s) ended (no longer live)`,
          200,
        ),
      );
    } catch (err) {
      next(err);
    }
  },
);

// ────────────────────────────────────────────────────────────────────────────────
// One-off live checks (not tied to watchlist)
// ────────────────────────────────────────────────────────────────────────────────

const LiveQuerySchema = z.object({
  handle: z
    .string()
    .min(1, 'handle is required')
    .transform((v) => v.replace(/^@/, '').trim()),
});

router.get(
  '/live',
  requireAuth,
  requireRole('admin'),
  validate(LiveQuerySchema, 'query'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { handle } = req.query as { handle: string };
      const result = await ScrapeCreatorsService.getUserLive(handle);
      res.json(successResponse(result, 'Live status fetched', 200));
    } catch (err) {
      next(err);
    }
  },
);

const BatchQuerySchema = z.object({
  handles: z.string().min(1, 'handles is required'),
});

router.get(
  '/live/batch',
  requireAuth,
  requireRole('admin'),
  validate(BatchQuerySchema, 'query'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { handles } = req.query as { handles: string };
      const handleList = handles
        .split(',')
        .map((h) => h.trim())
        .filter(Boolean);

      if (handleList.length === 0)
        throw new AppError(400, 'At least one handle is required', 'VALIDATION_ERROR');
      if (handleList.length > 10)
        throw new AppError(400, 'Maximum 10 handles per request', 'TOO_MANY_HANDLES');

      const results = await ScrapeCreatorsService.batchGetUserLive(handleList);
      const live = results.filter((r) => r.isLive);

      res.json(
        successResponse(
          { live, liveCount: live.length, totalChecked: results.length },
          'Batch live status fetched',
          200,
        ),
      );
    } catch (err) {
      next(err);
    }
  },
);

// ────────────────────────────────────────────────────────────────────────────────
// Live product shelf — fetch products pinned to a live room via TikTok webcast API
// ────────────────────────────────────────────────────────────────────────────────

/**
 * GET /tiktok/live/products?roomId=<roomId>&handle=<handle>
 * Fetches the product shelf for an active live room directly from TikTok's
 * internal webcast API. Returns soldInLive counts (units sold in this live session).
 */
router.get(
  '/live/products',
  requireAuth,
  requireRole('admin'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const roomId = String(req.query.roomId || '').trim();
      const handle = String(req.query.handle || '')
        .replace(/^@/, '')
        .trim()
        .toLowerCase();

      if (!roomId && !handle) {
        throw new AppError(400, 'roomId or handle is required', 'VALIDATION_ERROR');
      }

      let resolvedRoomId = roomId;

      // If no roomId, try to get it from a live check
      if (!resolvedRoomId && handle) {
        if (!ScrapeCreatorsService.isConfigured()) {
          throw new AppError(
            503,
            'SCRAPECREATORS_API_KEY is not configured',
            'SCRAPECREATORS_NOT_CONFIGURED',
          );
        }
        const live = await ScrapeCreatorsService.getUserLive(handle);
        if (!live.isLive) {
          res.json(
            successResponse(
              { products: [], roomId: null },
              `@${handle} is not currently live`,
              200,
            ),
          );
          return;
        }
        resolvedRoomId = live.roomId || '';
        if (!resolvedRoomId) {
          res.json(
            successResponse(
              { products: [], roomId: null },
              'Could not determine roomId from live response',
              200,
            ),
          );
          return;
        }
      }

      const products = await TikTokWebcastService.getLiveProducts(resolvedRoomId, handle);

      res.json(
        successResponse(
          { products, roomId: resolvedRoomId, productCount: products.length },
          `${products.length} product${products.length !== 1 ? 's' : ''} in live room`,
          200,
        ),
      );
    } catch (err) {
      next(err);
    }
  },
);

// ────────────────────────────────────────────────────────────────────────────────
// Sessions — GMV history
// ────────────────────────────────────────────────────────────────────────────────

/** GET /tiktok/sessions */
router.get(
  '/sessions',
  requireAuth,
  requireRole('admin'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const LiveSessionModel = req.models.LiveSession;
      const handle = req.query.handle
        ? String(req.query.handle).replace(/^@/, '').toLowerCase()
        : undefined;
      const status = req.query.status ? String(req.query.status) : undefined;
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));

      const filter: Record<string, unknown> = {};
      if (handle) filter.handle = handle;
      if (status === 'live' || status === 'ended') filter.status = status;

      const [sessions, total] = await Promise.all([
        LiveSessionModel.find(filter)
          .sort({ startedAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        LiveSessionModel.countDocuments(filter),
      ]);

      res.json(
        successResponse(
          { sessions, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
          `${sessions.length} sessions`,
          200,
        ),
      );
    } catch (err) {
      next(err);
    }
  },
);

/** GET /tiktok/sessions/:id */
router.get(
  '/sessions/:id',
  requireAuth,
  requireRole('admin'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const session = await req.models.LiveSession.findById(req.params.id).lean();
      if (!session) throw new AppError(404, 'Session not found', 'NOT_FOUND');
      res.json(successResponse(session, 'Session detail', 200));
    } catch (err) {
      next(err);
    }
  },
);

export default router;
