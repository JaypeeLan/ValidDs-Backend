describe('Product Categories - Hardcoded Canonical List', () => {
  let PRODUCT_CATEGORIES: any;
  let ProductRepository: any;
  let ProductService: any;
  let ProductFeedQuerySchema: any;

  beforeAll(async () => {
    // Scaffold minimal environment config so env.validation.ts doesn't crash on import
    process.env.NODE_ENV = 'development';
    process.env.INTERNAL_API_KEY = 'k'.repeat(32);
    process.env.JWT_SECRET = 'x'.repeat(32);
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
    process.env.MONGODB_URI = 'mongodb://localhost:27017/test';
    
    // Now dynamically import modules after setting environment
    const constants = await import('../src/api/products/product.constants');
    PRODUCT_CATEGORIES = constants.PRODUCT_CATEGORIES;

    const repo = await import('../src/db/repositories/product.repository');
    ProductRepository = repo.ProductRepository;

    const service = await import('../src/services/product.service');
    ProductService = service.ProductService;

    const validator = await import('../src/api/products/product.validator');
    ProductFeedQuerySchema = validator.ProductFeedQuerySchema;
  });

  it('PRODUCT_CATEGORIES should be defined and have multiple categories', () => {
    expect(PRODUCT_CATEGORIES).toBeDefined();
    expect(PRODUCT_CATEGORIES.length).toBeGreaterThanOrEqual(12);
    expect(PRODUCT_CATEGORIES).toContain('Beauty & Personal Care');
    expect(PRODUCT_CATEGORIES).toContain('Home & Living');
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
      const validQuery = { category: ['Home & Living', 'Pet Supplies'] };
      const parsed = ProductFeedQuerySchema.parse(validQuery);
      expect(parsed.category).toEqual(['Home & Living', 'Pet Supplies']);
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

