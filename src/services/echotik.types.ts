export interface EchoTikApiResponse<T> {
  code: number;
  message: string;
  data: T;
  requestId?: string;
}

export interface EchoTikInfluencer {
  user_id: string;
  unique_id?: string;
  nick_name?: string;
  avatar?: string;
  signature?: string;
  region?: string;
  total_followers_cnt?: number;
  total_views_cnt?: number;
  total_live_cnt?: number;
  total_sale_gmv_amt?: number;
}

export interface EchoTikLiveStream {
  room_id: string;
  user_id: string;
  nick_name?: string;
  region?: string;
  title?: string;
  cover_url?: string;
  create_time?: number;
  finish_time?: number;
  duration?: number;
  total_views_cnt?: number;
  total_joins_cnt?: number;
  total_digg_cnt?: number;
  total_comments_cnt?: number;
  total_followers_cnt?: number;
  total_product_cnt?: number;
  total_sale_cnt?: number;
  total_sale_gmv_amt?: number;
}
