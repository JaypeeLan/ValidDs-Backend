import {
  buildPersonalizationProfile,
  SIGNAL_WEIGHTS,
} from '../src/services/product-recommendation.service';
import type { IUserDocument } from '../src/types/user.types';
import mongoose from 'mongoose';

describe('product-recommendation.service', () => {
  it('buildPersonalizationProfile weights saved, imports, and search signals', () => {
    const user = {
      savedProducts: [{ productId: new mongoose.Types.ObjectId(), savedAt: new Date() }],
      shopifyImportHistory: [
        {
          productId: new mongoose.Types.ObjectId(),
          importedAt: new Date(),
        },
      ],
      searchHistory: [
        {
          query: 'ice cream maker',
          filters: { category: ['Home & Kitchen'], subcategory: ['Kitchen Appliances'] },
          searchedAt: new Date(),
        },
      ],
    } as Pick<IUserDocument, 'savedProducts' | 'searchHistory' | 'shopifyImportHistory'>;

    const savedId = String(user.savedProducts[0]!.productId);
    const importId = String(user.shopifyImportHistory[0]!.productId);

    const profile = buildPersonalizationProfile(
      user,
      [],
      new Map([
        [savedId, { categoryL1: 'Home & Kitchen', categoryL2: 'Kitchen Gadgets', price: 29 }],
      ]),
      new Map([
        [importId, { categoryL1: 'Home & Kitchen', categoryL2: 'Kitchen Appliances', price: 49 }],
      ]),
    );

    expect(profile.excludeIds.has(savedId)).toBe(true);
    expect(profile.excludeIds.has(importId)).toBe(true);
    expect(profile.l2Weights.get('Kitchen Appliances')).toBe(
      SIGNAL_WEIGHTS.shopifyImport + SIGNAL_WEIGHTS.search,
    );
    expect(profile.l2Weights.get('Kitchen Gadgets')).toBe(SIGNAL_WEIGHTS.saved);
    expect(profile.l1Weights.get('Home & Kitchen')).toBe(
      SIGNAL_WEIGHTS.saved + SIGNAL_WEIGHTS.shopifyImport + SIGNAL_WEIGHTS.search,
    );
    expect(profile.searchTexts[0]).toBe('ice cream maker');
    expect(profile.priceSamples).toEqual(expect.arrayContaining([29, 49]));
  });
});
