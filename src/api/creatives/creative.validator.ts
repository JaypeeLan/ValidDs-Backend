import { z } from 'zod';
import { flattenMultiStringParam } from '../products/product-feed-filters.util';
import {
  buildContentMetricFilters,
  contentMetricFilterZodFields,
  validateContentMetricRanges,
} from '../../utils/content-feed-filters.util';

const CreativeListQueryBaseSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  q: z.string().trim().min(1).max(120).optional(),
  productId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, 'Invalid productId format')
    .optional(),
  source: z.preprocess(
    (v) => (typeof v === 'string' ? v.toLowerCase() : v),
    z.enum(['tiktok', 'meta']).optional(),
  ),
  section: z.enum(['top-ads', 'trending']).optional(),
  isAd: z.coerce.boolean().optional(),
  region: z
    .string()
    .regex(/^[a-zA-Z]{2}$/, 'Region must be a 2-letter country code')
    .optional(),
  minViews: z.coerce.number().min(0).optional(),
  hashtags: z.union([z.string(), z.array(z.string())]).optional(),
  sortBy: z.enum(['views', 'likes', 'recent', 'engagement']).default('views'),
  groupBy: z.enum(['creator']).optional(),
  categoryL1: z.union([z.string(), z.array(z.string())]).optional(),
  categoryL2: z.union([z.string(), z.array(z.string())]).optional(),
  categoryL3: z.union([z.string(), z.array(z.string())]).optional(),
  ...contentMetricFilterZodFields,
});

function normalizeCreativeListQuery(val: z.infer<typeof CreativeListQueryBaseSchema>) {
  return {
    ...val,
    _metricFilters: buildContentMetricFilters(val),
    hashtags: flattenMultiStringParam(val.hashtags),
    categoryL1: flattenMultiStringParam(val.categoryL1),
    categoryL2: flattenMultiStringParam(val.categoryL2),
    categoryL3: flattenMultiStringParam(val.categoryL3),
  };
}

export const CreativeListQuerySchema = CreativeListQueryBaseSchema.superRefine((val, ctx) => {
  validateContentMetricRanges(val, ctx);
}).transform(normalizeCreativeListQuery);

export const CreativeIdParamSchema = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid creative ID format'),
});

export const CreativeStreamQuerySchema = z.object({
  index: z.coerce.number().int().min(0).max(50).default(0),
});

export const CreativeThumbnailQuerySchema = z.object({
  index: z.coerce.number().int().min(0).max(50).default(0),
  kind: z.enum(['thumbnail', 'avatar', 'shop']).default('thumbnail'),
});

export type CreativeListQuery = ReturnType<typeof normalizeCreativeListQuery>;

/** Same filters as list creatives, without legacy `section` (top ads are defined by `creator.isIndependentCreator`). */
export const CreativeTopAdsListQuerySchema = CreativeListQueryBaseSchema.omit({ section: true })
  .superRefine((val, ctx) => {
    validateContentMetricRanges(val, ctx);
  })
  .transform(normalizeCreativeListQuery);
export type CreativeTopAdsListQuery = CreativeListQuery;

export const CreativeIngestBodySchema = z.object({
  keyword: z.string().min(2).max(100),
  limit: z.coerce.number().min(1).max(50).default(10),
  period: z.coerce.number().min(1).max(90).default(30),
  country: z.string().length(2).default('us'),
});

export type CreativeIngestBody = z.infer<typeof CreativeIngestBodySchema>;
