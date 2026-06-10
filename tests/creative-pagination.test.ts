import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { Creative } from '../src/models/creative.model';
import { Product } from '../src/models/product.model';
import { CreativeService } from '../src/services/creative.service';
import { CREATIVE_TRENDING_MATCH } from '../src/services/creative.service';
import { minimalTestCreative } from './helpers/minimal-creative.fixture';
import { minimalTestProduct } from './helpers/minimal-product.fixture';

describe('CreativeService.findCreatives pagination', () => {
  jest.setTimeout(60000);
  let mongo: MongoMemoryServer;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 60000 } });
    await mongoose.connect(mongo.getUri());

    const creatives = [];
    for (let i = 0; i < 20; i++) {
      const product = await Product.create(
        minimalTestProduct({
          title: `Pagination Product ${i}`,
          externalId: `pag_ext_${i}`,
          source: 'tiktok',
        }),
      );
      const productId = product._id as mongoose.Types.ObjectId;
      const videoId = `7643925823090625${String(i).padStart(3, '0')}`;
      creatives.push(
        minimalTestCreative({
          productId,
          externalVideoId: videoId,
          section: 'top-ads',
          isAd: false,
          publishedAt: new Date(2024, 0, i + 1),
          metrics: { viewCount: 1000 - i, likeCount: 100 - i },
          tiktokPostUrl: `https://www.tiktok.com/@creator/video/${videoId}`,
        }),
      );
      // Second creative on the same product — must not inflate global feed totals.
      creatives.push(
        minimalTestCreative({
          productId,
          externalVideoId: `${videoId}_alt`,
          section: 'top-ads',
          isAd: false,
          publishedAt: new Date(2024, 0, i + 1),
          metrics: { viewCount: 500 - i, likeCount: 50 - i },
          tiktokPostUrl: `https://www.tiktok.com/@creator/video/${videoId}`,
        }),
      );
    }

    await Creative.insertMany(creatives);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  it('returns full pages after dedupe and feed exposure filtering', async () => {
    const page1 = await CreativeService.findCreatives(
      { page: 1, limit: 9, sortBy: 'views' },
      CREATIVE_TRENDING_MATCH,
      Creative,
    );
    expect(page1.data).toHaveLength(9);
    expect(page1.pagination.total).toBe(20);

    const page2 = await CreativeService.findCreatives(
      { page: 2, limit: 9, sortBy: 'views' },
      CREATIVE_TRENDING_MATCH,
      Creative,
    );
    expect(page2.data).toHaveLength(9);

    const page3 = await CreativeService.findCreatives(
      { page: 3, limit: 9, sortBy: 'views' },
      CREATIVE_TRENDING_MATCH,
      Creative,
    );
    expect(page3.data).toHaveLength(2);

    const page1Ids = page1.data.map((c) => c.externalVideoId);
    const page2Ids = page2.data.map((c) => c.externalVideoId);
    expect(page1Ids.some((id) => id.endsWith('_dup'))).toBe(false);
    expect(page2Ids.some((id) => id.endsWith('_dup'))).toBe(false);
    expect(
      new Set([...page1Ids, ...page2Ids, ...page3.data.map((c) => c.externalVideoId)]).size,
    ).toBe(20);
  });
});
