import {
  normalizePrimaryCreatorForStorage,
  normalizePrimaryCreatorOnProduct,
  normalizeSuppliersOnProduct,
  supplierHasRating,
  type CreatorAvatarEnrichment,
} from '../src/utils/product-response.util';

describe('normalizePrimaryCreatorForStorage', () => {
  it('writes primaryImageUrl from avatarUrl when only legacy field is set', () => {
    const stored = normalizePrimaryCreatorForStorage({
      handle: 'colorkey_vn',
      avatarUrl: 'https://ui-avatars.com/api/?name=CC',
    });
    expect(stored.primaryImageUrl).toBe('https://ui-avatars.com/api/?name=CC');
    expect(stored.avatarUrl).toBe('https://ui-avatars.com/api/?name=CC');
  });
});

describe('normalizePrimaryCreatorOnProduct', () => {
  it('prefers primaryImageUrl as the canonical creator avatar', () => {
    const product: Record<string, unknown> = {
      _id: '507f1f77bcf86cd799439011',
      primaryCreator: {
        handle: 'creator1',
        primaryImageUrl: 'https://cdn.example/avatar-primary.jpg',
        avatarUrl: 'https://cdn.example/avatar-legacy.jpg',
      },
    };

    normalizePrimaryCreatorOnProduct(product);

    const pc = product.primaryCreator as Record<string, unknown>;
    expect(pc.primaryImageUrl).toBe('https://cdn.example/avatar-primary.jpg');
    expect(pc.avatarUrl).toBe('https://cdn.example/avatar-primary.jpg');
  });

  it('falls back from avatarUrl to primaryImageUrl when only avatarUrl is stored', () => {
    const product: Record<string, unknown> = {
      primaryCreator: {
        handle: 'creator2',
        avatarUrl: 'https://cdn.example/only-legacy.jpg',
      },
    };

    normalizePrimaryCreatorOnProduct(product);

    const pc = product.primaryCreator as Record<string, unknown>;
    expect(pc.primaryImageUrl).toBe('https://cdn.example/only-legacy.jpg');
    expect(pc.avatarUrl).toBe('https://cdn.example/only-legacy.jpg');
  });

  it('fills primaryImageUrl from creative enrichment and adds avatarProxyUrl', () => {
    const product: Record<string, unknown> = {
      _id: '507f1f77bcf86cd799439011',
      primaryCreator: { handle: 'creator3' },
    };
    const enrichment: CreatorAvatarEnrichment = {
      creativeId: '507f1f77bcf86cd799439099',
      primaryImageUrl: 'https://cdn.tiktok.com/creator.jpg',
    };

    normalizePrimaryCreatorOnProduct(product, enrichment);

    const pc = product.primaryCreator as Record<string, unknown>;
    expect(pc.primaryImageUrl).toBe('https://cdn.tiktok.com/creator.jpg');
    expect(pc.avatarUrl).toBe('https://cdn.tiktok.com/creator.jpg');
    expect(pc.avatarProxyUrl).toBe(
      '/api/v1/creatives/507f1f77bcf86cd799439099/thumbnail?index=0&kind=avatar',
    );
  });

  it('adds avatarProxyUrl from creativeId even when primaryImageUrl is missing', () => {
    const product: Record<string, unknown> = {
      primaryCreator: { handle: 'creator5' },
    };
    const enrichment: CreatorAvatarEnrichment = {
      creativeId: '507f1f77bcf86cd799439099',
    };

    normalizePrimaryCreatorOnProduct(product, enrichment);

    const pc = product.primaryCreator as Record<string, unknown>;
    expect(pc.primaryImageUrl).toBe(
      '/api/v1/creatives/507f1f77bcf86cd799439099/thumbnail?index=0&kind=avatar',
    );
    expect(pc.avatarUrl).toBe(pc.primaryImageUrl);
    expect(pc.avatarProxyUrl).toBe(pc.primaryImageUrl);
  });

  it('keeps stored primaryImageUrl over creative enrichment when both exist', () => {
    const product: Record<string, unknown> = {
      primaryCreator: {
        handle: 'creator4',
        primaryImageUrl: 'https://cdn.example/stored.jpg',
      },
    };
    const enrichment: CreatorAvatarEnrichment = {
      creativeId: '507f1f77bcf86cd799439099',
      primaryImageUrl: 'https://cdn.tiktok.com/from-creative.jpg',
    };

    normalizePrimaryCreatorOnProduct(product, enrichment);

    const pc = product.primaryCreator as Record<string, unknown>;
    expect(pc.primaryImageUrl).toBe('https://cdn.example/stored.jpg');
    expect(pc.avatarProxyUrl).toContain('/creatives/507f1f77bcf86cd799439099/');
  });
});

describe('supplierHasRating', () => {
  it('accepts product rating > 0', () => {
    expect(supplierHasRating({ rating: 4.2 })).toBe(true);
  });

  it('accepts shop.rating when product rating is missing', () => {
    expect(supplierHasRating({ shop: { rating: 3.5 } })).toBe(true);
  });

  it('rejects zero, null, and missing ratings', () => {
    expect(supplierHasRating({ rating: 0 })).toBe(false);
    expect(supplierHasRating({ rating: null, shop: { rating: 0 } })).toBe(false);
    expect(supplierHasRating({ title: 'Store' })).toBe(false);
    expect(supplierHasRating(null)).toBe(false);
  });
});

describe('normalizeSuppliersOnProduct', () => {
  it('hides stores with 0 or no ratings', () => {
    const product: Record<string, unknown> = {
      suppliers: [
        {
          source: 'apify_store_leads',
          title: 'Rated Store',
          rating: 4.5,
          productUrl: 'https://a.example',
        },
        {
          source: 'apify_store_leads',
          title: 'Zero Store',
          rating: 0,
          productUrl: 'https://b.example',
        },
        { source: 'apify_store_leads', title: 'No Rating', productUrl: 'https://c.example' },
        {
          source: 'apify_store_leads',
          title: 'Shop Rated',
          shop: { name: 'Shop', rating: 4.1 },
          productUrl: 'https://d.example',
        },
      ],
    };

    normalizeSuppliersOnProduct(product);

    const titles = (product.suppliers as Array<{ title: string }>).map((s) => s.title);
    expect(titles).toEqual(['Rated Store', 'Shop Rated']);
  });
});
