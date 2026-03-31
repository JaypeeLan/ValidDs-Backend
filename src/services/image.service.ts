import { logger } from '../logger';

const log = logger.child({ module: 'image-service' });

/**
 * Product Image Service
 *
 * Fetches a product image URL by searching for the product name.
 *
 * Primary:   Google Custom Search API (100 free queries/day)
 * Fallback:  SerpAPI (100 free searches/month)
 *
 * For V1, images are best-effort. If no image is found, the
 * product record is still created with primaryImageUrl = null.
 * The frontend should handle this gracefully (placeholder image).
 *
 * Setup required in .env:
 *   GOOGLE_CSE_API_KEY=   (Google Custom Search API key)
 *   GOOGLE_CSE_CX=        (Search engine ID)
 *   SERPAPI_KEY=          (fallback)
 */

export const ImageService = {

  /**
   * Search for a product image by name.
   * Returns the first relevant image URL, or null if nothing is found.
   */
  async findProductImage(productName: string): Promise<string | null> {
    // Try Google CSE first
    const googleResult = await searchGoogleCSE(productName);
    if (googleResult) return googleResult;

    // Fall back to SerpAPI
    const serpResult = await searchSerpAPI(productName);
    if (serpResult) return serpResult;

    log.debug(`No image found for product: ${productName}`);
    return null;
  },
};

// ── Google Custom Search API ──────────────────────────────────────────────────

async function searchGoogleCSE(query: string): Promise<string | null> {
  const apiKey = process.env.GOOGLE_CSE_API_KEY;
  const cx = process.env.GOOGLE_CSE_CX;

  if (!apiKey || !cx) return null;

  try {
    const params = new URLSearchParams({
      key: apiKey,
      cx,
      q: `${query} product`,
      searchType: 'image',
      num: '3',
      imgType: 'photo',
      imgSize: 'medium',
      safe: 'active',
    });

    const res = await fetch(
      `https://www.googleapis.com/customsearch/v1?${params.toString()}`,
      { signal: AbortSignal.timeout(5000) }
    );

    if (!res.ok) {
      log.debug('Google CSE request failed', { status: res.status });
      return null;
    }

    const data = await res.json() as {
      items?: Array<{ link?: string; image?: { thumbnailLink?: string } }>;
    };

    // Return the first image that looks like a real product photo
    for (const item of data.items ?? []) {
      const url = item.link;
      if (url && isAcceptableImageUrl(url)) return url;
    }

    return null;
  } catch (err) {
    log.debug('Google CSE search failed', { err: String(err) });
    return null;
  }
}

// ── SerpAPI ───────────────────────────────────────────────────────────────────

async function searchSerpAPI(query: string): Promise<string | null> {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) return null;

  try {
    const params = new URLSearchParams({
      api_key: apiKey,
      engine: 'google_images',
      q: `${query} product`,
      num: '3',
      safe: 'active',
    });

    const res = await fetch(
      `https://serpapi.com/search?${params.toString()}`,
      { signal: AbortSignal.timeout(5000) }
    );

    if (!res.ok) return null;

    const data = await res.json() as {
      images_results?: Array<{ original?: string; thumbnail?: string }>;
    };

    for (const item of data.images_results ?? []) {
      const url = item.thumbnail ?? item.original;
      if (url && isAcceptableImageUrl(url)) return url;
    }

    return null;
  } catch (err) {
    log.debug('SerpAPI search failed', { err: String(err) });
    return null;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isAcceptableImageUrl(url: string): boolean {
  // Skip obviously bad sources
  const blocklist = ['pinterest', 'instagram', 'facebook', 'twitter', 'tiktok'];
  const lower = url.toLowerCase();
  if (blocklist.some((b) => lower.includes(b))) return false;
  if (!url.startsWith('http')) return false;
  return true;
}
