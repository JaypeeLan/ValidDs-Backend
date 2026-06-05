import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import {
  creativeFeedExposureMatchStage,
  shouldExposeCreativeInFeed,
} from '../src/utils/creative-response.util';

async function matchesFeedExposureInMongo(doc: Record<string, unknown>): Promise<boolean> {
  const col = mongoose.connection.collection('creative_feed_exposure_probe');
  await col.deleteMany({});
  await col.insertOne({ ...doc, _id: new mongoose.Types.ObjectId() });
  const [hit] = await col
    .aggregate([creativeFeedExposureMatchStage(), { $count: 'count' }])
    .toArray();
  return (hit?.count ?? 0) > 0;
}

describe('creativeFeedExposureMatchStage', () => {
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

  it('matches playable TikTok creatives with stored videoS3Key', async () => {
    const doc = {
      externalVideoId: '7643925823090625822',
      videoS3Key: 'brightdata/tiktok-videos/7643925823090625822.mp4',
      tiktokPostUrl: 'https://www.tiktok.com/@x/video/7643925823090625822',
    };
    expect(shouldExposeCreativeInFeed(doc)).toBe(true);
    expect(await matchesFeedExposureInMongo(doc)).toBe(true);
  });

  it('rejects TikTok creatives without videoS3Key', async () => {
    const doc = {
      externalVideoId: '7643925823090625822',
      tiktokPostUrl: 'https://www.tiktok.com/@x/video/7643925823090625822',
    };
    expect(shouldExposeCreativeInFeed(doc)).toBe(false);
    expect(await matchesFeedExposureInMongo(doc)).toBe(false);
  });

  it('matches verified Meta creatives even when videoS3Key is not stored yet', async () => {
    const doc = {
      externalVideoId: 'meta:12345678901',
      metaAdLibraryUrl: 'https://www.facebook.com/ads/library/?id=12345678901',
      tiktokPostUrl: 'https://www.facebook.com/ads/library/?id=12345678901',
    };
    expect(shouldExposeCreativeInFeed(doc)).toBe(false);
    expect(await matchesFeedExposureInMongo(doc)).toBe(true);
  });

  it('rejects Meta creatives with access_token in viewer URL', async () => {
    const doc = {
      externalVideoId: 'meta:12345678901',
      metaAdLibraryUrl: 'https://www.facebook.com/ads/library/?id=12345678901&access_token=secret',
      videoS3Key: 'brightdata/tiktok-videos/meta/12345678901.mp4',
    };
    expect(shouldExposeCreativeInFeed(doc)).toBe(false);
    expect(await matchesFeedExposureInMongo(doc)).toBe(false);
  });
});
