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

describe('formatCreativeFeedItem metrics', () => {
  it('sanitizes implausible view/like ratios in API output', () => {
    const item = formatCreativeFeedItem({
      _id: '507f1f77bcf86cd799439012',
      externalVideoId: '7123456789',
      videoS3Key: 'brightdata/tiktok-videos/7123456789.mp4',
      tiktokPostUrl: 'https://www.tiktok.com/@user/video/7123456789',
      creator: {
        handle: 'user',
        verified: false,
        tiktokPostUrl: 'https://www.tiktok.com/@user/video/7123456789',
      },
      metrics: { viewCount: 4_000_000, likeCount: 2, commentCount: 0, shareCount: 0 },
      section: 'top-ads',
      productId: '507f1f77bcf86cd799439022',
    });

    expect(item.metrics.viewCount).toBe(1000);
    expect(item.metrics.likeCount).toBe(2);
  });
});

describe('formatCreativeFeedItem creator avatar proxy', () => {
  it('exposes avatarProxyUrl when only creator handle is stored (S3/proxy refresh)', () => {
    const item = formatCreativeFeedItem({
      _id: '507f1f77bcf86cd799439012',
      externalVideoId: '7123456789',
      embedUrl: 'https://www.tiktok.com/@user/video/1',
      tiktokPostUrl: 'https://www.tiktok.com/@user/video/1',
      creator: {
        handle: 'tiktok_user',
        verified: false,
        tiktokPostUrl: 'https://www.tiktok.com/@user/video/1',
      },
      metrics: { viewCount: 1, likeCount: 0, commentCount: 0, shareCount: 0 },
      section: 'trending',
      productId: '507f1f77bcf86cd799439022',
    });

    expect(item.creator.avatarUrl).toBe(
      '/api/v1/creatives/507f1f77bcf86cd799439012/thumbnail?index=0&kind=avatar',
    );
    expect(item.creator.avatarProxyUrl).toBe(
      '/api/v1/creatives/507f1f77bcf86cd799439012/thumbnail?index=0&kind=avatar',
    );
  });
});

describe('formatCreativeFeedItem videoProxyUrl', () => {
  it('sets videoProxyUrl only when videoS3Key exists', () => {
    const withVideo = formatCreativeFeedItem({
      _id: '507f1f77bcf86cd799439012',
      externalVideoId: '7123456789',
      videoS3Key: 'brightdata/tiktok-videos/7123456789.mp4',
      tiktokPostUrl: 'https://www.tiktok.com/@user/video/7123456789',
      creator: {
        handle: 'user',
        verified: false,
        tiktokPostUrl: 'https://www.tiktok.com/@user/video/7123456789',
      },
      metrics: { viewCount: 1, likeCount: 0, commentCount: 0, shareCount: 0 },
      section: 'top-ads',
      productId: '507f1f77bcf86cd799439022',
    });
    expect(withVideo.videoProxyUrl).toBe(
      '/api/v1/creatives/507f1f77bcf86cd799439012/video?index=0',
    );

    const withoutVideo = formatCreativeFeedItem({
      _id: '507f1f77bcf86cd799439013',
      externalVideoId: 'meta:12345678901',
      metaAdLibraryUrl: 'https://www.facebook.com/ads/library/?id=12345678901',
      tiktokPostUrl: 'https://www.facebook.com/ads/library/?id=12345678901',
      creator: {
        handle: 'brand',
        verified: false,
        tiktokPostUrl: 'https://www.facebook.com/ads/library/?id=12345678901',
      },
      metrics: { viewCount: 0, likeCount: 0, commentCount: 0, shareCount: 0 },
      section: 'trending',
      productId: '507f1f77bcf86cd799439022',
    });
    expect(withoutVideo.videoProxyUrl).toBeUndefined();
  });

  it('sets videoProxyUrl for verified Meta creative with S3 key', () => {
    const item = formatCreativeFeedItem({
      _id: '507f1f77bcf86cd799439014',
      externalVideoId: 'meta:12345678901',
      metaAdId: '12345678901',
      metaAdLibraryUrl: 'https://www.facebook.com/ads/library/?id=12345678901',
      tiktokPostUrl: 'https://www.facebook.com/ads/library/?id=12345678901',
      videoS3Key: 'brightdata/tiktok-videos/meta/12345678901.mp4',
      creator: {
        handle: 'brand',
        verified: false,
        tiktokPostUrl: 'https://www.facebook.com/ads/library/?id=12345678901',
      },
      metrics: { viewCount: 0, likeCount: 0, commentCount: 0, shareCount: 0 },
      section: 'trending',
      productId: '507f1f77bcf86cd799439022',
    });
    expect(item.videoProxyUrl).toBe('/api/v1/creatives/507f1f77bcf86cd799439014/video?index=0');
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
