import { collectHttpsUrls } from '../src/utils/image-s3-cache.util';
import {
  deriveShopAccountHandle,
  pickShopLogoFromShopInfo,
} from '../src/services/scrapecreators-shop.service';
import { buildShopAvatarProxyUrl } from '../src/utils/creator-avatar.util';

describe('image-s3-cache.util', () => {
  it('collectHttpsUrls dedupes and ignores non-https', () => {
    expect(collectHttpsUrls('http://bad', 'https://a.com/x', 'https://a.com/x', undefined)).toEqual(
      ['https://a.com/x'],
    );
  });
});

describe('scrapecreators-shop.service', () => {
  it('derives account handle from shop name', () => {
    expect(deriveShopAccountHandle('Glamnetic')).toBe('glamnetic');
    expect(deriveShopAccountHandle('Brazil in Miami')).toBe('brazilinmiami');
  });

  it('picks logo from shopInfo.shop_logo.url_list', () => {
    expect(
      pickShopLogoFromShopInfo({
        shop_logo: { url_list: ['https://cdn.example/shop.webp'] },
      }),
    ).toBe('https://cdn.example/shop.webp');
  });
});

describe('buildShopAvatarProxyUrl', () => {
  it('builds shop thumbnail proxy path', () => {
    expect(
      buildShopAvatarProxyUrl('/api/v1/creatives/abc123', {
        shopName: 'Glamnetic',
        shopAvatarS3Key: 'validds/creator-assets/shops/us/glamnetic.jpg',
      }),
    ).toBe('/api/v1/creatives/abc123/thumbnail?index=0&kind=shop');
  });
});
