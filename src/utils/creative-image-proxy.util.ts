import type { ICreatorProfile, ISecondaryVideo } from '../types/creative.types';
import { pickCreativeThumbnailUrl, resolveCreatorAvatarUrl } from './creative-response.util';

type CreativePlain = Record<string, unknown>;

function pickUrl(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim().startsWith('https://')) return v.trim();
  }
  return undefined;
}

/** Ordered HTTPS URLs to try when the primary TikTok CDN link is expired. */
export function collectThumbnailProxyCandidates(
  creative: CreativePlain,
  index: number,
  kind: 'thumbnail' | 'avatar',
): string[] {
  const seen = new Set<string>();
  const add = (url: string | undefined) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
  };

  add(pickCreativeThumbnailUrl(creative, index, kind));

  const creator = creative.creator as ICreatorProfile | undefined;

  if (index <= 0) {
    if (kind === 'avatar') {
      add(resolveCreatorAvatarUrl(creative));
      add(creator?.avatarUrl);
      add(pickUrl(creative.shopAvatarUrl));
      add(pickUrl(creative.productPrimaryImageUrl));
      add(pickUrl(creative.thumbnailUrl));
    } else {
      add(pickUrl(creative.thumbnailUrl, creator?.avatarUrl));
      add(pickUrl(creative.productPrimaryImageUrl));
      add(resolveCreatorAvatarUrl(creative));
      add(pickUrl(creative.shopAvatarUrl));
    }
  } else {
    const related = Array.isArray(creative.relatedVideos)
      ? (creative.relatedVideos as ISecondaryVideo[])
      : [];
    const node = related[index - 1];
    if (node) {
      if (kind === 'avatar') {
        add(pickUrl(node.creator?.avatarUrl));
      } else {
        add(pickUrl(node.thumbnailUrl, node.creator?.avatarUrl));
      }
    }
    add(pickUrl(creative.productPrimaryImageUrl));
  }

  return [...seen];
}

/** Neutral placeholder when every CDN URL fails — always return 200 for <img> tags. */
export const IMAGE_PROXY_PLACEHOLDER = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
  <rect width="400" height="400" fill="#1a1a22"/>
  <circle cx="200" cy="168" r="52" fill="#2d2d3a"/>
  <rect x="96" y="248" width="208" height="20" rx="10" fill="#2d2d3a"/>
</svg>`,
  'utf8',
);

export function sendImagePlaceholder(res: {
  setHeader: (k: string, v: string) => void;
  status: (n: number) => void;
  end: (b?: Buffer) => void;
}): void {
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.setHeader('X-Image-Source', 'placeholder');
  res.status(200);
  res.end(IMAGE_PROXY_PLACEHOLDER);
}
