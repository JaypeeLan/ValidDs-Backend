import {
  buildShopStoreCatalogUrl,
  deriveShopAccountHandle,
  isLikelyCreatorProfileAvatarCdnUrl,
  isSuspiciousShopAvatarUrl,
} from '../src/utils/shop-avatar.util';

describe('shop-avatar.util', () => {
  it('derives account handle from shop name', () => {
    expect(deriveShopAccountHandle('Glamnetic')).toBe('glamnetic');
    expect(deriveShopAccountHandle('Brazil in Miami')).toBe('brazilinmiami');
  });

  it('builds tiktok shop/store catalog URL from view/shop link', () => {
    expect(
      buildShopStoreCatalogUrl('https://shop.tiktok.com/view/shop/7495832567110863806', 'Crocs'),
    ).toBe('https://www.tiktok.com/shop/store/crocs/7495832567110863806');
  });

  it('flags creator profile CDN URLs as suspicious shop logos', () => {
    const profileUrl =
      'https://p16-common-sign.tiktokcdn-us.com/tos-useast5-avt-0068-tx/da74b4ed549eab726ac1b7bb685d8b6d~tplv-tiktokx-cropcenter:1080:1080.jpeg';
    expect(isLikelyCreatorProfileAvatarCdnUrl(profileUrl)).toBe(true);
    expect(isSuspiciousShopAvatarUrl({ shopAvatarUrl: profileUrl })).toBe(true);
  });

  it('accepts oec-general shop catalog logos', () => {
    const catalogUrl =
      'https://p16-oec-general-useast5.ttcdn-us.com/tos-useast5-i-omjb5zjo8w-tx/0e1e83bcdab948b9aa9e6474e87c5d2f~tplv-fhlh96nyum-resize-webp:300:300.webp';
    expect(isLikelyCreatorProfileAvatarCdnUrl(catalogUrl)).toBe(false);
    expect(isSuspiciousShopAvatarUrl({ shopAvatarUrl: catalogUrl })).toBe(false);
  });
});
