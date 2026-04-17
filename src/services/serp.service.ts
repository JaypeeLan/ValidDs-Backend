import axios from 'axios';
import { logger } from '../logger';

const log = logger.child({ module: 'serp-service' });
const SEARCH_API_BASE_URL = 'https://www.searchapi.io/api/v1/search';

export interface SerpShoppingResult {
  title: string;
  source: string;
  price?: string;
  price_raw?: number;
  thumbnail?: string;
  link?: string;
  rating?: number;
  reviews?: number;
  is_ad?: boolean;
}

export interface SerpRichData {
  shopping_results?: SerpShoppingResult[];
  immersive_products?: any[];
  local_results?: any;
  organic_results?: any[];
  knowledge_graph?: any;
}

function normalizeSearchApiResponse(raw: any): SerpRichData {
  const shoppingAds = Array.isArray(raw?.shopping_ads) ? raw.shopping_ads : [];
  const inlineShopping = Array.isArray(raw?.inline_shopping) ? raw.inline_shopping : [];

  const normalizedFromAds: SerpShoppingResult[] = shoppingAds.map((item: any) => ({
    title: item.title || '',
    source: item.seller || '',
    price: item.price,
    price_raw: typeof item.extracted_price === 'number' ? item.extracted_price : undefined,
    thumbnail: item.image,
    link: item.product_link || item.link,
    rating: typeof item.rating === 'number' ? item.rating : undefined,
    reviews: typeof item.reviews === 'number' ? item.reviews : undefined,
    is_ad: true,
  }));

  const normalizedFromInline: SerpShoppingResult[] = inlineShopping.map((item: any) => ({
    title: item.title || '',
    source: item.seller || '',
    price: item.price,
    price_raw: typeof item.extracted_price === 'number' ? item.extracted_price : undefined,
    thumbnail: item.thumbnail,
    link: item.product_link || item.link,
    rating: typeof item.rating === 'number' ? item.rating : undefined,
    reviews: typeof item.reviews === 'number' ? item.reviews : undefined,
    is_ad: false,
  }));

  const shopping_results = [...normalizedFromAds, ...normalizedFromInline]
    .filter((item) => item.title && item.source);

  return {
    shopping_results,
    immersive_products: raw?.immersive_products || [],
    local_results: raw?.local_results,
    organic_results: raw?.organic_results || [],
    knowledge_graph: raw?.knowledge_graph,
  };
}

export const SerpService = {
  /**
   * Fetches full Google Search JSON via SerpAPI.
   * This provides the "Good Info" (related products, ads, local sightings).
   */
  async getRichProductData(query: string): Promise<SerpRichData | null> {
    const apiKey = process.env.SERPAPI_KEY;
    if (!apiKey) {
      log.warn('SERPAPI_KEY is not configured');
      return null;
    }

    try {
      const params = {
        api_key: apiKey,
        engine: 'google',
        q: query,
        location: 'United States',
        google_domain: 'google.com',
        gl: 'us',
        hl: 'en'
      };

      const response = await axios.get(SEARCH_API_BASE_URL, {
        params,
        timeout: 15000
      });

      return normalizeSearchApiResponse(response.data);
    } catch (err: any) {
      log.error('SerpAPI rich search failed', { 
        error: err.message,
        status: err.response?.status
      });
      return null;
    }
  },

  /**
   * Extracts a full gallery of unique, high-quality images from the search data.
   */
  extractGalleryImages(data: SerpRichData): string[] {
    const images = new Set<string>();

    // 1. Immersive Products (High quality)
    if (data.immersive_products) {
      data.immersive_products.forEach(p => {
        if (p.thumbnail) images.add(p.thumbnail);
      });
    }

    // 2. Shopping Results
    if (data.shopping_results) {
      data.shopping_results.forEach(p => {
        if (p.thumbnail) images.add(p.thumbnail);
      });
    }

    // 3. Knowledge Graph
    if (data.knowledge_graph?.header_images) {
      data.knowledge_graph.header_images.forEach((img: any) => {
        if (img.image) images.add(img.image);
      });
    }

    return Array.from(images).filter(url => url.startsWith('http'));
  },

  /**
   * Extracts verified rating sources from SerpApi data.
   * Primary: immersive_products (per-store product ratings: Target, Walmart, etc.)
   * Fallback: shopping_results (Amazon, eBay, etc.)
   * Deduplicates by store, requires both rating + reviews, sorts by most-reviewed.
   */
  extractRatingSources(data: SerpRichData): Array<{ source: string; rating: number; reviewsCount: number; url?: string }> {
    const seenStores = new Set<string>();
    const sources: Array<{ source: string; rating: number; reviewsCount: number; url?: string }> = [];

    // 1. immersive_products: retailer-specific product ratings (most accurate)
    for (const item of (data.immersive_products ?? [])) {
      const store = (item.source || '').trim();
      if (!store || seenStores.has(store)) continue;
      if (typeof item.rating !== 'number' || item.rating <= 0) continue;
      if (typeof item.reviews !== 'number' || item.reviews <= 0) continue;
      seenStores.add(store);
      sources.push({ source: store, rating: item.rating, reviewsCount: item.reviews, url: item.link });
    }

    // 2. shopping_results: fallback for additional sources (Amazon, eBay, etc.)
    for (const item of (data.shopping_results ?? [])) {
      const store = (item.source || '').trim();
      if (!store || seenStores.has(store)) continue;
      if (!item.rating || !item.reviews) continue;
      seenStores.add(store);
      sources.push({ source: store, rating: item.rating, reviewsCount: item.reviews, url: item.link });
    }

    // Return up to 8, sorted by review count (most-reviewed = most reliable signal)
    return sources.sort((a, b) => b.reviewsCount - a.reviewsCount).slice(0, 8);
  },

  /**
   * Specific extraction for primary thumbnail.
   * otherwise falls back to the first acceptable result.
   */
  extractBestThumbnail(data: SerpRichData): string | null {
    if (data.immersive_products && data.immersive_products.length > 0) {
      // Often the first immersive product has a good clean thumbnail
      return data.immersive_products[0].thumbnail || null;
    }
    
    if (data.shopping_results && data.shopping_results.length > 0) {
      return data.shopping_results[0].thumbnail || null;
    }

    return null;
  }
};
