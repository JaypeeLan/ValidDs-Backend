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
   * Returns a number representing 'total units sold' globally, or null if uncertain.
   */
  async estimateGlobalSales(productName: string): Promise<number | null> {
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
        q: `${productName} global total units sold sales volume customer count`,
      });

      const res = await fetch(
        `https://www.googleapis.com/customsearch/v1?${params.toString()}`,
        { signal: AbortSignal.timeout(5000) }
      );

      if (!res.ok) {
        log.debug('Google Search API request failed', { status: res.status });
        return null;
      }

      const data = await res.json() as { items?: Array<{ snippet: string; title: string }> };
      const snippets = (data.items ?? []).map(i => i.snippet + ' ' + i.title).join('\n');

      if (!snippets) return null;

      // In a real system, we'd pass these snippets to Gemini to extract the number.
      // For now, we'll use a regex and basic heuristic, or return null to allow
      // the AI extractor to use its internal grounding knowledge with this context.
      return this.parseSalesFromSnippets(snippets);
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
