import {
  discoverySectionsForProduct,
  resolveGlobalSelling,
  resolveHighOpportunity,
  resolveProductIsAd,
} from '../src/utils/discovery-sections.util';

describe('discoverySectionsForProduct', () => {
  it('tags organic products with trending', () => {
    expect(discoverySectionsForProduct({ discoverySections: ['tiktok_shop'] })).toEqual([
      'trending',
    ]);
  });

  it('tags ad products with top-ads', () => {
    expect(discoverySectionsForProduct({ isAd: true })).toEqual(['top-ads']);
    expect(discoverySectionsForProduct({ discoverySections: ['top-ads'] })).toEqual(['top-ads']);
  });

  it('tags high-opportunity products (explicit signal)', () => {
    expect(discoverySectionsForProduct({ isHighOpportunity: true })).toEqual(['high-opportunity']);
    expect(discoverySectionsForProduct({ discoverySections: ['high-opportunity'] })).toEqual([
      'high-opportunity',
    ]);
  });

  it('tags global-selling products (explicit signal)', () => {
    expect(discoverySectionsForProduct({ isGlobalSelling: true })).toEqual(['global-selling']);
    expect(discoverySectionsForProduct({ discoverySections: ['global-selling'] })).toEqual([
      'global-selling',
    ]);
  });

  it('resolves exactly one section by priority (global-selling wins)', () => {
    expect(
      discoverySectionsForProduct({
        isGlobalSelling: true,
        isHighOpportunity: true,
        isAd: true,
      }),
    ).toEqual(['global-selling']);
    expect(discoverySectionsForProduct({ isHighOpportunity: true, isAd: true })).toEqual([
      'high-opportunity',
    ]);
  });

  it('resolveProductIsAd from stored top-ads section', () => {
    expect(resolveProductIsAd({ discoverySections: ['top-ads'] })).toBe(true);
    expect(resolveProductIsAd({ discoverySections: ['trending'] })).toBe(false);
  });

  it('resolveHighOpportunity / resolveGlobalSelling from signals', () => {
    expect(resolveHighOpportunity({ isHighOpportunity: true })).toBe(true);
    expect(resolveGlobalSelling({ discoverySections: ['global-selling'] })).toBe(true);
    expect(resolveGlobalSelling({ discoverySections: ['trending'] })).toBe(false);
  });
});
