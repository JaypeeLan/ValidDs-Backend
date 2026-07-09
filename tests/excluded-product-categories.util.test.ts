import {
  expandExcludedProductCategoryL1FilterValues,
  isExcludedProductCategoryL1,
} from '../src/utils/excluded-product-categories.util';

describe('excluded-product-categories.util', () => {
  it('flags electronics aliases as excluded', () => {
    expect(isExcludedProductCategoryL1('Electronics & Tech')).toBe(true);
    expect(isExcludedProductCategoryL1('Tech / Gadgets')).toBe(true);
    expect(isExcludedProductCategoryL1('Electronics')).toBe(true);
    expect(isExcludedProductCategoryL1('Beauty & Personal Care')).toBe(false);
  });

  it('expands excluded values for Mongo filters', () => {
    const values = expandExcludedProductCategoryL1FilterValues();
    expect(values).toEqual(expect.arrayContaining(['Electronics & Tech', 'Tech / Gadgets']));
  });
});
