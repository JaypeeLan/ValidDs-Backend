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

  it('keeps distinct TikTok videos', () => {
    const a = creativeAdDedupeKey({
      externalVideoId: '7643925823090625822',
      tiktokPostUrl: 'https://www.tiktok.com/@x/video/7643925823090625822',
    });
    const b = creativeAdDedupeKey({
      externalVideoId: '7642748503227223327',
      tiktokPostUrl: 'https://www.tiktok.com/@x/video/7642748503227223327',
    });
    expect(a).not.toBe(b);
  });
});
