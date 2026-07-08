import mongoose, { type Model } from 'mongoose';
import type { ICreativeDocument, IVideoMetrics } from '../types/creative.types';
import { computeEstimatedVideoGmvAllocations } from '../utils/estimated-video-gmv.util';
import { logger } from '../logger';

export async function syncEstimatedVideoGmvForProduct(
  productId: string | mongoose.Types.ObjectId,
  creativeModel: Model<ICreativeDocument>,
): Promise<number> {
  const creatives = await creativeModel
    .find({ productId })
    .select('_id metrics.viewCount productTotalGmv productTotalSales')
    .lean();

  if (!creatives.length) return 0;

  const inputs = creatives.map((creative) => ({
    id: String(creative._id),
    viewCount: (creative.metrics as IVideoMetrics | undefined)?.viewCount ?? 0,
    productTotalGmv: creative.productTotalGmv,
    productTotalSales: creative.productTotalSales,
  }));

  const allocations = computeEstimatedVideoGmvAllocations(inputs);
  const computedAt = new Date();
  const ops = [...allocations.entries()].map(([id, allocation]) => ({
    updateOne: {
      filter: { _id: new mongoose.Types.ObjectId(id) },
      update: {
        $set: {
          ...allocation,
          estimatedVideoGmvComputedAt: computedAt,
        },
      },
    },
  }));

  const result = await creativeModel.bulkWrite(ops, { ordered: false });
  const modified = result.modifiedCount ?? 0;
  if (modified > 0) {
    logger.debug('Synced estimated video GMV for product creatives', {
      productId: String(productId),
      creatives: creatives.length,
      modified,
    });
  }
  return modified;
}
