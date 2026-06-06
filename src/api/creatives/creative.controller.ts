import { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import {
  CreativeService,
  CREATIVE_TRENDING_MATCH,
  CREATIVE_TOP_ADS_MATCH,
  findRelatedVideosByCreativeId,
} from '../../services/creative.service';
import {
  CreativeListQuery,
  CreativeTopAdsListQuery,
  CreativeIngestBody,
} from './creative.validator';
import { ResponseMessage, successResponse } from '../../utils/response.util';
import { NotFoundError } from '../../middleware/error.middleware';
import { Creative } from '../../models/creative.model';
import { pickCreativeStreamVideoUrl } from '../../utils/creative-response.util';
import { resolveCreativeVideoS3Key } from '../../services/meta-video-s3-resolve.service';
import {
  collectThumbnailProxyCandidates,
  sendImagePlaceholder,
} from '../../utils/creative-image-proxy.util';
import {
  pickCreatorAvatarS3Key,
  TIKTOK_CDN_HEADERS,
  TIKTOK_IMAGE_HEADERS,
} from '../../utils/creator-avatar.util';
import {
  persistCreatorAvatarOnCreative,
  persistShopAvatarOnCreative,
  streamCreatorAvatarFromS3,
  streamShopAvatarFromS3,
} from '../../services/creator-avatar-cache.service';
import { getS3VideoObject, isS3VideoConfigured } from '../../utils/s3-video.util';
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
  void CreativeService.refreshCreativeMedia(creativeId, index).catch((err) =>
    log.warn('Lazy creative refresh failed', { creativeId, index, err: String(err) }),
  );
}

async function fetchProxiedImage(url: string) {
  return axios.get(url, {
    headers: TIKTOK_IMAGE_HEADERS,
    responseType: 'stream',
    timeout: 10_000,
    validateStatus: (s) => s < 500,
    maxRedirects: 5,
  });
}

async function streamFirstAvailableImage(
  req: Request,
  res: Response,
  urls: string[],
  creativeId: string,
): Promise<boolean> {
  for (const url of urls) {
    let upstream: Awaited<ReturnType<typeof fetchProxiedImage>> | undefined;
    try {
      upstream = await fetchProxiedImage(url);
      if (upstream.status < 400) {
        pipeImageUpstream(req, res, upstream, creativeId);
        return true;
      }
      upstream.data?.destroy?.();
    } catch (err) {
      upstream?.data?.destroy?.();
      log.debug('Image proxy fetch failed', {
        creativeId,
        url: url.slice(0, 80),
        err: String(err),
      });
    }
  }
  return false;
}

function pipeS3Image(
  req: Request,
  res: Response,
  s3Obj: NonNullable<Awaited<ReturnType<typeof streamCreatorAvatarFromS3>>>,
  id: string,
): void {
  res.setHeader('Content-Type', s3Obj.contentType);
  if (s3Obj.contentLength != null) res.setHeader('Content-Length', String(s3Obj.contentLength));
  res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
  res.setHeader('X-Image-Source', 's3');
  res.status(s3Obj.statusCode);
  req.on('close', () => s3Obj.body.destroy?.());
  s3Obj.body.on('error', (err: Error) => {
    log.warn('S3 image stream error', { id, err: err.message });
    if (!res.headersSent) res.status(502);
    res.end();
  });
  s3Obj.body.pipe(res);
}

function pipeImageUpstream(
  req: Request,
  res: Response,
  upstream: Awaited<ReturnType<typeof fetchProxiedImage>>,
  id: string,
): void {
  const ct = upstream.headers['content-type'];
  res.setHeader('Content-Type', typeof ct === 'string' ? ct : 'image/jpeg');
  const cl = upstream.headers['content-length'];
  if (typeof cl === 'string') res.setHeader('Content-Length', cl);
  res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
  res.status(200);
  req.on('close', () => upstream.data?.destroy?.());
  upstream.data.on('error', (err: Error) => {
    log.warn('Thumbnail stream error', { id, err: err.message });
    if (!res.headersSent) res.status(502);
    res.end();
  });
  upstream.data.pipe(res);
}

export const CreativeController = {
  /**
   * Retrieves a paginated list of creatives with filters.
   * GET /api/v1/creatives
   */
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = req.query as unknown as CreativeListQuery;
      const listMatch = query.section || query.productId ? undefined : CREATIVE_TRENDING_MATCH;
      const result = await CreativeService.findCreatives(query, listMatch, req.models?.Creative);

      res.json(successResponse(result, ResponseMessage.CREATIVES_RETRIEVED, 200));
    } catch (err) {
      next(err);
    }
  },

  /**
   * L1 categories that have at least one creative in the current market.
   * GET /api/v1/creatives/categories
   */
  async categories(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const categories = await CreativeService.getCategories(req.models?.Creative, req.market);
      res.json(successResponse({ categories }, ResponseMessage.SUCCESS, 200));
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
      const result = await CreativeService.findCreatives(
        query,
        CREATIVE_TOP_ADS_MATCH,
        req.models?.Creative,
      );

      res.json(successResponse(result, ResponseMessage.CREATIVES_RETRIEVED, 200));
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

      res.json(successResponse({ relatedVideos }, ResponseMessage.CREATIVES_RETRIEVED, 200));
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

      res.json(successResponse({ creative }, ResponseMessage.CREATIVE_RETRIEVED, 200));
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
      const index = Number.isFinite(Number(indexRaw))
        ? Math.max(0, Math.floor(Number(indexRaw)))
        : 0;

      const creativeModel = req.models?.Creative ?? Creative;
      const creative = await creativeModel.findById(id).lean();
      if (!creative) throw new NotFoundError('Creative not found');

      const s3Key = await resolveCreativeVideoS3Key(
        creative as Record<string, unknown>,
        index,
        creativeModel,
      );
      if (s3Key && isS3VideoConfigured()) {
        const rangeHeader = typeof req.headers.range === 'string' ? req.headers.range : undefined;
        const s3Obj = await getS3VideoObject(s3Key, rangeHeader);
        if (s3Obj) {
          res.setHeader('Content-Type', s3Obj.contentType);
          if (s3Obj.contentLength != null)
            res.setHeader('Content-Length', String(s3Obj.contentLength));
          if (s3Obj.contentRange) res.setHeader('Content-Range', s3Obj.contentRange);
          if (s3Obj.acceptRanges) res.setHeader('Accept-Ranges', s3Obj.acceptRanges);
          else res.setHeader('Accept-Ranges', 'bytes');
          if (s3Obj.etag) res.setHeader('ETag', s3Obj.etag);
          if (s3Obj.lastModified) res.setHeader('Last-Modified', s3Obj.lastModified.toUTCString());
          res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
          res.status(s3Obj.statusCode);
          req.on('close', () => s3Obj.body.destroy?.());
          s3Obj.body.on('error', (err: Error) => {
            log.warn('S3 video stream error', { id, err: err.message });
            if (!res.headersSent) res.status(502);
            res.end();
          });
          s3Obj.body.pipe(res);
          return;
        }
        log.debug('S3 key configured but object missing', { id, s3Key });
        res.status(404).json({ error: 'No playable video for this creative' });
        return;
      }

      // S3-only playback when configured — do not proxy expiring TikTok CDN URLs (410 / unavailable in UI).
      const url = isS3VideoConfigured()
        ? undefined
        : pickCreativeStreamVideoUrl(creative as Record<string, unknown>, index);
      if (!url) {
        const market = req.market ?? 'US';
        const refreshed = await CreativeService.refreshCreativeMedia(
          id,
          index,
          market,
          creativeModel,
        );
        if (refreshed) {
          const nextDoc = await creativeModel.findById(id).lean();
          const nextUrl = nextDoc
            ? pickCreativeStreamVideoUrl(nextDoc as Record<string, unknown>, index)
            : undefined;
          if (nextUrl) {
            const upstream = await axios.get(nextUrl, {
              headers: {
                ...TIKTOK_CDN_HEADERS,
                ...(typeof req.headers.range === 'string' ? { Range: req.headers.range } : {}),
              },
              responseType: 'stream',
              timeout: 15_000,
              validateStatus: (s) => s < 500,
              maxRedirects: 5,
            });
            const passthrough = [
              'content-type',
              'content-length',
              'content-range',
              'accept-ranges',
              'last-modified',
              'etag',
            ];
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
            return;
          }
        }

        res.status(404).json({ error: 'No playable video for this creative' });
        return;
      }

      const headers: Record<string, string> = { ...TIKTOK_CDN_HEADERS };
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

      const passthrough = [
        'content-type',
        'content-length',
        'content-range',
        'accept-ranges',
        'last-modified',
        'etag',
      ];
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
   * GET /api/v1/creatives/:id/thumbnail?index=0&kind=thumbnail|avatar|shop
   */
  async streamThumbnail(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const indexRaw = req.query.index;
      const index = Number.isFinite(Number(indexRaw))
        ? Math.max(0, Math.floor(Number(indexRaw)))
        : 0;
      const kindRaw = req.query.kind;
      const kind = kindRaw === 'avatar' ? 'avatar' : kindRaw === 'shop' ? 'shop' : 'thumbnail';

      const creativeModel = req.models?.Creative ?? Creative;
      let creative = await creativeModel.findById(id).lean();
      if (!creative) {
        sendImagePlaceholder(res);
        return;
      }

      const plain = creative as Record<string, unknown>;
      const market = req.market ?? 'US';

      if (kind === 'shop') {
        const existingShopKey =
          typeof plain.shopAvatarS3Key === 'string' ? plain.shopAvatarS3Key.trim() : '';
        if (existingShopKey) {
          const s3Obj = await streamShopAvatarFromS3(existingShopKey);
          if (s3Obj) {
            pipeS3Image(req, res, s3Obj, id);
            return;
          }
        }

        const cached = await persistShopAvatarOnCreative(id, creativeModel, { market });
        if (cached?.shopAvatarS3Key) {
          const s3Obj = await streamShopAvatarFromS3(cached.shopAvatarS3Key);
          if (s3Obj) {
            pipeS3Image(req, res, s3Obj, id);
            return;
          }
        }
        if (
          cached?.shopAvatarUrl &&
          (await streamFirstAvailableImage(req, res, [cached.shopAvatarUrl], id))
        ) {
          return;
        }

        const shopUrl = typeof plain.shopAvatarUrl === 'string' ? plain.shopAvatarUrl : '';
        if (
          shopUrl.startsWith('https://') &&
          (await streamFirstAvailableImage(req, res, [shopUrl], id))
        ) {
          void persistShopAvatarOnCreative(id, creativeModel, { market });
          return;
        }

        sendImagePlaceholder(res);
        return;
      }

      if (kind === 'avatar') {
        const existingKey = pickCreatorAvatarS3Key(plain, index);
        if (existingKey) {
          const s3Obj = await streamCreatorAvatarFromS3(existingKey);
          if (s3Obj) {
            pipeS3Image(req, res, s3Obj, id);
            return;
          }
        }

        const cached = await persistCreatorAvatarOnCreative(id, creativeModel, {
          index,
          market,
        });
        if (cached?.avatarS3Key) {
          const s3Obj = await streamCreatorAvatarFromS3(cached.avatarS3Key);
          if (s3Obj) {
            pipeS3Image(req, res, s3Obj, id);
            return;
          }
        }
        if (
          cached?.avatarUrl &&
          (await streamFirstAvailableImage(req, res, [cached.avatarUrl], id))
        ) {
          return;
        }
      }

      let urls = collectThumbnailProxyCandidates(plain, index, kind);
      if (await streamFirstAvailableImage(req, res, urls, id)) {
        if (kind === 'avatar') {
          void persistCreatorAvatarOnCreative(id, creativeModel, { index, market });
        }
        return;
      }

      log.debug('Thumbnail CDN failed; refreshing media', { id, index, kind });
      const refreshed = await CreativeService.refreshCreativeMedia(id, index, market);
      if (refreshed) {
        creative = await creativeModel.findById(id).lean();
        if (creative) {
          const refreshedPlain = creative as Record<string, unknown>;
          if (kind === 'avatar') {
            const s3Key = pickCreatorAvatarS3Key(refreshedPlain, index);
            if (s3Key) {
              const s3Obj = await streamCreatorAvatarFromS3(s3Key);
              if (s3Obj) {
                pipeS3Image(req, res, s3Obj, id);
                return;
              }
            }
          }
          urls = collectThumbnailProxyCandidates(refreshedPlain, index, kind);
          if (await streamFirstAvailableImage(req, res, urls, id)) return;
        }
      }

      triggerLazyRefresh(id, index, `thumbnail-exhausted-${kind}`);
      log.info('Serving placeholder image for creative thumbnail', { id, index, kind });
      sendImagePlaceholder(res);
    } catch (err) {
      if (!res.headersSent) {
        sendImagePlaceholder(res);
        return;
      }
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

      res.status(201).json(successResponse(result, ResponseMessage.CREATIVES_INGESTED, 201));
    } catch (err) {
      next(err);
    }
  },
};
