import { Document, Model } from 'mongoose';

export type ProductStatus = 'active' | 'review' | 'invalid';
export type TrendDirection = 'rising' | 'peaked' | 'saturating' | 'stable' | 'declining' | 'emerging' | 'viral' | 'unknown';
export type PriceBand = 'budget' | 'mid-range' | 'premium';
export type ProductType = 'evergreen' | 'trend-driven' | 'seasonal' | 'unknown';

export interface IPrimaryCreator {
  tiktokUserId?: string;
  handle: string;
  displayName?: string;
  followers?: number;
  verified?: boolean;
  tiktokPostUrl?: string;
}

export interface IProductReview {
  author?: string | null;
  rating?: number | null;
  content?: string | null;
  date?: string | null;
  item?: string | null;
}

export interface ISpecification {
  title: string;
  value: string;
}

export interface IProductSupplier {
  source?: string;
  platform?: string;
  externalId?: string;
  title?: string;
  productUrl?: string;
  shareUrl?: string;
  price?: number | null;
  originalPrice?: number | null;
  onSale?: boolean;
  currency?: string;
  rating?: number | null;
  totalRatings?: number | null;
  totalReviews?: number | null;
  soldLast30Days?: number | null;
  availableForSale?: boolean;
  shippingDays?: number;
  moq?: number;
  shop?: string | null;
  checkedAt?: Date;
  fetchedAt?: Date;
}

export interface IAIIntelligence {
  confidence: number;
  confidenceReason: string;
  brand?: string;
  categoryKeywords: string[];
  buyingSentimentScore?: number;
  buyingSentimentReason?: string;
  extractedAt: Date;
  niche?: string;
  productType: ProductType;
  priceBand?: PriceBand;
  audience: string[];
  problemStatement?: string;
  valueStatement?: string;
}

export interface ITrend {
  score: number;
  direction: TrendDirection;
  reason?: string;
  isTrending: boolean;
  calculatedAt: Date;
}

export interface IProduct {
  externalId: string;
  source: string;
  status: ProductStatus;
  title: string;
  normalizedTitle: string;
  description?: string;
  hashtags: string[];
  categoryL1: string;
  categoryL2?: string;
  categoryL3?: string;
  categoryPath: string;
  primaryImageUrl?: string;
  imageUrls: string[];
  price?: number;
  currency: string;
  originalPrice?: number;
  discountPercent?: number;
  shippingFee?: number;
  suppliers: IProductSupplier[];
  rating?: number;
  reviewCount?: number;
  reviews: IProductReview[];
  soldCount?: number;
  totalSales?: number;
  totalGmv?: number;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  engagementRate?: number;
  primaryCreator?: IPrimaryCreator;
  aiIntelligence: IAIIntelligence;
  trend: ITrend;
  creativeCounts: {
    ads: number;
    organic: number;
    reviews: number;
    total: number;
  };
  shopName?: string;
  shopUrl?: string;
  shopFollowers?: number;
  inStock?: boolean;
  postUrl?: string;
  videoUrl?: string;
  productUrl?: string;
  variations: unknown[];
  specifications: ISpecification[];
  sizes: string[];
  colors: string[];
  validationStatus: string;
  validationIssues: unknown[];
  lastIngestedAt: Date;
  dataSourceUpdatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IProductDocument extends IProduct, Document {}

export interface IProductModel extends Model<IProductDocument> {
  findByExternalId(externalId: string): Promise<IProductDocument | null>;
}
