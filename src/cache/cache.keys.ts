/**
 * Centralised cache key definitions.
 *
 * All Redis keys are defined here — never hardcode key strings
 * in services or controllers.
 *
 * Key format: <entity>:<identifier>[:<variant>]
 * Example: product:feed:page:1:limit:20
 *
 * Benefits:
 * - Easy to find and update keys in one place
 * - Prefix-based invalidation works reliably
 * - No key collision bugs from typos
 */

export const CacheKeys = {
  // Product feed — varies by page + limit + filters
  productFeed: (page: number, limit: number, filters?: string) =>
    `product:feed:${page}:${limit}${filters ? `:${filters}` : ''}`,

  // Individual product detail
  productDetail: (id: string) => `product:detail:${id}`,

  // Product categories
  productCategories: () => `product:categories`,

  // Product trend signals
  productTrend: (id: string) => `product:trend:${id}`,

  // Video list
  videoFeed: (page: number, limit: number) => `video:feed:${page}:${limit}`,

  // Individual video detail
  videoDetail: (id: string) => `video:detail:${id}`,

  // Trend overview
  trends: (category?: string) => `trend:list${category ? `:${category}` : ''}`,

  // Store / competitor data
  store: (id: string) => `store:detail:${id}`,
  storeFeed: (page: number, limit: number) => `store:feed:${page}:${limit}`,

  // Supplier data
  supplier: (id: string) => `supplier:detail:${id}`,

  // System health (cached briefly to reduce DB hammering on /ready endpoint)
  healthCheck: () => `system:health`,

  // Ingestion state — tracks last successful run per source
  ingestionLastRun: (source: string) => `ingestion:last-run:${source}`,
};

/**
 * TTL constants in seconds.
 *
 * Keep these conservative for V1 — data freshness is a core product promise.
 * Adjust based on observed ingestion frequency and product requirements.
 */
export const CACHE_TTL = {
  PRODUCT_FEED: 300,       // 5 minutes — feeds refresh relatively often
  PRODUCT_DETAIL: 600,     // 10 minutes — detail pages can be slightly staler
  PRODUCT_TREND: 180,      // 3 minutes — trend data changes quickly
  CATEGORIES: 3600,        // 1 hour — DB scans for distinct take time
  VIDEO_FEED: 300,         // 5 minutes
  VIDEO_DETAIL: 600,       // 10 minutes
  TRENDS: 300,             // 5 minutes
  STORE: 900,              // 15 minutes — stores change less frequently
  SUPPLIER: 1800,          // 30 minutes — supplier data is relatively stable
  HEALTH_CHECK: 10,        // 10 seconds — brief cache to protect the DB
  INGESTION_STATE: 3600,   // 1 hour — just metadata, not product data
} as const;

/**
 * Key prefixes — used for bulk invalidation by entity type.
 *
 * Usage:
 *   await CacheService.deleteByPrefix(CACHE_PREFIXES.PRODUCT);
 *   // Clears all product:* keys
 */
export const CACHE_PREFIXES = {
  PRODUCT: 'product:',
  VIDEO: 'video:',
  TREND: 'trend:',
  STORE: 'store:',
  SUPPLIER: 'supplier:',
  SYSTEM: 'system:',
  INGESTION: 'ingestion:',
} as const;
