import { env } from '../config/env.validation';
import { logger } from '../logger';
import { buildShopStoreCatalogUrl } from '../utils/shop-avatar.util';
import { ScrapeCreatorsService } from './scrapecreators.service';

const log = logger.child({ module: 'scrapecreators-shop' });

function firstHttpsFromUrlList(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string' && value.startsWith('https://')) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const u = firstHttpsFromUrlList(item);
      if (u) return u;
    }
  }
  if (typeof value === 'object') {
    const block = value as Record<string, unknown>;
    for (const key of ['url_list', 'urlList', 'thumb_url_list']) {
      const u = firstHttpsFromUrlList(block[key]);
      if (u) return u;
    }
  }
  return undefined;
}

export function pickShopLogoFromShopInfo(shopInfo: Record<string, unknown>): string | undefined {
  const logo = shopInfo.shop_logo;
  if (logo && typeof logo === 'object') {
    return firstHttpsFromUrlList(logo);
  }
  return undefined;
}

async function scFetch(path: string, params: Record<string, string>): Promise<unknown | null> {
  if (!ScrapeCreatorsService.isConfigured()) return null;
  const qs = new URLSearchParams(params).toString();
  const url = `${env.SCRAPECREATORS_BASE_URL}${path}?${qs}`;
  try {
    const res = await fetch(url, {
      headers: { 'x-api-key': env.SCRAPECREATORS_API_KEY!, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    return res.json();
  } catch (err) {
    log.debug('ScrapeCreators shop request failed', { path, err: String(err) });
    return null;
  }
}

/** Fetch shop logo from TikTok Shop storefront catalog (`/v1/tiktok/shop/products`). */
export async function fetchShopLogoFromCatalog(
  shopUrl: string,
  shopName: string,
  region = 'US',
): Promise<string | undefined> {
  const catalogUrl =
    buildShopStoreCatalogUrl(shopUrl, shopName) ??
    (shopUrl.trim().includes('tiktok.com/shop/store/') ? shopUrl.trim() : undefined);
  if (!catalogUrl?.startsWith('https://')) return undefined;

  const data = (await scFetch('/v1/tiktok/shop/products', {
    url: catalogUrl,
    region,
  })) as Record<string, unknown> | null;
  if (!data || data.success === false) return undefined;
  const shopInfo = data.shopInfo;
  if (shopInfo && typeof shopInfo === 'object') {
    const fromCatalog = pickShopLogoFromShopInfo(shopInfo as Record<string, unknown>);
    if (fromCatalog) return fromCatalog;
    const link = (shopInfo as Record<string, unknown>).shop_link;
    if (typeof link === 'string' && link.includes('tiktok.com/shop/store/')) {
      const retry = (await scFetch('/v1/tiktok/shop/products', { url: link, region })) as Record<
        string,
        unknown
      > | null;
      const info = retry?.shopInfo;
      if (info && typeof info === 'object') {
        return pickShopLogoFromShopInfo(info as Record<string, unknown>);
      }
    }
  }
  return undefined;
}

export async function fetchFreshShopLogoUrls(input: {
  shopName: string;
  shopUrl?: string;
  region?: string;
}): Promise<string[]> {
  const urls: string[] = [];
  const add = (u: string | undefined) => {
    if (u?.startsWith('https://') && !urls.includes(u)) urls.push(u);
  };

  const region = (input.region ?? 'US').toUpperCase();
  const shopUrl = input.shopUrl?.trim();
  const shopName = input.shopName.trim();
  if (shopUrl?.startsWith('https://') && shopName) {
    add(await fetchShopLogoFromCatalog(shopUrl, shopName, region));
  }

  return urls;
}
