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

const GENERIC_VIDEO_BRAND_TAGS = new Set([
  'glowup',
  'glassskin',
  'glassskinbundle',
  'tiktokshop',
  'tiktokshopping',
  'ttsdelight',
  'tiktokshopcreatorpicks',
  'tiktokshopnewarrivals',
  'tiktokshopjumpstart',
  'tiktokshoprestock',
  'tiktokshopspringglowup',
  'koreanskincare',
  'koreanskincareproducts',
  'skincare',
  'bundle',
  'sale',
  'fyp',
  'viral',
  'dealsforyoudays',
  'makeup',
  'beauty',
  'cosmetics',
  'concealer',
  'colorcorrection',
  'colorcorrector',
  'stitch',
  'productreview',
  'empties',
  'decemberempties',
  'makeuplook',
  'undereyecorrector',
  'ccundereyecorrector',
  'darkcircles',
  'makeuphacks',
  'beautytips',
  'makeupdeals',
  'tiktokfinds',
  'makeupsale',
  'beautycommunity',
]);

function normalizeBrandStem(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function stemsAlign(a: string, b: string): boolean {
  return a === b || a.startsWith(b) || b.startsWith(a);
}

function extractProductBrandStems(productTitle: string, shopName?: string): Set<string> {
  const stems = new Set<string>();
  const titleCf = productTitle.toLowerCase();
  const bracket = productTitle.match(/^\s*\[([^\]]{2,40})\]/);
  if (bracket) {
    const b = normalizeBrandStem(bracket[1]);
    if (b.length >= 3) stems.add(b);
  }
  const shop = (shopName ?? '').trim();
  if (!shop) return stems;
  const shopWords = shop
    .toLowerCase()
    .replace(/[,.-]+/g, ' ')
    .split(/\s+/)
    .filter(
      (w) =>
        w &&
        !['inc', 'llc', 'ltd', 'co', 'store', 'shop', 'official', 'us', 'usa', 'uk'].includes(w),
    );
  if (shopWords.length === 0) return stems;
  const firstInTitle = Boolean(titleCf && shopWords[0] && titleCf.includes(shopWords[0]));
  if (shopWords.length <= 3 && firstInTitle) {
    for (const w of shopWords.slice(0, 2)) {
      if (w.length >= 3) stems.add(normalizeBrandStem(w));
    }
    if (shopWords.length >= 2) {
      stems.add(normalizeBrandStem(`${shopWords[0]}${shopWords[1]}`));
    }
  } else if (titleCf && firstInTitle) {
    stems.add(normalizeBrandStem(shopWords[0]));
    if (shopWords.length >= 2) {
      const combined = `${shopWords[0]}${shopWords[1]}`;
      if (titleCf.replace(/[^a-z0-9]/g, '').includes(combined)) {
        stems.add(normalizeBrandStem(combined));
      }
    }
  }
  return stems;
}

function extractVideoBrandMentions(item: {
  description?: unknown;
  hashtags?: unknown;
}): Set<string> {
  const stems = new Set<string>();
  const text = typeof item.description === 'string' ? item.description : '';
  for (const m of text.matchAll(/\b([A-Za-z][A-Za-z0-9]{2,})'s\b/g)) {
    const s = normalizeBrandStem(m[1]);
    if (s.length >= 4) stems.add(s);
  }
  const tags = Array.isArray(item.hashtags) ? item.hashtags : [];
  for (const raw of tags) {
    const tag = normalizeBrandStem(String(raw).replace(/^#/, ''));
    if (tag.length < 4 || GENERIC_VIDEO_BRAND_TAGS.has(tag)) continue;
    stems.add(tag);
  }
  return stems;
}

function videoBrandConflictsWithProduct(
  item: { description?: unknown; hashtags?: unknown },
  productTitle: string,
  shopName?: string,
): boolean {
  const productBrands = extractProductBrandStems(productTitle, shopName);
  if (productBrands.size === 0) return false;

  const prodTokens = productTitleTokens(productTitle);
  const videoBrands = extractVideoBrandMentions(item);
  for (const vb of videoBrands) {
    if ([...prodTokens].some((t) => stemsAlign(t, vb))) continue;
    if ([...productBrands].some((pb) => stemsAlign(pb, vb))) continue;
    return true;
  }
  return false;
}

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
  opts?: {
    minScore?: number;
    minOverlap?: number;
    minDistinctiveOverlap?: number;
    allowOtherBrands?: boolean;
  },
): boolean {
  if (!opts?.allowOtherBrands && videoBrandConflictsWithProduct(item, productTitle)) return false;

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

/**
 * Relaxed "same product, best match" gate for secondary creatives and ads.
 * Keeps the brand-conflict guard; only loosens the token thresholds.
 */
function videoMatchesProductLoose(
  item: { description?: unknown; hashtags?: unknown },
  productTitle: string,
): boolean {
  return videoMatchesProduct(item, productTitle, {
    minScore: 0.2,
    minOverlap: 1,
    minDistinctiveOverlap: 1,
  });
}

function captionProductMismatchReason(
  doc: Record<string, unknown>,
  productTitle: string,
  listingVerified: boolean,
  loose = false,
): string | null {
  const shopName = String(doc.shopName ?? '').trim() || undefined;
  const originalCaption = String(doc.originalCaption ?? '').trim();
  const item = {
    description: originalCaption || doc.description,
    hashtags: doc.hashtags,
  };

  if (loose) {
    if (videoBrandConflictsWithProduct(item, productTitle, shopName)) {
      return `video caption references a different brand than ${productTitle.slice(0, 60)}`;
    }
    if (!videoItemText(item).trim()) return null;
    if (videoMatchesProductLoose(item, productTitle)) return null;
    return `video caption does not match product ${productTitle.slice(0, 60)}`;
  }

  if (videoBrandConflictsWithProduct(item, productTitle, shopName)) {
    return `video caption references a different brand than ${productTitle.slice(0, 60)}`;
  }
  if (originalCaption && doc.angle) {
    if (
      !videoMatchesProduct(item, productTitle, {
        minScore: 0.28,
        minOverlap: 2,
        minDistinctiveOverlap: 1,
      })
    ) {
      return `video caption does not match product ${productTitle.slice(0, 60)}`;
    }
    return null;
  }
  if (!videoItemText(item).trim()) {
    return listingVerified ? null : 'video caption missing — cannot verify product match';
  }

  if (videoMatchesProduct(item, productTitle)) return null;
  const prefix = listingVerified ? 'listing-verified creative caption' : 'video caption';
  return `${prefix} does not match product ${productTitle.slice(0, 60)}`;
}

export function creativeVideoProductMatchReason(doc: Record<string, unknown>): string | null {
  const ext = String(doc.externalVideoId ?? '');
  if (ext.startsWith('meta:')) return null;

  const productTitle = String(doc.productName ?? '').trim();
  if (productTitle.length < 4) return null;

  // Primary discovery and anchor/thumbnail listing-verified rows stay strict;
  // other secondary creatives + ads use the loose "same product, any brand" gate.
  if (!doc.isPrimaryDiscovery && doc.listingVerified !== true) {
    return captionProductMismatchReason(doc, productTitle, false, true);
  }

  return captionProductMismatchReason(doc, productTitle, doc.listingVerified === true);
}

export function creativeVideoMatchesProduct(doc: Record<string, unknown>): boolean {
  return creativeVideoProductMatchReason(doc) === null;
}
