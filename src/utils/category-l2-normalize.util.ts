import { CATEGORY_TAXONOMY, SUBCATEGORIES_BY_CATEGORY } from '../api/products/product.constants';

/**
 * Raw L2 labels from TikTok Shop / AI → canonical L2 in CATEGORY_TAXONOMY.
 * Keep in sync with scraper taxonomy normalization when added there.
 */
export const CATEGORY_L2_ALIASES: Record<string, Record<string, string>> = {
  'Beauty & Personal Care': {
    Makeup: 'Makeup & Cosmetics',
    'Skin Care': 'Skincare',
    Skincare: 'Skincare',
    Fragrance: 'Fragrance',
  },
  Fashion: {
    'Bags & Luggage': 'Bags & Accessories',
    Jewelry: 'Jewellery',
    Jewellery: 'Jewellery',
    Footwear: 'Shoes & Footwear',
    Shoes: 'Shoes & Footwear',
    Lingerie: 'Shapewear & Underwear',
  },
  'Health & Wellness': {
    'Pain Relief': 'Recovery & Pain Relief',
    'Health Care': 'Medical Supplies',
    'Sports Nutrition': 'Vitamins & Supplements',
    Supplements: 'Vitamins & Supplements',
  },
  'Home & Kitchen': {
    Bedding: 'Bedding & Bath',
    'Home Décor': 'Home Decor',
    'Home Decor': 'Home Decor',
    'Storage & Organization': 'Storage & Organisation',
    'Storage & Organisation': 'Storage & Organisation',
    'Kitchen & Dining': 'Cookware & Bakeware',
    Cleaning: 'Cleaning',
  },
  'Sports & Outdoors': {
    'Outdoor Recreation': 'Outdoor & Camping',
    'Knives & Tools': 'Outdoor & Camping',
    'Sports & Fitness': 'Gym & Training',
  },
  'Electronics & Tech': {
    'Phone Accessories': 'Phone Accessories',
    'Mobile Phone Accessories': 'Phone Accessories',
    'Computer Accessories': 'Computers & Peripherals',
    'Headphones & Earbuds': 'Audio',
    Audio: 'Audio',
  },
};

const CANONICAL_L2_BY_L1 = SUBCATEGORIES_BY_CATEGORY;

function canonicalSetForL1(l1: string): Set<string> {
  return new Set(CANONICAL_L2_BY_L1[l1] ?? []);
}

/** Map a stored L2 to the canonical taxonomy label for an L1 (or return trimmed raw if unknown). */
export function normalizeCategoryL2(l1: string, rawL2: string): string {
  const trimmed = rawL2.trim();
  if (!trimmed || !l1) return trimmed;

  const canonical = canonicalSetForL1(l1);
  if (canonical.has(trimmed)) return trimmed;

  const alias = CATEGORY_L2_ALIASES[l1]?.[trimmed];
  if (alias && canonical.has(alias)) return alias;

  const lower = trimmed.toLowerCase();
  for (const c of canonical) {
    if (c.toLowerCase() === lower) return c;
  }

  return trimmed;
}

/** True when L2 is a valid canonical subcategory for L1 (after normalization). */
export function isCanonicalCategoryL2(l1: string, rawL2: string): boolean {
  const normalized = normalizeCategoryL2(l1, rawL2);
  return canonicalSetForL1(l1).has(normalized);
}

/** Distinct L2 per L1 with values normalized to canonical labels where possible. */
export function normalizeSubcategoriesByL1(
  dbByL1: Record<string, string[]>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [l1, subs] of Object.entries(dbByL1)) {
    const set = new Set<string>();
    for (const raw of subs) {
      const n = normalizeCategoryL2(l1, raw);
      if (n) set.add(n);
    }
    out[l1] = [...set].sort((a, b) => a.localeCompare(b));
  }
  return out;
}

/** Expand feed filter values to include raw DB aliases (e.g. Makeup → Makeup & Cosmetics). */
export function expandSubcategoryFilterValues(subcategories: string[]): string[] {
  const expanded = new Set<string>();
  for (const sub of subcategories) {
    const s = sub.trim();
    if (!s) continue;
    expanded.add(s);
    for (const aliases of Object.values(CATEGORY_L2_ALIASES)) {
      for (const [raw, canonical] of Object.entries(aliases)) {
        if (canonical === s) expanded.add(raw);
      }
    }
    for (const subs of Object.values(CANONICAL_L2_BY_L1)) {
      for (const c of subs) {
        if (c.toLowerCase() === s.toLowerCase()) expanded.add(c);
      }
    }
  }
  return [...expanded];
}

/** All canonical L2 keys for an L1 (for tests / docs). */
export function canonicalSubcategoriesForL1(l1: string): string[] {
  return Object.keys(CATEGORY_TAXONOMY[l1] ?? {});
}

/** Expand an L3 label to taxonomy case variants within an L1/L2 (e.g. lip color ↔ Lip Color). */
export function expandCategoryL3FilterValues(l1: string, rawL2: string, rawL3: string): string[] {
  const trimmed = rawL3.trim();
  if (!trimmed) return [];

  const expanded = new Set<string>([trimmed]);
  const canonicalL2 = normalizeCategoryL2(l1, rawL2);
  const leaves = CATEGORY_TAXONOMY[l1]?.[canonicalL2] ?? [];
  const lower = trimmed.toLowerCase();

  for (const leaf of leaves) {
    if (leaf.toLowerCase() === lower) {
      expanded.add(leaf);
    }
  }

  return [...expanded];
}
