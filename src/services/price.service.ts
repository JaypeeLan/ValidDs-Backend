import { logger } from '../logger';

const log = logger.child({ module: 'price-service' });

/**
 * Product Price Service
 *
 * Estimates a product's retail price by searching the web.
 * Uses SerpAPI (Google Shopping) as the primary source.
 */
export const PriceService = {
  /**
   * Search for a realistic retail price for a product.
   * Returns the estimated price in USD, or null if nothing is found.
   */
  async findProductPrice(productName: string): Promise<number | null> {
    const apiKey = process.env.SEARCHAPI_KEY ?? process.env.SERPAPI_KEY;
    if (!apiKey) {
      log.debug('SEARCHAPI_KEY missing - cannot search for price online');
      return null;
    }

    try {
      const params = new URLSearchParams({
        api_key: apiKey,
        engine: 'google_shopping',
        q: productName,
        google_domain: 'google.com',
        gl: 'us',
        hl: 'en',
      });

      const res = await fetch(
        `https://www.searchapi.io/api/v1/search?${params.toString()}`,
        { signal: AbortSignal.timeout(5000) }
      );

      if (!res.ok) {
        log.debug('SerpAPI Shopping search failed', { status: res.status });
        return null;
      }

      const data = await res.json() as {
        shopping_results?: Array<{ price?: string; extracted_price?: number }>;
      };

      // Extract prices and find a reasonable average or the first relevant one
      const prices = (data.shopping_results ?? [])
        .map(r => r.extracted_price)
        .filter((p): p is number => typeof p === 'number' && p > 0);

      if (prices.length === 0) return null;

      // Return the median or just the first relevant result for simplicity in V1
      return prices[0];
    } catch (err) {
      log.debug('Price search failed', { err: String(err) });
      return null;
    }
  },
};
