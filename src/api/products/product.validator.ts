import { z } from 'zod';

const CategoryFilterSchema = z.union([z.string(), z.array(z.string())])
  .optional()
  .transform(val => {
    if (!val) return undefined;
    if (Array.isArray(val)) return val.filter(Boolean);
    return val.split(',').map(s => s.trim()).filter(Boolean);
  });

export const ProductFeedQuerySchema = z.object({
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

export const ProductSearchQuerySchema = z.object({
  q:        z.string().min(1, 'Search query is required').max(200),
  category: CategoryFilterSchema,
  page:     z.coerce.number().min(1).default(1),
  limit:    z.coerce.number().min(1).max(100).default(20),
});

export type ProductFeedQuery  = z.infer<typeof ProductFeedQuerySchema>;
export type ProductSearchQuery = z.infer<typeof ProductSearchQuerySchema>;
