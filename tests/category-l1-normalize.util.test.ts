import {
  expandCategoryL1FilterValues,
  normalizeCategoryL1,
} from '../src/utils/category-l1-normalize.util';
import { filterL1CategoriesWithProducts } from '../src/utils/product-category-catalog.util';

describe('category-l1-normalize.util', () => {
  it('maps common TikTok Shop L1 labels to canonical taxonomy', () => {
    expect(normalizeCategoryL1('Clothing, Shoes & Accessories')).toBe('Fashion');
    expect(normalizeCategoryL1('Health & Household')).toBe('Health & Wellness');
    expect(normalizeCategoryL1('Electronics')).toBe('Electronics & Tech');
    expect(normalizeCategoryL1('Pet Supplies')).toBe('Pets');
    expect(normalizeCategoryL1('Food & Grocery')).toBe('Food & Beverage');
    expect(normalizeCategoryL1('Office Products')).toBe('Tools & Home Improvement');
  });

  it('passes through canonical L1 unchanged', () => {
    expect(normalizeCategoryL1('Fashion')).toBe('Fashion');
    expect(normalizeCategoryL1('Beauty & Personal Care')).toBe('Beauty & Personal Care');
  });

  it('expandCategoryL1FilterValues includes raw DB aliases', () => {
    const fashionExpanded = expandCategoryL1FilterValues(['Fashion']);
    expect(fashionExpanded).toContain('Fashion');
    expect(fashionExpanded).toContain('Clothing, Shoes & Accessories');

    const electronicsExpanded = expandCategoryL1FilterValues(['Electronics & Tech']);
    expect(electronicsExpanded).toContain('Electronics');
    expect(electronicsExpanded).toContain('Electronics & Tech');
  });

  it('filterL1CategoriesWithProducts surfaces canonical L1 after alias normalization', () => {
    const out = filterL1CategoriesWithProducts([
      'Clothing, Shoes & Accessories',
      'Electronics',
      'Pet Supplies',
    ]);
    expect(out).toEqual(['Fashion', 'Electronics & Tech', 'Pets']);
  });
});
