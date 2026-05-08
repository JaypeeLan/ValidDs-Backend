export interface ShopifyScraperMediaSource {
  url: string;
  mimeType: string;
  width: number;
  height: number;
  format: string;
}

export interface ShopifyScraperMediaItem {
  type: string;
  url: string;
  altText: string | null;
  width: number;
  height: number;
  previewUrl?: string;
  sources?: ShopifyScraperMediaSource[];
}

export interface ShopifyScraperReview {
  id: string;
  title: string | null;
  body: string;
  rating: number;
  helpfulnessCount: number;
  submittedAt: string;
  syndicated: boolean;
  reviewerName: string;
  merchantReply: string | null;
}

export interface ShopifyScraperVariantOption {
  name: string;
  value: string;
}

export interface ShopifyScraperVariant {
  id: string;
  title: string;
  slug: string;
  availableForSale: boolean;
  quantityAvailable: number | null;
  requiresShipping: boolean;
  price: number;
  compareAtPrice: number | null;
  currency: string;
  selectedOptions: ShopifyScraperVariantOption[];
  imageUrl: string | null;
}

export interface ShopifyScraperOption {
  name: string;
  values: string[];
}

export interface ShopifyScraperContact {
  method: string;
  target: string;
}

export interface ShopifyScraperRatingBreakdown {
  oneStar: number;
  twoStars: number;
  threeStars: number;
  fourStars: number;
  fiveStars: number;
}

export interface ShopifyScraperItem {
  id: string;
  title: string;
  slug: string;
  url: string;
  shareUrl: string;
  description: string;
  descriptionHtml: string;
  vendor: string;
  productType: string;
  availableForSale: boolean;
  price: number;
  currency: string;
  originalPrice: number | null;
  onSale: boolean;
  variantsCount: number;
  options: ShopifyScraperOption[];
  variants: ShopifyScraperVariant[];
  images: string[];
  media: ShopifyScraperMediaItem[];
  rating: number | null;
  totalRatings: number;
  totalReviews: number;
  ratingBreakdown: ShopifyScraperRatingBreakdown;
  reviews: ShopifyScraperReview[];
  shopId: string;
  shopName: string;
  shopUrl: string;
  shopMyshopifyDomain: string;
  shopShareUrl: string;
  shopRating: number | null;
  shopTotalRatings: number;
  shopTotalReviews: number;
  shopAddress: string[] | null;
  shopContacts: ShopifyScraperContact[];
  soldLast30Days: number | null;
  shopCount: number;
  universalProductId: string;
  scrapedAt: string;
}

export interface ShopifyScraperResponseData {
  count: number;
  data: ShopifyScraperItem[];
}

export interface TikTokLiveOwner {
  id?: number | string;
  nickname?: string;
  unique_id?: string;
  avatar_thumb?: { url_list?: string[] };
  follow_info?: { follower_count?: number };
}

export interface TikTokLiveStats {
  total_user?: number;
}

export interface TikTokLiveStreamUrl {
  rtmp_pull_url?: string;
  flv_pull_url?: Record<string, string>;
}

export interface TikTokLiveScraperItem {
  id?: number | string;
  id_str?: string;
  title?: string;
  status?: number;
  user_count?: number;
  room_id?: number | string;
  owner_user_id?: number | string;
  cover?: { url_list?: string[] };
  stream_url?: TikTokLiveStreamUrl;
  stats?: TikTokLiveStats;
  owner?: TikTokLiveOwner;
  create_time?: number;
}
