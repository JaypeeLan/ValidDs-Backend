import { buildStoreLinks } from '../src/utils/store-links.util';

describe('store-links.util', () => {
  it('builds TikTok and website links when both are known', () => {
    const links = buildStoreLinks({
      shopName: 'Anua Store US',
      shopUrl: 'https://www.tiktok.com/shop/store/anua-store-us/123456789012',
      officialWebsiteUrl: 'https://anua.com',
    });

    expect(links).toEqual([
      {
        platform: 'tiktok',
        label: 'View on TikTok',
        url: 'https://www.tiktok.com/shop/store/anua-store-us/123456789012',
        kind: 'store',
      },
      {
        platform: 'shopify',
        label: 'View on website',
        url: 'https://anua.com',
        kind: 'store',
      },
    ]);
  });

  it('omits website link when no official storefront is stored', () => {
    const links = buildStoreLinks({
      shopName: 'Some Shop',
      shopUrl: 'https://www.tiktok.com/shop/store/some-shop/123456789012',
    });

    expect(links).toHaveLength(1);
    expect(links[0]?.platform).toBe('tiktok');
  });
});
