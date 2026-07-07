import { CreativeListQuerySchema } from '../src/api/creatives/creative.validator';

describe('CreativeListQuerySchema', () => {
  it('accepts a single categoryL1 string', () => {
    const parsed = CreativeListQuerySchema.parse({ categoryL1: 'Home & Kitchen' });
    expect(parsed.categoryL1).toEqual(['Home & Kitchen']);
  });

  it('splits comma-separated categoryL1 values', () => {
    const parsed = CreativeListQuerySchema.parse({
      categoryL1: 'Home & Kitchen,Beauty & Personal Care',
    });
    expect(parsed.categoryL1).toEqual(['Home & Kitchen', 'Beauty & Personal Care']);
  });

  it('accepts multiple categoryL2 values as an array', () => {
    const parsed = CreativeListQuerySchema.parse({
      categoryL2: ['Skincare', 'Hair Care'],
    });
    expect(parsed.categoryL2).toEqual(['Skincare', 'Hair Care']);
  });

  it('splits comma-separated tokens inside a single categoryL2 array element', () => {
    const parsed = CreativeListQuerySchema.parse({
      categoryL2: ['Skincare,Hair Care'],
    });
    expect(parsed.categoryL2).toEqual(['Skincare', 'Hair Care']);
  });

  it('splits comma-separated hashtags', () => {
    const parsed = CreativeListQuerySchema.parse({ hashtags: 'beautyfinds,skincare' });
    expect(parsed.hashtags).toEqual(['beautyfinds', 'skincare']);
  });

  it('accepts minViews and maxViews', () => {
    const parsed = CreativeListQuerySchema.parse({ minViews: 1000, maxViews: 500000 });
    expect(parsed.minViews).toBe(1000);
    expect(parsed.maxViews).toBe(500000);
  });

  it('rejects minViews greater than maxViews', () => {
    expect(() => CreativeListQuerySchema.parse({ minViews: 100000, maxViews: 1000 })).toThrow();
  });
});
