/**
 * Discovery section tags for ingested products.
 * Mirrors scraper/pipeline/discovery_sections.py
 */

import {
  NEW_POST_PRIORITY_DAYS_3,
  NEW_POST_PRIORITY_DAYS_7,
  parsePublishedAt,
} from './product-recency.util';

export type ProductDiscoverySection = 'top-ads' | 'trending' | 'new-3d' | 'new-7d';

export function resolveProductIsAd(raw: Record<string, unknown>): boolean {
  if (raw.isAd === true) return true;
  const sections = Array.isArray(raw.discoverySections) ? raw.discoverySections : [];
  return sections.includes('top-ads');
}

/** Recompute time-sensitive discovery buckets from post age + ad flag. */
export function discoverySectionsForProduct(
  raw: Record<string, unknown>,
  now = Date.now(),
): ProductDiscoverySection[] {
  const sections: ProductDiscoverySection[] = [];
  if (resolveProductIsAd(raw)) {
    sections.push('top-ads');
  } else {
    sections.push('trending');
  }

  const published = parsePublishedAt(raw.publishedAt ?? raw.postCreatedAt);
  if (published) {
    const ageMs = now - published.getTime();
    if (ageMs >= 0) {
      const ageDays = ageMs / (24 * 60 * 60 * 1000);
      if (ageDays <= NEW_POST_PRIORITY_DAYS_7) sections.push('new-7d');
      if (ageDays <= NEW_POST_PRIORITY_DAYS_3) sections.push('new-3d');
    }
  }

  return sections;
}

/** Mongo filter: post is within the last N days (publishedAt or postCreatedAt). */
export function postPublishedWithinDaysFilter(
  days: number,
  now = Date.now(),
): Record<string, unknown> {
  const cutoff = new Date(now - days * 24 * 60 * 60 * 1000);
  return {
    $or: [{ publishedAt: { $gte: cutoff } }, { postCreatedAt: { $gte: cutoff } }],
  };
}
