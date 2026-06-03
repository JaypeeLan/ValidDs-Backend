import { PRODUCT_CATEGORIES } from '../src/api/products/product.constants';
import {
  filterL1CategoriesWithProducts,
  filterSubcategoriesWithProducts,
} from '../src/utils/product-category-catalog.util';

describe('product-category-catalog.util', () => {
  it('filterL1CategoriesWithProducts keeps canonical order and drops empty L1', () => {
    const db = ['Pets', 'Beauty & Personal Care'];
    expect(filterL1CategoriesWithProducts(db)).toEqual(['Beauty & Personal Care', 'Pets']);
  });

  it('filterL1CategoriesWithProducts returns empty when no products', () => {
    expect(filterL1CategoriesWithProducts([])).toEqual([]);
  });

  it('filterSubcategoriesWithProducts omits L1 without products', () => {
    const map = {
      'Beauty & Personal Care': ['Skincare'],
      Pets: ['Dog'],
    };
    const out = filterSubcategoriesWithProducts(map) as Record<string, string[]>;
    expect(out['Beauty & Personal Care']).toEqual(['Skincare']);
    expect(out.Pets).toEqual(['Dog']);
    expect(out.Fashion).toBeUndefined();
  });

  it('filterSubcategoriesWithProducts with category returns flat list', () => {
    const map = { 'Beauty & Personal Care': ['Skincare', 'Hair Care'] };
    expect(filterSubcategoriesWithProducts(map, 'Beauty & Personal Care')).toEqual([
      'Skincare',
      'Hair Care',
    ]);
  });

  it('filterSubcategoriesWithProducts excludes subcategories with no products', () => {
    const map = { 'Beauty & Personal Care': ['Skincare'] };
    const out = filterSubcategoriesWithProducts(map, 'Beauty & Personal Care') as string[];
    expect(out).toEqual(['Skincare']);
    expect(out).not.toContain('Fragrance');
  });

  it('unknown L1 category query returns empty subcategory list', () => {
    expect(filterSubcategoriesWithProducts({}, 'Not Real')).toEqual([]);
  });

  it('PRODUCT_CATEGORIES is the ordering source for L1 filter', () => {
    const subset = PRODUCT_CATEGORIES.slice(0, 2);
    expect(filterL1CategoriesWithProducts(subset)).toEqual(subset);
  });
});
