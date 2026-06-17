import {
  defaultSortOptionsForFeed,
  normalizeProductSortBy,
} from '../src/api/products/product-feed-filters.util';

describe('product-feed-filters.util', () => {
  it('normalizeProductSortBy maps last_ingested aliases to recent', () => {
    expect(normalizeProductSortBy('last_ingested')).toBe('recent');
    expect(normalizeProductSortBy('last-ingested')).toBe('recent');
    expect(normalizeProductSortBy('lastIngested')).toBe('recent');
    expect(normalizeProductSortBy('ingested_desc')).toBe('recent');
    expect(normalizeProductSortBy('ingested-desc')).toBe('recent');
    expect(normalizeProductSortBy('recent')).toBe('recent');
  });

  it('defaultSortOptionsForFeed includes last_ingested on top-opportunities', () => {
    expect(defaultSortOptionsForFeed('top-opportunities')).toContain('last_ingested');
  });
});
