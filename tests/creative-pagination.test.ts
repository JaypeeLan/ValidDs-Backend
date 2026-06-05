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
  let productId: mongoose.Types.ObjectId;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 60000 } });
    await mongoose.connect(mongo.getUri());

    const product = await Product.create(
      minimalTestProduct({
        title: 'Pagination Product',
        externalId: 'pag_ext_1',
        source: 'tiktok',
      }),
    );
    productId = product._id as mongoose.Types.ObjectId;

    const creatives = [];
    for (let i = 0; i < 20; i++) {
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
      // Duplicate row for every other video — should not affect unique page counts.
      if (i % 2 === 0) {
        creatives.push(
          minimalTestCreative({
            productId,
            externalVideoId: `${videoId}_dup`,
            section: 'top-ads',
            isAd: false,
            publishedAt: new Date(2024, 0, i + 1),
            metrics: { viewCount: 500 - i, likeCount: 50 - i },
            tiktokPostUrl: `https://www.tiktok.com/@creator/video/${videoId}`,
          }),
        );
      }
    }

    // Non-playable rows that must not steal pagination slots.
    for (let i = 0; i < 5; i++) {
      creatives.push(
        minimalTestCreative({
          productId,
          externalVideoId: `unplayable_${i}`,
          section: 'top-ads',
          isAd: false,
          videoS3Key: '',
          publishedAt: new Date(2023, 0, i + 1),
          metrics: { viewCount: 99999, likeCount: 9999 },
          tiktokPostUrl: `https://www.tiktok.com/@creator/video/unplayable_${i}`,
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
