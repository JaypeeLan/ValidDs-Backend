/**
 * Discovery section tags for ingested products.
 * Mirrors scraper/pipeline/discovery_sections.py
 *
 * Every product belongs to EXACTLY ONE of three sections, resolved by priority:
 *   global-selling  → Partner Center "Global Selling" pool (cross-border sellers)
 *   high-opportunity → Partner Center "High opportunity products" pool
 *   default         → all other products (organic + ad-backed)
 */

export type ProductDiscoverySection = 'default' | 'high-opportunity' | 'global-selling';

/** Legacy section slugs stored on older products — treated as `default` on read/filter. */
export const LEGACY_DEFAULT_SECTIONS = ['default', 'top-ads', 'trending'] as const;

export function normalizeProductSectionFilter(section: string): string {
  if (section === 'top-ads' || section === 'trending') return 'default';
  return section;
}

/** True when the product is ad-backed (for `isTopAd` / `?isAd=` filters, not discovery section). */
export function resolveProductIsAd(raw: Record<string, unknown>): boolean {
  if (raw.isAd === true) return true;
  const counts = raw.creativeCounts as { ads?: number } | undefined;
  if (counts != null && Number(counts.ads) >= 1) return true;
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
 * Priority: global-selling > high-opportunity > default.
 */
export function discoverySectionsForProduct(
  raw: Record<string, unknown>,
  _now = Date.now(),
): ProductDiscoverySection[] {
  if (resolveGlobalSelling(raw)) return ['global-selling'];
  if (resolveHighOpportunity(raw)) return ['high-opportunity'];
  return ['default'];
}
