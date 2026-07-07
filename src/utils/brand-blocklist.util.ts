/**
 * Branded / big-name product guard.
 *
 * Products from major brands (e.g. "Samsung Galaxy Buds 5 Pro", iPhones, PlayStation)
 * are not viable dropshipping candidates: they carry trademark/reseller restrictions,
 * MAP pricing, and razor-thin margins. This module identifies such listings by their
 * title so ingest can reject them and cleanup can purge existing rows.
 *
 * Matching is whole-token (word/phrase) against a normalized title, so ambiguous
 * substrings are avoided — e.g. "apple" is intentionally NOT blocked (would kill
 * legitimate "apple cider vinegar" products); Apple hardware is matched via
 * specific product terms like "iphone" / "airpods" instead.
 */

/** Curated default terms — normalized (lowercase, single-spaced) whole tokens/phrases. */
const DEFAULT_BLOCKED_BRAND_TERMS: readonly string[] = [
  // Apple hardware (never bare "apple")
  'iphone',
  'ipad',
  'macbook',
  'imac',
  'airpods',
  'airtag',
  'apple watch',
  'apple pencil',
  // Samsung
  'samsung',
  'galaxy buds',
  'galaxy watch',
  'galaxy tab',
  'galaxy note',
  'galaxy z',
  'galaxy fold',
  'galaxy flip',
  // Google
  'google pixel',
  'pixel buds',
  // Gaming consoles
  'playstation',
  'xbox',
  'nintendo',
  'nintendo switch',
  // Audio
  'bose',
  'sonos',
  'jbl',
  'beats by dre',
  'beats studio',
  'beats solo',
  'sony wh',
  'sony wf',
  // Other name-brand electronics
  'dyson',
  'gopro',
  'fitbit',
  'garmin',
  'oculus',
  'meta quest',
  // Luxury / designer fashion
  'rolex',
  'gucci',
  'louis vuitton',
  'prada',
  'chanel',
  'yeezy',
  'air jordan',
  'ray ban',
];

function envTerms(): string[] {
  const raw = process.env.PRODUCT_BLOCKED_BRAND_TERMS ?? '';
  return raw
    .split(',')
    .map((t) => normalizeText(t))
    .filter((t) => t.length > 0);
}

function guardEnabled(): boolean {
  // Enabled by default; opt out with PRODUCT_BRAND_GUARD_ENABLED=false.
  return String(process.env.PRODUCT_BRAND_GUARD_ENABLED ?? 'true').toLowerCase() !== 'false';
}

/**
 * Compatibility markers — when a brand token is preceded by one of these, the
 * listing is an accessory *for* that brand (e.g. "case FOR iphone"), not the
 * branded device itself. Such products are fine for dropshipping.
 */
const COMPAT_MARKERS = new Set([
  'for',
  'with',
  'compatible',
  'fit',
  'fits',
  'fitting',
  'suitable',
  'designed',
  'replacement',
  'replaces',
  'support',
  'supports',
]);

/**
 * Accessory nouns/phrases — when present anywhere, the listing is an accessory
 * (case, charger, stand, screen protector, …), not the branded device. These are
 * legitimate dropshipping products even if they name a brand for compatibility.
 */
const ACCESSORY_TERMS: readonly string[] = [
  'case',
  'cases',
  'cover',
  'covers',
  'protector',
  'protectors',
  'screen protector',
  'tempered glass',
  'film',
  'stand',
  'holder',
  'phone holder',
  'mount',
  'car mount',
  'charger',
  'chargers',
  'charging station',
  'charging dock',
  'cable',
  'cables',
  'adapter',
  'adapters',
  'dock',
  'grip',
  'band',
  'bands',
  'strap',
  'straps',
  'skin',
  'skins',
  'sleeve',
  'pouch',
  'bag',
  'tripod',
  'lens',
  'keyboard',
  'wallet',
  'kickstand',
  'power bank',
  'powerbank',
  'ring light',
  'pencil',
  'stylus',
];

/** Lowercase, strip non-alphanumerics to single spaces. */
export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** All active blocked terms (defaults + env additions), de-duplicated. */
export function blockedBrandTerms(): string[] {
  return Array.from(new Set([...DEFAULT_BLOCKED_BRAND_TERMS, ...envTerms()]));
}

function hasAccessoryTerm(normalized: string): boolean {
  const haystack = ` ${normalized} `;
  return ACCESSORY_TERMS.some((t) => haystack.includes(` ${t} `));
}

/** Index positions where the term (token sequence) starts within tokens. */
function termStartIndexes(tokens: string[], term: string): number[] {
  const parts = term.split(' ');
  const out: number[] = [];
  for (let i = 0; i + parts.length <= tokens.length; i += 1) {
    let match = true;
    for (let j = 0; j < parts.length; j += 1) {
      if (tokens[i + j] !== parts[j]) {
        match = false;
        break;
      }
    }
    if (match) out.push(i);
  }
  return out;
}

/**
 * Returns the matched brand term if the title is an actual branded / non-dropship
 * product, otherwise null.
 *
 * Skips accessories that merely name a brand for compatibility — either because an
 * accessory noun is present (case, charger, stand, …) or because every brand mention
 * is preceded by a compatibility marker ("for iphone", "compatible with samsung").
 */
export function matchedBlockedBrand(title: string): string | null {
  if (!guardEnabled()) return null;
  if (typeof title !== 'string' || !title.trim()) return null;

  const normalized = normalizeText(title);
  if (!normalized) return null;

  // Accessory listings are dropship-friendly even when they name a brand.
  if (hasAccessoryTerm(normalized)) return null;

  const tokens = normalized.split(' ');
  for (const term of blockedBrandTerms()) {
    const starts = termStartIndexes(tokens, term);
    if (starts.length === 0) continue;
    // A mention is a real product only when NO compatibility marker precedes it —
    // this handles lists like "for iPhone, Samsung, Kindle" where only the first
    // item gets the "for" (all are compatibility, not the product itself).
    const isProductMention = starts.some(
      (idx) => !tokens.slice(0, idx).some((t) => COMPAT_MARKERS.has(t)),
    );
    if (isProductMention) return term;
  }
  return null;
}

export function isBlockedBrandProduct(title: string): boolean {
  return matchedBlockedBrand(title) !== null;
}
