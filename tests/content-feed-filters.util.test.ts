import {
  applyCreativeMetricFilters,
  applyProductCreatorMetricFilters,
  buildContentMetricFilters,
  parseStartDateParam,
} from '../src/utils/content-feed-filters.util';

describe('content-feed-filters.util', () => {
  it('parseStartDateParam accepts YYYY-MM-DD', () => {
    const d = parseStartDateParam('2026-04-29');
    expect(d?.toISOString()).toBe('2026-04-29T00:00:00.000Z');
  });

  it('parseStartDateParam rejects invalid', () => {
    expect(parseStartDateParam('not-a-date')).toBeUndefined();
  });

  it('buildContentMetricFilters defaults minGmv and minUnits to ingest floors', () => {
    expect(buildContentMetricFilters({}).minGmv).toBe(1000);
    expect(buildContentMetricFilters({ minGmv: 500 }).minGmv).toBe(500);
    expect(buildContentMetricFilters({}).minUnits).toBe(300);
    expect(buildContentMetricFilters({ minUnits: 50 }).minUnits).toBe(50);
  });

  it('buildContentMetricFilters includes creator metric fields', () => {
    const f = buildContentMetricFilters({
      minCreatorGmv: 1000,
      maxCreatorGmv: 50000,
      minFollowers: 10_000,
      maxFollowers: 1_000_000,
      minCreatorLikes: 50_000,
      maxCreatorLikes: 5_000_000,
    });
    expect(f.minCreatorGmv).toBe(1000);
    expect(f.maxFollowers).toBe(1_000_000);
  });

  it('applyCreativeMetricFilters maps creator fields to Mongo paths', () => {
    const query: Record<string, unknown> = {};
    applyCreativeMetricFilters(
      query,
      buildContentMetricFilters({
        minGmv: 500,
        minFollowers: 1000,
        minCreatorLikes: 2000,
      }),
    );
    expect(query.productTotalGmv).toEqual({ $gte: 500 });
    expect(query['creator.followers']).toEqual({ $gte: 1000 });
    expect(query['creator.totalLikes']).toEqual({ $gte: 2000 });
  });

  it('applyProductCreatorMetricFilters uses storeGmv and primaryCreator', () => {
    const query: Record<string, unknown> = {};
    applyProductCreatorMetricFilters(query, {
      minCreatorGmv: 800,
      maxFollowers: 500_000,
    });
    expect(query.storeGmv).toEqual({ $gte: 800 });
    expect(query['primaryCreator.followers']).toEqual({ $lte: 500_000 });
  });
});
