import {
  enrichRelatedVideosMetricsInPlace,
  isZeroVideoMetrics,
} from '../src/utils/related-video-metrics.util';
import type { IVideoMetrics } from '../src/types/creative.types';

describe('related-video-metrics.util', () => {
  it('detects all-zero metrics', () => {
    expect(isZeroVideoMetrics({ viewCount: 0, likeCount: 0, commentCount: 0, shareCount: 0 })).toBe(
      true,
    );
    expect(
      isZeroVideoMetrics({ viewCount: 1200, likeCount: 0, commentCount: 0, shareCount: 0 }),
    ).toBe(false);
  });

  it('fills embedded related slots from sibling index', () => {
    const metrics: IVideoMetrics = {
      viewCount: 991379,
      likeCount: 50,
      commentCount: 3,
      shareCount: 34,
      engagementRate: 0.0088,
    };
    const creative: Record<string, unknown> = {
      relatedVideos: [
        {
          externalVideoId: '7640286993921953055',
          metrics: { viewCount: 0, likeCount: 0, commentCount: 0, shareCount: 0 },
        },
      ],
    };
    enrichRelatedVideosMetricsInPlace(creative, new Map([['7640286993921953055', metrics]]));
    const rv = (creative.relatedVideos as { metrics: IVideoMetrics }[])[0];
    expect(rv.metrics.viewCount).toBe(991379);
    expect(rv.metrics.likeCount).toBe(50);
  });
});
