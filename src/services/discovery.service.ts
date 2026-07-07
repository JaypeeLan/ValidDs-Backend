import { IProductDocument } from '../models/product.model';
import { Creative } from '../models/creative.model';
import { logger } from '../logger';
import {
  resolveGlobalSelling,
  resolveHighOpportunity,
  type ProductDiscoverySection,
} from '../utils/discovery-sections.util';

const log = logger.child({ module: 'discovery-service' });

/** TikTok views at/above this are treated as high-reach (often ad-supported) when harder ad signals are missing. */
const TOP_AD_ABSOLUTE_VIEW_FLOOR = 350_000;

export const DiscoveryService = {
  /**
   * Resolve a product's single discovery section.
   *
   * Priority: global-selling > high-opportunity > top-ads > trending.
   * The Partner Center pool signals (carried on discoverySections) are explicit
   * and win; otherwise the ad/organic split decides.
   */
  async categorizeProduct(product: IProductDocument): Promise<ProductDiscoverySection[]> {
    try {
      const raw = { discoverySections: product.discoverySections } as Record<string, unknown>;
      if (resolveGlobalSelling(raw)) return ['global-selling'];
      if (resolveHighOpportunity(raw)) return ['high-opportunity'];

      const creativeAdsCount = await Creative.countDocuments({
        productId: product._id,
        isAd: true,
      });
      const viewCount = Math.max(0, Number(product.viewCount) || 0);
      const isAd = creativeAdsCount >= 1 || viewCount >= TOP_AD_ABSOLUTE_VIEW_FLOOR;

      const section: ProductDiscoverySection = isAd ? 'top-ads' : 'trending';
      log.debug(`Product ${product.title} categorized into: ${section}`);
      return [section];
    } catch (err) {
      log.error('Product categorization failed', { error: String(err) });
      return ['trending'];
    }
  },
};
