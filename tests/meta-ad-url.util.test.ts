import {
  attachMetaAdLibraryUrlsToAngles,
  enrichAnglesWithVideoProxyUrls,
  stripNonPlayableAngleVideoUrls,
} from '../src/utils/marketing-angles.util';
import { normalizeMetaAdLibraryUrl } from '../src/utils/meta-ad-url.util';

describe('meta-ad-url.util', () => {
  it('normalizes render_ad snapshot URLs', () => {
    expect(
      normalizeMetaAdLibraryUrl(
        'https://www.facebook.com/ads/archive/render_ad/?id=12345&access_token=secret',
      ),
    ).toBe('https://www.facebook.com/ads/library/?id=12345');
  });
});

describe('playable angle videos', () => {
  it('strips Ad Library URLs from angle videoUrl', () => {
    const out = stripNonPlayableAngleVideoUrls([
      {
        hook: 'h',
        body: 'b',
        target: 't',
        videoUrl: 'https://www.facebook.com/ads/library/?id=11111111111',
      },
    ]);
    expect(out[0]?.videoUrl).toBeUndefined();
  });

  it('enriches TikTok angles with videoProxyUrl when creative exists', () => {
    const index = new Map([['7123456789012345678', 'creative123']]);
    const out = enrichAnglesWithVideoProxyUrls(
      [
        {
          hook: 'h',
          body: 'b',
          target: 't',
          videoUrl: 'https://www.tiktok.com/@shop/video/7123456789012345678',
        },
      ],
      index,
      'v1',
    );
    expect(out[0]?.videoProxyUrl).toBe('/api/v1/creatives/creative123/video?index=0');
  });

  it('attachMetaAdLibraryUrlsToAngles is deprecated (external links stripped at API layer)', () => {
    const out = attachMetaAdLibraryUrlsToAngles(
      [{ hook: 'h', body: 'b', target: 't' }],
      ['https://www.facebook.com/ads/library/?id=22222222222'],
    );
    expect(out[0]?.metaAdLibraryUrl).toBe('https://www.facebook.com/ads/library/?id=22222222222');
  });
});
