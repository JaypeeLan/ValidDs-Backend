import { creativeRecencyPrioritySortSpec } from '../../utils/product-recency.util';

export type CreativeSortBy = 'views' | 'likes' | 'recent' | 'engagement' | 'last_ingested';

const CREATIVE_SORT_ALIASES: Record<string, CreativeSortBy> = {
  views: 'views',
  likes: 'likes',
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
  return sortKey === 'recent' || sortKey === 'last_ingested';
}

export function resolveCreativeSort(
  sortBy: CreativeSortBy,
  opts?: { source?: 'meta' | 'tiktok' },
): { sortKey: CreativeSortBy; sort: Record<string, 1 | -1> } {
  if (opts?.source === 'meta') {
    return { sortKey: sortBy, sort: { metaAdRelevanceScore: -1, publishedAt: -1 } };
  }
  switch (sortBy) {
    case 'recent':
      return { sortKey: 'recent', sort: { publishedAt: -1 } };
    case 'last_ingested':
      return { sortKey: 'last_ingested', sort: { ingestedAt: -1, publishedAt: -1 } };
    case 'likes':
      return { sortKey: 'likes', sort: creativeRecencyPrioritySortSpec('likes') };
    case 'engagement':
      return { sortKey: 'engagement', sort: creativeRecencyPrioritySortSpec('engagement') };
    case 'views':
    default:
      return { sortKey: 'views', sort: creativeRecencyPrioritySortSpec('views') };
  }
}

export const CREATIVE_SORT_OPTIONS = [
  'views',
  'likes',
  'recent',
  'last_ingested',
  'engagement',
] as const;
