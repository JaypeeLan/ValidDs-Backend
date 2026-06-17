import {
  CREATIVE_SORT_OPTIONS,
  normalizeCreativeSortBy,
  resolveCreativeSort,
} from '../src/api/creatives/creative-feed-filters.util';

describe('creative-feed-filters.util', () => {
  it('normalizeCreativeSortBy maps last_ingested aliases', () => {
    expect(normalizeCreativeSortBy('last_ingested')).toBe('last_ingested');
    expect(normalizeCreativeSortBy('last-ingested')).toBe('last_ingested');
    expect(normalizeCreativeSortBy('ingested_desc')).toBe('last_ingested');
    expect(normalizeCreativeSortBy('recent')).toBe('recent');
    expect(normalizeCreativeSortBy('views')).toBe('views');
  });

  it('resolveCreativeSort uses ingestedAt for last_ingested', () => {
    expect(resolveCreativeSort('last_ingested').sort).toEqual({
      ingestedAt: -1,
      publishedAt: -1,
    });
    expect(resolveCreativeSort('recent').sort).toEqual({ publishedAt: -1 });
  });

  it('CREATIVE_SORT_OPTIONS includes last_ingested', () => {
    expect(CREATIVE_SORT_OPTIONS).toContain('last_ingested');
  });
});
