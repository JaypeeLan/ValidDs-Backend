/**
 * Shared query filters for product and creative discovery lists.
 */

import { z } from 'zod';
import { INGEST_QUALITY, MIN_TOTAL_GMV } from '../api/internal/ingest-quality';
import { postDateCoalesceExpr } from './product-recency.util';

export interface ContentMetricFilters {
  minLikes?: number;
  minGmv?: number;
  maxGmv?: number;
  minEngagementRate?: number;
  minUnits?: number;
  maxUnits?: number;
  /** Inclusive lower bound on post date (UTC start of day for YYYY-MM-DD). */
  startDate?: Date;
  /** Creator / shop GMV — creatives: `productTotalGmv`; products: `storeGmv`. */
  minCreatorGmv?: number;
  maxCreatorGmv?: number;
  minFollowers?: number;
  maxFollowers?: number;
  minCreatorLikes?: number;
  maxCreatorLikes?: number;
}

/** Zod fields — spread into product/creative list query schemas. */
export const contentMetricFilterZodFields = {
  minLikes: z.coerce.number().min(0).optional(),
  minGmv: z.coerce.number().min(0).optional(),
  maxGmv: z.coerce.number().min(0).optional(),
  minEngagementRate: z.coerce.number().min(0).max(100).optional(),
  minUnits: z.coerce.number().min(0).optional(),
  maxUnits: z.coerce.number().min(0).optional(),
  startDate: z
    .string()
    .trim()
    .optional()
    .transform((val) => {
      if (!val) return undefined;
      return val;
    }),
  minCreatorGmv: z.coerce.number().min(0).optional(),
  maxCreatorGmv: z.coerce.number().min(0).optional(),
  minFollowers: z.coerce.number().int().min(0).optional(),
  maxFollowers: z.coerce.number().int().min(0).optional(),
  minCreatorLikes: z.coerce.number().int().min(0).optional(),
  maxCreatorLikes: z.coerce.number().int().min(0).optional(),
};

export function parseStartDateParam(raw?: string): Date | undefined {
  if (!raw?.trim()) return undefined;
  const s = raw.trim();
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00.000Z`) : new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function buildContentMetricFilters(raw: {
  minLikes?: number;
  minGmv?: number;
  maxGmv?: number;
  minEngagementRate?: number;
  minUnits?: number;
  maxUnits?: number;
  startDate?: string;
  minCreatorGmv?: number;
  maxCreatorGmv?: number;
  minFollowers?: number;
  maxFollowers?: number;
  minCreatorLikes?: number;
  maxCreatorLikes?: number;
}): ContentMetricFilters {
  const start = parseStartDateParam(raw.startDate);
  return {
    minLikes: raw.minLikes,
    minGmv: raw.minGmv ?? MIN_TOTAL_GMV,
    maxGmv: raw.maxGmv,
    minEngagementRate: raw.minEngagementRate,
    minUnits: raw.minUnits ?? INGEST_QUALITY.MIN_UNITS_SOLD,
    maxUnits: raw.maxUnits,
    startDate: start,
    minCreatorGmv: raw.minCreatorGmv,
    maxCreatorGmv: raw.maxCreatorGmv,
    minFollowers: raw.minFollowers,
    maxFollowers: raw.maxFollowers,
    minCreatorLikes: raw.minCreatorLikes,
    maxCreatorLikes: raw.maxCreatorLikes,
  };
}

function appendAnd(filter: Record<string, unknown>, clause: Record<string, unknown>): void {
  const existing = filter.$and;
  if (Array.isArray(existing)) {
    existing.push(clause);
  } else if (existing) {
    filter.$and = [existing as Record<string, unknown>, clause];
  } else {
    filter.$and = [clause];
  }
}

/**
 * Combine user filters (including text search `$or`) with a feed bucket match such as
 * `CREATIVE_TOP_ADS_MATCH`, which also uses `$or`. Object.assign would drop search.
 */
export function mergeCreativeFeedExtraMatch(
  base: Record<string, unknown>,
  extraMatch: Record<string, unknown>,
): Record<string, unknown> {
  if (!extraMatch || Object.keys(extraMatch).length === 0) return base;
  if (!base || Object.keys(base).length === 0) return { ...extraMatch };
  return { $and: [base, extraMatch] };
}

/** likes / views × 100 (percent). */
export function likesPerViewsPercentExpr(
  likesField: string,
  viewsField: string,
): Record<string, unknown> {
  return {
    $multiply: [
      {
        $divide: [likesField, { $max: [viewsField, 1] }],
      },
      100,
    ],
  };
}

export function applyProductMetricFilters(
  query: Record<string, unknown>,
  filters: ContentMetricFilters,
): void {
  if (filters.minLikes != null) {
    query.likeCount = { $gte: filters.minLikes };
  }

  if (filters.minEngagementRate != null) {
    appendAnd(query, {
      $expr: {
        $gte: [likesPerViewsPercentExpr('$likeCount', '$viewCount'), filters.minEngagementRate],
      },
    });
  }

  if (filters.startDate) {
    // publishedAt may be ISO string (scraper mongo ingest) or BSON Date — coerce before compare.
    appendAnd(query, {
      $expr: {
        $gte: [postDateCoalesceExpr(), filters.startDate],
      },
    });
  }
}

export function applyCreativeMetricFilters(
  query: Record<string, unknown>,
  filters: ContentMetricFilters,
): void {
  if (filters.minLikes != null) {
    query['metrics.likeCount'] = { $gte: filters.minLikes };
  }

  if (filters.minEngagementRate != null) {
    appendAnd(query, {
      $expr: {
        $gte: [
          likesPerViewsPercentExpr('$metrics.likeCount', '$metrics.viewCount'),
          filters.minEngagementRate,
        ],
      },
    });
  }

  if (filters.minUnits != null || filters.maxUnits != null) {
    query.productTotalSales = {
      ...(filters.minUnits != null ? { $gte: filters.minUnits } : {}),
      ...(filters.maxUnits != null ? { $lte: filters.maxUnits } : {}),
    };
  }

  if (filters.startDate) {
    // publishedAt may be stored as ISO string (scraper mongo ingest) or BSON Date — coerce before compare.
    appendAnd(query, {
      $expr: {
        $gte: [postDateCoalesceExpr(), filters.startDate],
      },
    });
  }

  const gmvMin = [filters.minGmv, filters.minCreatorGmv].filter((n): n is number => n != null);
  const gmvMax = [filters.maxGmv, filters.maxCreatorGmv].filter((n): n is number => n != null);
  const productGmvMin = gmvMin.length ? Math.max(...gmvMin) : undefined;
  const productGmvMax = gmvMax.length ? Math.min(...gmvMax) : undefined;
  if (productGmvMin != null || productGmvMax != null) {
    query.productTotalGmv = {
      ...(productGmvMin != null ? { $gte: productGmvMin } : {}),
      ...(productGmvMax != null ? { $lte: productGmvMax } : {}),
    };
  }

  if (filters.minFollowers != null || filters.maxFollowers != null) {
    query['creator.followers'] = {
      ...(filters.minFollowers != null ? { $gte: filters.minFollowers } : {}),
      ...(filters.maxFollowers != null ? { $lte: filters.maxFollowers } : {}),
    };
  }

  if (filters.minCreatorLikes != null || filters.maxCreatorLikes != null) {
    query['creator.totalLikes'] = {
      ...(filters.minCreatorLikes != null ? { $gte: filters.minCreatorLikes } : {}),
      ...(filters.maxCreatorLikes != null ? { $lte: filters.maxCreatorLikes } : {}),
    };
  }
}

/** Creator metrics on product documents (`primaryCreator.shopGmv`, fallback `storeGmv`). */
export function applyProductCreatorMetricFilters(
  query: Record<string, unknown>,
  filters: Pick<
    ContentMetricFilters,
    | 'minCreatorGmv'
    | 'maxCreatorGmv'
    | 'minFollowers'
    | 'maxFollowers'
    | 'minCreatorLikes'
    | 'maxCreatorLikes'
  >,
): void {
  if (filters.minCreatorGmv != null || filters.maxCreatorGmv != null) {
    const gmvValue = { $ifNull: ['$primaryCreator.shopGmv', '$storeGmv', 0] };
    const parts: Record<string, unknown>[] = [];
    if (filters.minCreatorGmv != null) {
      parts.push({ $gte: [gmvValue, filters.minCreatorGmv] });
    }
    if (filters.maxCreatorGmv != null) {
      parts.push({ $lte: [gmvValue, filters.maxCreatorGmv] });
    }
    const gmvExpr = parts.length === 1 ? parts[0]! : { $and: parts };
    const existing = query.$expr;
    if (existing && typeof existing === 'object') {
      query.$expr = { $and: [existing, gmvExpr] };
    } else {
      query.$expr = gmvExpr;
    }
  }
  if (filters.minFollowers != null || filters.maxFollowers != null) {
    query['primaryCreator.followers'] = {
      ...(filters.minFollowers != null ? { $gte: filters.minFollowers } : {}),
      ...(filters.maxFollowers != null ? { $lte: filters.maxFollowers } : {}),
    };
  }
  if (filters.minCreatorLikes != null || filters.maxCreatorLikes != null) {
    query['primaryCreator.totalLikes'] = {
      ...(filters.minCreatorLikes != null ? { $gte: filters.minCreatorLikes } : {}),
      ...(filters.maxCreatorLikes != null ? { $lte: filters.maxCreatorLikes } : {}),
    };
  }
}

function addRangeIssue(
  ctx: z.RefinementCtx,
  path: string,
  min?: number,
  max?: number,
  label?: string,
): void {
  if (min != null && max != null && min > max) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [path],
      message: `${label ?? path} minimum cannot exceed maximum`,
    });
  }
}

export function validateContentMetricRanges(
  raw: {
    minGmv?: number;
    maxGmv?: number;
    minUnits?: number;
    maxUnits?: number;
    startDate?: string;
    minCreatorGmv?: number;
    maxCreatorGmv?: number;
    minFollowers?: number;
    maxFollowers?: number;
    minCreatorLikes?: number;
    maxCreatorLikes?: number;
  },
  ctx: z.RefinementCtx,
): void {
  addRangeIssue(ctx, 'minGmv', raw.minGmv, raw.maxGmv, 'minGmv');
  addRangeIssue(ctx, 'minUnits', raw.minUnits, raw.maxUnits, 'minUnits');
  addRangeIssue(ctx, 'minCreatorGmv', raw.minCreatorGmv, raw.maxCreatorGmv, 'minCreatorGmv');
  addRangeIssue(ctx, 'minFollowers', raw.minFollowers, raw.maxFollowers, 'minFollowers');
  addRangeIssue(
    ctx,
    'minCreatorLikes',
    raw.minCreatorLikes,
    raw.maxCreatorLikes,
    'minCreatorLikes',
  );
  if (raw.startDate && !parseStartDateParam(raw.startDate)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['startDate'],
      message: 'startDate must be ISO date (YYYY-MM-DD) or valid ISO datetime',
    });
  }
}
