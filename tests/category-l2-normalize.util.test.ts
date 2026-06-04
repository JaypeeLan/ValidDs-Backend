import {
  expandSubcategoryFilterValues,
  normalizeCategoryL2,
} from '../src/utils/category-l2-normalize.util';
import { filterSubcategoriesWithProducts } from '../src/utils/product-category-catalog.util';

describe('category-l2-normalize.util', () => {
  it('maps common TikTok/AI L2 labels to canonical taxonomy', () => {
    expect(normalizeCategoryL2('Beauty & Personal Care', 'Makeup')).toBe('Makeup & Cosmetics');
    expect(normalizeCategoryL2('Beauty & Personal Care', 'Skin Care')).toBe('Skincare');
    expect(normalizeCategoryL2('Fashion', 'Bags & Luggage')).toBe('Bags & Accessories');
    expect(normalizeCategoryL2('Home & Kitchen', 'Bedding')).toBe('Bedding & Bath');
    expect(normalizeCategoryL2('Home & Kitchen', 'Home Décor')).toBe('Home Decor');
    expect(normalizeCategoryL2('Health & Wellness', 'Pain Relief')).toBe('Recovery & Pain Relief');
    expect(normalizeCategoryL2('Sports & Outdoors', 'Outdoor Recreation')).toBe(
      'Outdoor & Camping',
    );
  });

  it('expandSubcategoryFilterValues includes raw DB aliases', () => {
    const expanded = expandSubcategoryFilterValues(['Makeup & Cosmetics']);
    expect(expanded).toContain('Makeup & Cosmetics');
    expect(expanded).toContain('Makeup');
  });

  it('filterSubcategoriesWithProducts surfaces subs after alias normalization', () => {
    const map = {
      'Beauty & Personal Care': ['Makeup', 'Hair Care'],
      Fashion: ['Bags & Luggage'],
      'Home & Kitchen': ['Bedding', 'Kitchen Gadgets'],
    };
    const out = filterSubcategoriesWithProducts(map) as Record<string, string[]>;
    expect(out['Beauty & Personal Care']).toEqual(['Makeup & Cosmetics', 'Hair Care']);
    expect(out.Fashion).toEqual(['Bags & Accessories']);
    expect(out['Home & Kitchen']).toEqual(['Kitchen Gadgets', 'Bedding & Bath']);
  });
});
