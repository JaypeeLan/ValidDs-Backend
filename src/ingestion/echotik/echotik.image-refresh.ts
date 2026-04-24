import { Product } from '../../models/product.model';
import { ECHOTIK_IMAGE_HOST, resolveEchoTikImageUrls } from './echotik.image';
import { ImageService } from '../../services/image.service';
import { logger } from '../../logger';

const log = logger.child({ module: 'echotik-image-refresh' });

/**
 * EchoTik temp URLs live ~24h. We refresh anything older than this threshold
 * so callers always see working URLs without paying the resolution cost on
 * the request hot path.
 */
export const IMAGE_REFRESH_AFTER_MS = 22 * 60 * 60 * 1000; // 22 hours

function isVolcesUrl(url: unknown): url is string {
  return typeof url === 'string' && url.includes(ECHOTIK_IMAGE_HOST);
}

/**
 * True when a product has resolved temp URLs that are still fresh.
 * Legacy products that never went through ingest-time resolution are
 * considered "needs refresh" so they are healed on first read.
 */
export function imagesAreFresh(product: {
  imagesResolvedAt?: Date | null;
  primaryImageUrl?: string;
  imageUrls?: string[];
}): boolean {
  if (!product.imagesResolvedAt) return false;
  const resolvedAt = new Date(product.imagesResolvedAt).getTime();
  if (!Number.isFinite(resolvedAt)) return false;
  if (Date.now() - resolvedAt >= IMAGE_REFRESH_AFTER_MS) return false;

  // Sanity check — if any served URL is still a raw volces URL, it isn't
  // actually resolved (older docs that only had the timestamp added).
  if (isVolcesUrl(product.primaryImageUrl)) return false;
  if (Array.isArray(product.imageUrls) && product.imageUrls.some(isVolcesUrl)) return false;
  return true;
}

/**
 * Picks the best set of source URLs to (re)resolve for a product.
 * Prefers explicit sourceImageUrls when present, otherwise falls back
 * to anything still pointing at volces.com (legacy docs).
 */
export function pickSourceUrls(product: {
  sourcePrimaryImageUrl?: string;
  sourceImageUrls?: string[];
  primaryImageUrl?: string;
  imageUrls?: string[];
}): { primary?: string; gallery: string[] } {
  const primary =
    product.sourcePrimaryImageUrl ??
    (isVolcesUrl(product.primaryImageUrl) ? product.primaryImageUrl : undefined);

  const gallery =
    Array.isArray(product.sourceImageUrls) && product.sourceImageUrls.length > 0
      ? product.sourceImageUrls
      : Array.isArray(product.imageUrls)
        ? product.imageUrls.filter(isVolcesUrl)
        : [];

  return { primary, gallery };
}

/**
 * Applies a fresh set of image URLs to the plain object and persists the
 * same update to MongoDB (fire-and-forget).
 */
function applyRefreshed(
  plain: Record<string, unknown>,
  newPrimary: string | undefined,
  newGallery: string[],
  opts: { source?: string; gallerySource?: string[] } = {}
): void {
  plain.primaryImageUrl = newPrimary;
  plain.imageUrls       = newGallery;
  if (typeof plain.thumbnailUrl === 'string' || newPrimary) {
    plain.thumbnailUrl = newPrimary ?? (plain.thumbnailUrl as string | undefined);
  }
  const resolvedAt = new Date();
  plain.imagesResolvedAt = resolvedAt;
  if (opts.source) plain.sourcePrimaryImageUrl = opts.source;
  if (opts.gallerySource && opts.gallerySource.length > 0) plain.sourceImageUrls = opts.gallerySource;

  const id = (plain as any)._id;
  if (!id) return;
  void Product.updateOne(
    { _id: id },
    {
      $set: {
        primaryImageUrl:  newPrimary,
        imageUrls:        newGallery,
        imagesResolvedAt: resolvedAt,
        ...(opts.source                         ? { sourcePrimaryImageUrl: opts.source } : {}),
        ...(opts.gallerySource && opts.gallerySource.length > 0 ? { sourceImageUrls: opts.gallerySource } : {}),
      },
    }
  ).catch((err) => log.warn('Persist refreshed image URLs failed', { err: String(err), id: String(id) }));
}

/**
 * Resolves a product's EchoTik image URLs in place on the given plain object
 * AND persists the refreshed values to the document so subsequent reads are
 * instant. When EchoTik resolution yields no usable URLs, falls back to the
 * Search API so the product still has working images.
 *
 * Returns true when a refresh actually happened.
 * Errors are swallowed — the caller's payload is left untouched on failure.
 */
export async function refreshProductImages(plain: Record<string, unknown>): Promise<boolean> {
  const { primary, gallery } = pickSourceUrls(plain as any);
  const candidates = Array.from(new Set([
    ...(primary ? [primary] : []),
    ...gallery,
  ]));

  // Step 1 — try EchoTik if we have any source URLs to re-resolve.
  if (candidates.length > 0) {
    let urlMap: Record<string, string> = {};
    try {
      urlMap = await resolveEchoTikImageUrls(candidates);
    } catch (err) {
      log.warn('Failed to refresh EchoTik image URLs', { err: String(err), id: (plain as any)?._id });
    }
    if (Object.keys(urlMap).length > 0) {
      const newPrimary = primary ? urlMap[primary] ?? primary : (plain.primaryImageUrl as string | undefined);
      const newGallery = gallery.length > 0
        ? gallery.map((url) => urlMap[url] ?? url)
        : (Array.isArray(plain.imageUrls) ? (plain.imageUrls as string[]) : []);
      applyRefreshed(plain, newPrimary, newGallery, { source: primary, gallerySource: gallery });
      return true;
    }
  }

  // Step 2 — fall back to the Search API if the doc is still showing unusable
  // images (nothing resolved, or still pointing at volces.com).
  const currentPrimary  = plain.primaryImageUrl as string | undefined;
  const currentGallery  = Array.isArray(plain.imageUrls) ? (plain.imageUrls as string[]) : [];
  const primaryIsUsable = typeof currentPrimary === 'string' && !isVolcesUrl(currentPrimary);
  if (!primaryIsUsable) {
    const title = (plain.title as string | undefined) ?? (plain.normalizedTitle as string | undefined);
    if (title) {
      try {
        const searchImages = await ImageService.findProductImages(title);
        if (searchImages.length > 0) {
          applyRefreshed(plain, searchImages[0], searchImages, {
            source: primary,
            gallerySource: gallery,
          });
          log.debug('Used search-API images as EchoTik refresh fallback', {
            id: String((plain as any)?._id),
            count: searchImages.length,
          });
          return true;
        }
      } catch (err) {
        log.warn('Search-API fallback failed during refresh', {
          err: String(err),
          id: String((plain as any)?._id),
        });
      }
    }
  } else {
    // The doc already has usable (non-volces) images but its timestamp is
    // stale — bump it so we don't keep retrying EchoTik on every request.
    // The periodic background job will still attempt an upgrade later.
    const id = (plain as any)?._id;
    const resolvedAt = new Date();
    plain.imagesResolvedAt = resolvedAt;
    if (id) {
      void Product.updateOne({ _id: id }, { $set: { imagesResolvedAt: resolvedAt } })
        .catch((err) => log.warn('Failed to bump imagesResolvedAt', { err: String(err), id: String(id) }));
    }
  }

  return false;
}

/**
 * Background job: scan a batch of EchoTik products whose resolved images
 * are nearing expiry and refresh them. Designed to be cheap and idempotent.
 */
export async function refreshStaleProductImages(limit: number = 100): Promise<{
  scanned: number;
  refreshed: number;
}> {
  const cutoff = new Date(Date.now() - IMAGE_REFRESH_AFTER_MS);
  const docs = await Product.find({
    source: 'echotik',
    sourceImageUrls: { $exists: true, $ne: [] },
    $or: [
      { imagesResolvedAt: { $exists: false } },
      { imagesResolvedAt: { $lt: cutoff } },
    ],
  })
    .sort({ imagesResolvedAt: 1 })
    .limit(limit)
    .lean();

  let refreshed = 0;
  for (const doc of docs) {
    const did = await refreshProductImages(doc as Record<string, unknown>);
    if (did) refreshed += 1;
  }
  log.info('Stale EchoTik image refresh complete', { scanned: docs.length, refreshed });
  return { scanned: docs.length, refreshed };
}
