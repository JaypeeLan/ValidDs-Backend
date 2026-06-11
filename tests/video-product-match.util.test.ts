import {
  creativeVideoProductMatchReason,
  creativeVideoMatchesProduct,
  videoMatchesProduct,
} from '../src/utils/video-product-match.util';

describe('video-product-match.util', () => {
  it('matches when caption shares distinctive product tokens', () => {
    expect(
      videoMatchesProduct(
        {
          description: 'My Tarte colored clay undereye corrector review',
          hashtags: ['makeup'],
        },
        'Tarte Colored Clay CC Undereye Corrector',
      ),
    ).toBe(true);
  });

  it('rejects unrelated caption vs product title', () => {
    expect(
      videoMatchesProduct(
        {
          description: 'I did not expect there to be so much collagen in these jars',
          hashtags: ['supplements'],
        },
        'Tarte Colored Clay CC Undereye Corrector',
      ),
    ).toBe(false);
  });

  it('creativeVideoProductMatchReason skips listingVerified rows', () => {
    expect(
      creativeVideoProductMatchReason({
        externalVideoId: '123',
        productName: 'Tarte Colored Clay CC Undereye Corrector',
        description: 'random unrelated caption',
        listingVerified: true,
      }),
    ).toBeNull();
  });

  it('creativeVideoMatchesProduct returns false on mismatch', () => {
    expect(
      creativeVideoMatchesProduct({
        externalVideoId: '123',
        productName: 'Tarte Colored Clay CC Undereye Corrector',
        description: 'collagen creatine jars bulk supplement',
        hashtags: [],
      }),
    ).toBe(false);
  });

  it('uses originalCaption for angle ads when present', () => {
    expect(
      creativeVideoProductMatchReason({
        externalVideoId: '7640286993921953055',
        productName: 'tarte colored clay CC undereye',
        description: 'This creator demonstrates how the Tarte Shape Tape Cloud CC Cream works',
        originalCaption: 'Medicube deodorant fresh that lasts review',
        isAd: true,
        isPrimaryDiscovery: false,
        angle: 'Ultimate under-eye corrector',
      }),
    ).toContain('video caption does not match product');
  });
});
