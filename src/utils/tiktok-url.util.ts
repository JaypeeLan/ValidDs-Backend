const TIKTOK_VIDEO_ID_RE = /\/video\/(\d+)/i;
const TIKTOK_EMBED_ID_RE = /embed\/v2\/(\d+)/i;

export function isTikTokPostUrl(url: string): boolean {
  const u = String(url ?? '').trim();
  return /tiktok\.com/i.test(u) && TIKTOK_VIDEO_ID_RE.test(u);
}

export function extractTikTokVideoId(url: string): string | null {
  const m = String(url ?? '')
    .trim()
    .match(TIKTOK_VIDEO_ID_RE);
  return m?.[1] ?? null;
}

/** Canonical TikTok post URL for opening the video in the TikTok app/site. */
export function resolveCreativeTikTokUrl(input: {
  tiktokPostUrl?: string | null;
  embedUrl?: string | null;
  externalVideoId?: string | null;
  creator?: { handle?: string | null; tiktokPostUrl?: string | null } | null;
}): string | null {
  for (const raw of [input.tiktokPostUrl, input.creator?.tiktokPostUrl, input.embedUrl]) {
    const url = String(raw ?? '').trim();
    if (isTikTokPostUrl(url)) return url;
    const embedId = url.match(TIKTOK_EMBED_ID_RE)?.[1];
    if (embedId) {
      const handle = String(input.creator?.handle ?? '')
        .replace(/^@/, '')
        .trim();
      if (handle) return `https://www.tiktok.com/@${handle}/video/${embedId}`;
    }
  }

  const handle = String(input.creator?.handle ?? '')
    .replace(/^@/, '')
    .trim();
  const ext = String(input.externalVideoId ?? '').trim();
  if (handle && /^\d+$/.test(ext)) {
    return `https://www.tiktok.com/@${handle}/video/${ext}`;
  }

  return null;
}
