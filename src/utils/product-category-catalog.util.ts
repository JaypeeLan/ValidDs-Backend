import { PRODUCT_CATEGORIES, SUBCATEGORIES_BY_CATEGORY } from '../api/products/product.constants';

/** L1 categories in canonical order, limited to those present in the database. */
export function filterL1CategoriesWithProducts(dbL1: string[]): string[] {
  const have = new Set(dbL1.map((c) => c.trim()).filter(Boolean));
  return PRODUCT_CATEGORIES.filter((c) => have.has(c));
}

/**
 * Subcategories in canonical order per L1, limited to those with products.
 * When `category` is set, returns a flat array for that L1 only.
 */
export function filterSubcategoriesWithProducts(
  dbByL1: Record<string, string[]>,
  category?: string,
): Record<string, string[]> | string[] {
  if (category) {
    const canonical = SUBCATEGORIES_BY_CATEGORY[category] ?? [];
    const have = new Set((dbByL1[category] ?? []).map((s) => s.trim()).filter(Boolean));
    return canonical.filter((s) => have.has(s));
  }

  const out: Record<string, string[]> = {};
  for (const l1 of PRODUCT_CATEGORIES) {
    const have = new Set((dbByL1[l1] ?? []).map((s) => s.trim()).filter(Boolean));
    const subs = (SUBCATEGORIES_BY_CATEGORY[l1] ?? []).filter((s) => have.has(s));
    if (subs.length > 0) {
      out[l1] = subs;
    }
  }
  return out;
}
