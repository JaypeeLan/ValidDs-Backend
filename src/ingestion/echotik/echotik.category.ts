/**
 * echotik.category.ts
 *
 * Resolves EchoTik numeric category IDs to human-readable TikTok-Shop names.
 *
 * Lookups consult three sources in order:
 *   1. The dynamic in-memory cache populated by `echotik.categories.ts`
 *      (sourced from EchoTik's `/category/l1|l2|l3` endpoints — authoritative).
 *   2. A small static fallback map for the most common IDs, so we still emit
 *      sensible names if the dynamic load hasn't happened yet (e.g. during
 *      ingestion before the first warm-up, or in unit tests).
 *   3. `undefined` (or `'Uncategorised'` for L1, which is a required field on
 *      the Product model). We deliberately never emit `"Category 600028"` —
 *      raw IDs leaking into the UI is a bug, not a useful fallback.
 */

import { lookupCategoryName } from './echotik.categories';

// ── Static fallback maps (only used when the dynamic cache misses) ───────────

const L1_FALLBACK: Record<string, string> = {
  '600001': 'Beauty & Personal Care',
  '600002': "Women's Clothing",
  '600003': 'Health',
  '600004': 'Kitchen & Dining',
  '600005': 'Sports & Outdoors',
  '600006': 'Home & Garden',
  '600007': 'Electronics',
  '600008': 'Jewelry & Accessories',
  '600009': 'Pet Supplies',
  '600010': 'Baby & Maternity',
  '600011': "Men's Clothing",
  '600012': 'Toys & Games',
  '600013': 'Shoes',
  '600014': 'Bags & Luggage',
  '600015': 'Automotive',
  '600016': 'Office & School Supplies',
  '600017': 'Food & Beverages',
  '600018': 'Arts, Crafts & Sewing',
  '600019': 'Tools & Home Improvement',
  '700434': 'Beauty & Personal Care',
  '700435': 'Health',
  '700436': 'Home & Garden',
  '700437': 'Food & Beverages',
  '700438': 'Sports & Outdoors',
  '700439': 'Electronics',
  '700440': "Women's Clothing",
  '700441': "Men's Clothing",
  '700442': 'Jewelry & Accessories',
  '700443': 'Kitchen & Dining',
  '700444': 'Pet Supplies',
  '700445': 'Baby & Maternity',
  '700446': 'Shoes',
  '700447': 'Bags & Luggage',
  '700448': 'Toys & Games',
  '700449': 'Arts, Crafts & Sewing',
  '700450': 'Automotive',
  '700451': 'Office & School Supplies',
};

const L2_FALLBACK: Record<string, string> = {
  '600003': 'Skin Care',
  '600004': 'Hair Care',
  '600005': 'Makeup',
  '600006': 'Fragrance',
  '600007': 'Nail Care',
  '600020': 'Vitamins & Supplements',
  '600021': 'Personal Care',
  '600022': 'Medical Supplies',
  '600030': 'Cookware',
  '600031': 'Kitchen Appliances',
  '600032': 'Storage & Organization',
  '914824': 'Beverages',
  '914825': 'Snacks',
  '914826': 'Coffee & Tea',
  '914827': 'Nutritional Supplements',
  '914828': 'Cooking Ingredients',
};

const L3_FALLBACK: Record<string, string> = {
  '600011': 'Cleansers',
  '600012': 'Moisturizers',
  '600013': 'Serums',
  '600014': 'Sunscreen',
  '917512': 'Energy Drinks & Hydration',
  '917513': 'Protein Drinks',
  '917514': 'Herbal Teas',
};

// ── Lookup helpers ───────────────────────────────────────────────────────────

const UNCATEGORISED = 'Uncategorised';

function resolve(id: string | undefined, fallback: Record<string, string>): string | undefined {
  if (!id) return undefined;
  const dynamic = lookupCategoryName(id);
  if (dynamic) return dynamic;
  return fallback[id];
}

export function getCategoryL1Name(id: string | undefined): string {
  return resolve(id, L1_FALLBACK) ?? UNCATEGORISED;
}

export function getCategoryL2Name(id: string | undefined): string | undefined {
  return resolve(id, L2_FALLBACK);
}

export function getCategoryL3Name(id: string | undefined): string | undefined {
  return resolve(id, L3_FALLBACK);
}

/**
 * Builds a human-readable category path from the three level IDs, e.g.
 * "Food & Beverages / Beverages / Energy Drinks & Hydration". Drops any level
 * we can't resolve so we never produce "Food / SubCategory 914999".
 */
export function buildCategoryPath(
  l1Id: string | undefined,
  l2Id: string | undefined,
  l3Id: string | undefined
): string {
  const l1 = getCategoryL1Name(l1Id);
  const parts = [
    l1 === UNCATEGORISED ? undefined : l1,
    getCategoryL2Name(l2Id),
    getCategoryL3Name(l3Id),
  ].filter((p): p is string => Boolean(p));
  return parts.length > 0 ? parts.join(' / ') : UNCATEGORISED;
}
