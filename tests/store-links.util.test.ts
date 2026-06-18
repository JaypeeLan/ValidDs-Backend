import { buildStoreLinks } from '../src/utils/store-links.util';

describe('store-links.util', () => {
  it('builds product and store links when both are known', () => {
    const links = buildStoreLinks({
      shopName: 'Anua Store US',
      shopUrl: 'https://www.tiktok.com/shop/store/anua-store-us/123456789012',
      productUrl: 'https://shop.tiktok.com/view/product/1731150607022133549',
      officialWebsiteUrl: 'https://anua.com',
      officialProductUrl: 'https://anua.com/products/niacinamide-serum',
    });

    expect(links).toEqual([
      {
        platform: 'tiktok',
        label: 'View product on TikTok',
        url: 'https://www.tiktok.com/shop/pdp/product/1731150607022133549',
        kind: 'product',
      },
      {
        platform: 'tiktok',
        label: 'View store on TikTok',
        url: 'https://www.tiktok.com/shop/store/anua-store-us/123456789012',
        kind: 'store',
      },
      {
        platform: 'shopify',
        label: 'View product on website',
        url: 'https://anua.com/products/niacinamide-serum',
        kind: 'product',
      },
      {
        platform: 'shopify',
        label: 'View store on website',
        url: 'https://anua.com',
        kind: 'store',
      },
    ]);
  });

  it('derives TikTok PDP from listing id when productUrl is a storefront link', () => {
    const links = buildStoreLinks({
      shopName: 'Some Shop',
      shopUrl: 'https://www.tiktok.com/shop/store/some-shop/123456789012',
      productUrl: 'https://www.tiktok.com/shop/store/some-shop/123456789012',
      listingId: '1731150607022133549',
    });

    expect(links[0]).toEqual({
      platform: 'tiktok',
      label: 'View product on TikTok',
      url: 'https://www.tiktok.com/shop/pdp/product/1731150607022133549',
      kind: 'product',
    });
    expect(links[1]?.kind).toBe('store');
  });

  it('omits website links when no official storefront is stored', () => {
    const links = buildStoreLinks({
      shopName: 'Some Shop',
      shopUrl: 'https://www.tiktok.com/shop/store/some-shop/123456789012',
      productUrl: 'https://www.tiktok.com/shop/pdp/product/1731150607022133549',
    });

    expect(links).toHaveLength(2);
    expect(links[0]?.kind).toBe('product');
    expect(links[1]?.platform).toBe('tiktok');
    expect(links[1]?.kind).toBe('store');
  });
});
