import { z } from 'zod';
import {
  buildContentMetricFilters,
  contentMetricFilterZodFields,
  validateContentMetricRanges,
} from '../../utils/content-feed-filters.util';

const CreativeListQueryBaseSchema = z.object({
  page:      z.coerce.number().min(1).default(1),
  limit:     z.coerce.number().min(1).max(100).default(20),
  q:         z.string().trim().min(1).max(120).optional(),
  productId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid productId format').optional(),
  source:    z.enum(['tiktok', 'meta']).optional(),
  section:   z.enum(['top-ads', 'trending', 'influencer-reviews', 'tutorials', 'viral-unboxings']).optional(),
  isAd:      z.coerce.boolean().optional(),
  region:    z.string().regex(/^[a-zA-Z]{2}$/, 'Region must be a 2-letter country code').optional(),
  minViews:  z.coerce.number().min(0).optional(),
  hashtags:  z.union([z.string(), z.array(z.string())]).optional(),
  sortBy:    z.enum(['views', 'likes', 'recent', 'engagement']).default('views'),
  categoryL1: z.string().optional(),
  categoryL2: z.string().optional(),
  categoryL3: z.string().optional(),
  ...contentMetricFilterZodFields,
});

export const CreativeListQuerySchema = CreativeListQueryBaseSchema.superRefine((val, ctx) => {
  validateContentMetricRanges(val, ctx);
}).transform((val) => ({
  ...val,
  _metricFilters: buildContentMetricFilters(val),
}));

export const CreativeIdParamSchema = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid creative ID format'),
});

export const CreativeStreamQuerySchema = z.object({
  index: z.coerce.number().int().min(0).max(50).default(0),
});

export const CreativeThumbnailQuerySchema = z.object({
  index: z.coerce.number().int().min(0).max(50).default(0),
  kind: z.enum(['thumbnail', 'avatar']).default('thumbnail'),
});

export type CreativeListQuery = z.infer<typeof CreativeListQueryBaseSchema> & {
  _metricFilters: ReturnType<typeof buildContentMetricFilters>;
};

/** Same filters as list creatives, without legacy `section` (top ads are defined by `creator.isIndependentCreator`). */
export const CreativeTopAdsListQuerySchema = CreativeListQueryBaseSchema.omit({ section: true })
  .superRefine((val, ctx) => {
    validateContentMetricRanges(val, ctx);
  })
  .transform((val) => ({
    ...val,
    _metricFilters: buildContentMetricFilters(val),
  }));
export type CreativeTopAdsListQuery = z.infer<typeof CreativeListQueryBaseSchema> & {
  _metricFilters: ReturnType<typeof buildContentMetricFilters>;
};

export const CreativeIngestBodySchema = z.object({
  keyword: z.string().min(2).max(100),
  limit:   z.coerce.number().min(1).max(50).default(10),
  period:  z.coerce.number().min(1).max(90).default(30),
  country: z.string().length(2).default('us'),
});

export type CreativeIngestBody = z.infer<typeof CreativeIngestBodySchema>;
