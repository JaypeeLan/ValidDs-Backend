import { z } from 'zod';
import { PRODUCT_CATEGORIES, PRODUCT_SUBCATEGORIES, PRODUCT_DISCOVERY_SECTIONS } from './product.constants';

const MultiStringSchema = (allowedValues?: string[]) =>
  z.union([z.string(), z.array(z.string())])
    .optional()
    .transform((val) => {
      if (!val) return undefined;
      const items = Array.isArray(val)
        ? val.filter(Boolean)
        : val.split(',').map((s) => s.trim()).filter(Boolean);
      return items.length ? items : undefined;
    })
    .refine(
      (items) => {
        if (!items || !allowedValues) return true;
        return items.every((v) => allowedValues.includes(v));
      },
      { message: allowedValues ? `Invalid value. Allowed: ${allowedValues.join(', ')}` : 'Invalid value' }
    );

export const ProductFeedQuerySchema = z.object({
  /** Full-text search; when set, results are ranked by text relevance (other sort options are ignored). */
  q: z
    .string()
    .max(200)
    .optional()
    .transform((val) => {
      if (val == null || val === '') return undefined;
      const t = val.trim();
      return t.length ? t : undefined;
    }),
  page:           z.coerce.number().min(1).default(1),
  limit:          z.coerce.number().min(1).max(100).default(20),
  category:       MultiStringSchema(PRODUCT_CATEGORIES),
  subcategory:    MultiStringSchema(PRODUCT_SUBCATEGORIES),
  niche:          z.string().min(1).optional(),
  trendDirection: z.enum(['rising', 'peaked', 'saturating', 'unknown']).optional(),
  minTrendScore:  z.coerce.number().min(0).max(100).optional(),
  minViews:       z.coerce.number().min(0).optional(),
  /** When true, only products in the top-ads discovery bucket; false excludes that bucket. Maps to `discoverySections`. */
  isAd:           z.coerce.boolean().optional(),
  /** Filter by discovery section slug (e.g. `top-ads`). Matches if the value appears in `discoverySections`. */
  section:        z.enum(PRODUCT_DISCOVERY_SECTIONS).optional(),
  sortBy:         z.enum(['gmv', 'trendScore', 'views', 'recent', 'engagement']).default('gmv'),
  region:         z.string().optional(),
});

export const ProductKeywordContextQuerySchema = z.object({
  name: z.string().min(1, 'Keyword is required').max(200),
  timeFilter: z.union([
    z.literal(1),
    z.literal(7),
    z.literal(30),
    z.literal(90),
    z.literal(180),
  ]).default(30),
  sortOrder: z.union([z.literal(0), z.literal(1)]).default(0),
  country: z.string().regex(/^[a-zA-Z]{2}$/, 'Country must be a 2-letter code').optional(),
  cursor: z.coerce.number().min(0).default(0),
  matchExactly: z.coerce.boolean().default(false),
});

export const ProductIdParamSchema = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid product ID format'),
});

/** Optional cap for related creative lists on a product. */
export const ProductRelatedCreativesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type ProductFeedQuery  = z.infer<typeof ProductFeedQuerySchema>;
export type ProductKeywordContextQuery = z.infer<typeof ProductKeywordContextQuerySchema>;
export type ProductRelatedCreativesQuery = z.infer<typeof ProductRelatedCreativesQuerySchema>;
