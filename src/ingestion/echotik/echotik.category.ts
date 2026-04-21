/**
 * echotik.category.ts
 *
 * Maps EchoTik numeric category IDs to human-readable TikTok Shop category names.
 *
 * EchoTik returns three levels of numeric IDs (category_id, category_l2_id, category_l3_id).
 * This module provides best-effort name resolution. Unknown IDs are returned as-is
 * (prefixed with 'Category ') so nothing breaks when new categories appear.
 *
 * To extend: add new IDs to the appropriate level map below.
 * Category IDs are TikTok Shop US-specific; other regions may differ.
 */

// ── Level 1 (Root categories) ─────────────────────────────────────────────────

const L1_NAMES: Record<string, string> = {
  '600001': 'Beauty & Personal Care',
  '600002': 'Women\'s Clothing',
  '600003': 'Health',
  '600004': 'Kitchen & Dining',
  '600005': 'Sports & Outdoors',
  '600006': 'Home & Garden',
  '600007': 'Electronics',
  '600008': 'Jewelry & Accessories',
  '600009': 'Pet Supplies',
  '600010': 'Baby & Maternity',
  '600011': 'Men\'s Clothing',
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
  '700440': 'Women\'s Clothing',
  '700441': 'Men\'s Clothing',
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

// ── Level 2 (Sub-categories) ──────────────────────────────────────────────────

const L2_NAMES: Record<string, string> = {
  // Beauty
  '600003': 'Skin Care',
  '600004': 'Hair Care',
  '600005': 'Makeup',
  '600006': 'Fragrance',
  '600007': 'Nail Care',
  // Health
  '600020': 'Vitamins & Supplements',
  '600021': 'Personal Care',
  '600022': 'Medical Supplies',
  // Kitchen
  '600030': 'Cookware',
  '600031': 'Kitchen Appliances',
  '600032': 'Storage & Organization',
  // Food & Beverages
  '914824': 'Beverages',
  '914825': 'Snacks',
  '914826': 'Coffee & Tea',
  '914827': 'Nutritional Supplements',
  '914828': 'Cooking Ingredients',
};

// ── Level 3 (Sub-sub-categories) ─────────────────────────────────────────────

const L3_NAMES: Record<string, string> = {
  '600011': 'Cleansers',
  '600012': 'Moisturizers',
  '600013': 'Serums',
  '600014': 'Sunscreen',
  '917512': 'Energy Drinks & Hydration',
  '917513': 'Protein Drinks',
  '917514': 'Herbal Teas',
};

// ── Lookup helpers ─────────────────────────────────────────────────────────────

export function getCategoryL1Name(id: string | undefined): string {
  if (!id) return 'General';
  return L1_NAMES[id] ?? `Category ${id}`;
}

export function getCategoryL2Name(id: string | undefined): string | undefined {
  if (!id) return undefined;
  return L2_NAMES[id] ?? `SubCategory ${id}`;
}

export function getCategoryL3Name(id: string | undefined): string | undefined {
  if (!id) return undefined;
  return L3_NAMES[id] ?? `SubCategory ${id}`;
}

/**
 * Builds a human-readable category path from the three level IDs.
 * e.g. "Food & Beverages / Beverages / Energy Drinks & Hydration"
 */
export function buildCategoryPath(
  l1Id: string | undefined,
  l2Id: string | undefined,
  l3Id: string | undefined
): string {
  const parts = [
    getCategoryL1Name(l1Id),
    getCategoryL2Name(l2Id),
    getCategoryL3Name(l3Id),
  ].filter((p): p is string => Boolean(p));
  return parts.join(' / ');
}
