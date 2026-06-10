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
});
