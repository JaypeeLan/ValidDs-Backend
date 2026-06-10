/**
 * Caption ↔ product title matching for TikTok creatives.
 * Keep in sync with scraper/pipeline/video_product_match.py.
 */

const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'must',
  'can',
  'that',
  'this',
  'these',
  'those',
  'i',
  'you',
  'we',
  'they',
  'it',
  'of',
  'in',
  'on',
  'at',
  'to',
  'for',
  'with',
  'by',
  'from',
  'up',
  'out',
  'if',
  'as',
  'into',
  'through',
  'after',
  'before',
  'your',
  'our',
  'their',
  'its',
  'my',
  'just',
  'no',
  'not',
  'so',
  'but',
  'when',
  'what',
  'how',
  'get',
  'll',
  've',
  're',
  'new',
  'best',
  'free',
  'shop',
  'tiktok',
  'video',
  'official',
]);

const GENERIC_PRODUCT_TOKENS = new Set([
  'adult',
  'classic',
  'new',
  'original',
  'official',
  'authentic',
  'genuine',
  'men',
  'mens',
  'women',
  'womens',
  'kids',
  'kid',
  'unisex',
  'size',
  'clogs',
  'clog',
  'crocs',
  'croc',
  'shoe',
  'shoes',
  'sandal',
  'sandals',
  'slipper',
  'slippers',
  'footwear',
  'slide',
  'slides',
  'comfort',
  'comfortable',
  'soft',
  'lightweight',
]);

function tokenize(text: string): Set<string> {
  const tokens = new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean),
  );
  for (const t of [...tokens]) {
    if (t.length <= 1 || STOPWORDS.has(t)) tokens.delete(t);
  }
  return tokens;
}

function productTitleTokens(productTitle: string): Set<string> {
  return tokenize(productTitle.trim());
}

function videoItemText(item: { description?: unknown; hashtags?: unknown }): string {
  const desc = typeof item.description === 'string' ? item.description : '';
  const tags = Array.isArray(item.hashtags)
    ? item.hashtags.map((t) => String(t)).join(' ')
    : typeof item.hashtags === 'string'
      ? item.hashtags
      : '';
  return `${desc} ${tags}`.trim();
}

export function videoMatchesProduct(
  item: { description?: unknown; hashtags?: unknown },
  productTitle: string,
  opts?: { minScore?: number; minOverlap?: number; minDistinctiveOverlap?: number },
): boolean {
  const minScore = opts?.minScore ?? 0.28;
  const minOverlap = opts?.minOverlap ?? 2;
  const minDistinctiveOverlap = opts?.minDistinctiveOverlap ?? 1;

  const prodTokens = productTitleTokens(productTitle);
  if (prodTokens.size === 0) return false;

  const vtoks = tokenize(videoItemText(item));
  if (vtoks.size === 0) return false;

  const distinctive = [...prodTokens].filter(
    (t) => !GENERIC_PRODUCT_TOKENS.has(t) && t.length >= 3,
  );
  if (distinctive.length > 0) {
    const need = Math.min(minDistinctiveOverlap, distinctive.length);
    const hit = distinctive.filter((t) => vtoks.has(t)).length;
    if (hit < need) return false;
  }

  const overlap = [...prodTokens].filter((t) => vtoks.has(t)).length;
  const score = overlap / Math.max(1, prodTokens.size);
  const sigOverlap = [...prodTokens].filter((t) => vtoks.has(t) && t.length >= 3).length;

  return !(sigOverlap < minOverlap && score < minScore);
}

export function creativeVideoProductMatchReason(doc: Record<string, unknown>): string | null {
  const ext = String(doc.externalVideoId ?? '');
  if (ext.startsWith('meta:')) return null;
  if (doc.listingVerified === true) return null;

  const productTitle = String(doc.productName ?? '').trim();
  if (productTitle.length < 4) return null;

  const item = {
    description: doc.description,
    hashtags: doc.hashtags,
  };
  if (!videoItemText(item).trim()) {
    return 'video caption missing — cannot verify product match';
  }

  if (videoMatchesProduct(item, productTitle)) return null;
  return `video caption does not match product ${productTitle.slice(0, 60)}`;
}

export function creativeVideoMatchesProduct(doc: Record<string, unknown>): boolean {
  return creativeVideoProductMatchReason(doc) === null;
}
