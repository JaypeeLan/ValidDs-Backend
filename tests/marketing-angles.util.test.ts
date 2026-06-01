import {
  angleHasPlayableVideo,
  enrichAnglesWithMetaVideoProxyUrls,
  sortMarketingAnglesWithVideoFirst,
} from '../src/utils/marketing-angles.util';

describe('marketing-angles.util', () => {
  it('detects playable video only via videoProxyUrl (S3)', () => {
    expect(angleHasPlayableVideo({ videoProxyUrl: '/api/v1/creatives/x/video' })).toBe(true);
    expect(
      angleHasPlayableVideo({
        videoUrl: 'https://www.tiktok.com/@shop/video/7123456789012345678',
      }),
    ).toBe(false);
    expect(angleHasPlayableVideo({ videoUrl: 'https://www.facebook.com/ads/library/?id=1' })).toBe(
      false,
    );
    expect(angleHasPlayableVideo({ hook: 'h' })).toBe(false);
  });

  it('enriches Meta angles with videoProxyUrl and strips external links', () => {
    const index = new Map([['1000970549543334', 'creative_meta_1']]);
    const out = enrichAnglesWithMetaVideoProxyUrls(
      [
        {
          hook: 'h',
          metaAdLibraryUrl: 'https://www.facebook.com/ads/library/?id=1000970549543334',
        },
      ],
      index,
    );
    expect(out[0]?.videoProxyUrl).toBe('/api/v1/creatives/creative_meta_1/video?index=0');
    expect(out[0]?.thumbnailProxyUrl).toBe(
      '/api/v1/creatives/creative_meta_1/thumbnail?index=0&kind=thumbnail',
    );
    expect(out[0]?.metaAdLibraryUrl).toBeUndefined();
  });

  it('sorts angles with video first', () => {
    const sorted = sortMarketingAnglesWithVideoFirst([
      { hook: 'a' },
      { hook: 'b', videoProxyUrl: '/api/v1/creatives/x/video' },
      { hook: 'c' },
    ]);
    expect(sorted.map((a) => a.hook)).toEqual(['b', 'a', 'c']);
  });
});
