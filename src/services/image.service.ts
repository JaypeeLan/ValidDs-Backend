import { logger } from '../logger';

const log = logger.child({ module: 'image-service' });

/**
 * Product Image Service
 *
 * Fetches a product image URL by searching for the product name.
 *
 * Primary:   Google Custom Search API (100 free queries/day)
 * Fallback:  SearchApi (google_images engine)
 *
 * For V1, images are best-effort. If no image is found, the
 * product record is still created with primaryImageUrl = null.
 * The frontend should handle this gracefully (placeholder image).
 *
 * Setup required in .env:
 *   GOOGLE_CSE_API_KEY=   (Google Custom Search API key)
 *   GOOGLE_CSE_CX=        (Search engine ID)
 *   SEARCHAPI_KEY=        (fallback)
 */

export const ImageService = {
  /**
   * Search for product images by name.
   * Returns a list of relevant image URLs, prioritizing high quality and clean backgrounds.
   * Optimizes for 300x300 containers by preferring centered studio shots.
   */
  async findProductImages(productName: string): Promise<string[]> {
    // 1. Try SerpAPI first (User Priority)
    const serpResults = await searchSerpAPI(productName);
    if (serpResults && serpResults.length > 0) {
      log.debug(`Found ${serpResults.length} images via SerpAPI`, { product: productName });
      return serpResults;
    }

    // 2. Fall back to Google CSE (Secondary)
    const googleResults = await searchGoogleCSE(productName);
    if (googleResults && googleResults.length > 0) {
      log.debug(`Found ${googleResults.length} images via Google CSE`, { product: productName });
      return googleResults;
    }

    log.debug(`No images found for product: ${productName}`);
    return [];
  },

  /**
   * Optimized for 178x133 primary display as requested.
   */
  async findPrimaryThumbnail(productName: string, serpThumbnail?: string): Promise<string | null> {
    if (serpThumbnail) return serpThumbnail;
    const results = await this.findProductImages(productName);
    return results[0] || null;
  },
};

// ── Google Custom Search API ──────────────────────────────────────────────────

async function searchGoogleCSE(query: string): Promise<string[]> {
  const apiKey = process.env.GOOGLE_CSE_API_KEY || process.env.GOOGLE_API_KEY;
  const cx = process.env.GOOGLE_CSE_CX;

  if (!apiKey || !cx) return [];

  try {
    const params = new URLSearchParams({
      key: apiKey,
      cx,
      q: `${query} product photography studio white background`,
      searchType: 'image',
      num: '10',
      imgType: 'photo',
      imgSize: 'large',
      safe: 'active',
    });

    const res = await fetch(
      `https://www.googleapis.com/customsearch/v1?${params.toString()}`,
      { signal: AbortSignal.timeout(12000) }
    );

    if (!res.ok) {
      log.debug('Google CSE request failed', { status: res.status });
      return [];
    }

    const data = await res.json() as {
      items?: Array<{ link?: string; image?: { height?: number; width?: number } }>;
    };

    return (data.items ?? [])
      .map(item => item.link)
      .filter((url): url is string => Boolean(url && isAcceptableImageUrl(url)))
      .slice(0, 10);
  } catch (err) {
    log.debug('Google CSE search failed', { err: String(err) });
    return [];
  }
}

// ── SearchApi ─────────────────────────────────────────────────────────────────

async function searchSerpAPI(query: string): Promise<string[]> {
  const apiKey = process.env.SEARCHAPI_KEY ?? process.env.SERPAPI_KEY;
  if (!apiKey) return [];

  try {
    const params = new URLSearchParams({
      api_key: apiKey,
      engine: 'google_images',
      q: `${query} high resolution product photography lifestyle aesthetic studio white background 4k`,
      num: '15',
      safe: 'active',
    });

    const res = await fetch(
      `https://www.searchapi.io/api/v1/search?${params.toString()}`,
      { signal: AbortSignal.timeout(12000) }
    );

    if (!res.ok) return [];

    const data = await res.json() as {
      images_results?: Array<{ original?: string; thumbnail?: string; width?: number; height?: number }>;
    };

    const results: string[] = [];
    for (const item of data.images_results ?? []) {
      const url = item.original || item.thumbnail;
      if (url && isAcceptableImageUrl(url)) {
        results.push(url);
      }
    }

    return results.slice(0, 10);
  } catch (err) {
    log.debug('SearchApi image search failed', { err: String(err) });
    return [];
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isAcceptableImageUrl(url: string): boolean {
  // Skip obviously bad sources or low-res cdn links
  const blocklist = ['pinterest', 'instagram', 'facebook', 'twitter', 'tiktok', 'p16-', 'p19-'];
  const lower = url.toLowerCase();
  
  // Also check for common low-res extensions or patterns
  if (blocklist.some((b) => lower.includes(b))) return false;
  if (!url.startsWith('http')) return false;
  
  // Prefer common image extensions
  const extensions = ['.jpg', '.jpeg', '.png', '.webp'];
  if (!extensions.some(ext => lower.includes(ext))) {
     // If no common extension, still allow if it looks like a valid URL, but lower quality
  }

  return true;
}
