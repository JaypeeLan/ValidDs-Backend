import { IProductDocument } from '../models/product.model';
import { logger } from '../logger';
import {
  resolveGlobalSelling,
  resolveHighOpportunity,
  type ProductDiscoverySection,
} from '../utils/discovery-sections.util';

const log = logger.child({ module: 'discovery-service' });

export const DiscoveryService = {
  /**
   * Resolve a product's single discovery section.
   *
   * Priority: global-selling > high-opportunity > default.
   */
  async categorizeProduct(product: IProductDocument): Promise<ProductDiscoverySection[]> {
    try {
      const raw = { discoverySections: product.discoverySections } as Record<string, unknown>;
      if (resolveGlobalSelling(raw)) return ['global-selling'];
      if (resolveHighOpportunity(raw)) return ['high-opportunity'];

      log.debug(`Product ${product.title} categorized into: default`);
      return ['default'];
    } catch (err) {
      log.error('Product categorization failed', { error: String(err) });
      return ['default'];
    }
  },
};
