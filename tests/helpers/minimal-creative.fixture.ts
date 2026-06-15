/** Minimal Creative document for integration tests. */

import type { Types } from 'mongoose';

export function minimalTestCreative(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const handle = (overrides.creator as { handle?: string } | undefined)?.handle ?? 'creator';
  const videoId = (overrides.externalVideoId as string | undefined) ?? 'vid_test';
  const postUrl =
    (overrides.tiktokPostUrl as string | undefined) ??
    `https://www.tiktok.com/@${handle}/video/${videoId}`;

  return {
    externalVideoId: videoId,
    tiktokPostUrl: postUrl,
    videoS3Key: `brightdata/tiktok-videos/${videoId}.mp4`,
    section: 'top-ads',
    isAd: false,
    publishedAt: new Date(),
    creator: {
      handle,
      displayName: 'Test Creator',
      region: 'US',
      verified: false,
      tiktokPostUrl: postUrl,
      avatarS3Key: `validds/creator-assets/avatars/us/${handle}.jpg`,
      isIndependentCreator: false,
    },
    metrics: {
      viewCount: 0,
      likeCount: 0,
      commentCount: 0,
      shareCount: 0,
    },
    ...overrides,
  };
}

/** Feed-safe creative linked to a product (required for product list/detail APIs). */
export function playableCreativeForProduct(
  productId: Types.ObjectId,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return minimalTestCreative({ productId, ...overrides });
}
