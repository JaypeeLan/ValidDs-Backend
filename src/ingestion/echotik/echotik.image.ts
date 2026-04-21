import { EchoTikClient } from './echotik.client';
import { CacheService } from '../../cache/cache.service';
import { logger } from '../../logger';

const log = logger.child({ module: 'echotik-image' });

const ECHOTIK_IMAGE_HOST = 'echosell-images.tos-ap-southeast-1.volces.com';
// Cache 20 hours — 4h safety margin before the 24h expiry
const TEMP_URL_TTL_SECONDS = 72_000;

function cacheKey(url: string): string {
  return `echotik:img:${url}`;
}

function isEchoTikUrl(url: string): boolean {
  return url.includes(ECHOTIK_IMAGE_HOST);
}

/**
 * Resolves EchoTik volces.com image URLs to temporary accessible URLs.
 *
 * Cache-aside pattern: hits are served from Redis, misses are batched into a
 * single /batch/cover/download call and then cached for 20 hours.
 * Non-EchoTik URLs (e.g. TikTok CDN) are not touched and won't appear in the map.
 */
export async function resolveEchoTikImageUrls(
  urls: string[]
): Promise<Record<string, string>> {
  const echotikUrls = [...new Set(urls.filter(isEchoTikUrl))];
  if (echotikUrls.length === 0) return {};

  const result: Record<string, string> = {};
  const misses: string[] = [];

  await Promise.all(
    echotikUrls.map(async (url) => {
      const cached = await CacheService.get<string>(cacheKey(url));
      if (cached) {
        result[url] = cached;
      } else {
        misses.push(url);
      }
    })
  );

  if (misses.length > 0) {
    const client = new EchoTikClient();
    const tempUrlMap = await client.getTempCoverUrls(misses);

    await Promise.all(
      misses.map(async (url) => {
        const tempUrl = tempUrlMap[url];
        if (tempUrl) {
          result[url] = tempUrl;
          await CacheService.set(cacheKey(url), tempUrl, TEMP_URL_TTL_SECONDS);
        }
      })
    );

    log.debug('EchoTik image URLs resolved', {
      total: echotikUrls.length,
      cacheHits: echotikUrls.length - misses.length,
      apiResolved: Object.keys(tempUrlMap).length,
    });
  }

  return result;
}

/**
 * Applies a resolved URL map to a plain product object in-place.
 */
export function applyResolvedImages(
  product: Record<string, unknown>,
  urlMap: Record<string, string>
): void {
  if (Object.keys(urlMap).length === 0) return;

  if (Array.isArray(product.imageUrls)) {
    product.imageUrls = (product.imageUrls as string[]).map((url) => urlMap[url] ?? url);
  }
  if (typeof product.primaryImageUrl === 'string') {
    product.primaryImageUrl = urlMap[product.primaryImageUrl] ?? product.primaryImageUrl;
  }
  if (typeof product.thumbnailUrl === 'string') {
    product.thumbnailUrl = urlMap[product.thumbnailUrl] ?? product.thumbnailUrl;
  }
}
