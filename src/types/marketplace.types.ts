/** Apify-sourced cross-marketplace listing snapshot (Alibaba / AliExpress / Target). */
export interface IMarketplaceListing {
  /** Direct link to the product page; empty string means searched but not found. */
  productUrl: string;
  price: number | null;
  originalPrice?: number | null;
  currency: string;
  title?: string | null;
  /** Minimum order quantity — Alibaba only. */
  moq?: number | null;
  rating?: number | null;
  fetchedAt: Date | string;
}
