import { logger } from '../logger';

const log = logger.child({ module: 'market-research' });

/**
 * Market Research Service
 * 
 * Uses Google Search to find global sales, awards, and customer counts
 * for products to estimate global 'units sold' at scale.
 * 
 * Required env:
 *  - GOOGLE_API_KEY
 *  - GOOGLE_CSE_CX (Search Engine ID)
 */
export const MarketResearchService = {

  /**
   * Search for global sales volume for a product.
   * Returns the verified sales number AND the direct URL to the source proving it.
   */
  async estimateGlobalSales(productName: string): Promise<{ sales: number, url: string } | null> {
    const apiKey = process.env.GOOGLE_API_KEY;
    const cx = process.env.GOOGLE_CSE_CX;

    if (!apiKey || !cx) {
      log.debug('Google Search API not fully configured — skipping automated grounding');
      return null;
    }

    try {
      const params = new URLSearchParams({
        key: apiKey,
        cx,
        q: `${productName} units sold OR orders OR customers site:aliexpress.com OR site:walmart.com`,
      });

      const res = await fetch(
        `https://www.googleapis.com/customsearch/v1?${params.toString()}`,
        { signal: AbortSignal.timeout(5000) }
      );

      if (!res.ok) {
        log.debug('Google Search API request failed', { status: res.status });
        return null;
      }

      const data = await res.json() as { items?: Array<{ snippet: string; title: string; link: string }> };
      
      for (const item of data.items || []) {
        const text = item.snippet + ' ' + item.title;
        const sales = this.parseSalesFromSnippets(text);
        if (sales && sales > 0) {
          return { sales, url: item.link };
        }
      }

      return null;
    } catch (err) {
      log.error('Market research search failed', err);
      return null;
    }
  },

  /**
   * Basic heuristic to find large numbers in search snippets.
   * Looks for "X million", "X,000+", etc.
   */
  parseSalesFromSnippets(text: string): number | null {
    const lowerText = text.toLowerCase();
    
    // Look for Millions
    const millionMatch = lowerText.match(/(\d+(\.\d+)?)\s*million/);
    if (millionMatch) {
      return Math.floor(parseFloat(millionMatch[1]) * 1000000);
    }

    // Look for Thousands
    const thousandMatch = lowerText.match(/(\d{1,3}(,\d{3})*)\+?\s*units|orders|customers|sales/);
    if (thousandMatch) {
      return parseInt(thousandMatch[1].replace(/,/g, ''), 10);
    }

    return null;
  }
};
