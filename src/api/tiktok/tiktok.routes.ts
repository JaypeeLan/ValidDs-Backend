import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
import { successResponse } from '../../utils/response.util';
import { AppError } from '../../middleware/error.middleware';
import { ScrapeCreatorsService } from '../../services/scrapecreators.service';
import { LiveMonitorService } from '../../services/live-monitor.service';
import { TikTokWebcastService } from '../../services/tiktok-webcast.service';
import { TrackedStore } from '../../models/tracked-store.model';
import { LiveSession } from '../../models/live-session.model';
import { logger } from '../../logger';

const log = logger.child({ module: 'tiktok-routes' });
const router = Router();

/**
 * TikTok Routes
 *
 * Tracked stores (watchlist) — admin JWT
 *   GET    /tiktok/stores                → list all tracked stores
 *   POST   /tiktok/stores                → add a store by handle
 *   GET    /tiktok/stores/:handle        → store detail + recent sessions
 *   PATCH  /tiktok/stores/:handle        → update notes/tags/isActive
 *   DELETE /tiktok/stores/:handle        → remove from watchlist
 *
 * Live discovery (uses tracked stores watchlist)
 *   GET    /tiktok/live/discover         → live `LiveSession` rows from DB (hourly job syncs via external API)
 *   POST   /tiktok/live/watchlist        → add a handle to the watchlist (any signed-in user; same as POST /stores body)
 *
 * One-off checks (no watchlist needed)
 *   GET    /tiktok/live?handle=          → check a single handle
 *   GET    /tiktok/live/batch?handles=   → check up to 10 handles
 *
 * Sessions (GMV history)
 *   GET    /tiktok/sessions              → list all sessions (paginated)
 *   GET    /tiktok/sessions/:id          → single session detail
 */

// ────────────────────────────────────────────────────────────────────────────────
// Tracked stores — CRUD
// ────────────────────────────────────────────────────────────────────────────────

const AddStoreSchema = z.object({
  handle:      z.string().min(1).transform((v) => v.replace(/^@/, '').trim().toLowerCase()),
  displayName: z.string().optional(),
  notes:       z.string().optional(),
  tags:        z.array(z.string()).optional(),
  shopUrl:     z.string().url().optional(),
});

const UpdateStoreSchema = z.object({
  displayName: z.string().optional(),
  notes:       z.string().optional(),
  tags:        z.array(z.string()).optional(),
  shopUrl:     z.string().url().optional().nullable(),
  isActive:    z.boolean().optional(),
});

/** Create a `TrackedStore` watchlist row (or return existing). Shared by admin POST /stores and user POST /live/watchlist. */
async function addTrackedStoreFromBody(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { handle, displayName, notes, tags, shopUrl } = req.body as z.infer<typeof AddStoreSchema>;

    const existing = await TrackedStore.findOne({ handle });
    if (existing) {
      await LiveMonitorService.probeWatchlistHandle(handle);
      res.json(successResponse(existing, 'Store already in watchlist', 200));
      return;
    }

    const profileData: Record<string, unknown> = {};

    if (ScrapeCreatorsService.isConfigured()) {
      const info = await ScrapeCreatorsService.getUserInfo(handle).catch(() => null);
      if (info) {
        if (info.id)             profileData.tiktokUserId   = info.id;
        const resolvedName = displayName || info.nickname;
        if (resolvedName)        profileData.displayName    = resolvedName;
        if (info.bio)            profileData.bio            = info.bio;
        if (info.avatarThumb)    profileData.avatarThumb    = info.avatarThumb;
        if (info.avatarMedium)   profileData.avatarMedium   = info.avatarMedium;
        if (info.avatarLarger)   profileData.avatarLarger   = info.avatarLarger;
        if (info.verified)       profileData.verified       = info.verified;
        if (info.privateAccount) profileData.privateAccount = info.privateAccount;
        if (info.hasShop)        profileData.hasShop        = info.hasShop;
        if (info.region)         profileData.region         = info.region;
        if (info.language)       profileData.language       = info.language;
        if (info.followerCount)  profileData.followerCount  = info.followerCount;
        if (info.followingCount) profileData.followingCount = info.followingCount;
        if (info.videoCount)     profileData.videoCount     = info.videoCount;
        if (info.heartCount)     profileData.heartCount     = info.heartCount;
        if (info.diggCount)      profileData.diggCount      = info.diggCount;
        if (info.engagementRate) profileData.engagementRate = info.engagementRate;
        if (info.shopId)         profileData.shopId         = info.shopId;
        if (info.shopRegion)     profileData.shopRegion     = info.shopRegion;
        profileData.profileFetchedAt = new Date();
      }
    }

    const store = await TrackedStore.create({
      handle,
      ...profileData,
      ...(displayName ? { displayName } : {}),
      ...(notes       ? { notes }       : {}),
      ...(tags?.length ? { tags }       : {}),
      shopUrl: shopUrl || `https://www.tiktok.com/@${handle}/shop`,
      addedBy: (req as { user?: { _id?: unknown } }).user?._id,
    });

    await LiveMonitorService.probeWatchlistHandle(handle);

    log.info('Tracked store added', { handle, hasProfile: Object.keys(profileData).length > 0 });
    res.status(201).json(successResponse(store, 'Store added to watchlist', 201));
  } catch (err) {
    next(err);
  }
}

/** GET /tiktok/stores */
router.get('/stores', requireAuth, requireRole('admin'), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const stores = await TrackedStore.find().sort({ lastLiveAt: -1, createdAt: -1 }).lean();
    res.json(successResponse(stores, `${stores.length} tracked stores`, 200));
  } catch (err) { next(err); }
});

/** POST /tiktok/stores */
router.post(
  '/stores',
  requireAuth,
  requireRole('admin'),
  validate(AddStoreSchema, 'body'),
  addTrackedStoreFromBody,
);

/** GET /tiktok/stores/:handle */
router.get('/stores/:handle', requireAuth, requireRole('admin'), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const handle = req.params.handle.replace(/^@/, '').toLowerCase();
    const store  = await TrackedStore.findOne({ handle }).lean();
    if (!store) throw new AppError(404, 'Store not in watchlist', 'NOT_FOUND');

    const sessions = await LiveSession.find({ handle })
      .sort({ startedAt: -1 })
      .limit(20)
      .lean();

    res.json(successResponse({ store, sessions }, 'Store detail', 200));
  } catch (err) { next(err); }
});

/** PATCH /tiktok/stores/:handle */
router.patch(
  '/stores/:handle',
  requireAuth,
  requireRole('admin'),
  validate(UpdateStoreSchema, 'body'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const handle  = req.params.handle.replace(/^@/, '').toLowerCase();
      const updates = req.body as z.infer<typeof UpdateStoreSchema>;
      const store   = await TrackedStore.findOneAndUpdate({ handle }, { $set: updates }, { new: true });
      if (!store) throw new AppError(404, 'Store not in watchlist', 'NOT_FOUND');
      res.json(successResponse(store, 'Store updated', 200));
    } catch (err) { next(err); }
  }
);

/** POST /tiktok/stores/:handle/refresh — re-fetch profile from ScrapeCreators */
router.post('/stores/:handle/refresh', requireAuth, requireRole('admin'), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const handle = req.params.handle.replace(/^@/, '').toLowerCase();
    const store  = await TrackedStore.findOne({ handle });
    if (!store) throw new AppError(404, 'Store not in watchlist', 'NOT_FOUND');

    if (!ScrapeCreatorsService.isConfigured()) {
      throw new AppError(503, 'SCRAPECREATORS_API_KEY is not configured', 'SCRAPECREATORS_NOT_CONFIGURED');
    }

    const info = await ScrapeCreatorsService.getUserInfo(handle);
    if (!info) {
      res.json(successResponse(store, 'Profile fetch returned no data — handle may not exist', 200));
      return;
    }

    const updates: Record<string, unknown> = { profileFetchedAt: new Date() };
    if (info.id)             updates.tiktokUserId   = info.id;
    if (info.nickname)       updates.displayName    = info.nickname;
    if (info.bio)            updates.bio            = info.bio;
    if (info.avatarThumb)    updates.avatarThumb    = info.avatarThumb;
    if (info.avatarMedium)   updates.avatarMedium   = info.avatarMedium;
    if (info.avatarLarger)   updates.avatarLarger   = info.avatarLarger;
    if (info.verified        != null) updates.verified       = info.verified;
    if (info.privateAccount  != null) updates.privateAccount = info.privateAccount;
    if (info.hasShop         != null) updates.hasShop        = info.hasShop;
    if (info.region)         updates.region         = info.region;
    if (info.language)       updates.language       = info.language;
    if (info.followerCount)  updates.followerCount  = info.followerCount;
    if (info.followingCount) updates.followingCount = info.followingCount;
    if (info.videoCount)     updates.videoCount     = info.videoCount;
    if (info.heartCount)     updates.heartCount     = info.heartCount;
    if (info.diggCount)      updates.diggCount      = info.diggCount;
    if (info.engagementRate) updates.engagementRate = info.engagementRate;
    if (info.shopId)         updates.shopId         = info.shopId;
    if (info.shopRegion)     updates.shopRegion     = info.shopRegion;

    const updated = await TrackedStore.findOneAndUpdate({ handle }, { $set: updates }, { new: true });
    log.info('Store profile refreshed', { handle });
    res.json(successResponse(updated, 'Profile refreshed', 200));
  } catch (err) { next(err); }
});

/** DELETE /tiktok/stores/:handle */
router.delete('/stores/:handle', requireAuth, requireRole('admin'), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const handle = req.params.handle.replace(/^@/, '').toLowerCase();
    const store  = await TrackedStore.findOneAndDelete({ handle });
    if (!store) throw new AppError(404, 'Store not in watchlist', 'NOT_FOUND');
    log.info('Tracked store removed', { handle });
    res.json(successResponse({ handle }, 'Store removed from watchlist', 200));
  } catch (err) { next(err); }
});

// ────────────────────────────────────────────────────────────────────────────────
// Live discovery — uses tracked stores, manages sessions automatically
// ────────────────────────────────────────────────────────────────────────────────

router.get(
  '/live/discover',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await LiveMonitorService.getCachedLiveDiscover();

      res.json(successResponse(
        result,
        `${result.liveCount} live session${result.liveCount !== 1 ? 's' : ''} in database`,
        200
      ));
    } catch (err) { next(err); }
  }
);

/** POST /tiktok/live/watchlist — same watchlist as admin POST /stores; any authenticated user */
router.post(
  '/live/watchlist',
  requireAuth,
  validate(AddStoreSchema, 'body'),
  addTrackedStoreFromBody,
);

// ────────────────────────────────────────────────────────────────────────────────
// One-off live checks (not tied to watchlist)
// ────────────────────────────────────────────────────────────────────────────────

const LiveQuerySchema = z.object({
  handle: z.string().min(1, 'handle is required').transform((v) => v.replace(/^@/, '').trim()),
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
    } catch (err) { next(err); }
  }
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
      const handleList  = handles.split(',').map((h) => h.trim()).filter(Boolean);

      if (handleList.length === 0)  throw new AppError(400, 'At least one handle is required', 'VALIDATION_ERROR');
      if (handleList.length > 10)   throw new AppError(400, 'Maximum 10 handles per request',  'TOO_MANY_HANDLES');

      const results = await ScrapeCreatorsService.batchGetUserLive(handleList);
      const live    = results.filter((r) => r.isLive);

      res.json(successResponse(
        { live, liveCount: live.length, totalChecked: results.length },
        'Batch live status fetched',
        200
      ));
    } catch (err) { next(err); }
  }
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
      const handle = String(req.query.handle || '').replace(/^@/, '').trim().toLowerCase();

      if (!roomId && !handle) {
        throw new AppError(400, 'roomId or handle is required', 'VALIDATION_ERROR');
      }

      let resolvedRoomId = roomId;

      // If no roomId, try to get it from a live check
      if (!resolvedRoomId && handle) {
        if (!ScrapeCreatorsService.isConfigured()) {
          throw new AppError(503, 'SCRAPECREATORS_API_KEY is not configured', 'SCRAPECREATORS_NOT_CONFIGURED');
        }
        const live = await ScrapeCreatorsService.getUserLive(handle);
        if (!live.isLive) {
          res.json(successResponse({ products: [], roomId: null }, `@${handle} is not currently live`, 200));
          return;
        }
        resolvedRoomId = live.roomId || '';
        if (!resolvedRoomId) {
          res.json(successResponse({ products: [], roomId: null }, 'Could not determine roomId from live response', 200));
          return;
        }
      }

      const products = await TikTokWebcastService.getLiveProducts(resolvedRoomId, handle);

      res.json(successResponse(
        { products, roomId: resolvedRoomId, productCount: products.length },
        `${products.length} product${products.length !== 1 ? 's' : ''} in live room`,
        200
      ));
    } catch (err) { next(err); }
  }
);

// ────────────────────────────────────────────────────────────────────────────────
// Sessions — GMV history
// ────────────────────────────────────────────────────────────────────────────────

/** GET /tiktok/sessions */
router.get('/sessions', requireAuth, requireRole('admin'), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const handle  = req.query.handle  ? String(req.query.handle).replace(/^@/, '').toLowerCase() : undefined;
    const status  = req.query.status  ? String(req.query.status)  : undefined;
    const page    = Math.max(1, Number(req.query.page)  || 1);
    const limit   = Math.min(50, Math.max(1, Number(req.query.limit) || 20));

    const filter: Record<string, unknown> = {};
    if (handle) filter.handle = handle;
    if (status === 'live' || status === 'ended') filter.status = status;

    const [sessions, total] = await Promise.all([
      LiveSession.find(filter)
        .sort({ startedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      LiveSession.countDocuments(filter),
    ]);

    res.json(successResponse(
      { sessions, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
      `${sessions.length} sessions`,
      200
    ));
  } catch (err) { next(err); }
});

/** GET /tiktok/sessions/:id */
router.get('/sessions/:id', requireAuth, requireRole('admin'), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const session = await LiveSession.findById(req.params.id).lean();
    if (!session) throw new AppError(404, 'Session not found', 'NOT_FOUND');
    res.json(successResponse(session, 'Session detail', 200));
  } catch (err) { next(err); }
});

export default router;
