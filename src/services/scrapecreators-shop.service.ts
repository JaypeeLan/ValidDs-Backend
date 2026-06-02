import { env } from '../config/env.validation';
import { logger } from '../logger';
import { ScrapeCreatorsService } from './scrapecreators.service';

const log = logger.child({ module: 'scrapecreators-shop' });

const MIN_PROFILE_MATCH_SCORE = 0.45;

function similarity(a: string, b: string): number {
  const x = a.toLowerCase().trim();
  const y = b.toLowerCase().trim();
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.85;
  const longer = x.length >= y.length ? x : y;
  const shorter = x.length < y.length ? x : y;
  let matches = 0;
  for (let i = 0; i <= shorter.length - 3; i += 1) {
    if (longer.includes(shorter.slice(i, i + 3))) matches += 1;
  }
  return Math.min(1, matches / Math.max(1, shorter.length - 2));
}

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

export function deriveShopAccountHandle(shopName: string): string {
  return shopName.toLowerCase().replace(/[^a-z0-9]/g, '');
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
  region = 'US',
): Promise<string | undefined> {
  const url = shopUrl.trim();
  if (!url.startsWith('https://')) return undefined;

  const data = (await scFetch('/v1/tiktok/shop/products', { url, region })) as Record<
    string,
    unknown
  > | null;
  if (!data || data.success === false) return undefined;
  const shopInfo = data.shopInfo;
  if (shopInfo && typeof shopInfo === 'object') {
    return pickShopLogoFromShopInfo(shopInfo as Record<string, unknown>);
  }
  return undefined;
}

/** Match shop name to a creator profile avatar when storefront logo is unavailable. */
export async function fetchShopLogoFromProfile(
  shopName: string,
  accountHandle?: string,
): Promise<string | undefined> {
  const handle = (accountHandle || deriveShopAccountHandle(shopName)).trim();
  if (!handle) return undefined;

  const profile = await ScrapeCreatorsService.getUserInfo(handle);
  if (!profile?.uniqueId) return undefined;

  const nickname = profile.nickname ?? profile.uniqueId;
  if (similarity(shopName, nickname) < MIN_PROFILE_MATCH_SCORE) {
    log.debug('Shop profile match rejected', { shopName, handle, nickname });
    return undefined;
  }

  return ScrapeCreatorsService.pickAvatarUrl(profile);
}

export async function fetchFreshShopLogoUrls(input: {
  shopName: string;
  shopUrl?: string;
  creatorHandle?: string;
  region?: string;
}): Promise<string[]> {
  const urls: string[] = [];
  const add = (u: string | undefined) => {
    if (u?.startsWith('https://') && !urls.includes(u)) urls.push(u);
  };

  const region = (input.region ?? 'US').toUpperCase();
  const shopUrl = input.shopUrl?.trim();
  if (shopUrl?.startsWith('https://')) {
    add(await fetchShopLogoFromCatalog(shopUrl, region));
  }

  add(
    await fetchShopLogoFromProfile(
      input.shopName,
      input.creatorHandle || deriveShopAccountHandle(input.shopName),
    ),
  );

  const creatorHandle = input.creatorHandle?.replace(/^@/, '').trim();
  if (creatorHandle) {
    const profile = await ScrapeCreatorsService.getUserInfo(creatorHandle);
    add(ScrapeCreatorsService.pickAvatarUrl(profile));
  }

  return urls;
}
