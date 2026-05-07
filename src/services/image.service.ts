import { logger } from '../logger';

const log = logger.child({ module: 'image-service' });

/**
 * Product Image Service
 *
 * Fetches product image URLs by searching for the product name via
 * SearchApi's `google_images` engine (https://www.searchapi.io/).
 *
 * For V1, images are best-effort. If no image is found, the product
 * record is still created with primaryImageUrl = null. The frontend
 * handles this gracefully (placeholder image).
 *
 * Setup required in .env:
 *   SEARCHAPI_KEY=   (SearchApi key — https://www.searchapi.io/)
 */
export const ImageService = {
  /**
   * Search for product images by name.
   * Returns a list of relevant image URLs, prioritizing high quality
   * and clean backgrounds (studio white / lifestyle / 4k).
   */
  async findProductImages(productName: string): Promise<string[]> {
    const results = await searchSearchApi(productName);
    if (results.length > 0) {
      log.debug(`Found ${results.length} images via SearchApi`, { product: productName });
      return results;
    }
    log.debug(`No images found for product: ${productName}`);
    return [];
  },

  /**
   * Returns the best single thumbnail URL, preferring an already-provided
   * SearchApi thumbnail if we have one.
   */
  async findPrimaryThumbnail(productName: string, searchApiThumbnail?: string): Promise<string | null> {
    if (searchApiThumbnail) return searchApiThumbnail;
    const results = await this.findProductImages(productName);
    return results[0] || null;
  },

  /**
   * Checks whether an image URL is actually serving an image — i.e. returns
   * a 2xx status AND a `Content-Type` that starts with `image/`. Some CDNs
   * (notably TikTok / volces) return 200 with an HTML error page or plain
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

// ── SearchApi ─────────────────────────────────────────────────────────────────

async function searchSearchApi(query: string): Promise<string[]> {
  const apiKey = process.env.SEARCHAPI_KEY ?? process.env.SERPAPI_KEY;
  if (!apiKey) {
    log.debug('SEARCHAPI_KEY missing — skipping image search');
    return [];
  }

  try {
    const q = buildImageQuery(query);
    const params = new URLSearchParams({
      api_key: apiKey,
      engine:  'google_images',
      q,
      num:     '15',
      safe:    'active',
    });

    const res = await fetch(
      `https://www.searchapi.io/api/v1/search?${params.toString()}`,
      { signal: AbortSignal.timeout(12000) }
    );

    if (!res.ok) {
      log.debug('SearchApi image request failed', { status: res.status });
      return [];
    }

    type ImageItem = {
      original?:  string | { link?: string; width?: number; height?: number };
      thumbnail?: string;
      source?:    string;
    };
    const data = (await res.json()) as {
      images?:         ImageItem[];
      images_results?: ImageItem[];
    };

    const items = data.images ?? data.images_results ?? [];
    const results: string[] = [];
    for (const item of items) {
      const original =
        typeof item.original === 'string'
          ? item.original
          : item.original?.link;
      const url = original || item.thumbnail;
      if (url && isAcceptableImageUrl(url)) results.push(url);
    }

    return results.slice(0, 10);
  } catch (err) {
    log.debug('SearchApi image search failed', { err: String(err) });
    return [];
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Builds a concise image-search query. TikTok Shop titles are often long,
 * multilingual, and stuffed with tags/brackets — feeding the whole thing to
 * Google Images typically returns zero hits. We trim to the first handful of
 * meaningful tokens and append a light "product" hint.
 */
function buildImageQuery(raw: string): string {
  const cleaned = raw
    .replace(/[\[\](){}|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const words = cleaned.split(' ').filter(Boolean).slice(0, 10);
  const short = words.join(' ').slice(0, 120);
  return `${short} product`;
}

function isAcceptableImageUrl(url: string): boolean {
  const blocklist = ['pinterest', 'instagram', 'facebook', 'twitter', 'tiktok', 'p16-', 'p19-'];
  const lower = url.toLowerCase();
  if (blocklist.some((b) => lower.includes(b))) return false;
  if (!url.startsWith('http')) return false;
  return true;
}
