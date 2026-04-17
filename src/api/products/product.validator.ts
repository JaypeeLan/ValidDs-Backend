import { z } from 'zod';
import { PRODUCT_CATEGORIES } from './product.constants';

const CategoryFilterSchema = z.union([z.string(), z.array(z.string())])
  .optional()
  .transform(val => {
    if (!val) return undefined;
    const categories = Array.isArray(val) 
      ? val.filter(Boolean) 
      : val.split(',').map(s => s.trim()).filter(Boolean);
    
    return categories;
  })
  .refine(cats => {
    if (!cats) return true;
    return cats.every(c => (PRODUCT_CATEGORIES as readonly string[]).includes(c));
  }, {
    message: `Invalid category. Allowed: ${PRODUCT_CATEGORIES.join(', ')}`
  });

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
  category:       CategoryFilterSchema,
  niche:          z.string().min(1).optional(),
  trendDirection: z.enum(['rising', 'peaked', 'saturating', 'unknown']).optional(),
  minTrendScore:  z.coerce.number().min(0).max(100).optional(),
  minViews:       z.coerce.number().min(0).optional(),
  isAd:           z.coerce.boolean().optional(),
  sortBy:         z.enum(['trendScore', 'views', 'recent', 'engagement']).default('trendScore'),
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

export type ProductFeedQuery  = z.infer<typeof ProductFeedQuerySchema>;
export type ProductKeywordContextQuery = z.infer<typeof ProductKeywordContextQuerySchema>;
