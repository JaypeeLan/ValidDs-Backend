import { downloadImageBuffer, TIKTOK_IMAGE_HEADERS } from './creator-avatar.util';
import { getS3Object, isS3Configured, putS3Object } from './s3-video.util';
import { logger } from '../logger';

const log = logger.child({ module: 'image-s3-cache' });

export function collectHttpsUrls(...values: unknown[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    if (typeof v === 'string' && v.startsWith('https://') && !out.includes(v)) out.push(v);
  }
  return out;
}

/** Confirm an S3 object exists and contains a readable image (>= 64 bytes). */
export async function verifyS3ImageKey(key: string): Promise<boolean> {
  if (!key.trim() || !isS3Configured()) return false;
  try {
    const obj = await getS3Object(key, 'bytes=0-8191', 'image/jpeg');
    if (!obj) return false;
    const chunks: Buffer[] = [];
    for await (const chunk of obj.body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).length >= 64;
  } catch {
    return false;
  }
}

export type CacheImageToS3Input = {
  s3Key: string;
  sourceUrls?: string[];
  fetchFreshUrls?: () => Promise<string[]>;
  /** Product hero image — used when TikTok storefront has no logo. */
  primaryImageUrl?: string;
  logLabel?: string;
  /** Re-download even when S3 already has bytes (repair bad cached logos). */
  forceRefresh?: boolean;
};

export type CacheImageToS3Result = {
  s3Key?: string;
  sourceUrl?: string;
};

async function tryDownloadAndUpload(
  s3Key: string,
  urls: string[],
  logLabel?: string,
): Promise<CacheImageToS3Result | null> {
  for (const url of urls) {
    const downloaded = await downloadImageBuffer(url, TIKTOK_IMAGE_HEADERS);
    if (!downloaded) continue;

    if (isS3Configured()) {
      try {
        await putS3Object(s3Key, downloaded.buffer, downloaded.contentType);
        log.debug('Cached image to S3', { logLabel, s3Key, sourceUrl: url.slice(0, 80) });
        return { s3Key, sourceUrl: url };
      } catch (err) {
        log.warn('S3 image upload failed', { logLabel, s3Key, err: String(err) });
      }
    }

    return { sourceUrl: url };
  }
  return null;
}

/**
 * Validate CDN URLs before upload; skip download when S3 already has a valid image.
 * Calls `fetchFreshUrls` when stored URLs are broken or missing.
 */
export async function cacheImageToS3(
  input: CacheImageToS3Input,
): Promise<CacheImageToS3Result | null> {
  const s3Key = input.s3Key?.trim();
  if (!s3Key) return null;

  if (!input.forceRefresh && isS3Configured() && (await verifyS3ImageKey(s3Key))) {
    return { s3Key };
  }

  const urls = collectHttpsUrls(...(input.sourceUrls ?? []));
  let result = await tryDownloadAndUpload(s3Key, urls, input.logLabel);
  if (result) return result;

  if (input.fetchFreshUrls) {
    const fresh = collectHttpsUrls(...(await input.fetchFreshUrls()));
    result = await tryDownloadAndUpload(s3Key, fresh, input.logLabel);
    if (result) return result;
  }

  // TikTok storefront missing — fall back to product hero image (shop CDN, not creator profile).
  const productFallback = String(input.primaryImageUrl ?? '').trim();
  if (productFallback.includes('oec-general')) {
    result = await tryDownloadAndUpload(s3Key, [productFallback], input.logLabel);
    if (result) return result;
  }

  return null;
}
