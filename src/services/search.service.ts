import axios from 'axios';
import { logger } from '../logger';

const log = logger.child({ module: 'search-service' });

const BASE_URL = 'https://www.searchapi.io/api/v1/search';

function getApiKey(): string | undefined {
  return process.env.SEARCHAPI_KEY ?? process.env.SERPAPI_KEY;
}

// ── Response shapes ───────────────────────────────────────────────────────────

export interface SearchApiShoppingResult {
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

export interface SearchApiRichData {
  shopping_results?: SearchApiShoppingResult[];
  immersive_products?: any[];
  local_results?: any;
  organic_results?: any[];
  knowledge_graph?: any;
}

export interface SearchApiProductReview {
  text: string;
  rating: number;
  title?: string;
  date?: string;
  authorName?: string;
  isVerified: boolean;
  helpfulVotes?: number;
  source: string;
}

export interface SearchApiProductDetails {
  reviews: SearchApiProductReview[];
  relatedProducts: Array<{
    title: string;
    price?: string;
    thumbnail?: string;
    link?: string;
    store?: string;
  }>;
  offers: Array<{
    title: string;
    price?: string;
    store?: string;
    link?: string;
  }>;
}

// ── Core request ──────────────────────────────────────────────────────────────

async function get<T = any>(
  engine: string,
  params: Record<string, string> = {}
): Promise<T | null> {
  const apiKey = getApiKey();
  if (!apiKey) {
    log.warn('SEARCHAPI_KEY not configured');
    return null;
  }

  try {
    const res = await axios.get<T>(BASE_URL, {
      params: { api_key: apiKey, engine, ...params },
      timeout: 15_000,
    });
    return res.data;
  } catch (err: any) {
    log.error(`SearchApi request failed (${engine})`, {
      status: err.response?.status,
      message: err.message,
    });
    return null;
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

export const SearchApiService = {

  /**
   * Fetches full Google Search JSON.
   * Provides shopping results, immersive products, organic results.
   */
  async getRichProductData(query: string): Promise<SearchApiRichData | null> {
    const data = await get('google', {
      q: query,
      location: 'United States',
      google_domain: 'google.com',
      gl: 'us',
      hl: 'en',
    });
    if (!data) return null;
    return normalizeSearchApiResponse(data);
  },

  /**
   * Three-step review fetch:
   *  1. google_shopping  → product_token
   *  2. google_product   → reviews, related_products, offers
   *
   * Returns empty arrays if the product has no Google Shopping presence.
   */
  async fetchProductReviews(productTitle: string): Promise<SearchApiProductDetails> {
    const empty: SearchApiProductDetails = { reviews: [], relatedProducts: [], offers: [] };

    // Step 1: shopping search → product_token
    const shopping = await get<any>('google_shopping', {
      q: productTitle,
      gl: 'us',
      hl: 'en',
    });

    const productToken = shopping?.shopping_results?.[0]?.product_token;
    if (!productToken) return empty;

    // Step 2: product detail → reviews + related
    const product = await get<any>('google_product', {
      product_token: productToken,
      gl: 'us',
      hl: 'en',
    });

    if (!product) return empty;

    const reviews: SearchApiProductReview[] = (product.reviews ?? []).map((r: any) => ({
      text:         r.text        ?? '',
      rating:       r.rating      ?? 0,
      title:        r.title       ?? undefined,
      date:         r.date        ?? undefined,
      authorName:   r.profile?.name ?? undefined,
      isVerified:   r.is_verified_purchase ?? false,
      helpfulVotes: r.helpful_votes ?? undefined,
      source:       'Google Shopping',
    }));

    const relatedProducts = (product.related_products ?? []).slice(0, 8).map((r: any) => ({
      title:     r.title     ?? '',
      price:     r.price     ?? undefined,
      thumbnail: r.thumbnail ?? undefined,
      link:      r.link      ?? undefined,
      store:     r.seller    ?? undefined,
    }));

    const offers = (product.offers ?? []).slice(0, 5).map((o: any) => ({
      title: o.title ?? productTitle,
      price: o.price ?? undefined,
      store: o.merchant?.name ?? undefined,
      link:  o.link  ?? undefined,
    }));

    return { reviews, relatedProducts, offers };
  },

  extractGalleryImages(data: SearchApiRichData): string[] {
    const images = new Set<string>();

    for (const p of data.immersive_products ?? []) {
      if (p.thumbnail) images.add(p.thumbnail);
    }
    for (const p of data.shopping_results ?? []) {
      if (p.thumbnail) images.add(p.thumbnail);
    }
    for (const img of data.knowledge_graph?.header_images ?? []) {
      if (img.image) images.add(img.image);
    }

    return Array.from(images).filter((url) => url.startsWith('http'));
  },

  extractRatingSources(
    data: SearchApiRichData
  ): Array<{ source: string; rating: number; reviewsCount: number; url?: string }> {
    const seenStores = new Set<string>();
    const sources: Array<{ source: string; rating: number; reviewsCount: number; url?: string }> = [];

    for (const item of data.immersive_products ?? []) {
      const store = (item.source || '').trim();
      if (!store || seenStores.has(store)) continue;
      if (typeof item.rating !== 'number' || item.rating <= 0) continue;
      if (typeof item.reviews !== 'number' || item.reviews <= 0) continue;
      seenStores.add(store);
      sources.push({ source: store, rating: item.rating, reviewsCount: item.reviews, url: item.link });
    }

    for (const item of data.shopping_results ?? []) {
      const store = (item.source || '').trim();
      if (!store || seenStores.has(store)) continue;
      if (!item.rating || !item.reviews) continue;
      seenStores.add(store);
      sources.push({ source: store, rating: item.rating, reviewsCount: item.reviews, url: item.link });
    }

    return sources.sort((a, b) => b.reviewsCount - a.reviewsCount).slice(0, 8);
  },

  extractBestThumbnail(data: SearchApiRichData): string | null {
    return data.immersive_products?.[0]?.thumbnail
      ?? data.shopping_results?.[0]?.thumbnail
      ?? null;
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeSearchApiResponse(raw: any): SearchApiRichData {
  const shoppingAds    = Array.isArray(raw?.shopping_ads)    ? raw.shopping_ads    : [];
  const inlineShopping = Array.isArray(raw?.inline_shopping) ? raw.inline_shopping : [];

  const fromAds: SearchApiShoppingResult[] = shoppingAds.map((item: any) => ({
    title:     item.title || '',
    source:    item.seller || '',
    price:     item.price,
    price_raw: typeof item.extracted_price === 'number' ? item.extracted_price : undefined,
    thumbnail: item.image,
    link:      item.product_link || item.link,
    rating:    typeof item.rating === 'number' ? item.rating : undefined,
    reviews:   typeof item.reviews === 'number' ? item.reviews : undefined,
    is_ad:     true,
  }));

  const fromInline: SearchApiShoppingResult[] = inlineShopping.map((item: any) => ({
    title:     item.title || '',
    source:    item.seller || '',
    price:     item.price,
    price_raw: typeof item.extracted_price === 'number' ? item.extracted_price : undefined,
    thumbnail: item.thumbnail,
    link:      item.product_link || item.link,
    rating:    typeof item.rating === 'number' ? item.rating : undefined,
    reviews:   typeof item.reviews === 'number' ? item.reviews : undefined,
    is_ad:     false,
  }));

  return {
    shopping_results:   [...fromAds, ...fromInline].filter((i) => i.title && i.source),
    immersive_products: raw?.immersive_products || [],
    local_results:      raw?.local_results,
    organic_results:    raw?.organic_results || [],
    knowledge_graph:    raw?.knowledge_graph,
  };
}
