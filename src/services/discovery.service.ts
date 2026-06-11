import { IProductDocument } from '../models/product.model';
import { Creative } from '../models/creative.model';
import { logger } from '../logger';
import { postRecencyFlags } from '../utils/product-recency.util';

const log = logger.child({ module: 'discovery-service' });

/** TikTok views at/above this are treated as high-reach (often ad-supported) when harder ad signals are missing. */
const TOP_AD_ABSOLUTE_VIEW_FLOOR = 350_000;

export const DiscoveryService = {
  /**
   * Categorizes a product into various discovery sections.
   */
  async categorizeProduct(product: IProductDocument): Promise<string[]> {
    const sections: Set<string> = new Set();

    try {
      // 1. Top Ads Logic (creatives + high view counts; no external shopping SERP)
      const creativeAdsCount = await Creative.countDocuments({
        productId: product._id,
        isAd: true,
      });
      const viewCount = Math.max(0, Number(product.viewCount) || 0);

      if (creativeAdsCount >= 1 || viewCount >= TOP_AD_ABSOLUTE_VIEW_FLOOR) {
        sections.add('top-ads');
      }

      // 2. Trending Logic — organic / high-momentum products
      if (
        !sections.has('top-ads') ||
        (product.trend?.score || 0) > 80 ||
        (product.viewCount ?? 0) > 1_000_000
      ) {
        sections.add('trending');
      }

      const postDate = product.publishedAt ?? product.postCreatedAt;
      const { isNew3d, isNew7d } = postRecencyFlags(postDate);
      if (isNew7d) sections.add('new-7d');
      if (isNew3d) sections.add('new-3d');

      const result = Array.from(sections);
      log.debug(`Product ${product.title} categorized into: ${result.join(', ')}`);
      return result;
    } catch (err) {
      log.error('Product categorization failed', { error: String(err) });
      return Array.from(sections);
    }
  },
};
