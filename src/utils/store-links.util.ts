import { resolveShopProductUrl, resolveShopStoreUrl } from './shop-avatar.util';

export type StoreLinkPlatform = 'tiktok' | 'shopify';
export type StoreLinkKind = 'store' | 'product';

export interface StoreLink {
  platform: StoreLinkPlatform;
  label: string;
  url: string;
  kind: StoreLinkKind;
}

function isLikelyProductPageUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname.replace(/\/$/, '');
    return path.length > 1 && path !== '/';
  } catch {
    return false;
  }
}

export function buildStoreLinks(input: {
  shopUrl?: string | null;
  productUrl?: string | null;
  listingId?: string | null;
  shopName?: string | null;
  officialWebsiteUrl?: string | null;
  officialProductUrl?: string | null;
}): StoreLink[] {
  const links: StoreLink[] = [];

  const tiktokProduct = resolveShopProductUrl(
    input.productUrl ?? undefined,
    input.listingId ?? undefined,
  );
  if (tiktokProduct) {
    links.push({
      platform: 'tiktok',
      label: 'View product on TikTok',
      url: tiktokProduct,
      kind: 'product',
    });
  }

  const tiktokStore = resolveShopStoreUrl(input.shopUrl ?? undefined, input.shopName ?? undefined);
  if (tiktokStore) {
    links.push({
      platform: 'tiktok',
      label: 'View store on TikTok',
      url: tiktokStore,
      kind: 'store',
    });
  }

  const officialProduct = (input.officialProductUrl ?? '').trim();
  if (officialProduct.startsWith('https://') && isLikelyProductPageUrl(officialProduct)) {
    links.push({
      platform: 'shopify',
      label: 'View product on website',
      url: officialProduct,
      kind: 'product',
    });
  }

  const website = (input.officialWebsiteUrl ?? '').trim();
  if (website.startsWith('https://')) {
    links.push({
      platform: 'shopify',
      label: 'View store on website',
      url: website,
      kind: 'store',
    });
  }

  return links;
}
