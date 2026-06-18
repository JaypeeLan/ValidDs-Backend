/**
 * Shop avatar URL helpers — storefront logos must not come from creator profile CDN.
 */

export function deriveShopAccountHandle(shopName: string): string {
  return shopName.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** TikTok Shop catalog API requires www.tiktok.com/shop/store/{slug}/{sellerId}. */
export function buildShopStoreCatalogUrl(shopUrl: string, shopName: string): string | undefined {
  const trimmed = shopUrl.trim();
  if (!trimmed.startsWith('https://')) return undefined;
  if (trimmed.includes('tiktok.com/shop/store/')) return trimmed;

  const sellerId = trimmed.match(/(\d{12,})/)?.[1];
  const slug = shopName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  if (!sellerId || !slug) return undefined;
  return `https://www.tiktok.com/shop/store/${slug}/${sellerId}`;
}

const SHOP_PRODUCT_ID_RE = /\/(?:view\/product|pdp\/product)\/(\d+)/i;

/** Canonical TikTok Shop PDP URL — rejects storefront URLs mistaken for product links. */
export function resolveShopProductUrl(
  productUrl: string | undefined | null,
  listingId?: string | null,
): string | undefined {
  const trimmed = (productUrl ?? '').trim();
  if (trimmed && !trimmed.includes('/shop/store/')) {
    const match = trimmed.match(SHOP_PRODUCT_ID_RE);
    if (match?.[1]) {
      return `https://www.tiktok.com/shop/pdp/product/${match[1]}`;
    }
    if (trimmed.startsWith('https://')) {
      return trimmed;
    }
  }

  const pid = (listingId ?? '').trim();
  if (/^\d{10,}$/.test(pid)) {
    return `https://www.tiktok.com/shop/pdp/product/${pid}`;
  }

  return undefined;
}

/** Public storefront link for API responses and ingest (fixes legacy view/shop URLs). */
export function resolveShopStoreUrl(
  shopUrl: string | undefined | null,
  shopName: string | undefined | null,
): string | undefined {
  const trimmed = (shopUrl ?? '').trim();
  if (!trimmed.startsWith('https://')) return undefined;
  if (trimmed.includes('tiktok.com/shop/store/')) return trimmed;
  if (trimmed.includes('shop.tiktok.com/view/shop/')) {
    return buildShopStoreCatalogUrl(trimmed, shopName ?? '') ?? undefined;
  }
  return buildShopStoreCatalogUrl(trimmed, shopName ?? '') ?? trimmed;
}

/** Strip query params for stable comparison. */
export function shopAvatarUrlBase(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url.split('?')[0] ?? url;
  }
}

/** True when URL is a TikTok user/profile avatar CDN path (not a Shop catalog logo). */
export function isLikelyCreatorProfileAvatarCdnUrl(url: string): boolean {
  const u = url.trim();
  if (!u.startsWith('https://')) return false;
  if (u.includes('oec-general')) return false;
  if (/\/avt-0068|\/tos-[^/]+-avt-/.test(u)) return true;
  if (u.includes('sc=avatar')) return true;
  if (u.includes('sc=PUBLISH') && u.includes('shcp=132edbea')) return true;
  if (u.includes('tiktokx-cropcenter:1080:1080') && u.includes('common-sign')) return true;
  return false;
}

export type ShopAvatarSuspicionInput = {
  shopAvatarUrl?: string | null;
  creatorAvatarUrl?: string | null;
  primaryImageUrl?: string | null;
};

/** Detect shop logos that were copied from creator/product images or profile CDN. */
export function isSuspiciousShopAvatarUrl(input: ShopAvatarSuspicionInput): boolean {
  const shop = typeof input.shopAvatarUrl === 'string' ? input.shopAvatarUrl.trim() : '';
  if (!shop.startsWith('https://')) return true;

  const creator = typeof input.creatorAvatarUrl === 'string' ? input.creatorAvatarUrl.trim() : '';
  const primary = typeof input.primaryImageUrl === 'string' ? input.primaryImageUrl.trim() : '';

  if (creator && shopAvatarUrlBase(shop) === shopAvatarUrlBase(creator)) return true;
  if (primary && shopAvatarUrlBase(shop) === shopAvatarUrlBase(primary)) return true;
  if (isLikelyCreatorProfileAvatarCdnUrl(shop)) return true;
  return false;
}
