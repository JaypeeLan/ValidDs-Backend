import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { Creative } from '../src/models/creative.model';
import { Product } from '../src/models/product.model';
import { CreativeService, CREATIVE_TOP_ADS_MATCH } from '../src/services/creative.service';
import { mergeCreativeFeedExtraMatch } from '../src/utils/content-feed-filters.util';
import { minimalTestCreative } from './helpers/minimal-creative.fixture';
import { minimalTestProduct } from './helpers/minimal-product.fixture';
import { LISTABLE_PRODUCT_METRICS } from './helpers/seed-listable.fixture';

describe('mergeCreativeFeedExtraMatch', () => {
  it('preserves search $or when merging top-ads bucket match', () => {
    const base = {
      productName: /widget/i,
      $or: [{ productName: /widget/i }, { description: /widget/i }],
    };
    const merged = mergeCreativeFeedExtraMatch(base, CREATIVE_TOP_ADS_MATCH);
    expect(merged).toEqual({
      $and: [base, CREATIVE_TOP_ADS_MATCH],
    });
  });
});

describe('CreativeService.findCreatives top-ads search', () => {
  jest.setTimeout(60000);
  let mongo: MongoMemoryServer;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 60000 } });
    await mongoose.connect(mongo.getUri());

    const productA = await Product.create(
      minimalTestProduct({
        title: 'Alpha Widget Pro',
        externalId: 'alpha_widget',
        source: 'tiktok',
      }),
    );
    const productB = await Product.create(
      minimalTestProduct({
        title: 'Beta Gadget',
        externalId: 'beta_gadget',
        source: 'tiktok',
      }),
    );

    const metaBase = {
      ...LISTABLE_PRODUCT_METRICS,
      section: 'trending' as const,
      isAd: true,
      publishedAt: new Date('2024-03-01'),
      videoS3Key: 'brightdata/tiktok-videos/meta/12345678901.mp4',
      metaAdLibraryUrl: 'https://www.facebook.com/ads/library/?id=12345678901',
      tiktokPostUrl: 'https://www.facebook.com/ads/library/?id=12345678901',
      creator: {
        handle: 'brand_a',
        displayName: 'Brand A',
        region: 'US',
        tiktokPostUrl: 'https://www.facebook.com/ads/library/?id=12345678901',
        isIndependentCreator: true,
      },
      metrics: { viewCount: 1000, likeCount: 100 },
    };

    await Creative.insertMany([
      minimalTestCreative({
        ...metaBase,
        productId: productA._id,
        productName: 'Alpha Widget Pro',
        externalVideoId: 'meta:11111111111',
        metaAdLibraryUrl: 'https://www.facebook.com/ads/library/?id=11111111111',
        tiktokPostUrl: 'https://www.facebook.com/ads/library/?id=11111111111',
        videoS3Key: 'brightdata/tiktok-videos/meta/11111111111.mp4',
      }),
      minimalTestCreative({
        ...metaBase,
        productId: productB._id,
        productName: 'Beta Gadget',
        externalVideoId: 'meta:22222222222',
        metaAdLibraryUrl: 'https://www.facebook.com/ads/library/?id=22222222222',
        tiktokPostUrl: 'https://www.facebook.com/ads/library/?id=22222222222',
        videoS3Key: 'brightdata/tiktok-videos/meta/22222222222.mp4',
      }),
    ]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  it('filters top-ads feed by q without dropping bucket match', async () => {
    const all = await CreativeService.findCreatives(
      { page: 1, limit: 20, sortBy: 'views' },
      CREATIVE_TOP_ADS_MATCH,
      Creative,
    );
    expect(all.pagination.total).toBe(2);

    const alpha = await CreativeService.findCreatives(
      { page: 1, limit: 20, sortBy: 'views', q: 'Alpha Widget' },
      CREATIVE_TOP_ADS_MATCH,
      Creative,
    );
    expect(alpha.pagination.total).toBe(1);

    const none = await CreativeService.findCreatives(
      { page: 1, limit: 20, sortBy: 'views', q: 'nonexistent-xyz' },
      CREATIVE_TOP_ADS_MATCH,
      Creative,
    );
    expect(none.pagination.total).toBe(0);
  });
});
