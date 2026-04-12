export interface RainforestPrice {
  symbol: string;
  value: number;
  currency: string;
  raw: string;
}

export interface RainforestProduct {
  position: number;
  title: string;
  asin: string;
  link: string;               // Direct Amazon product URL (e.g. https://www.amazon.com/dp/B0...)
  categories?: { name: string }[];
  image: string;
  rating?: number;
  ratings_total?: number;
  prices?: RainforestPrice[];
  price?: RainforestPrice;     // primary price shortcut
  is_prime?: boolean;
  recent_sales?: string;       // e.g., "20K+ bought in past month"
  brand?: string;
}

export interface RainforestRequestInfo {
  success: boolean;
  credits_used: number;
  credits_remaining: number;
  credits_used_this_request: number;
}

export interface RainforestSearchResponse {
  request_info: RainforestRequestInfo;
  search_results: RainforestProduct[];
  pagination?: {
    total_results: number;
    current_page: number;
    total_pages: number;
  };
}
