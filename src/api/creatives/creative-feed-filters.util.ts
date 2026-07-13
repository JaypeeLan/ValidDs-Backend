import {
  creativeEngagementMetricSortSpec,
  creativeProductMetricSortSpec,
  type CreativeProductMetricSortBy,
  withIdTiebreak,
} from '../../utils/product-recency.util';

export type CreativeSortBy =
  | 'views'
  | 'views-desc'
  | 'views-asc'
  | 'likes'
  | 'likes-desc'
  | 'likes-asc'
  | 'gmv-desc'
  | 'gmv-asc'
  | 'units-desc'
  | 'units-asc'
  | 'creator_gmv_desc'
  | 'creator_gmv_asc'
  | 'followers_desc'
  | 'followers_asc'
  | 'recent'
  | 'engagement'
  | 'last_ingested';

const CREATIVE_SORT_ALIASES: Record<string, CreativeSortBy> = {
  views: 'views',
  views_desc: 'views-desc',
  'views-desc': 'views-desc',
  views_asc: 'views-asc',
  'views-asc': 'views-asc',
  likes: 'likes',
  likes_desc: 'likes-desc',
  'likes-desc': 'likes-desc',
  likes_asc: 'likes-asc',
  'likes-asc': 'likes-asc',
  gmv_desc: 'gmv-desc',
  'gmv-desc': 'gmv-desc',
  gmv_asc: 'gmv-asc',
  'gmv-asc': 'gmv-asc',
  units_sold_desc: 'units-desc',
  units_sold_asc: 'units-asc',
  units_desc: 'units-desc',
  units_asc: 'units-asc',
  'units-desc': 'units-desc',
  'units-asc': 'units-asc',
  creator_gmv_desc: 'creator_gmv_desc',
  creator_gmv_asc: 'creator_gmv_asc',
  followers_desc: 'followers_desc',
  followers_asc: 'followers_asc',
  recent: 'recent',
  engagement: 'engagement',
  last_ingested: 'last_ingested',
  'last-ingested': 'last_ingested',
  lastIngested: 'last_ingested',
  ingested_desc: 'last_ingested',
  'ingested-desc': 'last_ingested',
};

export function normalizeCreativeSortBy(raw?: string): CreativeSortBy | undefined {
  if (!raw) return undefined;
  const key = raw.trim();
  return CREATIVE_SORT_ALIASES[key] ?? CREATIVE_SORT_ALIASES[key.toLowerCase()];
}

export function creativeSortSkipsRecencyTier(sortKey: string): boolean {
  return (
    sortKey === 'recent' ||
    sortKey === 'last_ingested' ||
    sortKey === 'views' ||
    sortKey === 'views-desc' ||
    sortKey === 'views-asc' ||
    sortKey === 'likes' ||
    sortKey === 'likes-desc' ||
    sortKey === 'likes-asc' ||
    sortKey === 'engagement'
  );
}

export function resolveCreativeSort(
  sortBy: CreativeSortBy,
  opts?: { source?: 'meta' | 'tiktok' },
): { sortKey: CreativeSortBy; sort: Record<string, 1 | -1> } {
  if (opts?.source === 'meta') {
    return {
      sortKey: sortBy,
      sort: withIdTiebreak({ metaAdRelevanceScore: -1, publishedAt: -1 }),
    };
  }
  switch (sortBy) {
    case 'recent':
      return { sortKey: 'recent', sort: withIdTiebreak({ publishedAt: -1 }) };
    case 'last_ingested':
      return {
        sortKey: 'last_ingested',
        sort: withIdTiebreak({ ingestedAt: -1, publishedAt: -1 }),
      };
    case 'likes-desc':
      return { sortKey: 'likes-desc', sort: creativeEngagementMetricSortSpec('likes', 'desc') };
    case 'likes-asc':
      return { sortKey: 'likes-asc', sort: creativeEngagementMetricSortSpec('likes', 'asc') };
    case 'likes':
      return { sortKey: 'likes', sort: creativeEngagementMetricSortSpec('likes') };
    case 'engagement':
      return { sortKey: 'engagement', sort: creativeEngagementMetricSortSpec('engagement') };
    case 'views-desc':
      return { sortKey: 'views-desc', sort: creativeEngagementMetricSortSpec('views', 'desc') };
    case 'views-asc':
      return { sortKey: 'views-asc', sort: creativeEngagementMetricSortSpec('views', 'asc') };
    case 'gmv-desc':
    case 'gmv-asc':
    case 'units-desc':
    case 'units-asc':
      return {
        sortKey: sortBy,
        sort: creativeProductMetricSortSpec(sortBy as CreativeProductMetricSortBy),
      };
    case 'views':
    default:
      return { sortKey: 'views', sort: creativeEngagementMetricSortSpec('views') };
  }
}

/** Sort keys accepted by `GET /creatives` (videos / ads feed). */
export const CREATIVE_SORT_OPTIONS = [
  'gmv_desc',
  'gmv_asc',
  'units_sold_desc',
  'units_sold_asc',
  'views_desc',
  'views_asc',
  'likes_desc',
  'likes_asc',
  'views',
  'likes',
  'recent',
  'last_ingested',
  'engagement',
] as const;

/** Sort keys for `GET /creatives?groupBy=creator` (creator lobby). */
export const CREATOR_LOBBY_SORT_OPTIONS = [
  'creator_gmv_desc',
  'creator_gmv_asc',
  'followers_desc',
  'followers_asc',
  ...CREATIVE_SORT_OPTIONS,
] as const;
