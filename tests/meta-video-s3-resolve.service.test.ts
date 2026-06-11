import { enrichCreativesWithResolvedVideoS3Keys } from '../src/services/meta-video-s3-resolve.service';
import { shouldExposeCreativeInFeed } from '../src/utils/creative-response.util';
import { s3ObjectExists } from '../src/utils/s3-video.util';

jest.mock('../src/utils/s3-video.util', () => ({
  ...jest.requireActual('../src/utils/s3-video.util'),
  s3ObjectExists: jest.fn(),
}));

const mockedS3Exists = s3ObjectExists as jest.MockedFunction<typeof s3ObjectExists>;

describe('enrichCreativesWithResolvedVideoS3Keys', () => {
  beforeEach(() => {
    mockedS3Exists.mockReset();
  });

  it('clears stale TikTok videoS3Key when S3 object is missing', async () => {
    mockedS3Exists.mockResolvedValue(false);

    const doc = {
      _id: '507f1f77bcf86cd799439012',
      externalVideoId: '7646571978102541598',
      videoS3Key: 'brightdata/tiktok-videos/7646571978102541598.mp4',
      tiktokPostUrl: 'https://www.tiktok.com/@x/video/7646571978102541598',
      productName: 'Sample Product',
      description: 'sample product review',
    };

    const [out] = await enrichCreativesWithResolvedVideoS3Keys([doc], {
      updateOne: jest.fn().mockResolvedValue({ matchedCount: 0 }),
    } as never);

    expect(out?.videoS3Key).toBeUndefined();
    expect(shouldExposeCreativeInFeed(out!)).toBe(false);
  });

  it('keeps TikTok videoS3Key when S3 object exists', async () => {
    mockedS3Exists.mockResolvedValue(true);

    const doc = {
      externalVideoId: '7643925823090625822',
      videoS3Key: 'brightdata/tiktok-videos/7643925823090625822.mp4',
      tiktokPostUrl: 'https://www.tiktok.com/@x/video/7643925823090625822',
      productName: 'Sample Product',
      description: 'sample product review',
    };

    const [out] = await enrichCreativesWithResolvedVideoS3Keys([doc], {
      updateOne: jest.fn().mockResolvedValue({ matchedCount: 0 }),
    } as never);

    expect(out?.videoS3Key).toBe('brightdata/tiktok-videos/7643925823090625822.mp4');
    expect(shouldExposeCreativeInFeed(out!)).toBe(true);
  });

  it('drops related video slots whose S3 object is missing', async () => {
    mockedS3Exists.mockImplementation(async (key: string) =>
      key.includes('7643925823090625822.mp4'),
    );

    const doc = {
      externalVideoId: '7643925823090625822',
      videoS3Key: 'brightdata/tiktok-videos/7643925823090625822.mp4',
      tiktokPostUrl: 'https://www.tiktok.com/@x/video/7643925823090625822',
      productName: 'Sample Product',
      description: 'sample product review',
      relatedVideos: [
        {
          externalVideoId: '7649999999999999999',
          videoS3Key: 'brightdata/tiktok-videos/7649999999999999999.mp4',
        },
        {
          externalVideoId: '7648888888888888888',
        },
      ],
    };

    const [out] = await enrichCreativesWithResolvedVideoS3Keys([doc], {
      updateOne: jest.fn().mockResolvedValue({ matchedCount: 0 }),
    } as never);

    expect(Array.isArray(out?.relatedVideos)).toBe(true);
    expect((out?.relatedVideos as unknown[]).length).toBe(1);
    expect((out?.relatedVideos as { externalVideoId?: string }[])[0]?.externalVideoId).toBe(
      '7648888888888888888',
    );
  });
});
