import { PRODUCT_CATEGORIES } from '../src/api/products/product.constants';
import { ProductRepository } from '../src/db/repositories/product.repository';
import { ProductService } from '../src/services/product.service';
import { ProductFeedQuerySchema } from '../src/api/products/product.validator';

describe('Product Categories - Hardcoded Canonical List', () => {

  it('PRODUCT_CATEGORIES should be defined and have multiple categories', () => {
    expect(PRODUCT_CATEGORIES).toBeDefined();
    expect(PRODUCT_CATEGORIES.length).toBeGreaterThanOrEqual(11);
    expect(PRODUCT_CATEGORIES).toContain('Beauty & Personal Care');
    expect(PRODUCT_CATEGORIES).toContain('Home & Kitchen');
  });

  it('ProductRepository.getCategories() should return the hardcoded list', async () => {
    const repoCategories = await ProductRepository.getCategories();
    expect(repoCategories).toEqual([...PRODUCT_CATEGORIES]);
  });

  it('ProductService.getCategories() should return the hardcoded list directly', async () => {
    const serviceCategories = await ProductService.getCategories();
    expect(serviceCategories).toEqual([...PRODUCT_CATEGORIES]);
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
  });
});

