import { z } from 'zod';
import {
  PRODUCT_CATEGORIES,
  PRODUCT_SUBCATEGORIES,
  PRODUCT_DISCOVERY_SECTIONS,
} from './product.constants';
import {
  buildProductFeedFilters,
  defaultSortOptionsForFeed,
  FRONTEND_CATEGORY_TO_L1,
  normalizeProductSortBy,
  type RawProductFeedQuery,
} from './product-feed-filters.util';
import type { ProductFeedFilters } from '../../db/repositories/product.repository';

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
  .transform((val) => {
    if (!val) return undefined;
    const items = Array.isArray(val)
      ? val.filter(Boolean)
      : val.split(',').map((s) => s.trim()).filter(Boolean);
    return items.length ? items : undefined;
  })
  .refine(
    (items) => {
      if (!items) return true;
      const allowed = new Set([
        ...PRODUCT_CATEGORIES,
        ...Object.keys(FRONTEND_CATEGORY_TO_L1),
      ]);
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
  /** Frontend: gmv_desc, units_sold_desc, recent, views, … */
  sortBy: z.string().max(40).optional(),
  region: z.string().optional(),

  /** hot | seasonal (score / AI productType) — not physical/digital */
  productKind: z.enum(['hot', 'seasonal']).optional(),
  productType: z.enum(['hot', 'seasonal']).optional(),

  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  minTotalGmv: z.coerce.number().min(0).optional(),
  maxTotalGmv: z.coerce.number().min(0).optional(),
  minGmv: z.coerce.number().min(0).optional(),
  maxGmv: z.coerce.number().min(0).optional(),
  minUnitsSold: z.coerce.number().min(0).optional(),
  maxUnitsSold: z.coerce.number().min(0).optional(),
  minUnits: z.coerce.number().min(0).optional(),
  maxUnits: z.coerce.number().min(0).optional(),
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
});

export const ProductFeedQuerySchema = ProductFeedQueryBaseSchema.superRefine((val, ctx) => {
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
    const allowed = new Set(['recent', 'trendScore', 'views', 'engagement']);
    if (!allowed.has(sortBy)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sortBy'],
        message: 'For feed=discover use: recent, views, engagement, trendScore (or gmv/units for top-opportunities tab only)',
      });
    }
  }
  if (sortBy && val.feed === 'top-opportunities') {
    const allowed = new Set(['gmv-desc', 'gmv-asc', 'units-desc', 'units-asc']);
    if (!allowed.has(sortBy)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sortBy'],
        message: 'For feed=top-opportunities use: gmv_desc, gmv_asc, units_sold_desc, units_sold_asc',
      });
    }
  }
  if (val.minPrice != null && val.maxPrice != null && val.minPrice > val.maxPrice) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['minPrice'], message: 'minPrice cannot exceed maxPrice' });
  }
  const minGmv = val.minTotalGmv ?? val.minGmv;
  const maxGmv = val.maxTotalGmv ?? val.maxGmv;
  if (minGmv != null && maxGmv != null && minGmv > maxGmv) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['minGmv'], message: 'minGmv cannot exceed maxGmv' });
  }
  const minU = val.minUnitsSold ?? val.minUnits;
  const maxU = val.maxUnitsSold ?? val.maxUnits;
  if (minU != null && maxU != null && minU > maxU) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['minUnits'], message: 'minUnits cannot exceed maxUnits' });
  }
}).transform((val): ProductFeedQuery => {
  const filters = buildProductFeedFilters(val as RawProductFeedQuery);
  return {
    ...val,
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

export const ProductRelatedCreativesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type ProductKeywordContextQuery = z.infer<typeof ProductKeywordContextQuerySchema>;
export type ProductRelatedCreativesQuery = z.infer<typeof ProductRelatedCreativesQuerySchema>;
