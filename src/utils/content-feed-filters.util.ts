/**
 * Shared query filters for product and creative discovery lists.
 */

import { z } from 'zod';

export interface ContentMetricFilters {
  minLikes?: number;
  minGmv?: number;
  maxGmv?: number;
  minEngagementRate?: number;
  minUnits?: number;
  maxUnits?: number;
  /** Inclusive lower bound on post date (UTC start of day for YYYY-MM-DD). */
  startDate?: Date;
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
};

export function parseStartDateParam(raw?: string): Date | undefined {
  if (!raw?.trim()) return undefined;
  const s = raw.trim();
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s)
    ? new Date(`${s}T00:00:00.000Z`)
    : new Date(s);
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
}): ContentMetricFilters {
  const start = parseStartDateParam(raw.startDate);
  return {
    minLikes: raw.minLikes,
    minGmv: raw.minGmv,
    maxGmv: raw.maxGmv,
    minEngagementRate: raw.minEngagementRate,
    minUnits: raw.minUnits,
    maxUnits: raw.maxUnits,
    startDate: start,
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

/** likes / views × 100 (percent). */
export function likesPerViewsPercentExpr(
  likesField: string,
  viewsField: string,
): Record<string, unknown> {
  return {
    $multiply: [
      {
        $divide: [
          likesField,
          { $max: [viewsField, 1] },
        ],
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
        $gte: [
          likesPerViewsPercentExpr('$likeCount', '$viewCount'),
          filters.minEngagementRate,
        ],
      },
    });
  }

  if (filters.startDate) {
    appendAnd(query, {
      $or: [
        { publishedAt: { $gte: filters.startDate } },
        { postCreatedAt: { $gte: filters.startDate } },
      ],
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

  if (filters.minGmv != null || filters.maxGmv != null) {
    query.productTotalGmv = {
      ...(filters.minGmv != null ? { $gte: filters.minGmv } : {}),
      ...(filters.maxGmv != null ? { $lte: filters.maxGmv } : {}),
    };
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
    query.publishedAt = { $gte: filters.startDate };
  }
}

export function validateContentMetricRanges(
  raw: {
    minGmv?: number;
    maxGmv?: number;
    minUnits?: number;
    maxUnits?: number;
    startDate?: string;
  },
  ctx: z.RefinementCtx,
): void {
  if (raw.minGmv != null && raw.maxGmv != null && raw.minGmv > raw.maxGmv) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['minGmv'],
      message: 'minGmv cannot exceed maxGmv',
    });
  }
  if (raw.minUnits != null && raw.maxUnits != null && raw.minUnits > raw.maxUnits) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['minUnits'],
      message: 'minUnits cannot exceed maxUnits',
    });
  }
  if (raw.startDate && !parseStartDateParam(raw.startDate)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['startDate'],
      message: 'startDate must be ISO date (YYYY-MM-DD) or valid ISO datetime',
    });
  }
}
