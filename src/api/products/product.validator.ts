import { z } from 'zod';
import {
  PRODUCT_CATEGORIES,
  PRODUCT_SUBCATEGORIES,
  PRODUCT_DISCOVERY_SECTIONS,
} from './product.constants';
import {
  buildProductFeedFilters,
  defaultSortOptionsForFeed,
  flattenMultiStringParam,
  FRONTEND_CATEGORY_TO_L1,
  normalizeProductFeedQueryInput,
  normalizeProductSortBy,
  type RawProductFeedQuery,
} from './product-feed-filters.util';
import type { ProductFeedFilters } from '../../db/repositories/product.repository';
import {
  contentMetricFilterZodFields,
  validateContentMetricRanges,
} from '../../utils/content-feed-filters.util';

const MultiStringSchema = (allowedValues?: string[]) =>
  z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((val) => flattenMultiStringParam(val))
    .refine(
      (items) => {
        if (!items || !allowedValues) return true;
        return items.every((v) => allowedValues.includes(v));
      },
      {
        message: allowedValues
          ? `Invalid value. Allowed: ${allowedValues.join(', ')}`
          : 'Invalid value',
      },
    );

/** Accept backend L1 names and frontend display labels. */
const CategorySchema = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((val) => flattenMultiStringParam(val))
  .refine(
    (items) => {
      if (!items) return true;
      const allowed = new Set([...PRODUCT_CATEGORIES, ...Object.keys(FRONTEND_CATEGORY_TO_L1)]);
      return items.every((v) => allowed.has(v));
    },
    { message: 'Invalid category' },
  );

const LevelSchema = z.enum(['High', 'Medium', 'Low']);

const ProductFeedQueryBaseSchema = z.object({
  q: z
    .string()
    .max(200)
    .optional()
    .transform((val) => {
      if (val == null || val === '') return undefined;
      const t = val.trim();
      return t.length ? t : undefined;
    }),
  search: z
    .string()
    .max(200)
    .optional()
    .transform((val) => {
      if (val == null || val === '') return undefined;
      const t = val.trim();
      return t.length ? t : undefined;
    }),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  category: CategorySchema,
  subcategory: MultiStringSchema(PRODUCT_SUBCATEGORIES),
  niche: z.string().min(1).optional(),
  trendDirection: z
    .enum(['rising', 'peaked', 'saturating', 'emerging', 'unknown', 'declining', 'stable', 'viral'])
    .optional(),
  minTrendScore: z.coerce.number().min(0).max(100).optional(),
  minViews: z.coerce.number().min(0).optional(),
  isAd: z.coerce.boolean().optional(),
  section: z.enum(PRODUCT_DISCOVERY_SECTIONS).optional(),
  feed: z.enum(['discover', 'top-opportunities']).optional(),
  /** Frontend: gmv_desc, units_sold_desc, last_ingested, recent, views, … */
  sortBy: z.string().max(40).optional(),
  region: z.string().optional(),

  /** hot | seasonal (score / AI productType) — not physical/digital */
  productKind: z.enum(['hot', 'seasonal']).optional(),
  productType: z.enum(['hot', 'seasonal']).optional(),

  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  minTotalGmv: z.coerce.number().min(0).optional(),
  maxTotalGmv: z.coerce.number().min(0).optional(),
  minUnitsSold: z.coerce.number().min(0).optional(),
  maxUnitsSold: z.coerce.number().min(0).optional(),
  minConfidence: z.coerce.number().min(0).max(100).optional(),
  maxConfidence: z.coerce.number().min(0).max(100).optional(),
  confidenceLevel: LevelSchema.optional(),
  minCompetitionScore: z.coerce.number().min(0).max(100).optional(),
  maxCompetitionScore: z.coerce.number().min(0).max(100).optional(),
  minOpportunityScore: z.coerce.number().min(0).max(100).optional(),
  maxOpportunityScore: z.coerce.number().min(0).max(100).optional(),
  opportunityLevel: LevelSchema.optional(),
  minSales7d: z.coerce.number().min(0).optional(),
  maxSales7d: z.coerce.number().min(0).optional(),
  minGmv7d: z.coerce.number().min(0).optional(),
  maxGmv7d: z.coerce.number().min(0).optional(),
  ...contentMetricFilterZodFields,
});

export const ProductFeedQuerySchema = z
  .preprocess(normalizeProductFeedQueryInput, ProductFeedQueryBaseSchema)
  .superRefine((val, ctx) => {
    const sortBy = normalizeProductSortBy(val.sortBy);
    if (val.sortBy && !sortBy) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sortBy'],
        message: `Invalid sortBy. Examples: ${defaultSortOptionsForFeed(val.feed).join(', ')}`,
      });
      return;
    }
    if (sortBy && val.feed === 'discover') {
      const allowed = new Set([
        'recent',
        'trendScore',
        'views',
        'engagement',
        'gmv-desc',
        'gmv-asc',
        'units-desc',
        'units-asc',
      ]);
      if (!allowed.has(sortBy)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sortBy'],
          message:
            'For feed=discover use: recent, views, engagement, trendScore, gmv_desc, gmv_asc, units_sold_desc, units_sold_asc',
        });
      }
    }
    if (sortBy && val.feed === 'top-opportunities') {
      const allowed = new Set(['gmv-desc', 'gmv-asc', 'units-desc', 'units-asc', 'recent']);
      if (!allowed.has(sortBy)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sortBy'],
          message:
            'For feed=top-opportunities use: gmv_desc, gmv_asc, units_sold_desc, units_sold_asc, last_ingested',
        });
      }
    }
    if (val.minPrice != null && val.maxPrice != null && val.minPrice > val.maxPrice) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['minPrice'],
        message: 'minPrice cannot exceed maxPrice',
      });
    }
    const minGmv = val.minTotalGmv ?? val.minGmv;
    const maxGmv = val.maxTotalGmv ?? val.maxGmv;
    if (minGmv != null && maxGmv != null && minGmv > maxGmv) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['minGmv'],
        message: 'minGmv cannot exceed maxGmv',
      });
    }
    const minU = val.minUnitsSold ?? val.minUnits;
    const maxU = val.maxUnitsSold ?? val.maxUnits;
    if (minU != null && maxU != null && minU > maxU) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['minUnits'],
        message: 'minUnits cannot exceed maxUnits',
      });
    }
    validateContentMetricRanges(
      {
        minGmv: val.minGmv ?? val.minTotalGmv,
        maxGmv: val.maxGmv ?? val.maxTotalGmv,
        minUnits: minU,
        maxUnits: maxU,
        startDate: val.startDate,
      },
      ctx,
    );
  })
  .transform((val): ProductFeedQuery => {
    const q = val.q ?? val.search;
    const filters = buildProductFeedFilters({ ...(val as RawProductFeedQuery), q });
    return {
      ...val,
      q,
      sortBy: filters.sortBy,
      _filters: filters,
    };
  });

export type ProductFeedQuery = z.infer<typeof ProductFeedQueryBaseSchema> & {
  sortBy?: ProductFeedFilters['sortBy'];
  _filters: ProductFeedFilters;
};

export const ProductKeywordContextQuerySchema = z.object({
  name: z.string().min(1, 'Keyword is required').max(200),
  timeFilter: z
    .union([z.literal(1), z.literal(7), z.literal(30), z.literal(90), z.literal(180)])
    .default(30),
  sortOrder: z.union([z.literal(0), z.literal(1)]).default(0),
  country: z
    .string()
    .regex(/^[a-zA-Z]{2}$/, 'Country must be a 2-letter code')
    .optional(),
  cursor: z.coerce.number().min(0).default(0),
  matchExactly: z.coerce.boolean().default(false),
});

export const ProductIdParamSchema = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid product ID format'),
});

export const ProductRelatedCreativesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  excludeCreativeId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, 'Invalid creative ID format')
    .optional(),
});

export const ProductForYouQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(24).default(12),
});

export const ProductYouMayLikeQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(16).default(8),
});

const ProductObjectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid product ID format');

function parseCompareIdsInput(val: string | string[] | undefined): string[] {
  if (val == null) return [];
  const raw = Array.isArray(val) ? val : [val];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    for (const part of entry.split(',')) {
      const id = part.trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

export const ProductCompareQuerySchema = z
  .object({
    ids: z.union([z.string(), z.array(z.string())]).optional(),
  })
  .transform((val) => ({ ids: parseCompareIdsInput(val.ids) }))
  .superRefine((val, ctx) => {
    if (val.ids.length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ids'],
        message: 'At least 2 product IDs are required',
      });
      return;
    }
    if (val.ids.length > 5) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ids'],
        message: 'Maximum 5 products can be compared at once',
      });
      return;
    }
    for (const id of val.ids) {
      if (!ProductObjectIdSchema.safeParse(id).success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['ids'],
          message: 'Invalid product ID format',
        });
        return;
      }
    }
  });

export type ProductCompareQuery = z.infer<typeof ProductCompareQuerySchema>;

export type ProductKeywordContextQuery = z.infer<typeof ProductKeywordContextQuerySchema>;
export type ProductRelatedCreativesQuery = z.infer<typeof ProductRelatedCreativesQuerySchema>;
