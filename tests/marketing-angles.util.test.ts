import {
  angleHasPlayableVideo,
  enrichAnglesWithMetaVideoProxyUrls,
  enrichAnglesWithFallbackCreativeProxyUrls,
  stripAngleProxyUrls,
  stripAllAngleVideos,
  filterMarketingAnglesWithPlayableVideo,
  sortMarketingAnglesWithVideoFirst,
} from '../src/utils/marketing-angles.util';

describe('marketing-angles.util', () => {
  it('stripAllAngleVideos removes every video field', () => {
    const out = stripAllAngleVideos([
      {
        hook: 'h',
        body: 'b',
        target: 't',
        videoUrl: 'https://www.tiktok.com/@u/video/1',
        videoProxyUrl: '/api/v1/creatives/x/video',
        thumbnailProxyUrl: '/api/v1/creatives/x/thumbnail',
        metaAdLibraryUrl: 'https://www.facebook.com/ads/library/?id=1',
        listingVerified: true,
      },
    ]);
    expect(out[0]).toEqual({ hook: 'h', body: 'b', target: 't' });
  });

  it('stripAngleProxyUrls removes persisted proxy fields only', () => {
    const out = stripAngleProxyUrls([
      {
        hook: 'h',
        body: 'b',
        target: 't',
        videoUrl: 'https://www.tiktok.com/@u/video/1',
        videoProxyUrl: '/api/v1/creatives/x/video',
        thumbnailProxyUrl: '/api/v1/creatives/x/thumbnail',
      },
    ]);
    expect(out[0]).toEqual({
      hook: 'h',
      body: 'b',
      target: 't',
      videoUrl: 'https://www.tiktok.com/@u/video/1',
    });
  });

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

  it('filterMarketingAnglesWithPlayableVideo drops angles without proxy', () => {
    const out = filterMarketingAnglesWithPlayableVideo([
      { hook: 'text only' },
      { hook: 'playable', videoProxyUrl: '/api/v1/creatives/x/video' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.hook).toBe('playable');
  });

  it('sorts angles with video first', () => {
    const sorted = sortMarketingAnglesWithVideoFirst([
      { hook: 'a' },
      { hook: 'b', videoProxyUrl: '/api/v1/creatives/x/video' },
      { hook: 'c' },
    ]);
    expect(sorted.map((a) => a.hook)).toEqual(['b', 'a', 'c']);
  });

  it('enriches angles with fallback creative proxy URLs', () => {
    const out = enrichAnglesWithFallbackCreativeProxyUrls(
      [{ hook: 'h1' }, { hook: 'h2', videoUrl: 'https://www.tiktok.com/@x/video/7123' }],
      'creative_123',
      'v1',
    );
    expect(out[0]?.videoProxyUrl).toBe('/api/v1/creatives/creative_123/video?index=0');
    expect(out[0]?.thumbnailProxyUrl).toBe(
      '/api/v1/creatives/creative_123/thumbnail?index=0&kind=thumbnail',
    );
    // Do not attach fallback if a specific videoUrl is present (handled by other enrichers).
    expect(out[1]?.videoProxyUrl).toBeUndefined();
  });
});
