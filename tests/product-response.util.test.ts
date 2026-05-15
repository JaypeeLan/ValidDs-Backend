import {
  normalizePrimaryCreatorForStorage,
  normalizePrimaryCreatorOnProduct,
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
