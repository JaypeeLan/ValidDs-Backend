import mongoose, { Document } from 'mongoose';

// Mirrors IMetricTrend from product.types — kept local to avoid cross-model imports
export interface IMetricTrendWindow {
  label: string;
  daysAgo: number;
  value: number;
}

export interface IMetricTrend {
  direction: 'up' | 'down' | 'stable';
  changePercent: number;
  windows: IMetricTrendWindow[];
}

export type CreativeSection =
  | 'top-ads'
  | 'trending'
  | 'influencer-reviews'
  | 'tutorials'
  | 'viral-unboxings';

export interface ICreatorProfile {
  handle: string;
  displayName?: string;
  bio?: string;
  avatarUrl?: string;
  followers: number;
  following?: number;
  totalLikes?: number;
  region?: string;
  verified: boolean;
  tiktokPostUrl: string;
  /** When true, this creator is an independent creator — surfaced as a top ad for discovery */
  isIndependentCreator: boolean;
}

export interface IVideoMetrics {
  viewCount: number;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  /** (likes + comments + shares) / views × 100 — null when views = 0 */
  engagementRate?: number | null;
  source: string;
  fetchedAt: Date;
}

export interface ICreativeComment {
  comment: string;
  source: string;
  likeCount?: number;
  authorHandle?: string;
  collectedAt: Date;
}

export interface ISecondaryVideo {
  externalVideoId: string;
  /** Permanent TikTok embed URL (https://www.tiktok.com/embed/v2/<id>) — no CDN expiry */
  embedUrl: string;
  tiktokPostUrl: string;
  thumbnailUrl?: string;
  creator: ICreatorProfile;
  metrics: IVideoMetrics;
  topComments: ICreativeComment[];
  publishedAt: Date;
}

export interface ICreative {
  productId: mongoose.Types.ObjectId;
  externalVideoId: string;
  /** Permanent TikTok embed URL — use this instead of a CDN play URL which expires */
  embedUrl: string;
  tiktokPostUrl: string;
  thumbnailUrl?: string;
  creator: ICreatorProfile;
  metrics: IVideoMetrics;
  section: CreativeSection;
  /** true when the creator is NOT the product's own brand/seller */
  isIndependentCreator: boolean;
  productName?: string;
  productDescription?: string;
  categoryL1?: string;
  categoryL2?: string;
  categoryL3?: string;
  categoryPath?: string;
  description?: string;
  hashtags: string[];
  topComments: ICreativeComment[];
  relatedVideos: ISecondaryVideo[];
  /** Denormalized from the parent product — refreshed on every ingest so creatives can be queried standalone */
  productRating?: number | null;
  /** Lifetime total units sold */
  productTotalSales?: number | null;
  productPrimaryImageUrl?: string | null;
  productSalesTrend?: IMetricTrend | null;
  publishedAt: Date;
  ingestedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICreativeDocument extends ICreative, Document {}