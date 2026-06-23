import {
  CREATIVE_SORT_OPTIONS,
  CREATOR_LOBBY_SORT_OPTIONS,
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

  it('normalizeCreativeSortBy maps product and video metric aliases', () => {
    expect(normalizeCreativeSortBy('gmv_desc')).toBe('gmv-desc');
    expect(normalizeCreativeSortBy('units_sold_asc')).toBe('units-asc');
    expect(normalizeCreativeSortBy('views_desc')).toBe('views-desc');
    expect(normalizeCreativeSortBy('likes_asc')).toBe('likes-asc');
  });

  it('normalizeCreativeSortBy maps creator lobby aliases', () => {
    expect(normalizeCreativeSortBy('creator_gmv_desc')).toBe('creator_gmv_desc');
    expect(normalizeCreativeSortBy('followers_asc')).toBe('followers_asc');
  });

  it('resolveCreativeSort uses ingestedAt for last_ingested', () => {
    expect(resolveCreativeSort('last_ingested').sort).toEqual({
      ingestedAt: -1,
      publishedAt: -1,
    });
    expect(resolveCreativeSort('recent').sort).toEqual({ publishedAt: -1 });
  });

  it('resolveCreativeSort uses productTotalGmv for gmv_desc', () => {
    expect(resolveCreativeSort('gmv-desc').sort).toEqual({
      _recencyTier: 1,
      productTotalGmv: -1,
      publishedAt: -1,
    });
  });

  it('resolveCreativeSort supports ascending views', () => {
    expect(resolveCreativeSort('views-asc').sort).toEqual({
      'metrics.viewCount': 1,
      publishedAt: -1,
      _id: 1,
    });
  });

  it('resolveCreativeSort uses pure viewCount for views_desc', () => {
    expect(resolveCreativeSort('views-desc').sort).toEqual({
      'metrics.viewCount': -1,
      publishedAt: -1,
      _id: 1,
    });
  });

  it('CREATIVE_SORT_OPTIONS includes gmv and units aliases', () => {
    expect(CREATIVE_SORT_OPTIONS).toContain('gmv_desc');
    expect(CREATIVE_SORT_OPTIONS).toContain('units_sold_desc');
    expect(CREATOR_LOBBY_SORT_OPTIONS).toContain('creator_gmv_desc');
    expect(CREATOR_LOBBY_SORT_OPTIONS).toContain('followers_desc');
  });
});
