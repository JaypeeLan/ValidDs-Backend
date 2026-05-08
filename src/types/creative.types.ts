import mongoose, { Document } from 'mongoose';

export type CreativeSection =
  | 'top-ads'
  | 'trending'
  | 'influencer-reviews'
  | 'tutorials'
  | 'viral-unboxings';

export interface ICreatorProfile {
  tiktokUserId: string;
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
}

export interface IVideoMetrics {
  viewCount: number;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  engagementRate?: number;
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
  videoPlayUrl?: string;
  thumbnailUrl?: string;
  creator: ICreatorProfile;
  metrics: IVideoMetrics;
  topComments: ICreativeComment[];
  publishedAt: Date;
}

export interface ICreative {
  productId: mongoose.Types.ObjectId;
  externalVideoId: string;
  videoPlayUrl?: string;
  thumbnailUrl?: string;
  creator: ICreatorProfile;
  metrics: IVideoMetrics;
  section: CreativeSection;
  isAd: boolean;
  productName?: string;
  productDescription?: string;
  categoryL1?: string;
  categoryL2?: string;
  categoryL3?: string;
  description?: string;
  hashtags: string[];
  topComments: ICreativeComment[];
  relatedVideos: ISecondaryVideo[];
  publishedAt: Date;
  ingestedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICreativeDocument extends ICreative, Document {}
