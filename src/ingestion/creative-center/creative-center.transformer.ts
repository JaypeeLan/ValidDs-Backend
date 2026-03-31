import {
  CCTopAd,
  CCHashtag,
  CCTrendingVideo,
  CCKeywordTrend,
} from './creative-center.client';
import {
  NormalizedPost,
  NormalizedHashtag,
  NormalizedKeyword,
} from '../ingestion.types';

/**
 * Creative Center Transformer
 *
 * Maps raw Creative Center API responses into the normalized shapes
 * that the rest of the ingestion pipeline (orchestrator, AI extractor,
 * product repository) consumes.
 *
 * Nothing downstream ever touches the raw CC types.
 */

// ── Top Ads → NormalizedPost ─────────────────────────────────────────────────

/**
 * Convert a raw top ad into a NormalizedPost.
 *
 * Ad data maps well to our schema because:
 * - Ads are products that people are actively paying to promote
 * - first_shown_date / last_shown_date = our freshness signal
 * - brand_name / industry_name gives us niche context
 * - play_count / like_count / comment_count = engagement signals
 */
export function transformTopAd(ad: CCTopAd): NormalizedPost {
  const hashtags = extractHashtagsFromText(ad.ad_title ?? '');
  const description = buildAdDescription(ad);

  return {
    // Identity
    videoId: ad.id ?? ad.video_info?.vid ?? '',
    videoUrl: ad.video_info?.url,
    thumbnailUrl: ad.video_info?.cover,

    // Content
    title: ad.ad_title ?? ad.brand_name ?? '',
    description,
    hashtags,
    rawText: [ad.ad_title, ad.brand_name, ad.industry_name, hashtags.join(' ')]
      .filter(Boolean)
      .join(' '),

    // Creator (for ads, creator = advertiser/brand)
    creatorHandle: slugify(ad.brand_name ?? 'unknown'),
    creatorDisplayName: ad.brand_name,
    creatorFollowers: undefined,
    creatorVerified: undefined,
    creatorRegion: ad.country_code?.[0],

    // Engagement
    viewCount: ad.play_count ?? 0,
    likeCount: ad.like_count ?? 0,
    commentCount: ad.comment_count ?? 0,
    shareCount: ad.share_count ?? 0,
    engagementRate: calculateEngagementRate({
      views: ad.play_count ?? 0,
      likes: ad.like_count ?? 0,
      comments: ad.comment_count ?? 0,
      shares: ad.share_count ?? 0,
    }),

    // Ad signals
    isAd: true,
    adFirstSeenAt: ad.first_shown_date
      ? new Date(ad.first_shown_date * 1000)
      : undefined,
    adLastSeenAt: ad.last_shown_date
      ? new Date(ad.last_shown_date * 1000)
      : undefined,
    adStatus: inferAdStatus(ad.first_shown_date, ad.last_shown_date),

    // Timing
    publishedAt: ad.first_shown_date
      ? new Date(ad.first_shown_date * 1000)
      : undefined,
    collectedAt: new Date(),

    // Source
    source: 'creative-center',
    sourceRaw: ad,
  };
}

export function transformTopAds(ads: CCTopAd[]): NormalizedPost[] {
  return ads
    .filter((ad) => !!ad.id || !!ad.video_info?.vid) // skip ads without an ID
    .map(transformTopAd);
}

// ── Trending Videos → NormalizedPost ────────────────────────────────────────

export function transformTrendingVideo(video: CCTrendingVideo): NormalizedPost {
  const hashtags = extractHashtags(video);
  const title = video.desc ?? '';

  return {
    videoId: video.item_id ?? '',
    videoUrl: video.video?.play_addr?.url_list?.[0],
    thumbnailUrl: video.video?.cover,

    title,
    description: title,
    hashtags,
    rawText: [title, hashtags.join(' ')].filter(Boolean).join(' '),

    creatorHandle: video.author?.unique_id ?? 'unknown',
    creatorDisplayName: video.author?.nickname,
    creatorFollowers: video.author?.follower_count,
    creatorVerified: video.author?.verified,
    creatorRegion: video.author?.region,

    viewCount: video.stats?.play_count ?? 0,
    likeCount: video.stats?.digg_count ?? 0,
    commentCount: video.stats?.comment_count ?? 0,
    shareCount: video.stats?.share_count ?? 0,
    engagementRate: calculateEngagementRate({
      views: video.stats?.play_count ?? 0,
      likes: video.stats?.digg_count ?? 0,
      comments: video.stats?.comment_count ?? 0,
      shares: video.stats?.share_count ?? 0,
    }),

    isAd: false,
    publishedAt: video.create_time
      ? new Date(video.create_time * 1000)
      : undefined,
    collectedAt: new Date(),

    source: 'creative-center',
    sourceRaw: video,
  };
}

export function transformTrendingVideos(videos: CCTrendingVideo[]): NormalizedPost[] {
  return videos
    .filter((v) => !!v.item_id)
    .map(transformTrendingVideo);
}

// ── Hashtags ──────────────────────────────────────────────────────────────────

export function transformHashtag(
  hashtag: CCHashtag,
  region: string
): NormalizedHashtag {
  return {
    hashtag: hashtag.hashtag_name.toLowerCase().replace(/^#/, ''),
    viewCount: hashtag.video_views ?? 0,
    videoCount: hashtag.publish_cnt ?? 0,
    trendRank: hashtag.rank,
    region,
    collectedAt: new Date(),
    source: 'creative-center',
  };
}

export function transformHashtags(
  hashtags: CCHashtag[],
  region: string
): NormalizedHashtag[] {
  return hashtags
    .filter((h) => !!h.hashtag_name)
    .map((h) => transformHashtag(h, region));
}

// ── Keywords ──────────────────────────────────────────────────────────────────

export function transformKeywordTrend(
  kw: CCKeywordTrend,
  region: string
): NormalizedKeyword {
  return {
    keyword: kw.keyword,
    searchVolume: undefined,        // CC doesn't expose raw volume
    trendScore: trendArrayToScore(kw.search_trend),
    relatedHashtags: kw.related_hashtags ?? [],
    region: kw.country_code ?? region,
    collectedAt: new Date(),
    source: 'creative-center',
  };
}

export function transformKeywordTrends(
  keywords: CCKeywordTrend[],
  region: string
): NormalizedKeyword[] {
  return keywords
    .filter((k) => !!k.keyword)
    .map((k) => transformKeywordTrend(k, region));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function calculateEngagementRate(stats: {
  views: number;
  likes: number;
  comments: number;
  shares: number;
}): number | undefined {
  if (stats.views === 0) return undefined;
  return Number(
    (((stats.likes + stats.comments + stats.shares) / stats.views) * 100).toFixed(2)
  );
}

function extractHashtagsFromText(text: string): string[] {
  const matches = text.match(/#\w+/g) ?? [];
  return matches.map((h) => h.slice(1).toLowerCase());
}

function extractHashtags(video: CCTrendingVideo): string[] {
  const fromChallenges = (video.challenges ?? [])
    .map((c) => c.title?.toLowerCase())
    .filter(Boolean) as string[];

  const fromTextExtra = (video.textExtra ?? [])
    .map((t) => t.hashtagName?.toLowerCase())
    .filter(Boolean) as string[];

  const fromDesc = extractHashtagsFromText(video.desc ?? '');

  // Deduplicate
  return [...new Set([...fromChallenges, ...fromTextExtra, ...fromDesc])];
}

function buildAdDescription(ad: CCTopAd): string {
  const parts = [
    ad.ad_title,
    ad.brand_name ? `Brand: ${ad.brand_name}` : null,
    ad.industry_name ? `Industry: ${ad.industry_name}` : null,
    ad.landing_page ? `Landing page: ${ad.landing_page}` : null,
  ].filter(Boolean);
  return parts.join(' | ');
}

function inferAdStatus(
  firstSeen?: number,
  lastSeen?: number
): 'active' | 'inactive' | 'unknown' {
  if (!lastSeen) return 'unknown';
  const daysSinceLastSeen =
    (Date.now() - lastSeen * 1000) / (1000 * 60 * 60 * 24);
  return daysSinceLastSeen <= 3 ? 'active' : 'inactive';
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Convert a trend array (relative engagement over time) to a 0–100 score.
 * The array usually has one value per day, recent-first or oldest-first.
 * We look at the slope: rising = high score, falling = low score.
 */
function trendArrayToScore(trend?: number[]): number | undefined {
  if (!trend || trend.length < 2) return undefined;

  const recent = trend.slice(-3);  // last 3 data points
  const older = trend.slice(0, 3); // first 3 data points

  const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;

  if (olderAvg === 0) return 50;

  const changeRatio = (recentAvg - olderAvg) / olderAvg;

  // Map to 0-100: -100% change = 0, 0% = 50, +100% change = 100
  const score = Math.round(50 + changeRatio * 50);
  return Math.max(0, Math.min(100, score));
}
