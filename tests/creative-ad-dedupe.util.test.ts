import { creativeAdDedupeKey } from '../src/utils/creative-response.util';

describe('creativeAdDedupeKey', () => {
  it('collapses Meta ads with same copy on same page', () => {
    const base = {
      externalVideoId: 'meta:111',
      metaPageId: 'page1',
      productId: 'prod1',
      description: 'Shop our setting spray today',
      thumbnailUrl: 'https://cdn.example.com/a.jpg',
      creator: { handle: 'brand' },
    };
    const a = creativeAdDedupeKey(base);
    const b = creativeAdDedupeKey({ ...base, externalVideoId: 'meta:222' });
    expect(a).toBe(b);
  });

  it('collapses Meta ads that reuse the product hero even when copy differs', () => {
    const thumb = 'https://p16-oec.example.com/tos/abc/490f42dc4905478abbfb2ed0de864999~tplv.jpeg';
    const base = {
      externalVideoId: 'meta:111',
      metaPageId: 'page1',
      productId: 'prod1',
      description: 'Shop our setting spray today — limited time offer',
      thumbnailUrl: thumb,
      productPrimaryImageUrl: thumb,
      creator: { handle: 'brand' },
    };
    const a = creativeAdDedupeKey(base);
    const b = creativeAdDedupeKey({
      ...base,
      externalVideoId: 'meta:222',
      description: 'Get flawless skin with our viral setting spray now',
    });
    expect(a).toBe(b);
  });

  it('collapses Meta look-alike cards (same page, product, hero image, no copy)', () => {
    const thumb = 'https://p16-oec.example.com/tos/abc/490f42dc4905478abbfb2ed0de864999~tplv.jpeg';
    const base = {
      externalVideoId: 'meta:111',
      metaPageId: 'page1',
      productId: 'prod1',
      description: '',
      thumbnailUrl: thumb,
      creator: { handle: 'brand' },
    };
    const a = creativeAdDedupeKey(base);
    const b = creativeAdDedupeKey({
      ...base,
      externalVideoId: 'meta:222',
      thumbnailUrl:
        'https://p19-oec.example.com/tos/abc/490f42dc4905478abbfb2ed0de864999~tplv-other.jpeg',
    });
    expect(a).toBe(b);
  });

  it('keeps distinct TikTok videos with real covers', () => {
    const a = creativeAdDedupeKey({
      externalVideoId: '7643925823090625822',
      tiktokPostUrl: 'https://www.tiktok.com/@x/video/7643925823090625822',
      thumbnailUrl: 'https://cdn.example.com/cover-a.jpg',
      productPrimaryImageUrl: 'https://cdn.example.com/product.jpg',
    });
    const b = creativeAdDedupeKey({
      externalVideoId: '7642748503227223327',
      tiktokPostUrl: 'https://www.tiktok.com/@x/video/7642748503227223327',
      thumbnailUrl: 'https://cdn.example.com/cover-b.jpg',
      productPrimaryImageUrl: 'https://cdn.example.com/product.jpg',
    });
    expect(a).not.toBe(b);
  });

  it('collapses Meta ads for the same product when both use the listing hero image', () => {
    const hero = 'https://p16-oec.example.com/tos/abc/490f42dc4905478abbfb2ed0de864999~tplv.jpeg';
    const productId = '507f1f77bcf86cd799439011';
    const a = creativeAdDedupeKey({
      productId,
      externalVideoId: 'meta:111',
      metaPageId: 'page-a',
      thumbnailUrl: hero,
      productPrimaryImageUrl: hero,
      description: 'Different ad copy A',
      creator: { handle: 'brand_a' },
    });
    const b = creativeAdDedupeKey({
      productId,
      externalVideoId: 'meta:222',
      metaPageId: 'page-b',
      thumbnailUrl:
        'https://p19-oec.example.com/tos/abc/490f42dc4905478abbfb2ed0de864999~tplv-other.jpeg',
      productPrimaryImageUrl: hero,
      description: 'Different ad copy B',
      creator: { handle: 'brand_b' },
    });
    expect(a).toBe(`product-card:${productId}`);
    expect(b).toBe(a);
  });

  it('collapses TikTok promos that only show the product hero image', () => {
    const hero = 'https://p16-oec.example.com/tos/abc/490f42dc4905478abbfb2ed0de864999~tplv.jpeg';
    const productId = '507f1f77bcf86cd799439011';
    const a = creativeAdDedupeKey({
      productId,
      externalVideoId: '7643925823090625822',
      tiktokPostUrl: 'https://www.tiktok.com/@x/video/7643925823090625822',
      thumbnailUrl: hero,
      productPrimaryImageUrl: hero,
    });
    const b = creativeAdDedupeKey({
      productId,
      externalVideoId: '7642748503227223327',
      tiktokPostUrl: 'https://www.tiktok.com/@y/video/7642748503227223327',
      thumbnailUrl:
        'https://p19-oec.example.com/tos/abc/490f42dc4905478abbfb2ed0de864999~tplv-other.jpeg',
      productPrimaryImageUrl: hero,
    });
    expect(a).toBe(`product-card:${productId}`);
    expect(b).toBe(a);
  });
});
