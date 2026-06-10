import {
  isImplausibleVideoEngagement,
  sanitizeVideoMetrics,
} from '../src/utils/video-metrics.util';

describe('isImplausibleVideoEngagement', () => {
  it('flags product max-views mixed with video-level likes', () => {
    expect(
      isImplausibleVideoEngagement({
        viewCount: 4_000_000,
        likeCount: 2,
        commentCount: 0,
        shareCount: 0,
      }),
    ).toBe(true);
  });

  it('accepts realistic engagement', () => {
    expect(
      isImplausibleVideoEngagement({
        viewCount: 12_000,
        likeCount: 800,
        commentCount: 40,
        shareCount: 10,
      }),
    ).toBe(false);
  });
});

describe('sanitizeVideoMetrics', () => {
  it('caps inflated views using actual interactions', () => {
    const fixed = sanitizeVideoMetrics({
      viewCount: 4_000_000,
      likeCount: 2,
      commentCount: 0,
      shareCount: 0,
    });

    expect(fixed.viewCount).toBe(1000);
    expect(fixed.likeCount).toBe(2);
    expect(fixed.engagementRate).toBe(0.2);
  });

  it('leaves coherent metrics unchanged', () => {
    const input = {
      viewCount: 50_000,
      likeCount: 2_500,
      commentCount: 120,
      shareCount: 80,
    };
    expect(sanitizeVideoMetrics(input)).toEqual({
      ...input,
      engagementRate: 5.4,
    });
  });
});
