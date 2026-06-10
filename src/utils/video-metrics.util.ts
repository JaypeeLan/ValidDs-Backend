import type { IVideoMetrics } from '../types/creative.types';

type MetricInput = Partial<IVideoMetrics> | null | undefined;

function metricInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

/** Detect views/likes mixed from product max-views and per-video interactions. */
export function isImplausibleVideoEngagement(metrics: MetricInput): boolean {
  if (!metrics || typeof metrics !== 'object') return false;

  const views = metricInt(metrics.viewCount);
  if (views < 50_000) return false;

  const likes = metricInt(metrics.likeCount);
  const comments = metricInt(metrics.commentCount);
  const shares = metricInt(metrics.shareCount);
  const interactions = likes + comments + shares;

  if (interactions === 0) return views >= 100_000;

  const rate = interactions / views;
  if (views >= 1_000_000 && rate < 0.0001) return true;
  if (views >= 100_000 && rate < 0.00001) return true;
  return false;
}

function engagementRateFromCounts(
  views: number,
  likes: number,
  comments: number,
  shares: number,
): number | null {
  if (views <= 0) return null;
  return Math.round(((likes + comments + shares) / views) * 100 * 10_000) / 10_000;
}

/** Coerce metrics to non-negative integers and recompute engagementRate. */
export function normalizeVideoMetrics(metrics: MetricInput): IVideoMetrics {
  const views = metricInt(metrics?.viewCount);
  const likes = metricInt(metrics?.likeCount);
  const comments = metricInt(metrics?.commentCount);
  const shares = metricInt(metrics?.shareCount);

  return {
    viewCount: views,
    likeCount: likes,
    commentCount: comments,
    shareCount: shares,
    engagementRate: engagementRateFromCounts(views, likes, comments, shares),
    ...(metrics?.source ? { source: metrics.source } : {}),
    ...(metrics?.fetchedAt ? { fetchedAt: metrics.fetchedAt } : {}),
  };
}

/**
 * Repair inflated view counts on a single video's metrics.
 * Product-level max views must never be shown as this clip's view count.
 */
export function sanitizeVideoMetrics(metrics: MetricInput): IVideoMetrics {
  const normalized = normalizeVideoMetrics(metrics);
  if (!isImplausibleVideoEngagement(normalized)) return normalized;

  const likes = normalized.likeCount;
  const comments = normalized.commentCount;
  const shares = normalized.shareCount;
  const interactions = likes + comments + shares;
  if (interactions <= 0) return normalized;

  const cappedViews = Math.max(interactions, interactions * 500);
  return {
    ...normalized,
    viewCount: cappedViews,
    engagementRate: engagementRateFromCounts(cappedViews, likes, comments, shares),
  };
}
