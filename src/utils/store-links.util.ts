import { resolveShopStoreUrl } from './shop-avatar.util';

export type StoreLinkPlatform = 'tiktok' | 'shopify';
export type StoreLinkKind = 'store' | 'product';

export interface StoreLink {
  platform: StoreLinkPlatform;
  label: string;
  url: string;
  kind: StoreLinkKind;
}

export function buildStoreLinks(input: {
  shopUrl?: string | null;
  productUrl?: string | null;
  shopName?: string | null;
  officialWebsiteUrl?: string | null;
  officialProductUrl?: string | null;
}): StoreLink[] {
  const links: StoreLink[] = [];

  const tiktokStore = resolveShopStoreUrl(input.shopUrl ?? undefined, input.shopName ?? undefined);
  if (tiktokStore) {
    links.push({
      platform: 'tiktok',
      label: 'View on TikTok',
      url: tiktokStore,
      kind: 'store',
    });
  }

  const website = (input.officialWebsiteUrl ?? '').trim();
  if (website.startsWith('https://')) {
    links.push({
      platform: 'shopify',
      label: 'View on website',
      url: website,
      kind: 'store',
    });
  }

  return links;
}
