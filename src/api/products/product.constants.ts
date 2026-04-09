/**
 * Canonical product categories for the platform.
 * These are used by:
 * 1. The AI extractor to bucket products during ingestion.
 * 2. The API to provide a fixed list of categories for filtering.
 * 3. Validators to ensure incoming search queries are valid.
 */
export const PRODUCT_CATEGORIES = [
  'Beauty & Healthcare',
  'Electronics & Gadgets',
  'Sports & Outdoors',
  'Home & Kitchen',
  'Fashion & Accessories',
  'Toys & Hobbies',
  'Pet Supplies',
  'Automotive',
  'Tools & Home Improvement',
  'Office Products',
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];
