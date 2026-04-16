import { ProductRepository, EnrichedProductInput } from '../db/repositories/product.repository';
import { IProductDocument } from '../models/product.model';
import { ExtractedProduct, NormalizedPost } from '../ingestion/ingestion.types';
import { TeemDropService } from './teemdrop.service';
import { SerpService } from './serp.service';
import { CreativeService } from './creative.service';
import { DiscoveryService } from './discovery.service';
import { Creative } from '../models/creative.model';
import { logger } from '../logger';

const log = logger.child({ module: 'product-enricher' });

/**
 * Product Enricher (Discovery 2.0)
 *
 * Orchestrates multi-source enrichment:
 * 1. SerpApi  → image gallery & market ratings
 * 2. TeemDrop → supplier pricing & verified product URL
 * 3. AI       → 3-level taxonomy, confidence reasons, sentiment
 * 4. EnsembleData → creator-attributed TikTok videos (Creatives)
 * 5. Discovery → section tagging (trending, top-ads, viral...)
 */
export const ProductEnricher = {

  async mergeAndUpsert(
    extraction: ExtractedProduct,
    post: NormalizedPost,
    comments: NormalizedPost['sourceRaw'] extends any ? any[] : any[] = [] // typing as any[] for now, will receive NormalizedComment[]
  ): Promise<IProductDocument | null> {
    log.info('Running Discovery 2.0 Enrichment', { product: extraction.productName });

    // 1. SerpApi — gallery images & multi-source ratings
    const serpData    = await SerpService.getRichProductData(extraction.productName);
    const serpGallery = serpData ? SerpService.extractGalleryImages(serpData) : [];
    const serpRatings = serpData ? SerpService.extractRatingSources(serpData) : [];

    // 2. TeemDrop — supplier match
    let supplier: { platform: string; productUrl?: string; price?: number; currency?: string; shippingDays?: number; moq?: number; checkedAt: Date } | null = null;
    let supplierPrice: number | undefined;
    try {
      const match = await TeemDropService.findProductDetailByName(extraction.productName);
      if (match?.product) {
        const td = match.product;
        supplierPrice = td.productMinPrice ?? td.discountProductMinPrice ?? undefined;
        supplier = {
          platform:    'TeemDrop',
          productUrl:  undefined,            // TeemDrop detail API does not expose a public URL
          price:       supplierPrice,
          currency:    'USD',
          shippingDays:undefined,
          checkedAt:   new Date(),
        };
      }
    } catch (err) {
      log.warn('TeemDrop matching failed', { err: String(err) });
    }

    // 3. Image sourcing (SerpApi first, fallback to grounded AI images)
    const primaryImageUrl = SerpService.extractBestThumbnail(serpData || {}) || extraction.groundedImages[0];
    const gallery = serpGallery.length >= 3
      ? serpGallery
      : [...new Set([...serpGallery, ...extraction.groundedImages])];

    // 4. Sales evidence — only include if AI found a concrete source
    const salesEvidence: EnrichedProductInput['salesEvidence'] = extraction.salesSource?.store !== 'Unknown'
      ? {
          unitsSold:  extraction.unitsSold || 0,
          store:      extraction.salesSource!.store,
          storeUrl:   extraction.salesSource!.url,
          timeframe:  extraction.salesSource!.timeframe,
          fetchedAt:  new Date(),
        }
      : undefined;

    // 5. Rating sources (from SerpApi, or AI-estimated fallback from TikTok engagement)
    let ratingSources: EnrichedProductInput['ratingSources'] = serpRatings.map(r => ({
      platform:    r.source,
      rating:      r.rating,
      reviewCount: r.reviewsCount,
      sourceUrl:   r.url,
      fetchedAt:   new Date(),
    }));

    // FALLBACK ALGORTIHM: If Serp returns no ratings, we estimate from TikTok intent + engagement
    if (ratingSources.length === 0 && post.engagementRate) {
      const sentiment = extraction.buyingSentimentScore || 50;
      
      // Base estimated rating on sentiment (50 sentiment -> 3.5 stars, 100 -> 5.0 stars)
      let estimatedRating = 3.0 + (sentiment / 100) * 2.0;
      estimatedRating = Math.min(5.0, Math.max(1.0, estimatedRating)); // Clamp 1-5

      // Estimated reviews based on comment count and engagement
      const estimatedReviews = Math.max(10, Math.floor(post.commentCount * 0.15));

      ratingSources.push({
        platform: 'TikTok Engagement (Estimated)',
        rating: Number(estimatedRating.toFixed(1)),
        reviewCount: estimatedReviews,
        fetchedAt: new Date()
      });
    }

    // 5b. Map top comments for social proof
    const topComments = comments.slice(0, 10).map((c: any) => ({
      text: c.text,
      likeCount: c.likeCount || 0,
      authorHandle: c.authorHandle,
      sentiment: extraction.buyingSentimentScore && extraction.buyingSentimentScore > 70 ? 'positive' : 'neutral',
      source: 'EnsembleData',
      collectedAt: new Date()
    }));

    // 6. Related products from SerpApi
    const relatedProducts = (serpData?.immersive_products || serpData?.shopping_results || [])
      .slice(0, 6)
      .map((item: any) => ({
        title:     item.title,
        price:     item.price,
        thumbnail: item.thumbnail,
        link:      item.link,
        store:     item.source,
      }));

    // 7. Build tiktokPostUrl for primary creator
    const tiktokPostUrl = post.videoUrl
      || `https://www.tiktok.com/@${post.creatorHandle}/video/${post.videoId}`;

    // 8. Assemble the input
    const input: EnrichedProductInput = {
      // Identity
      videoId:     post.videoId,
      source:      post.source,
      hashtags:    post.hashtags,
      publishedAt: post.publishedAt,
      collectedAt: post.collectedAt,

      // Post engagement
      viewCount:     post.viewCount,
      likeCount:     post.likeCount,
      commentCount:  post.commentCount,
      shareCount:    post.shareCount,
      engagementRate:post.engagementRate,
      videoPlayUrl:  post.videoPlayUrl,
      thumbnailUrl:  post.thumbnailUrl,
      isAd:          post.isAd,

      // Content
      title:       extraction.productName,
      description: extraction.productDescription,

      // Taxonomy
      categoryL1:   extraction.categoryL1,
      categoryL2:   extraction.categoryL2,
      categoryL3:   extraction.categoryL3,
      categoryPath: extraction.categoryPath || extraction.categoryL1,

      // Media
      primaryImageUrl: primaryImageUrl || post.thumbnailUrl,
      imageUrls:       gallery,

      // Pricing
      price:    supplierPrice ?? extraction.estimatedPrice,
      currency: extraction.currency || 'USD',
      suppliers: supplier ? [supplier] : [],

      // Market evidence
      salesEvidence,
      ratingSources,
      rating:      calculateFinalRating(ratingSources, extraction),
      reviewCount: calculateFinalReviewCount(ratingSources, extraction),
      topComments: topComments as any,

      // Discovery origin
      primaryCreator: {
        handle:        post.creatorHandle || 'unknown',
        displayName:   post.creatorDisplayName,
        bio:           post.creatorBio,
        followers:     post.creatorFollowers,
        following:     post.creatorFollowing,
        totalLikes:    post.creatorTotalLikes,
        region:        post.creatorRegion,
        verified:      post.creatorVerified,
        avatarUrl:     post.creatorAvatarUrl,
        tiktokPostUrl,
      },

      // AI intelligence
      aiIntelligence: {
        confidence:           extraction.extractionConfidence,
        confidenceReason:     extraction.confidenceReason || 'AI extraction',
        brand:                extraction.brand,
        categoryKeywords:     extraction.categoryKeywords || [],
        buyingSentimentScore: extraction.buyingSentimentScore,
        buyingSentimentReason:extraction.buyingSentimentReason,
        extractedAt:          new Date(),
      },

      // Trend
      trend: {
        score:      extraction.trendScore,
        direction:  extraction.trendDirection,
        reason:     extraction.trendReason,
        isTrending: extraction.isTrending,
        calculatedAt: new Date(),
      },

      relatedProducts,
      discoverySections: [],
      creativeCounts: { ads: 0, organic: 0, reviews: 0, total: 0 },
    };

    // 9. Persist initial product record
    const product = await ProductRepository.upsertEnrichedProduct(input);
    if (!product) return null;

    // 10. Ingest creatives (pass taxonomy + relevance keywords)
    await CreativeService.fetchAndIngestCreatives(
      extraction.productName,
      product._id,
      {
        brand:            extraction.brand,
        categoryKeywords: extraction.categoryKeywords,
        categoryL1:       extraction.categoryL1,
        categoryL2:       extraction.categoryL2,
        categoryL3:       extraction.categoryL3,
      }
    );

    // 11. Discovery section tagging
    const sections = await DiscoveryService.categorizeProduct(product, serpData);

    // 12. Creative counts
    const [adsCount, totalCount, reviewsCount] = await Promise.all([
      Creative.countDocuments({ productId: product._id, isAd: true }),
      Creative.countDocuments({ productId: product._id }),
      Creative.countDocuments({ productId: product._id, section: 'influencer-reviews' }),
    ]);

    // 13. Final update
    product.discoverySections = sections;
    product.creativeCounts = {
      ads:     adsCount,
      organic: totalCount - adsCount,
      reviews: reviewsCount,
      total:   totalCount,
    };
    await product.save();

    log.info('Discovery 2.0 complete', {
      title:    product.title,
      sections: sections.join(','),
      creatives:totalCount,
    });

    return product;
  },
};

/**
 * Calculates a weighted average rating from multiple sources.
 * Fallback to AI-estimated rating if no sources exist.
 */
function calculateFinalRating(sources: any[], extraction: any): number | undefined {
  if (!sources || sources.length === 0) {
    return extraction.estimatedRating;
  }

  let totalWeightedScore = 0;
  let totalReviews = 0;

  for (const s of sources) {
    if (typeof s.rating === 'number' && typeof s.reviewCount === 'number') {
      totalWeightedScore += s.rating * s.reviewCount;
      totalReviews += s.reviewCount;
    }
  }

  if (totalReviews === 0) return extraction.estimatedRating;
  
  const avg = totalWeightedScore / totalReviews;
  return Math.round(avg * 10) / 10; // Round to 1 decimal
}

/**
 * Sums review counts from multiple sources, or falls back to AI estimate.
 */
function calculateFinalReviewCount(sources: any[], extraction: any): number | undefined {
  if (!sources || sources.length === 0) {
    return extraction.estimatedReviewCount || 0;
  }

  let total = 0;
  for (const s of sources) {
    total += s.reviewCount || 0;
  }

  return total > 0 ? total : (extraction.estimatedReviewCount || 0);
}
