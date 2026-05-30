import {
  formatCreativeFeedItem,
  resolveCreatorAvatarUrl,
} from '../src/utils/creative-response.util';

describe('resolveCreatorAvatarUrl', () => {
  it('prefers creator.avatarUrl over shopAvatarUrl', () => {
    const url = resolveCreatorAvatarUrl({
      creator: { avatarUrl: 'https://cdn.tiktok.com/a.jpg' },
      shopAvatarUrl: 'https://cdn.tiktok.com/shop.jpg',
    });
    expect(url).toBe('https://cdn.tiktok.com/a.jpg');
  });

  it('falls back to shopAvatarUrl when creator avatar is missing', () => {
    const url = resolveCreatorAvatarUrl({
      creator: { handle: 'page', verified: false, tiktokPostUrl: 'https://x' },
      shopAvatarUrl: 'https://cdn.shop/avatar.png',
      externalVideoId: 'meta:123',
    });
    expect(url).toBe('https://cdn.shop/avatar.png');
  });
});

describe('formatCreativeFeedItem creator avatar', () => {
  it('exposes avatarUrl and avatarProxyUrl when only shopAvatarUrl is stored', () => {
    const item = formatCreativeFeedItem({
      _id: '507f1f77bcf86cd799439011',
      externalVideoId: 'meta:99',
      embedUrl: 'https://www.facebook.com/ads/library/?id=99',
      tiktokPostUrl: 'https://www.facebook.com/ads/library/?id=99',
      creator: {
        handle: 'brand_page',
        verified: false,
        tiktokPostUrl: 'https://www.facebook.com/ads/library/?id=99',
      },
      shopAvatarUrl: 'https://cdn.example/shop-avatar.jpg',
      metrics: { viewCount: 0, likeCount: 0, commentCount: 0, shareCount: 0 },
      section: 'trending',
      productId: '507f1f77bcf86cd799439022',
    });

    expect(item.creator.avatarUrl).toBe('https://cdn.example/shop-avatar.jpg');
    expect(item.creator.avatarProxyUrl).toBe(
      '/api/v1/creatives/507f1f77bcf86cd799439011/thumbnail?index=0&kind=avatar',
    );
  });
});
