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
  /** Stable copy in S3 — served by thumbnail proxy when set */
  avatarS3Key?: string;
  /** Optional — not present on older ingested records from main DB */
  followers?: number;
  following?: number;
  /** Lifetime likes received across all TikTok posts (profile `heartCount` / `total_favorited`). Not per-video `metrics.likeCount`. */
  totalLikes?: number;
  region?: string;
  verified: boolean;
  tiktokPostUrl: string;
  isIndependentCreator?: boolean;
}

export interface IVideoMetrics {
  viewCount: number;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  /** (likes + comments + shares) / views × 100 — null when views = 0 */
  engagementRate?: number | null;
  /** Optional — not present on older ingested records */
  source?: string;
  fetchedAt?: Date;
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
  /** @deprecated Not stored on ingest — playback uses videoS3Key + API proxy */
  embedUrl?: string;
  tiktokPostUrl: string;
  thumbnailUrl?: string;
  videoPlayUrl?: string;
  videoS3Key?: string;
  videoDownloadRequestedAt?: Date;
  videoDownloadReadyAt?: Date;
  creator: ICreatorProfile;
  metrics: IVideoMetrics;
  topComments: ICreativeComment[];
  publishedAt: Date;
}

export interface ICreative {
  productId: mongoose.Types.ObjectId;
  externalVideoId: string;
  /** @deprecated Not stored on ingest — playback uses videoS3Key + API proxy */
  embedUrl?: string;
  tiktokPostUrl: string;
  thumbnailUrl?: string;
  /** Legacy CDN play URL — optional; used by video proxy when present */
  videoPlayUrl?: string;
  /** S3 object key for Bright Data–downloaded MP4 (preferred for playback) */
  videoS3Key?: string;
  videoDownloadRequestedAt?: Date;
  videoDownloadReadyAt?: Date;
  creator: ICreatorProfile;
  metrics: IVideoMetrics;
  section: CreativeSection;
  /** true when the creator is NOT the product's own brand/seller */
  isIndependentCreator: boolean;
  /** true when this creative was the primary discovery source for the product */
  isPrimaryDiscovery?: boolean;
  /** true when the video is a paid ad */
  isAd?: boolean;
  /** true when the video's product listing was verified against the shop card / anchor */
  listingVerified?: boolean;
  productName?: string;
  productDescription?: string;
  categoryL1?: string;
  categoryL2?: string;
  categoryL3?: string;
  categoryPath?: string;
  description?: string | null;
  angle?: string | null;
  hashtags: string[];
  topComments: ICreativeComment[];
  relatedVideos: ISecondaryVideo[];
  /** Denormalized from the parent product — refreshed on every ingest */
  productRating?: number | null;
  productTotalSales?: number | null;
  productTotalGmv?: number | null;
  productPrice?: number | null;
  productUrl?: string | null;
  shopName?: string | null;
  shopAvatarUrl?: string | null;
  shopAvatarS3Key?: string | null;
  productPrimaryImageUrl?: string | null;
  /** Denormalized copy of the parent product's `salesTrend` (MetricTrend windows). */
  productSalesTrend?: IMetricTrend | null;
  productTrend?: { score: number; direction: string; isTrending: boolean; reason?: string } | null;
  publishedAt?: Date | string | null;
  ingestedAt?: Date;
  /** Stable feed/upsert key — see creativeAdDedupeKey() */
  adDedupeKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICreativeDocument extends ICreative, Document {}

// ── API response shapes ───────────────────────────────────────────────────────

export interface ICreatorProfileApi extends Omit<ICreatorProfile, 'tiktokPostUrl'> {
  avatarProxyUrl?: string;
  /** Lifetime likes received across all TikTok posts (profile `heartCount` / `total_favorited`). Not per-video `metrics.likeCount`. */
  totalLikes?: number;
  following?: number;
}

export interface IVideoMetricsApi {
  viewCount: number;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  engagementRate?: number | null;
}

export interface ISecondaryVideoApi {
  isPrimary: false;
  externalVideoId: string;
  thumbnailUrl?: string;
  videoProxyUrl?: string;
  thumbnailProxyUrl?: string;
  metrics: IVideoMetricsApi;
  creator: ICreatorProfileApi;
  topComments: ICreativeComment[];
  publishedAt: Date;
}

export interface IProductTrendSnapshot {
  score: number;
  direction: string;
  isTrending: boolean;
  reason?: string;
}

/** Full creative — detail and product embeds. */
export interface CreativeApiItem {
  id: string;
  productId: string;
  externalVideoId: string;
  thumbnailUrl?: string;
  /** S3 MP4 via GET this path — only set when `videoS3Key` exists in DB. */
  videoProxyUrl?: string;
  thumbnailProxyUrl?: string;
  creator: ICreatorProfileApi;
  metrics: IVideoMetricsApi;
  section: CreativeSection;
  isIndependentCreator: boolean;
  isPrimaryDiscovery?: boolean;
  isAd?: boolean;
  productName?: string;
  productDescription?: string;
  categoryL1?: string;
  categoryL2?: string;
  categoryL3?: string;
  categoryPath?: string;
  description?: string | null;
  angle?: string | null;
  hashtags: string[];
  topComments: ICreativeComment[];
  relatedVideos: ISecondaryVideoApi[];
  productRating?: number | null;
  productTotalSales?: number | null;
  productTotalGmv?: number | null;
  productPrice?: number | null;
  productUrl?: string | null;
  shopName?: string | null;
  shopAvatarUrl?: string | null;
  productPrimaryImageUrl?: string | null;
  productSalesTrend?: IMetricTrend | null;
  productTrend?: IProductTrendSnapshot | null;
  publishedAt?: Date | string | null;
  ingestedAt?: Date | string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

/** List cards — omits long `productDescription`. */
export type CreativeFeedItem = Omit<CreativeApiItem, 'productDescription'>;

/** `GET /creatives?groupBy=creator` — one row per creator handle with total video count. */
export interface CreativeCreatorFeedItem extends CreativeFeedItem {
  videoCount: number;
}

/** Discovery creators tab — one row per `primaryCreator.handle` (shop / seller). */
export interface CreatorLobbyCreator {
  handle: string;
  displayName: string;
  followers: number;
  /** Lifetime profile likes across all posts — not single-video `metrics.likeCount`. */
  totalLikes: number;
  /** Stable avatar — `GET /creatives/{id}/thumbnail?kind=avatar`. */
  avatarProxyUrl?: string;
}

export interface CreatorLobbyTopProduct {
  productId: string;
  productName: string;
  productRating: number | null;
  productPrimaryImageUrl: string | null;
}

export interface CreatorLobbyItem {
  /** Sum of `totalGmv` across this creator's ingested products. */
  creatorGmv: number;
  creator: CreatorLobbyCreator;
  topProduct: CreatorLobbyTopProduct;
  updatedAt?: Date | string | null;
}
