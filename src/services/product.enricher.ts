import { ProductRepository, EnrichedProductInput } from '../db/repositories/product.repository';
import { IProductDocument } from '../models/product.model';
import { ExtractedProduct, NormalizedPost } from '../ingestion/ingestion.types';
import { TeemDropService } from './teemdrop.service';
import { SearchApiService } from './search.service';
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
 * 4. Creatives ingestion pipeline
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
    const serpData    = await SearchApiService.getRichProductData(extraction.productName);
    const serpGallery = serpData ? SearchApiService.extractGalleryImages(serpData) : [];
    const serpRatings = serpData ? SearchApiService.extractRatingSources(serpData) : [];

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
    const primaryImageUrl = SearchApiService.extractBestThumbnail(serpData || {}) || extraction.groundedImages[0];
    const gallery = serpGallery.length >= 3
      ? serpGallery
      : [...new Set([...serpGallery, ...extraction.groundedImages])];

    // 4. Sales evidence — only include if AI found a concrete source
    const sourceBreakdown = normalizeUnitsSoldBreakdown(extraction.unitsSoldBreakdown);
    if (sourceBreakdown.length === 0) {
      sourceBreakdown.push(buildFallbackUnitsSoldSource(extraction, post));
    }
    const unitsSoldTotal = sourceBreakdown.reduce((sum, item) => sum + item.unitsSold, 0);
    const primarySource = sourceBreakdown[0];
    const salesEvidence: EnrichedProductInput['salesEvidence'] = {
      unitsSold: unitsSoldTotal,
      store: extraction.salesSource?.store && extraction.salesSource.store !== 'Unknown'
        ? extraction.salesSource.store
        : primarySource.source,
      storeUrl: extraction.salesSource?.url || primarySource.url,
      timeframe: extraction.salesSource?.timeframe,
      sourceBreakdown,
      fetchedAt: new Date(),
    };

    // 5. Rating sources (from SerpApi, or AI-estimated fallback from TikTok engagement)
    let ratingSources: NonNullable<EnrichedProductInput['ratingSources']> = serpRatings.map(r => ({
      platform:    r.source,
      rating:      r.rating,
      reviewCount: r.reviewsCount,
      sourceUrl:   r.url,
      fetchedAt:   new Date(),
    }));
    ratingSources = normalizeRatingSources(ratingSources);

    // FALLBACK ALGORTIHM: If Serp returns no ratings, we estimate from TikTok intent + engagement
    if (ratingSources.length === 0) {
      ratingSources.push(buildFallbackRatingSource(extraction, post));
      ratingSources = normalizeRatingSources(ratingSources);
    }

    // 5b. Map top comments for social proof
    const topComments = comments.slice(0, 10).map((c: any) => ({
      comment: c.text,
      text: c.text,
      likeCount: c.likeCount || 0,
      authorHandle: c.authorHandle,
      sentiment: extraction.buyingSentimentScore && extraction.buyingSentimentScore > 70 ? 'positive' : 'neutral',
      source: 'TikTok',
      collectedAt: new Date()
    }));
    const reviews = buildProductReviews(extraction, serpData, topComments);

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
      reviews,

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
  if (!sources || sources.length === 0) return sanitizeRating(extraction.estimatedRating);

  let totalWeightedScore = 0;
  let totalReviews = 0;

  for (const s of sources) {
    if (
      typeof s.rating === 'number' &&
      typeof s.reviewCount === 'number' &&
      s.rating > 0 &&
      s.reviewCount > 0
    ) {
      totalWeightedScore += s.rating * s.reviewCount;
      totalReviews += s.reviewCount;
    }
  }

  if (totalReviews === 0) return sanitizeRating(extraction.estimatedRating);
  
  const avg = totalWeightedScore / totalReviews;
  return sanitizeRating(Math.round(avg * 10) / 10); // Round to 1 decimal
}

/**
 * Sums review counts from multiple sources, or falls back to AI estimate.
 */
function calculateFinalReviewCount(sources: any[], extraction: any): number | undefined {
  if (!sources || sources.length === 0) {
    return Math.max(1, Number(extraction.estimatedReviewCount) || 1);
  }

  let total = 0;
  for (const s of sources) {
    total += Math.max(0, Number(s.reviewCount) || 0);
  }

  if (total > 0) return total;
  return Math.max(1, Number(extraction.estimatedReviewCount) || 1);
}

function sanitizeRating(value: any): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 3.5;
  return Math.min(5, Math.max(1, Number(numeric.toFixed(1))));
}

function normalizeRatingSources(
  sources: EnrichedProductInput['ratingSources'] = []
): NonNullable<EnrichedProductInput['ratingSources']> {
  const cleaned = (sources || [])
    .map((source) => ({
      ...source,
      rating: sanitizeRating(source.rating),
      reviewCount: Math.max(1, Number(source.reviewCount) || 1),
      fetchedAt: source.fetchedAt || new Date(),
    }))
    .filter((source) => !!source.platform);

  return cleaned;
}

function buildFallbackRatingSource(extraction: any, post: NormalizedPost): NonNullable<EnrichedProductInput['ratingSources']>[number] {
  const sentiment = Number(extraction.buyingSentimentScore || 50);
  let estimated = Number(extraction.estimatedRating);

  if (!Number.isFinite(estimated) || estimated <= 0) {
    estimated = 3.0 + (sentiment / 100) * 2.0;
  }

  const reviewsFromPost = Math.max(1, Math.floor((post.commentCount || 0) * 0.15));
  const reviews = Math.max(10, Number(extraction.estimatedReviewCount) || reviewsFromPost);

  return {
    platform: post.engagementRate ? 'TikTok Engagement (Estimated)' : 'AI Estimate (Gemini/DeepSeek)',
    rating: sanitizeRating(estimated),
    reviewCount: reviews,
    fetchedAt: new Date(),
  };
}

function normalizeUnitsSoldBreakdown(
  breakdown: ExtractedProduct['unitsSoldBreakdown']
): Array<{ source: string; unitsSold: number; url?: string }> {
  return (breakdown || [])
    .map((entry) => ({
      source: String(entry?.source || '').trim(),
      unitsSold: Math.max(0, Math.round(Number(entry?.unitsSold || 0))),
      url: entry?.url,
    }))
    .filter((entry) => entry.source && entry.unitsSold > 0);
}

function buildFallbackUnitsSoldSource(
  extraction: ExtractedProduct,
  post: NormalizedPost
): { source: string; unitsSold: number; url?: string } {
  const aiUnits = Math.max(0, Math.round(Number(extraction.unitsSold || 0)));
  if (aiUnits > 0 && extraction.salesSource?.store && extraction.salesSource.store !== 'Unknown') {
    return {
      source: extraction.salesSource.store,
      unitsSold: aiUnits,
      url: extraction.salesSource.url,
    };
  }

  const estimatedDemand = Math.max(
    50,
    Math.round((post.commentCount || 0) * 10 + (post.shareCount || 0) * 4 + (post.likeCount || 0) * 0.01)
  );
  return {
    source: 'TikTok Demand Signal (Estimated)',
    unitsSold: estimatedDemand,
  };
}

function buildProductReviews(
  extraction: ExtractedProduct,
  serpData: any,
  topComments: Array<{ comment: string; source: string; collectedAt: Date }>
): Array<{ source: string; text: string; collectedAt: Date }> {
  const fromAi = (extraction.reviews || [])
    .map((review) => ({
      source: review.source,
      text: review.text,
      collectedAt: new Date(),
    }))
    .filter((review) => review.source && review.text);

  const fromSerp = (serpData?.organic_results || [])
    .slice(0, 5)
    .map((row: any) => ({
      source: String(row?.source || row?.domain || 'Web'),
      text: String(row?.snippet || '').trim(),
      collectedAt: new Date(),
    }))
    .filter((review: any) => review.text.length > 0);

  const fromTikTok = topComments.slice(0, 5).map((comment) => ({
    source: comment.source,
    text: comment.comment,
    collectedAt: new Date(),
  }));

  const dedup = new Set<string>();
  const combined = [...fromAi, ...fromSerp, ...fromTikTok].filter((review) => {
    const key = `${review.source}|${review.text}`.toLowerCase();
    if (dedup.has(key)) return false;
    dedup.add(key);
    return true;
  });

  return combined.slice(0, 20);
}
