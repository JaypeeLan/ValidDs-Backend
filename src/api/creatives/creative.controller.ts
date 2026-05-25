import { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import {
  CreativeService,
  CREATIVE_TRENDING_MATCH,
  CREATIVE_TOP_ADS_MATCH,
  findRelatedVideosByCreativeId,
} from '../../services/creative.service';
import { CreativeListQuery, CreativeTopAdsListQuery, CreativeIngestBody } from './creative.validator';
import { ResponseMessage, successResponse } from '../../utils/response.util';
import { NotFoundError } from '../../middleware/error.middleware';
import { Creative } from '../../models/creative.model';
import {
  pickCreativeStreamVideoUrl,
  pickCreativeThumbnailUrl,
} from '../../utils/creative-response.util';
import { logger } from '../../logger';

const log = logger.child({ module: 'creative-controller' });

// ── Lazy refresh dedupe ──────────────────────────────────────────────────────
// When a stored TikTok CDN URL rejects our proxy request (signature expired),
// we kick off a background refresh of that single slot.
// A short-lived in-memory dedupe map prevents us from firing the same refresh
// repeatedly if many requests hit the expired URL concurrently.
const REFRESH_DEDUPE_TTL_MS = 2 * 60 * 1000; // 2 min
const inFlightRefreshes = new Map<string, number>();

function shouldTriggerRefresh(key: string): boolean {
  const now = Date.now();
  const seenAt = inFlightRefreshes.get(key);
  if (typeof seenAt === 'number' && now - seenAt < REFRESH_DEDUPE_TTL_MS) return false;
  inFlightRefreshes.set(key, now);
  // Opportunistic cleanup so the map doesn't grow forever.
  if (inFlightRefreshes.size > 1000) {
    for (const [k, v] of inFlightRefreshes.entries()) {
      if (now - v >= REFRESH_DEDUPE_TTL_MS) inFlightRefreshes.delete(k);
    }
  }
  return true;
}

function triggerLazyRefresh(creativeId: string, index: number, reason: string): void {
  const key = `${creativeId}:${index}`;
  if (!shouldTriggerRefresh(key)) return;
  log.info('Triggering lazy creative media refresh', { creativeId, index, reason });
  void CreativeService.refreshCreativeMedia(creativeId, index)
    .catch((err) => log.warn('Lazy creative refresh failed', { creativeId, index, err: String(err) }));
}

// Headers the TikTok CDN requires; without `Referer` the CDN returns 403.
const TIKTOK_PROXY_HEADERS: Record<string, string> = {
  Referer: 'https://www.tiktok.com/',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
};

export const CreativeController = {
  /**
   * Retrieves a paginated list of creatives with filters.
   * GET /api/v1/creatives
   */
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = req.query as unknown as CreativeListQuery;
      const listMatch = query.section ? undefined : CREATIVE_TRENDING_MATCH;
      const result = await CreativeService.findCreatives(query, listMatch, req.models?.Creative);

      res.json(
        successResponse(
          result,
          ResponseMessage.CREATIVES_RETRIEVED,
          200
        )
      );
    } catch (err) {
      next(err);
    }
  },

  /**
   * Paginated paid / top-ad creatives only.
   * GET /api/v1/creatives/top-ads
   */
  async listTopAds(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = req.query as unknown as CreativeTopAdsListQuery;
      const result = await CreativeService.findCreatives(query, CREATIVE_TOP_ADS_MATCH, req.models?.Creative);

      res.json(
        successResponse(
          result,
          ResponseMessage.CREATIVES_RETRIEVED,
          200
        )
      );
    } catch (err) {
      next(err);
    }
  },

  /**
   * Retrieves detailed information for a single creative.
   * GET /api/v1/creatives/:id
   */
  async relatedVideos(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const relatedVideos = await findRelatedVideosByCreativeId(id, req.models?.Creative);

      if (relatedVideos === null) {
        throw new NotFoundError('Creative not found');
      }

      res.json(
        successResponse(
          { relatedVideos },
          ResponseMessage.CREATIVES_RETRIEVED,
          200,
        ),
      );
    } catch (err) {
      next(err);
    }
  },

  async detail(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const creative = await CreativeService.getCreativeById(id, req.models?.Creative);

      if (!creative) {
        throw new NotFoundError('Creative not found');
      }

      res.json(
        successResponse(
          { creative },
          ResponseMessage.CREATIVE_RETRIEVED,
          200
        )
      );
    } catch (err) {
      next(err);
    }
  },
  /**
   * Streams a creative's TikTok video through this server so browsers can play
   * it without hitting the TikTok CDN's `Referer`-required 403.
   *
   * GET /api/v1/creatives/:id/video?index=0
   *   index=0 → primary video (default)
   *   index=N → relatedVideos[N-1]
   *
   * Implementation notes:
   * - We forward the client's `Range` header so the browser can seek mid-video.
   * - We copy `Content-Type`, `Content-Length`, `Content-Range`, `Accept-Ranges`
   *   and the upstream status code (200 vs 206) back to the client.
   * - TikTok CDN URLs are signed and expire (typically a few hours). When the
   *   stored URL 403s/410s, we report 410 Gone so the frontend can fall back
   *   to the iframe `embedUrl` we ship in the JSON response.
   */
  async streamVideo(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const indexRaw = req.query.index;
      const index = Number.isFinite(Number(indexRaw)) ? Math.max(0, Math.floor(Number(indexRaw))) : 0;

      const creativeModel = req.models?.Creative ?? Creative;
      const creative = await creativeModel.findById(id).lean();
      if (!creative) throw new NotFoundError('Creative not found');

      const url = pickCreativeStreamVideoUrl(creative as Record<string, unknown>, index);
      if (!url) {
        res.status(404).json({ error: 'No playable video for this creative' });
        return;
      }

      const headers: Record<string, string> = { ...TIKTOK_PROXY_HEADERS };
      if (typeof req.headers.range === 'string') headers.Range = req.headers.range;

      const upstream = await axios.get(url, {
        headers,
        responseType: 'stream',
        timeout: 15_000,
        validateStatus: (s) => s < 500, // pass 4xx through so we can translate
        maxRedirects: 5,
      });

      if (upstream.status === 403 || upstream.status === 410 || upstream.status === 404) {
        log.debug('TikTok CDN rejected stored video URL', { id, status: upstream.status });
        upstream.data?.destroy?.();
        triggerLazyRefresh(id, index, `video-${upstream.status}`);
        res.status(410).json({
          error: 'Video URL has expired. A refresh has been triggered; retry shortly.',
          code: 'VIDEO_URL_EXPIRED',
        });
        return;
      }

      const passthrough = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag'];
      for (const h of passthrough) {
        const v = upstream.headers[h];
        if (typeof v === 'string') res.setHeader(h, v);
      }
      if (!upstream.headers['content-type']) res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Cache-Control', 'public, max-age=3600');

      res.status(upstream.status);

      req.on('close', () => upstream.data?.destroy?.());
      upstream.data.on('error', (err: Error) => {
        log.warn('Video stream error', { id, err: err.message });
        if (!res.headersSent) res.status(502);
        res.end();
      });
      upstream.data.pipe(res);
    } catch (err) {
      next(err);
    }
  },

  /**
   * Streams a creative's TikTok thumbnail / avatar through this server. Same
   * `Referer`-injection trick as `streamVideo` — TikTok's image CDN also 403s
   * `<img>` requests that come from a non-TikTok origin.
   *
   * GET /api/v1/creatives/:id/thumbnail?index=0&kind=thumbnail|avatar
   */
  async streamThumbnail(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const indexRaw = req.query.index;
      const index = Number.isFinite(Number(indexRaw)) ? Math.max(0, Math.floor(Number(indexRaw))) : 0;
      const kind = req.query.kind === 'avatar' ? 'avatar' : 'thumbnail';

      const creativeModel = req.models?.Creative ?? Creative;
      const creative = await creativeModel.findById(id).lean();
      if (!creative) throw new NotFoundError('Creative not found');

      const url = pickCreativeThumbnailUrl(creative as Record<string, unknown>, index, kind);
      if (!url) {
        res.status(404).json({ error: 'No image for this creative slot' });
        return;
      }

      const upstream = await axios.get(url, {
        headers: TIKTOK_PROXY_HEADERS,
        responseType: 'stream',
        timeout: 10_000,
        validateStatus: (s) => s < 500,
        maxRedirects: 5,
      });

      if (upstream.status >= 400) {
        upstream.data?.destroy?.();
        triggerLazyRefresh(id, index, `thumbnail-${upstream.status}-${kind}`);
        res.status(404).json({ error: 'Image not available', code: 'IMAGE_NOT_AVAILABLE' });
        return;
      }

      const ct = upstream.headers['content-type'];
      res.setHeader('Content-Type', typeof ct === 'string' ? ct : 'image/jpeg');
      const cl = upstream.headers['content-length'];
      if (typeof cl === 'string') res.setHeader('Content-Length', cl);
      // Thumbnails change rarely once a video is published — cache aggressively.
      res.setHeader('Cache-Control', 'public, max-age=86400, immutable');

      res.status(200);
      req.on('close', () => upstream.data?.destroy?.());
      upstream.data.on('error', (err: Error) => {
        log.warn('Thumbnail stream error', { id, err: err.message });
        if (!res.headersSent) res.status(502);
        res.end();
      });
      upstream.data.pipe(res);
    } catch (err) {
      next(err);
    }
  },

  /**
   * Standalone creative ingestion by keyword.
   * POST /api/v1/creatives/ingest
   */
  async ingest(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { keyword, limit, period, country } = req.body as CreativeIngestBody;
      const result = await CreativeService.ingestByKeyword(keyword, { limit, period, country });

      res.status(201).json(
        successResponse(
          result,
          ResponseMessage.CREATIVES_INGESTED,
          201
        )
      );
    } catch (err) {
      next(err);
    }
  },
};
