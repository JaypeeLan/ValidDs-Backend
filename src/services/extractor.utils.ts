import { NormalizedPost } from '../ingestion/ingestion.types';
import { PRODUCT_CATEGORIES } from '../api/products/product.constants';

export function formatNumber(n?: number): string {
  if (!n) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function formatDaysAgo(date?: Date): string {
  if (!date) return 'unknown';
  const days = Math.round((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

export function buildEngagementContext(post: NormalizedPost): string {
  const lines: string[] = [
    `Views: ${formatNumber(post.viewCount)}`,
    `Likes: ${formatNumber(post.likeCount)}`,
    `Comments: ${formatNumber(post.commentCount)}`,
    `Shares: ${formatNumber(post.shareCount)}`,
  ];
  if (post.engagementRate !== undefined) {
    lines.push(`Engagement rate: ${post.engagementRate}%`);
  }
  return lines.join(' | ');
}

export function inferNicheFromHashtags(hashtags: string[]): string {
  const nicheMap: Record<string, string> = {
    kitchen: 'Home & Kitchen',
    cooking: 'Home & Kitchen',
    beauty: 'Beauty & Healthcare',
    skincare: 'Beauty & Healthcare',
    makeup: 'Beauty & Healthcare',
    fitness: 'Sports & Outdoors',
    workout: 'Sports & Outdoors',
    gym: 'Sports & Outdoors',
    gadget: 'Electronics & Gadgets',
    tech: 'Electronics & Gadgets',
    fashion: 'Fashion & Accessories',
    outfit: 'Fashion & Accessories',
    pet: 'Pet Supplies',
    baby: 'Toys & Hobbies',
    toy: 'Toys & Hobbies',
    home: 'Home & Kitchen',
    travel: 'Sports & Outdoors',
    automotive: 'Automotive',
    car: 'Automotive',
    repair: 'Tools & Home Improvement',
    office: 'Office Products',
  };
  for (const tag of hashtags) {
    const lowerTag = tag.toLowerCase();
    for (const [key, niche] of Object.entries(nicheMap)) {
      if (lowerTag.includes(key)) return niche;
    }
  }
  return 'Beauty & Healthcare';
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
