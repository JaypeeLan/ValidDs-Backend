/**
 * Market definitions for ValidDs multi-region support.
 *
 * Each market maps to its own set of MongoDB collections:
 *   products_us, products_gb, creatives_us, creatives_gb, etc.
 *
 * Collection suffix = market code lowercased.
 *
 * NOTE: We use 'UK' (matching ALLOWED_CONTENT_REGIONS in user.model.ts and Bright Data's
 * region codes) even though the ISO 3166-1 alpha-2 code is 'GB'. Collection name: products_uk.
 */

export const SUPPORTED_MARKETS = {
  US: { code: 'US', name: 'United States',  currency: 'USD', locale: 'en-US', tiktokShop: true  },
  CA: { code: 'CA', name: 'Canada',         currency: 'CAD', locale: 'en-CA', tiktokShop: false },
  MX: { code: 'MX', name: 'Mexico',         currency: 'MXN', locale: 'es-MX', tiktokShop: false },
  UK: { code: 'UK', name: 'United Kingdom', currency: 'GBP', locale: 'en-GB', tiktokShop: true  },
  AU: { code: 'AU', name: 'Australia',      currency: 'AUD', locale: 'en-AU', tiktokShop: true  },
  NZ: { code: 'NZ', name: 'New Zealand',    currency: 'NZD', locale: 'en-NZ', tiktokShop: false },
  ES: { code: 'ES', name: 'Spain',          currency: 'EUR', locale: 'es-ES', tiktokShop: true  },
  DE: { code: 'DE', name: 'Germany',        currency: 'EUR', locale: 'de-DE', tiktokShop: true  },
  FR: { code: 'FR', name: 'France',         currency: 'EUR', locale: 'fr-FR', tiktokShop: true  },
  IT: { code: 'IT', name: 'Italy',          currency: 'EUR', locale: 'it-IT', tiktokShop: true  },
} as const;

export type MarketCode = keyof typeof SUPPORTED_MARKETS;
export type MarketMeta = (typeof SUPPORTED_MARKETS)[MarketCode];

export const MARKET_CODES = Object.keys(SUPPORTED_MARKETS) as MarketCode[];

export const DEFAULT_MARKET: MarketCode = 'US';

/** Returns the lowercase suffix used in collection names, e.g. 'US' → 'us' */
export function marketCollectionSuffix(market: MarketCode): string {
  return market.toLowerCase();
}

/** Returns the collection name for a given base name and market, e.g. ('products', 'US') → 'products_us' */
export function marketCollection(base: string, market: MarketCode): string {
  return `${base}_${marketCollectionSuffix(market)}`;
}

export function isValidMarket(code: string): code is MarketCode {
  return code in SUPPORTED_MARKETS;
}

/** Coerce a raw string to a MarketCode, falling back to the default. */
export function toMarketCode(raw: string | undefined | null): MarketCode {
  if (raw && isValidMarket(raw)) return raw;
  return DEFAULT_MARKET;
}
