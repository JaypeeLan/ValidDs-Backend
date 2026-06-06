import { PRODUCT_CATEGORIES } from '../api/products/product.constants';

const CANONICAL_L1_SET = new Set(PRODUCT_CATEGORIES);

/**
 * Raw L1 labels from TikTok Shop / Amazon-style catalogs → canonical L1 in CATEGORY_TAXONOMY.
 * Keep in sync with scraper taxonomy normalization when added there.
 */
export const CATEGORY_L1_ALIASES: Record<string, string> = {
  'Clothing, Shoes & Accessories': 'Fashion',
  'Clothing & Accessories': 'Fashion',
  'Apparel & Accessories': 'Fashion',
  'Fashion & Accessories': 'Fashion',
  'Fashion & Apparel': 'Fashion',
  'Jewelry & Watches': 'Fashion',
  'Travel & Luggage': 'Fashion',
  Shoes: 'Fashion',
  'Health & Household': 'Health & Wellness',
  Electronics: 'Electronics & Tech',
  'Pet Supplies': 'Pets',
  'Food, Beverages & Tobacco': 'Food & Beverage',
  'Food & Grocery': 'Food & Beverage',
  'Office Products': 'Tools & Home Improvement',
  'Fitness & Health': 'Health & Wellness',
  'Tech / Gadgets': 'Electronics & Tech',
  'Tech/Gadgets': 'Electronics & Tech',
};

/** Map a stored L1 to the canonical taxonomy label (or return trimmed raw if unknown). */
export function normalizeCategoryL1(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;

  if (CANONICAL_L1_SET.has(trimmed)) return trimmed;

  const alias = CATEGORY_L1_ALIASES[trimmed];
  if (alias && CANONICAL_L1_SET.has(alias)) return alias;

  const lower = trimmed.toLowerCase();
  for (const c of PRODUCT_CATEGORIES) {
    if (c.toLowerCase() === lower) return c;
  }

  return trimmed;
}

/** True when L1 is a valid canonical top-level category (after normalization). */
export function isCanonicalCategoryL1(raw: string): boolean {
  return CANONICAL_L1_SET.has(normalizeCategoryL1(raw));
}

/** Expand feed filter values to include raw DB aliases (e.g. Clothing, Shoes & Accessories → Fashion). */
export function expandCategoryL1FilterValues(categories: string[]): string[] {
  const expanded = new Set<string>();
  for (const cat of categories) {
    const s = cat.trim();
    if (!s) continue;
    expanded.add(s);
    const canonical = normalizeCategoryL1(s);
    if (canonical) expanded.add(canonical);
    for (const [raw, can] of Object.entries(CATEGORY_L1_ALIASES)) {
      if (can === canonical || can === s) expanded.add(raw);
    }
    for (const c of PRODUCT_CATEGORIES) {
      if (c.toLowerCase() === s.toLowerCase()) expanded.add(c);
    }
  }
  return [...expanded];
}
