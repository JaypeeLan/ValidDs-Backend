export interface TeemDropApiResponse<T = unknown> {
  code: number;
  message: string;
  data: T;
  success: boolean;
  traceId?: string;
  tid?: string;
}

export interface TeemDropTokenPayload {
  apiKey: string;
  token: string;
  expireTime: number;
}

export interface TeemDropProductListItem {
  productId: string;
  productMinPrice?: number | null;
  productMaxPrice?: number | null;
  discountProductMinPrice?: number | null;
  discountProductMaxPrice?: number | null;
  spu?: string | null;
  productNameEn?: string | null;
  productName?: string | null;
  image?: string | null;
  images?: string[] | null;
}

export interface TeemDropProductListData {
  total: number;
  page: number;
  pageSize: number;
  pageNum: number;
  data: TeemDropProductListItem[];
}

export interface TeemDropProductDetail extends TeemDropProductListItem {
  fstCategoryId?: string | null;
  sedCategoryId?: string | null;
  categoryId?: string | null;
  categoryNameEn?: string | null;
  categoryName?: string | null;
  description?: string | null;
  weight?: string | null;
  packWeight?: string | null;
  material?: string[] | null;
  materialEn?: string[] | null;
  materialKey?: string[] | null;
  packing?: string | null;
  packingKey?: string | null;
  logisticsAttr?: string[] | null;
  logisticsAttrEn?: string[] | null;
  logisticsAttrKey?: string[] | null;
  property?: string[] | null;
  propertyEn?: string[] | null;
}

export interface TeemDropResolvedProduct {
  product: TeemDropProductDetail;
  match: {
    score: number;
    pageNum: number;
    matchedTitle: string;
    searchTerm: string;
  };
}
