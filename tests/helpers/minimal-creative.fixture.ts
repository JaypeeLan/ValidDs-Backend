/** Minimal Creative document for integration tests. */

export function minimalTestCreative(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const handle =
    (overrides.creator as { handle?: string } | undefined)?.handle ?? 'creator';
  const videoId =
    (overrides.externalVideoId as string | undefined) ?? 'vid_test';
  const postUrl =
    (overrides.tiktokPostUrl as string | undefined) ??
    `https://www.tiktok.com/@${handle}/video/${videoId}`;

  return {
    externalVideoId: videoId,
    embedUrl: `https://www.tiktok.com/embed/v2/${videoId}`,
    tiktokPostUrl: postUrl,
    section: 'top-ads',
    isAd: false,
    publishedAt: new Date(),
    creator: {
      handle,
      displayName: 'Test Creator',
      region: 'US',
      verified: false,
      tiktokPostUrl: postUrl,
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
