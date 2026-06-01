import {
  collectThumbnailProxyCandidates,
  IMAGE_PROXY_PLACEHOLDER,
} from '../src/utils/creative-image-proxy.util';

describe('creative-image-proxy.util', () => {
  it('lists product hero as fallback when avatar CDN URL is primary', () => {
    const urls = collectThumbnailProxyCandidates(
      {
        creator: { avatarUrl: 'https://cdn.example.com/av.jpg', handle: 'x' },
        shopAvatarUrl: 'https://cdn.example.com/shop.jpg',
        productPrimaryImageUrl: 'https://cdn.example.com/product.jpg',
        thumbnailUrl: 'https://cdn.example.com/thumb.jpg',
      },
      0,
      'avatar',
    );
    expect(urls[0]).toBe('https://cdn.example.com/av.jpg');
    expect(urls).toContain('https://cdn.example.com/product.jpg');
  });

  it('provides a valid SVG placeholder buffer', () => {
    expect(IMAGE_PROXY_PLACEHOLDER.toString('utf8')).toContain('<svg');
  });
});
