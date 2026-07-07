/**
 * Discovery section tags for ingested products.
 * Mirrors scraper/pipeline/discovery_sections.py
 *
 * Every product belongs to EXACTLY ONE of four sections, resolved by priority:
 *   global-selling  → Partner Center "Global Selling" pool (cross-border sellers)
 *   high-opportunity → Partner Center "High opportunity products" pool
 *   top-ads          → product is ad-backed
 *   trending         → default (organic products)
 */

export type ProductDiscoverySection =
  | 'top-ads'
  | 'trending'
  | 'high-opportunity'
  | 'global-selling';

export function resolveProductIsAd(raw: Record<string, unknown>): boolean {
  if (raw.isAd === true) return true;
  const sections = Array.isArray(raw.discoverySections) ? raw.discoverySections : [];
  return sections.includes('top-ads');
}

/**
 * "High opportunity" products come from the TikTok Shop Partner Center pool.
 * This bucket is not time/ad derived — it is an explicit signal carried on the
 * scraped payload, so it must be preserved across re-ingest.
 */
export function resolveHighOpportunity(raw: Record<string, unknown>): boolean {
  if (raw.isHighOpportunity === true) return true;
  const sections = Array.isArray(raw.discoverySections) ? raw.discoverySections : [];
  return sections.includes('high-opportunity');
}

/**
 * "Global Selling" products come from the Partner Center gs-product-pool with the
 * "Global Selling products only" filter (cross-border / self-service sellers).
 * Also an explicit signal preserved across re-ingest.
 */
export function resolveGlobalSelling(raw: Record<string, unknown>): boolean {
  if (raw.isGlobalSelling === true) return true;
  const sections = Array.isArray(raw.discoverySections) ? raw.discoverySections : [];
  return sections.includes('global-selling');
}

/**
 * Resolve a product's single discovery section.
 *
 * Priority: global-selling > high-opportunity > top-ads > trending.
 * The Partner Center pool signals win because they are explicit, intentional
 * buckets; everything else falls back to the ad/organic split.
 */
export function discoverySectionsForProduct(
  raw: Record<string, unknown>,
  _now = Date.now(),
): ProductDiscoverySection[] {
  if (resolveGlobalSelling(raw)) return ['global-selling'];
  if (resolveHighOpportunity(raw)) return ['high-opportunity'];
  if (resolveProductIsAd(raw)) return ['top-ads'];
  return ['trending'];
}
