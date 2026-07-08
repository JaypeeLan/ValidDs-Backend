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

  it('creativeVideoProductMatchReason rejects listingVerified rows with mismatched caption', () => {
    expect(
      creativeVideoProductMatchReason({
        externalVideoId: '123',
        productName: 'Tarte Colored Clay CC Undereye Corrector',
        description: 'random unrelated caption',
        listingVerified: true,
      }),
    ).toMatch(/listing-verified creative caption does not match product/);
  });

  it('creativeVideoProductMatchReason allows listingVerified rows without caption', () => {
    expect(
      creativeVideoProductMatchReason({
        externalVideoId: '123',
        productName: 'Tarte Colored Clay CC Undereye Corrector',
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
    ).toMatch(/video caption (does not match product|references a different brand)/);
  });

  it('rejects MediCube promo attached to Anua glass skin bundle (brand guard kept under loose)', () => {
    const productName =
      '[Anua] Viral Ultimate Glass Skin Bundle | Salmon PDRN Cream + Niacinamide Serum';
    expect(
      creativeVideoMatchesProduct({
        externalVideoId: '7484291480627088686',
        productName,
        shopName: 'Anua Store US',
        originalCaption: "Glass skin goals for less! MediCube's Glass Skin Bundle is on a BIG sale",
        description: "Glass skin goals for less! MediCube's Glass Skin Bundle is on a BIG sale",
        hashtags: ['medicube', 'medicubeskincare', 'glassskin'],
        isAd: true,
        isPrimaryDiscovery: false,
        angle: 'Glass skin goals for less!',
      }),
    ).toBe(false);
  });

  it('keeps a secondary ad from another seller that names no competing brand', () => {
    // Fails the strict primary gate (missing model token) but passes loose for a secondary.
    const productName = 'Stanley Quencher H2.0 Tumbler 40oz Insulated Cup';
    expect(
      creativeVideoProductMatchReason({
        externalVideoId: '9001',
        productName,
        shopName: 'Stanley',
        originalCaption: 'this 40oz quencher tumbler keeps my drink cold all day',
        description: 'this 40oz quencher tumbler keeps my drink cold all day',
        hashtags: ['tumbler'],
        isAd: true,
        isPrimaryDiscovery: false,
        angle: 'Stays cold all day',
      }),
    ).toBeNull();
  });

  it('rejects a secondary clip that names a competitor brand', () => {
    const productName = 'Stanley Quencher H2.0 Tumbler 40oz Insulated Cup';
    expect(
      creativeVideoProductMatchReason({
        externalVideoId: '9002',
        productName,
        shopName: 'Stanley',
        originalCaption: 'Simple Modern 40oz tumbler quencher dupe review',
        description: 'Simple Modern 40oz tumbler quencher dupe review',
        hashtags: ['simplemodern'],
        isAd: true,
        isPrimaryDiscovery: false,
        angle: 'A great dupe',
      }),
    ).toMatch(/different brand/);
  });
});
