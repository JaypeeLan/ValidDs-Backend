import { CATEGORY_L1_ALIASES, normalizeCategoryL1 } from './category-l1-normalize.util';

/**
 * Product categories excluded from discovery feeds and ingest.
 * Tech / gadgets (phones, earbuds, Samsung-class electronics) are out of scope.
 */
export const EXCLUDED_PRODUCT_L1_CATEGORIES = ['Electronics & Tech'] as const;

export type ExcludedProductL1Category = (typeof EXCLUDED_PRODUCT_L1_CATEGORIES)[number];

/** True when the L1 category is excluded from feeds (after alias normalization). */
export function isExcludedProductCategoryL1(raw: string | null | undefined): boolean {
  if (!raw || typeof raw !== 'string') return false;
  const canonical = normalizeCategoryL1(raw.trim());
  return (EXCLUDED_PRODUCT_L1_CATEGORIES as readonly string[]).includes(canonical);
}

/** Raw + alias L1 values for Mongo `$nin` filters. */
export function expandExcludedProductCategoryL1FilterValues(): string[] {
  const expanded = new Set<string>();
  for (const canonical of EXCLUDED_PRODUCT_L1_CATEGORIES) {
    expanded.add(canonical);
    for (const [raw, mapped] of Object.entries(CATEGORY_L1_ALIASES)) {
      if (mapped === canonical) expanded.add(raw);
    }
  }
  expanded.add('Electronics');
  expanded.add('Tech / Gadgets');
  expanded.add('Tech/Gadgets');
  return [...expanded];
}

/** Mongo match fragment — spread into product/creative feed queries. */
export function excludedProductCategoryL1Filter(): Record<string, unknown> {
  return { categoryL1: { $nin: expandExcludedProductCategoryL1FilterValues() } };
}
