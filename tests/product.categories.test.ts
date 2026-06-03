import { PRODUCT_CATEGORIES } from '../src/api/products/product.constants';
import { ProductFeedQuerySchema } from '../src/api/products/product.validator';
import {
  filterL1CategoriesWithProducts,
  filterSubcategoriesWithProducts,
} from '../src/utils/product-category-catalog.util';

describe('Product Categories', () => {
  it('PRODUCT_CATEGORIES should be defined and have multiple categories', () => {
    expect(PRODUCT_CATEGORIES).toBeDefined();
    expect(PRODUCT_CATEGORIES.length).toBeGreaterThanOrEqual(11);
    expect(PRODUCT_CATEGORIES).toContain('Beauty & Personal Care');
    expect(PRODUCT_CATEGORIES).toContain('Home & Kitchen');
  });

  describe('Validator - ProductFeedQuerySchema', () => {
    it('should pass validation with valid single category string', () => {
      const validQuery = { category: 'Beauty & Personal Care' };
      const parsed = ProductFeedQuerySchema.parse(validQuery);
      expect(parsed.category).toEqual(['Beauty & Personal Care']);
    });

    it('should pass validation with valid multiple category array', () => {
      const validQuery = { category: ['Home & Kitchen', 'Pets'] };
      const parsed = ProductFeedQuerySchema.parse(validQuery);
      expect(parsed.category).toEqual(['Home & Kitchen', 'Pets']);
    });

    it('should pass validation with valid comma-separated string', () => {
      const validQuery = { category: 'Sports & Outdoors, Automotive' };
      const parsed = ProductFeedQuerySchema.parse(validQuery);
      expect(parsed.category).toEqual(['Sports & Outdoors', 'Automotive']);
    });

    it('should fail validation with invalid category', () => {
      const invalidQuery = { category: 'Random Fake Category' };
      const result = ProductFeedQuerySchema.safeParse(invalidQuery);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('Invalid category');
      }
    });

    it('should fail validation if one of multiple categories is invalid', () => {
      const invalidQuery = { category: ['Beauty & Personal Care', 'Random Fake Category'] };
      const result = ProductFeedQuerySchema.safeParse(invalidQuery);
      expect(result.success).toBe(false);
    });

    it('should pass validation with multiple subcategories as array', () => {
      const parsed = ProductFeedQuerySchema.parse({
        subcategory: ['Skincare', 'Makeup & Cosmetics'],
      });
      expect(parsed._filters.subcategory).toEqual(['Skincare', 'Makeup & Cosmetics']);
    });

    it('should pass validation with comma-separated subcategory string', () => {
      const parsed = ProductFeedQuerySchema.parse({
        subcategory: 'Skincare,Hair Care',
      });
      expect(parsed._filters.subcategory).toEqual(['Skincare', 'Hair Care']);
    });

    it('should pass validation with subcategories alias', () => {
      const parsed = ProductFeedQuerySchema.parse({
        subcategories: ['Skincare', 'Fragrance'],
      });
      expect(parsed._filters.subcategory).toEqual(['Skincare', 'Fragrance']);
    });

    it('should pass validation with categoryL2 alias', () => {
      const parsed = ProductFeedQuerySchema.parse({
        categoryL2: 'Skincare,Nail Care',
      });
      expect(parsed._filters.subcategory).toEqual(['Skincare', 'Nail Care']);
    });

    it('should split comma-separated tokens inside a single array element', () => {
      const parsed = ProductFeedQuerySchema.parse({
        subcategory: ['Skincare,Fragrance'],
      });
      expect(parsed._filters.subcategory).toEqual(['Skincare', 'Fragrance']);
    });

    it('should fail validation with invalid subcategory', () => {
      const result = ProductFeedQuerySchema.safeParse({ subcategory: 'Not A Real Subcategory' });
      expect(result.success).toBe(false);
    });
  });

  describe('API catalog filters (products in DB only)', () => {
    it('drops L1 categories with no listable products', () => {
      expect(filterL1CategoriesWithProducts(['Pets'])).toEqual(['Pets']);
      expect(filterL1CategoriesWithProducts([])).toEqual([]);
    });

    it('drops L2 subcategories with no listable products', () => {
      const all = filterSubcategoriesWithProducts({
        'Beauty & Personal Care': ['Skincare'],
      }) as Record<string, string[]>;
      expect(Object.keys(all)).toEqual(['Beauty & Personal Care']);
      expect(all['Beauty & Personal Care']).not.toContain('Fragrance');
    });
  });
});
