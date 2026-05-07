import { IProductDocument } from '../models/product.model';
import { Creative } from '../models/creative.model';
import { SearchApiRichData } from './search.service';
import { logger } from '../logger';

const log = logger.child({ module: 'discovery-service' });

/** TikTok views at/above this are treated as high-reach (often ad-supported) when harder ad signals are missing. */
const TOP_AD_ABSOLUTE_VIEW_FLOOR = 350_000;

export const DiscoveryService = {
  /**
   * Categorizes a product into various discovery sections.
   */
  async categorizeProduct(product: IProductDocument, serpData?: SearchApiRichData | null): Promise<string[]> {
    const sections: Set<string> = new Set(product.discoverySections || []);

    try {
      // 1. Top Ads Logic
      const hasSerpAds = serpData?.shopping_results?.some(r => r.is_ad) || false;
      const creativeAdsCount = await Creative.countDocuments({ 
        productId: product._id, 
        isAd: true 
      });
      const viewCount = Math.max(0, Number(product.viewCount) || 0);

      if (
        hasSerpAds ||
        creativeAdsCount >= 1 ||
        viewCount >= TOP_AD_ABSOLUTE_VIEW_FLOOR
      ) {
        sections.add('top-ads');
      }

      // 2. Trending Logic
      if ((product.trend?.score || 0) > 80 || product.viewCount > 1_000_000) {
        sections.add('trending');
      }

      // 3. Top Rated Logic
      const topRated = product.ratingSources?.find(r => r.rating >= 4.5 && r.reviewCount > 100);
      if (topRated) {
        sections.add('top-rated');
      }

      // 4. Viral Logic
      const viralCreatives = await Creative.countDocuments({
        productId: product._id,
        'metrics.engagementRate': { $gt: 15 }
      });
      
      if (viralCreatives >= 3 || (product.engagementRate || 0) > 10) {
        sections.add('viral');
      }

      const result = Array.from(sections);
      log.debug(`Product ${product.title} categorized into: ${result.join(', ')}`);
      return result;
    } catch (err) {
      log.error('Product categorization failed', { error: String(err) });
      return Array.from(sections);
    }
  }
};
