const TIKTOK_VIDEO_ID_RE = /\/video\/(\d+)/i;

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
