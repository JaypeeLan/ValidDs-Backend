import { logger } from '../logger';

const log = logger.child({ module: 'image-service' });

/**
 * Product Image Service
 *
 * Image URL probing for CDNs that return HTML error bodies on expired signed URLs.
 * External image search backends have been removed; callers use extraction/post media.
 */
export const ImageService = {
  /**
   * Reserved for future image discovery. Currently returns no third-party search results.
   */
  async findProductImages(_productName: string): Promise<string[]> {
    log.debug('findProductImages: no external image search configured');
    return [];
  },

  /**
   * Returns a preferred thumbnail when the caller already has one; otherwise no lookup.
   */
  async findPrimaryThumbnail(_productName: string, preferredThumbnail?: string): Promise<string | null> {
    return preferredThumbnail || null;
  },

  /**
   * Checks whether an image URL is actually serving an image — i.e. returns
   * a 2xx status AND a `Content-Type` that starts with `image/`. Some CDNs
   * (notably some TikTok / CDN hosts) return 200 with an HTML error page or plain
   * text when a signed URL is expired, which is why we can't trust HTTP
   * status alone.
   *
   * Uses HEAD where possible, then a very small GET range as a backup for
   * CDNs that reject HEAD.
   */
  async probe(url: string, timeoutMs = 5000): Promise<boolean> {
    if (!url || !url.startsWith('http')) return false;

    const headOk = await attempt(url, 'HEAD', timeoutMs);
    if (headOk === true) return true;
    if (headOk === false) {
      // HEAD explicitly failed with a non-image response — don't bother
      // with the GET probe; the URL is dead.
      return false;
    }
    // headOk === null → HEAD not supported / network error; try tiny GET
    return (await attempt(url, 'GET', timeoutMs)) === true;
  },
};

/**
 * Returns:
 *   true  — URL responded with 2xx and Content-Type image/*
 *   false — URL responded but is not an image (4xx/5xx or wrong content-type)
 *   null  — request threw (timeout, DNS, CORS, HEAD not supported)
 */
async function attempt(url: string, method: 'HEAD' | 'GET', timeoutMs: number): Promise<boolean | null> {
  try {
    const headers: Record<string, string> =
      method === 'GET' ? { Range: 'bytes=0-0' } : {};
    const res = await fetch(url, {
      method,
      headers,
      redirect: 'follow',
      signal:   AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return false;
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (ct.startsWith('image/')) return true;
    return false;
  } catch {
    return null;
  }
}
