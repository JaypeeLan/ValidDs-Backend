const META_AD_ID_RE = /^\d{5,}$/;
const META_ID_FROM_URL_RE = /[?&]id=(\d{5,})/i;

/** Numeric Ad Library id from viewer, archive/render, or `meta:{id}`. */
export function extractMetaAdIdFromUrl(url: string): string | null {
  const raw = String(url ?? '').trim();
  if (!raw) return null;
  if (raw.startsWith('meta:')) {
    const tail = raw.slice(5).trim();
    return META_AD_ID_RE.test(tail) ? tail : null;
  }
  const m = raw.match(META_ID_FROM_URL_RE);
  if (m && META_AD_ID_RE.test(m[1]!)) return m[1]!;
  return null;
}

/** Canonical `https://www.facebook.com/ads/library/?id={id}` (no tokens). */
export function normalizeMetaAdLibraryUrl(url: string): string | null {
  const id = extractMetaAdIdFromUrl(url);
  if (!id) return null;
  return `https://www.facebook.com/ads/library/?id=${id}`;
}

export function isMetaAdLibraryUrl(url: string): boolean {
  const u = String(url ?? '').toLowerCase();
  return u.includes('facebook.com/ads/library') || u.includes('facebook.com/ads/archive');
}
