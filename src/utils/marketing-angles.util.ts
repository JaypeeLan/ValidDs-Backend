import {
  extractMetaAdIdFromUrl,
  isMetaAdLibraryUrl,
  normalizeMetaAdLibraryUrl,
} from './meta-ad-url.util';
import { extractTikTokVideoId, isTikTokPostUrl } from './tiktok-url.util';

function omitAngleKeys<T extends Record<string, unknown>>(angle: T, keys: (keyof T)[]): T {
  const rest = { ...angle };
  for (const key of keys) {
    delete rest[key];
  }
  return rest;
}

/** True when the angle has an S3-backed proxy URL. */
export function angleHasPlayableVideo(angle: unknown): boolean {
  if (!angle || typeof angle !== 'object') return false;
  const row = angle as { videoProxyUrl?: unknown };
  return typeof row.videoProxyUrl === 'string' && row.videoProxyUrl.trim().length > 0;
}

/** Remove Ad Library links from videoUrl (not playable as MP4). */
export function stripNonPlayableAngleVideoUrls<T extends Record<string, unknown>>(
  angles: T[] | undefined | null,
): T[] {
  if (!Array.isArray(angles)) return [];
  return angles.map((angle) => {
    const url = angle.videoUrl;
    if (typeof url === 'string' && isMetaAdLibraryUrl(url)) {
      return omitAngleKeys(angle, ['videoUrl']);
    }
    if (typeof url === 'string' && url.trim() && !isTikTokPostUrl(url)) {
      return omitAngleKeys(angle, ['videoUrl']);
    }
    return angle;
  });
}

/** Canonicalize any stray Meta URLs (then strip from videoUrl). */
export function normalizeMarketingAngleVideoUrls<T extends Record<string, unknown>>(
  angles: T[] | undefined | null,
): T[] {
  return stripNonPlayableAngleVideoUrls(angles);
}

/**
 * @deprecated Ad Library URLs are not playable videos. Use stripNonPlayableAngleVideoUrls.
 */
export function alignMarketingAnglesToMetaCreatives<T extends Record<string, unknown>>(
  angles: T[],
  _metaViewerUrls: string[],
): T[] {
  return stripNonPlayableAngleVideoUrls(angles);
}

function angleCreativeProxyUrls(creativeId: string, apiVersion: string) {
  const base = `/api/${apiVersion}/creatives/${creativeId}`;
  return {
    videoProxyUrl: `${base}/video?index=0`,
    thumbnailProxyUrl: `${base}/thumbnail?index=0&kind=thumbnail`,
  };
}

/** Attach a fallback creative proxy when the angle has no videoUrl/metaAdLibraryUrl. */
export function enrichAnglesWithFallbackCreativeProxyUrls<T extends Record<string, unknown>>(
  angles: T[],
  fallbackCreativeId: string | undefined,
  apiVersion = 'v1',
): T[] {
  const id = typeof fallbackCreativeId === 'string' ? fallbackCreativeId.trim() : '';
  if (!id) return angles;
  return angles.map((angle) => {
    if (angleHasPlayableVideo(angle)) return angle;
    // If the angle already points to a specific creative (via url fields),
    // let the more specific enrichers handle it.
    const hasSpecificUrl =
      (typeof angle.videoUrl === 'string' && angle.videoUrl.trim().length > 0) ||
      (typeof angle.metaAdLibraryUrl === 'string' && angle.metaAdLibraryUrl.trim().length > 0);
    if (hasSpecificUrl) return angle;
    return {
      ...angle,
      ...angleCreativeProxyUrls(id, apiVersion),
    };
  });
}

/** Attach /api/v1/creatives/:id/video proxy paths for angles matched to product TikTok creatives. */
export function enrichAnglesWithVideoProxyUrls<T extends Record<string, unknown>>(
  angles: T[],
  videoIdToCreativeId: Map<string, string>,
  apiVersion = 'v1',
): T[] {
  if (!videoIdToCreativeId.size) return angles;

  return angles.map((angle) => {
    const url = angle.videoUrl;
    if (typeof url !== 'string' || !isTikTokPostUrl(url)) return angle;
    const vid = extractTikTokVideoId(url);
    if (!vid) return angle;
    const creativeId = videoIdToCreativeId.get(vid);
    if (!creativeId) return angle;
    return {
      ...omitAngleKeys(angle, ['videoUrl']),
      ...angleCreativeProxyUrls(creativeId, apiVersion),
    };
  });
}

/** Match angles with metaAdLibraryUrl to Meta creatives that have S3 video. */
export function enrichAnglesWithMetaVideoProxyUrls<T extends Record<string, unknown>>(
  angles: T[],
  metaAdIdToCreativeId: Map<string, string>,
  apiVersion = 'v1',
): T[] {
  if (!metaAdIdToCreativeId.size) return angles;

  return angles.map((angle) => {
    if (angleHasPlayableVideo(angle)) return angle;
    const lib =
      typeof angle.metaAdLibraryUrl === 'string'
        ? angle.metaAdLibraryUrl
        : typeof angle.videoUrl === 'string' && isMetaAdLibraryUrl(angle.videoUrl)
          ? angle.videoUrl
          : '';
    const adId = lib ? extractMetaAdIdFromUrl(lib) : null;
    if (!adId) return angle;
    const creativeId = metaAdIdToCreativeId.get(adId);
    if (!creativeId) return angle;
    return {
      ...omitAngleKeys(angle, ['videoUrl', 'metaAdLibraryUrl']),
      ...angleCreativeProxyUrls(creativeId, apiVersion),
    };
  });
}

/** Drop external video/page links from angles — clients use videoProxyUrl only. */
export function stripAngleExternalLinks<T extends Record<string, unknown>>(
  angles: T[] | undefined | null,
): T[] {
  if (!Array.isArray(angles)) return [];
  return angles.map((angle) => {
    return omitAngleKeys(angle, ['videoUrl', 'metaAdLibraryUrl']);
  });
}

/** Video angles first; preserves relative order within each group. */
export function sortMarketingAnglesWithVideoFirst<T>(angles: T[] | undefined | null): T[] {
  if (!Array.isArray(angles) || angles.length === 0) return [];
  return [...angles].sort((a, b) => {
    const aHas = angleHasPlayableVideo(a) ? 0 : 1;
    const bHas = angleHasPlayableVideo(b) ? 0 : 1;
    return aHas - bHas;
  });
}

/** Drop angles that cannot stream from S3 (no videoProxyUrl). */
export function filterMarketingAnglesWithPlayableVideo<T>(angles: T[] | undefined | null): T[] {
  if (!Array.isArray(angles)) return [];
  return angles.filter((angle) => angleHasPlayableVideo(angle));
}

/** Optional: keep normalized Ad Library link separate from videoUrl (not for inline player). */
export function attachMetaAdLibraryUrlsToAngles<T extends Record<string, unknown>>(
  angles: T[],
  metaViewerUrls: string[],
): T[] {
  const canonical: string[] = [];
  for (const raw of metaViewerUrls) {
    const norm = normalizeMetaAdLibraryUrl(raw);
    if (norm && !canonical.includes(norm)) canonical.push(norm);
  }
  if (!canonical.length) return angles;

  let urlIdx = 0;
  return angles.map((angle) => {
    if (angleHasPlayableVideo(angle)) return angle;
    if (urlIdx >= canonical.length) return angle;
    const metaAdLibraryUrl = canonical[urlIdx++]!;
    return { ...angle, metaAdLibraryUrl };
  });
}
