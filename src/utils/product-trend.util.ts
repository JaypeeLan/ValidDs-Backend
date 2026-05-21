import type { ITrend } from '../types/product.types';

const EMPTY_TREND: ITrend = {
  score: 0,
  direction: 'unknown',
  isTrending: false,
  calculatedAt: new Date(),
};

/** Read engagement trend from `trends.engagement`, with legacy root `trend` fallback. */
export function resolveEngagementTrend(product: Record<string, unknown>): ITrend {
  const trends = product.trends as { engagement?: Partial<ITrend> } | null | undefined;
  const engagement = trends?.engagement;
  if (engagement && typeof engagement === 'object') {
    return {
      score: Number(engagement.score) || 0,
      direction: (engagement.direction as ITrend['direction']) || 'unknown',
      reason: typeof engagement.reason === 'string' ? engagement.reason : undefined,
      isTrending: Boolean(engagement.isTrending),
      calculatedAt: engagement.calculatedAt
        ? new Date(engagement.calculatedAt as string | Date)
        : new Date(),
    };
  }

  const legacy = product.trend as Partial<ITrend> | null | undefined;
  if (legacy && typeof legacy === 'object') {
    return {
      score: Number(legacy.score) || 0,
      direction: (legacy.direction as ITrend['direction']) || 'unknown',
      reason: typeof legacy.reason === 'string' ? legacy.reason : undefined,
      isTrending: Boolean(legacy.isTrending),
      calculatedAt: legacy.calculatedAt
        ? new Date(legacy.calculatedAt as string | Date)
        : new Date(),
    };
  }

  return { ...EMPTY_TREND };
}

/** Mongo paths for engagement trend (new + legacy documents). */
export const ENGAGEMENT_TREND_SCORE_PATHS = ['trends.engagement.score', 'trend.score'] as const;
export const ENGAGEMENT_TREND_DIRECTION_PATHS = ['trends.engagement.direction', 'trend.direction'] as const;
