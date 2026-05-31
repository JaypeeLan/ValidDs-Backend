/** Extract playable / cover / avatar URLs from TikTok aweme JSON (ScrapeCreators profile/videos). */

function httpsUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const u = value.trim();
  if (u.startsWith('//')) return `https:${u}`;
  if (u.startsWith('https://')) return u;
  if (u.startsWith('http://')) return `https://${u.slice(7)}`;
  return undefined;
}

function urlFromList(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  for (const item of value) {
    const u = typeof item === 'string' ? httpsUrl(item) : urlFromBlock(item);
    if (u) return u;
  }
  return undefined;
}

function urlFromBlock(block: unknown): string | undefined {
  if (!block) return undefined;
  if (typeof block === 'string') return httpsUrl(block);
  if (typeof block === 'object' && block !== null) {
    const o = block as Record<string, unknown>;
    return urlFromList(o.url_list) || urlFromList(o.urlList) || httpsUrl(o.url) || httpsUrl(o.uri);
  }
  return undefined;
}

export function extractAwemeThumbnail(
  rawVideo: Record<string, unknown> | null | undefined,
): string | undefined {
  if (!rawVideo || typeof rawVideo !== 'object') return undefined;
  const videoBlock =
    rawVideo.video && typeof rawVideo.video === 'object'
      ? (rawVideo.video as Record<string, unknown>)
      : {};

  for (const block of [
    videoBlock.origin_cover,
    videoBlock.originCover,
    videoBlock.dynamic_cover,
    videoBlock.dynamicCover,
    videoBlock.cover,
    videoBlock.share_cover,
    videoBlock.shareCover,
    rawVideo.origin_cover,
    rawVideo.originCover,
    rawVideo.cover,
    rawVideo.video_cover,
    rawVideo.cover_url,
    rawVideo.coverUrl,
  ]) {
    const u = urlFromBlock(block);
    if (u) return u;
  }
  return undefined;
}

export function extractAwemeAvatar(
  author: Record<string, unknown> | null | undefined,
): string | undefined {
  if (!author || typeof author !== 'object') return undefined;
  for (const key of [
    'avatar_larger',
    'avatarLarger',
    'avatar_medium',
    'avatarMedium',
    'avatar_thumb',
    'avatarThumb',
  ]) {
    const u = urlFromBlock(author[key]);
    if (u) return u;
  }
  return undefined;
}

export function extractAwemeVideoPlayUrl(
  rawVideo: Record<string, unknown> | null | undefined,
): string | undefined {
  if (!rawVideo || typeof rawVideo !== 'object') return undefined;
  const videoBlock =
    rawVideo.video && typeof rawVideo.video === 'object'
      ? (rawVideo.video as Record<string, unknown>)
      : {};

  for (const block of [
    videoBlock.play_addr,
    videoBlock.playAddr,
    videoBlock.download_addr,
    videoBlock.downloadAddr,
    rawVideo.play_addr,
    rawVideo.playAddr,
  ]) {
    const u = urlFromBlock(block);
    if (u) return u;
  }
  return httpsUrl(videoBlock.play_url) || httpsUrl(videoBlock.playUrl);
}

export function resolveAwemeId(
  rawVideo: Record<string, unknown> | null | undefined,
): string | undefined {
  if (!rawVideo || typeof rawVideo !== 'object') return undefined;
  const id = String(rawVideo.aweme_id ?? rawVideo.awemeId ?? rawVideo.id ?? '').trim();
  return id || undefined;
}

export type AwemeMediaPatch = {
  videoPlayUrl?: string;
  thumbnailUrl?: string;
  creator?: {
    avatarUrl?: string;
    followers?: number;
    following?: number;
    totalLikes?: number;
    verified?: boolean;
  };
};

export function extractAwemeMedia(
  rawVideo: Record<string, unknown> | null | undefined,
): AwemeMediaPatch | null {
  if (!rawVideo || typeof rawVideo !== 'object') return null;

  const videoPlayUrl = extractAwemeVideoPlayUrl(rawVideo);
  const thumbnailUrl = extractAwemeThumbnail(rawVideo);
  const author =
    rawVideo.author && typeof rawVideo.author === 'object'
      ? (rawVideo.author as Record<string, unknown>)
      : undefined;
  const avatarUrl = extractAwemeAvatar(author);

  if (!videoPlayUrl && !thumbnailUrl && !avatarUrl) return null;

  const pos = (v: unknown): number | undefined => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };

  return {
    ...(videoPlayUrl ? { videoPlayUrl } : {}),
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    ...(avatarUrl || author
      ? {
          creator: {
            ...(avatarUrl ? { avatarUrl } : {}),
            ...(author
              ? {
                  followers: pos(author.follower_count ?? author.followerCount),
                  following: pos(author.following_count ?? author.followingCount),
                  totalLikes: pos(
                    author.total_favorited ?? author.totalFavorited ?? author.heart_count,
                  ),
                  verified: Boolean(author.verification_type ?? author.verified),
                }
              : {}),
          },
        }
      : {}),
  };
}
