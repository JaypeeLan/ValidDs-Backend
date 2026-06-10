/**
 * Prioritize fresh TikTok posts in feeds while keeping GMV (or units) order within each bucket.
 *
 * Tier 0: published within 3 days
 * Tier 1: published within 7 days (4–7d)
 * Tier 2: older
 */

export const NEW_POST_PRIORITY_DAYS_3 = 3;
export const NEW_POST_PRIORITY_DAYS_7 = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type GmvPrioritySortBy = 'gmv-desc' | 'gmv-asc' | 'units-desc' | 'units-asc';

export function usesRecencyPriorityWithGmv(sortBy?: string): sortBy is GmvPrioritySortBy {
  return (
    sortBy === 'gmv-desc' ||
    sortBy === 'gmv-asc' ||
    sortBy === 'units-desc' ||
    sortBy === 'units-asc'
  );
}

export function parsePublishedAt(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === 'string' && value.trim()) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function postRecencyTier(publishedAt: unknown, now = Date.now()): 0 | 1 | 2 {
  const d = parsePublishedAt(publishedAt);
  if (!d) return 2;
  const ageMs = now - d.getTime();
  if (ageMs < 0) return 0;
  if (ageMs <= NEW_POST_PRIORITY_DAYS_3 * MS_PER_DAY) return 0;
  if (ageMs <= NEW_POST_PRIORITY_DAYS_7 * MS_PER_DAY) return 1;
  return 2;
}

export function postRecencyFlags(
  publishedAt: unknown,
  now = Date.now(),
): { isNew3d: boolean; isNew7d: boolean } {
  const tier = postRecencyTier(publishedAt, now);
  return { isNew3d: tier === 0, isNew7d: tier <= 1 };
}

/** Mongo $addFields: normalized post timestamp from publishedAt / postCreatedAt / ingest time. */
export function postDateCoalesceExpr(): Record<string, unknown> {
  return {
    $let: {
      vars: {
        // Angle ads often omit publishedAt at ingest — fall back to ingestedAt/createdAt for date filters.
        raw: { $ifNull: ['$publishedAt', '$postCreatedAt', '$ingestedAt', '$createdAt'] },
      },
      in: {
        $switch: {
          branches: [
            {
              case: { $eq: [{ $type: '$$raw' }, 'date'] },
              then: '$$raw',
            },
            {
              case: { $eq: [{ $type: '$$raw' }, 'string'] },
              then: {
                $dateFromString: {
                  dateString: '$$raw',
                  onError: null,
                  onNull: null,
                },
              },
            },
            {
              case: { $in: [{ $type: '$$raw' }, ['double', 'int', 'long', 'decimal']] },
              then: {
                $convert: {
                  input: '$$raw',
                  to: 'date',
                  onError: null,
                  onNull: null,
                },
              },
            },
          ],
          default: null,
        },
      },
    },
  };
}

/** Mongo $addFields: _recencyTier 0 | 1 | 2 for aggregation sort. */
export function recencyTierAddFields(): Record<string, unknown> {
  const threeMs = NEW_POST_PRIORITY_DAYS_3 * MS_PER_DAY;
  const sevenMs = NEW_POST_PRIORITY_DAYS_7 * MS_PER_DAY;
  return {
    _postDate: postDateCoalesceExpr(),
    _recencyTier: {
      $switch: {
        branches: [
          {
            case: {
              $and: [
                { $ne: ['$_postDate', null] },
                { $gte: ['$_postDate', { $subtract: ['$$NOW', threeMs] }] },
              ],
            },
            then: 0,
          },
          {
            case: {
              $and: [
                { $ne: ['$_postDate', null] },
                { $gte: ['$_postDate', { $subtract: ['$$NOW', sevenMs] }] },
              ],
            },
            then: 1,
          },
        ],
        default: 2,
      },
    },
  };
}

export function recencyPrioritySortSpec(sortBy: GmvPrioritySortBy): Record<string, 1 | -1> {
  const metricKey = sortBy === 'units-desc' || sortBy === 'units-asc' ? 'totalSales' : 'totalGmv';
  const metricDir: 1 | -1 = sortBy === 'gmv-asc' || sortBy === 'units-asc' ? 1 : -1;
  return {
    _recencyTier: 1,
    [metricKey]: metricDir,
    lastIngestedAt: -1,
  };
}

export function creativeRecencyPrioritySortSpec(
  sortBy: 'views' | 'likes' | 'engagement',
): Record<string, 1 | -1> {
  const metricKey =
    sortBy === 'likes'
      ? 'metrics.likeCount'
      : sortBy === 'engagement'
        ? 'metrics.engagementRate'
        : 'metrics.viewCount';
  return {
    _recencyTier: 1,
    productTotalGmv: -1,
    [metricKey]: -1,
    publishedAt: -1,
  };
}
