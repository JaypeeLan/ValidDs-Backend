import type { ProductFeedFilters } from '../../db/repositories/product.repository';
import { INGEST_QUALITY, MIN_PRODUCT_PRICE, MIN_TOTAL_GMV } from '../internal/ingest-quality';
import { buildContentMetricFilters } from '../../utils/content-feed-filters.util';

/** Frontend L1 labels → backend `categoryL1` values. */
export const FRONTEND_CATEGORY_TO_L1: Record<string, string> = {
  'Beauty & Personal Care': 'Beauty & Personal Care',
  'Fitness & Health': 'Health & Wellness',
  'Home & Kitchen': 'Home & Kitchen',
  'Tech / Gadgets': 'Electronics & Tech',
  'Tech/Gadgets': 'Electronics & Tech',
  'Electronics & Tech': 'Electronics & Tech',
  Fashion: 'Fashion',
};

export type ProductKindFilter = 'hot' | 'seasonal';
export type LevelFilter = 'High' | 'Medium' | 'Low';

const SORT_ALIASES: Record<string, ProductFeedFilters['sortBy']> = {
  gmv_desc: 'gmv-desc',
  gmv_asc: 'gmv-asc',
  'gmv-desc': 'gmv-desc',
  'gmv-asc': 'gmv-asc',
  units_sold_desc: 'units-desc',
  units_sold_asc: 'units-asc',
  'units-desc': 'units-desc',
  'units-asc': 'units-asc',
  units_desc: 'units-desc',
  units_asc: 'units-asc',
  trendscore: 'trendScore',
  trendScore: 'trendScore',
  views: 'views',
  recent: 'recent',
  last_ingested: 'recent',
  'last-ingested': 'recent',
  lastIngested: 'recent',
  ingested_desc: 'recent',
  'ingested-desc': 'recent',
  engagement: 'engagement',
};

export function normalizeProductSortBy(raw?: string): ProductFeedFilters['sortBy'] | undefined {
  if (!raw) return undefined;
  const key = raw.trim();
  return SORT_ALIASES[key] ?? SORT_ALIASES[key.toLowerCase()];
}

export function mapFrontendCategories(categories?: string[]): string[] | undefined {
  if (!categories?.length) return undefined;
  const mapped = categories.map((c) => FRONTEND_CATEGORY_TO_L1[c.trim()] ?? c.trim());
  return [...new Set(mapped)];
}

/**
 * Normalize a multi-value query param from string, repeated keys, or comma-separated tokens.
 * Splits commas inside each array element (e.g. `subcategory[]=A,B`).
 */
export function flattenMultiStringParam(val: string | string[] | undefined): string[] | undefined {
  if (val == null || val === '') return undefined;
  const parts = Array.isArray(val) ? val : [val];
  const out: string[] = [];
  for (const part of parts) {
    if (part == null || part === '') continue;
    for (const token of String(part).split(',')) {
      const t = token.trim();
      if (t) out.push(t);
    }
  }
  return out.length ? [...new Set(out)] : undefined;
}

/** Merge `subcategory` query aliases before Zod validation. */
export function normalizeProductFeedQueryInput(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;
  const q = { ...(input as Record<string, unknown>) };
  const sub = q.subcategory ?? q.subcategories ?? q.categoryL2;
  if (sub != null) q.subcategory = sub;
  delete q.subcategories;
  delete q.categoryL2;
  return q;
}

function levelToRange(
  level: LevelFilter | undefined,
  bands: Record<LevelFilter, { min?: number; max?: number }>,
): { min?: number; max?: number } {
  if (!level) return {};
  return bands[level] ?? {};
}

export interface RawProductFeedQuery {
  feed?: 'discover' | 'top-opportunities';
  sortBy?: string;
  category?: string | string[];
  subcategory?: string | string[];
  niche?: string;
  trendDirection?: string;
  minTrendScore?: number;
  minViews?: number;
  isAd?: boolean;
  section?: string;
  page?: number;
  limit?: number;
  region?: string;
  q?: string;
  /** Frontend alias for `q` */
  search?: string;
  /** hot = high momentum score; seasonal = AI productType seasonal */
  productKind?: ProductKindFilter;
  productType?: ProductKindFilter;
  minPrice?: number;
  maxPrice?: number;
  minTotalGmv?: number;
  maxTotalGmv?: number;
  minGmv?: number;
  maxGmv?: number;
  minUnitsSold?: number;
  maxUnitsSold?: number;
  minUnits?: number;
  maxUnits?: number;
  minConfidence?: number;
  maxConfidence?: number;
  confidenceLevel?: LevelFilter;
  minCompetitionScore?: number;
  maxCompetitionScore?: number;
  minOpportunityScore?: number;
  maxOpportunityScore?: number;
  opportunityLevel?: LevelFilter;
  minSales7d?: number;
  maxSales7d?: number;
  minGmv7d?: number;
  maxGmv7d?: number;
  minLikes?: number;
  minEngagementRate?: number;
  startDate?: string;
  minCreatorGmv?: number;
  maxCreatorGmv?: number;
  minFollowers?: number;
  maxFollowers?: number;
  minCreatorLikes?: number;
  maxCreatorLikes?: number;
}

/**
 * Merge frontend query aliases into repository filters.
 */
export function buildProductFeedFilters(raw: RawProductFeedQuery): ProductFeedFilters {
  const confidenceBand = levelToRange(raw.confidenceLevel, {
    High: { min: 80, max: 100 },
    Medium: { min: 50, max: 79 },
    Low: { min: 0, max: 49 },
  });
  const opportunityBand = levelToRange(raw.opportunityLevel, {
    High: { min: 80, max: 100 },
    Medium: { min: 50, max: 79 },
    Low: { min: 0, max: 49 },
  });

  const sortBy = normalizeProductSortBy(raw.sortBy);
  const feed = raw.feed;

  const effectiveSortBy =
    sortBy ??
    (feed === 'discover' ? 'recent' : feed === 'top-opportunities' ? 'gmv-desc' : 'gmv-desc');

  const categoryList = Array.isArray(raw.category)
    ? raw.category
    : raw.category
      ? [raw.category]
      : undefined;

  const subcategoryList = flattenMultiStringParam(raw.subcategory);

  const metrics = buildContentMetricFilters(raw);

  return {
    category: mapFrontendCategories(categoryList),
    subcategory: subcategoryList,
    section: raw.section,
    trendDirection: raw.trendDirection,
    minTrendScore: raw.minTrendScore,
    minViews: raw.minViews,
    isAd: raw.isAd,
    page: raw.page,
    limit: raw.limit,
    sortBy: effectiveSortBy,
    userRegion: raw.region,
    minPrice: raw.minPrice ?? MIN_PRODUCT_PRICE,
    maxPrice: raw.maxPrice,
    minTotalGmv: raw.minTotalGmv ?? raw.minGmv ?? MIN_TOTAL_GMV,
    maxTotalGmv: raw.maxTotalGmv ?? raw.maxGmv,
    minUnitsSold: raw.minUnitsSold ?? raw.minUnits ?? INGEST_QUALITY.MIN_UNITS_SOLD,
    maxUnitsSold: raw.maxUnitsSold ?? raw.maxUnits,
    minConfidence: raw.minConfidence ?? confidenceBand.min,
    maxConfidence: raw.maxConfidence ?? confidenceBand.max,
    minCompetitionScore: raw.minCompetitionScore,
    maxCompetitionScore: raw.maxCompetitionScore,
    minOpportunityScore: raw.minOpportunityScore ?? opportunityBand.min,
    maxOpportunityScore: raw.maxOpportunityScore ?? opportunityBand.max,
    productKind: raw.productKind ?? raw.productType,
    minSales7d: raw.minSales7d,
    maxSales7d: raw.maxSales7d,
    minGmv7d: raw.minGmv7d,
    maxGmv7d: raw.maxGmv7d,
    minLikes: metrics.minLikes,
    minEngagementRate: metrics.minEngagementRate,
    startDate: metrics.startDate,
    minCreatorGmv: metrics.minCreatorGmv,
    maxCreatorGmv: metrics.maxCreatorGmv,
    minFollowers: metrics.minFollowers,
    maxFollowers: metrics.maxFollowers,
    minCreatorLikes: metrics.minCreatorLikes,
    maxCreatorLikes: metrics.maxCreatorLikes,
  };
}

export function defaultSortOptionsForFeed(feed?: 'discover' | 'top-opportunities'): string[] {
  if (feed === 'discover') {
    return ['recent', 'views', 'engagement', 'trendScore'];
  }
  if (feed === 'top-opportunities') {
    return ['gmv_desc', 'gmv_asc', 'units_sold_desc', 'units_sold_asc', 'last_ingested'];
  }
  return [
    'gmv_desc',
    'gmv_asc',
    'units_sold_desc',
    'units_sold_asc',
    'last_ingested',
    'recent',
    'views',
    'engagement',
    'trendScore',
  ];
}
