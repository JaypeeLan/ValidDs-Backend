import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { applyCreativeMetricFilters } from '../src/utils/content-feed-filters.util';
import { parseStartDateParam } from '../src/utils/content-feed-filters.util';

describe('creative startDate filter with ads (null publishedAt)', () => {
  jest.setTimeout(30000);
  let mongo: MongoMemoryServer;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 30000 } });
    await mongoose.connect(mongo.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  it('matches June ads via ingestedAt when publishedAt is null', async () => {
    const col = mongoose.connection.collection('creative_start_date_probe');
    await col.deleteMany({});

    const ingested = new Date('2026-06-10T12:00:00.000Z');
    await col.insertMany([
      {
        isAd: true,
        section: 'trending',
        publishedAt: null,
        ingestedAt: ingested,
        externalVideoId: 'ad-june-1',
        videoS3Key: 'brightdata/tiktok-videos/ad-june-1.mp4',
      },
      {
        isAd: false,
        section: 'top-ads',
        publishedAt: '2026-05-20T10:00:00.000Z',
        ingestedAt: new Date('2026-05-21T00:00:00.000Z'),
        externalVideoId: 'organic-may-1',
        videoS3Key: 'brightdata/tiktok-videos/organic-may-1.mp4',
      },
    ]);

    const query: Record<string, unknown> = { isAd: true };
    const start = parseStartDateParam('2026-06-03');
    applyCreativeMetricFilters(query, { startDate: start });

    const hits = await col.find(query).toArray();
    expect(hits.map((d) => d.externalVideoId)).toEqual(['ad-june-1']);
  });
});
