import { extractMetaAdIdFromUrl } from './meta-ad-url.util';

/** S3 prefix for Meta Ad Library MP4s (must match scraper `META_VIDEO_S3_PREFIX`). */
export function metaVideoS3Prefix(): string {
  const raw =
    process.env.META_VIDEO_S3_PREFIX?.trim() ||
    process.env.AWS_S3_META_VIDEO_PREFIX?.trim() ||
    'brightdata/tiktok-videos/meta';
  return raw.replace(/^\/+|\/+$/g, '');
}

/** Predictable object key: `{prefix}/{numericAdId}.mp4`. */
export function metaAdMp4S3Key(adId: string): string | undefined {
  const aid = String(adId ?? '').trim();
  if (!/^\d{5,}$/.test(aid)) return undefined;
  return `${metaVideoS3Prefix()}/${aid}.mp4`;
}

/** Numeric Meta ad id from `meta:{id}` or Ad Library URL fields. */
export function metaAdIdFromCreative(creative: Record<string, unknown>): string | null {
  const ext = String(creative.externalVideoId ?? '').trim();
  const fromExt = extractMetaAdIdFromUrl(ext);
  if (fromExt) return fromExt;
  for (const field of ['metaAdId', 'metaAdLibraryUrl', 'tiktokPostUrl', 'embedUrl'] as const) {
    const v = creative[field];
    if (typeof v === 'string' && v.trim()) {
      const id = extractMetaAdIdFromUrl(v);
      if (id) return id;
    }
  }
  return null;
}

export function isMetaCreative(creative: Record<string, unknown>): boolean {
  return String(creative.externalVideoId ?? '').startsWith('meta:');
}
