import {
  discoverySectionsForProduct,
  resolveProductIsAd,
} from '../src/utils/discovery-sections.util';

describe('discoverySectionsForProduct', () => {
  const now = Date.parse('2026-06-08T12:00:00.000Z');

  it('tags organic posts with trending + recency buckets', () => {
    const publishedAt = new Date('2026-06-07T12:00:00.000Z');
    expect(
      discoverySectionsForProduct({ publishedAt, discoverySections: ['tiktok_shop'] }, now),
    ).toEqual(['trending', 'new-7d', 'new-3d']);
  });

  it('tags ad posts with top-ads', () => {
    const publishedAt = new Date('2026-05-20T12:00:00.000Z');
    expect(discoverySectionsForProduct({ publishedAt, isAd: true }, now)).toEqual(['top-ads']);
  });

  it('drops new-7d once the post is older than 7 days', () => {
    const publishedAt = new Date('2026-05-27T12:00:00.000Z');
    expect(
      discoverySectionsForProduct({ publishedAt, discoverySections: ['top-ads', 'new-7d'] }, now),
    ).toEqual(['top-ads']);
  });

  it('resolveProductIsAd from stored top-ads section', () => {
    expect(resolveProductIsAd({ discoverySections: ['top-ads', 'new-7d'] })).toBe(true);
    expect(resolveProductIsAd({ discoverySections: ['trending'] })).toBe(false);
  });
});
