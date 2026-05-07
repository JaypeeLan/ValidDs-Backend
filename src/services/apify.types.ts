export interface ShopifyScraperItem {
  id?: string;
  title?: string;
  handle?: string;
  vendor?: string;
  productType?: string;
  tags?: string[];
  price?: string | number;
  images?: string[];
  shareUrl?: string;
  [key: string]: unknown;
}

export interface ShopifyScraperResponseData {
  count: number;
  data: ShopifyScraperItem[];
}
