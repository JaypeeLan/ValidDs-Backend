import axios from 'axios';

const TIKTOK_CDN_BASE_HEADERS: Record<string, string> = {
  Referer: 'https://www.tiktok.com/',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};

/** Image proxy / avatar download */
export const TIKTOK_IMAGE_HEADERS: Record<string, string> = {
  ...TIKTOK_CDN_BASE_HEADERS,
  Accept: 'image/*,*/*',
};

/** Video stream proxy */
export const TIKTOK_CDN_HEADERS: Record<string, string> = {
  ...TIKTOK_CDN_BASE_HEADERS,
  Accept: '*/*',
};

import { s3ImagePrefix } from './s3-video.util';

export function creatorAvatarS3Key(handle: string, market = 'us'): string {
  const h = handle.replace(/^@/, '').trim().toLowerCase();
  if (!h) return '';
  return `${s3ImagePrefix()}/avatars/${market.toLowerCase()}/${h}.jpg`;
}

export function shopAvatarS3Key(shopName: string, market = 'us'): string {
  const slug = shopName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  if (!slug) return '';
  return `${s3ImagePrefix()}/shops/${market.toLowerCase()}/${slug}.jpg`;
}

/** Stable backend URL for creator profile images (S3 + refresh, not expiring CDN). */
export function buildCreatorAvatarProxyUrl(
  baseUrl: string | undefined,
  index: number,
  opts: { avatarUrl?: string; avatarS3Key?: string; handle?: string },
): string | undefined {
  if (!baseUrl?.trim()) return undefined;
  const hasHandle = typeof opts.handle === 'string' && opts.handle.trim().length > 0;
  const hasSource =
    Boolean(opts.avatarUrl?.trim()) || Boolean(opts.avatarS3Key?.trim()) || hasHandle;
  if (!hasSource) return undefined;
  return `${baseUrl}/thumbnail?index=${index}&kind=avatar`;
}

export function pickCreatorAvatarS3Key(
  creative: Record<string, unknown>,
  index: number,
): string | undefined {
  const pick = (c: { avatarS3Key?: string } | undefined) =>
    typeof c?.avatarS3Key === 'string' && c.avatarS3Key.trim() ? c.avatarS3Key.trim() : undefined;

  if (index <= 0) {
    return pick(creative.creator as { avatarS3Key?: string } | undefined);
  }
  const related = Array.isArray(creative.relatedVideos) ? creative.relatedVideos : [];
  const node = related[index - 1] as { creator?: { avatarS3Key?: string } } | undefined;
  return pick(node?.creator);
}

export async function downloadImageBuffer(
  url: string,
  headers: Record<string, string>,
): Promise<{ buffer: Buffer; contentType: string } | null> {
  try {
    const res = await axios.get(url, {
      headers,
      responseType: 'arraybuffer',
      timeout: 15_000,
      validateStatus: (s) => s < 500,
      maxRedirects: 5,
    });
    if (res.status >= 400) return null;
    const ct = String(res.headers['content-type'] ?? '').toLowerCase();
    if (!ct.startsWith('image/')) return null;
    const buffer = Buffer.from(res.data);
    if (buffer.length < 64) return null;
    return { buffer, contentType: ct.split(';')[0] || 'image/jpeg' };
  } catch {
    return null;
  }
}
