import mongoose, { type Model } from 'mongoose';
import type { ICreativeDocument } from '../types/creative.types';
import type { IProductDocument } from '../types/product.types';
import { logger } from '../logger';

function creativeProductTrendPatch(product: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (product.salesTrend != null) patch.productSalesTrend = product.salesTrend;
  if (product.revenueTrend != null) patch.productRevenueTrend = product.revenueTrend;

  const sold = product.soldCount ?? product.totalSales;
  if (sold != null) patch.productTotalSales = sold;

  const gmv = product.totalGmv ?? product.storeGmv;
  if (gmv != null) patch.productTotalGmv = gmv;

  const trends = product.trends as { engagement?: unknown } | null | undefined;
  if (trends?.engagement && typeof trends.engagement === 'object') {
    patch.productTrend = trends.engagement;
  }
  return patch;
}

export async function syncCreativeProductTrends(
  productId: string | mongoose.Types.ObjectId,
  creativeModel: Model<ICreativeDocument>,
  product?: Record<string, unknown> | null,
): Promise<number> {
  const patch = product ? creativeProductTrendPatch(product) : {};
  if (!Object.keys(patch).length && !product) return 0;

  const setFields = Object.keys(patch).length
    ? patch
    : product
      ? creativeProductTrendPatch(product)
      : {};

  if (!Object.keys(setFields).length) return 0;

  const result = await creativeModel.updateMany({ productId }, { $set: setFields });
  const modified = result.modifiedCount ?? 0;
  if (modified > 0) {
    logger.debug('Synced product trends to creatives', { productId: String(productId), modified });
  }
  return modified;
}

export async function syncCreativeProductTrendsFromDoc(
  product: Pick<
    IProductDocument,
    | '_id'
    | 'salesTrend'
    | 'revenueTrend'
    | 'soldCount'
    | 'totalSales'
    | 'totalGmv'
    | 'storeGmv'
    | 'trends'
  >,
  creativeModel: Model<ICreativeDocument>,
): Promise<number> {
  return syncCreativeProductTrends(
    product._id,
    creativeModel,
    product as unknown as Record<string, unknown>,
  );
}
