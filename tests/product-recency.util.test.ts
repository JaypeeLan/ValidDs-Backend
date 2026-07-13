import {
  NEW_POST_PRIORITY_DAYS_3,
  NEW_POST_PRIORITY_DAYS_7,
  creativeEngagementMetricSortSpec,
  creativeProductMetricSortSpec,
  postRecencyFlags,
  postRecencyTier,
  recencyPrioritySortSpec,
  sortSpecWithoutRecencyFields,
  usesRecencyPriorityWithGmv,
  withIdTiebreak,
} from '../src/utils/product-recency.util';

describe('product-recency.util', () => {
  const now = Date.parse('2026-05-29T12:00:00.000Z');

  it('usesRecencyPriorityWithGmv', () => {
    expect(usesRecencyPriorityWithGmv('gmv-desc')).toBe(true);
    expect(usesRecencyPriorityWithGmv('units-asc')).toBe(true);
    expect(usesRecencyPriorityWithGmv('recent')).toBe(false);
  });

  it('assigns tiers at 3d and 7d boundaries', () => {
    const twoDaysAgo = new Date(now - 2 * 86400000).toISOString();
    const fiveDaysAgo = new Date(now - 5 * 86400000).toISOString();
    const tenDaysAgo = new Date(now - 10 * 86400000).toISOString();

    expect(postRecencyTier(twoDaysAgo, now)).toBe(0);
    expect(postRecencyTier(fiveDaysAgo, now)).toBe(1);
    expect(postRecencyTier(tenDaysAgo, now)).toBe(2);
  });

  it('postRecencyFlags', () => {
    const twoDaysAgo = new Date(now - 2 * 86400000).toISOString();
    const fiveDaysAgo = new Date(now - 5 * 86400000).toISOString();
    expect(postRecencyFlags(twoDaysAgo, now)).toEqual({ isNew3d: true, isNew7d: true });
    expect(postRecencyFlags(fiveDaysAgo, now)).toEqual({ isNew3d: false, isNew7d: true });
  });

  it('exports day constants', () => {
    expect(NEW_POST_PRIORITY_DAYS_3).toBe(3);
    expect(NEW_POST_PRIORITY_DAYS_7).toBe(7);
  });

  it('withIdTiebreak appends _id once', () => {
    expect(withIdTiebreak({ totalGmv: -1 })).toEqual({ totalGmv: -1, _id: 1 });
    expect(withIdTiebreak({ totalGmv: -1, _id: -1 })).toEqual({ totalGmv: -1, _id: -1 });
  });

  it('product and creative sort specs include a stable _id tie-break', () => {
    expect(recencyPrioritySortSpec('gmv-desc')._id).toBe(1);
    expect(creativeEngagementMetricSortSpec('views')._id).toBe(1);
    expect(creativeProductMetricSortSpec('gmv-desc')._id).toBe(1);
    expect(sortSpecWithoutRecencyFields({ _recencyTier: 1, publishedAt: -1 })._id).toBe(1);
  });
});
