import { NormalizedPost, NormalizedComment } from '../ingestion.types';
import { EnsemblePost, EnsembleComment } from './ensemble.client';

export function transformEnsemblePosts(posts: any[]): NormalizedPost[] {
  return posts.map((item) => {
    const post = item.aweme_info || item;
    const desc = post.desc || post.text || '';
    const hashtags = extractHashtagsIdentified(post);
    const author = post.author || {};
    const creatorHandle = author.unique_id || author.uniqueId || 'unknown';
    const videoId = post.aweme_id || post.id || post.videoId;

    return {
      videoId,
      videoUrl: `https://www.tiktok.com/@${creatorHandle}/video/${videoId}`,
      videoPlayUrl: post.video?.play_addr?.url_list?.[0] || post.video?.play_url,
      thumbnailUrl: post.video?.cover?.url_list?.[0],

      title: desc.split('\n')[0] || 'Unknown Title',
      description: desc,
      hashtags,
      rawText: desc,

      creatorHandle,
      creatorDisplayName: author.nickname || author.nickName,
      creatorFollowers: author.follower_count || author.followerCount || 0,
      creatorRegion: author.region,
      creatorVerified: typeof author.verification_type === 'number' ? author.verification_type > 0 : !!author.verified,
      creatorAvatarUrl: author.avatar_thumb?.url_list?.[0],
      creatorBio: author.signature,
      creatorFollowing: author.following_count || author.followingCount,
      creatorTotalLikes: author.total_favorited || author.heartCount,

      viewCount: post.statistics?.play_count || post.statistics?.playCount || 0,
      likeCount: post.statistics?.digg_count || post.statistics?.diggCount || 0,
      commentCount: post.statistics?.comment_count || post.statistics?.commentCount || 0,
      shareCount: post.statistics?.share_count || post.statistics?.shareCount || 0,

      isAd: !!(post.is_ad || post.isAd),
      adStatus: 'unknown',

      publishedAt: post.create_time ? new Date(post.create_time * 1000) : undefined,
      collectedAt: new Date(),

      source: 'ensemble',
      sourceRaw: item,
    };
  });
}

function extractHashtagsIdentified(post: any): string[] {
  const fromText = extractHashtagsFromText(post.desc || post.text || '');
  const fromMetadata = (post.text_extra ?? [])
    .map((entry: any) => entry.hashtag_name?.trim().toLowerCase())
    .filter((value: any): value is string => Boolean(value));

  return [...new Set([...fromMetadata, ...fromText])];
}

export function transformEnsembleComments(comments: EnsembleComment[], videoId: string): NormalizedComment[] {
  return comments.map((comment) => ({
    commentId: comment.cid,
    videoId,
    text: comment.text || '',
    likeCount: comment.digg_count || 0,
    createdAt: comment.create_time ? new Date(comment.create_time * 1000) : undefined,
    isReply: false, // Not tracked precisely in top-level fetch
  }));
}

function extractHashtagsFromText(text: string): string[] {
  const matches = text.match(/#\w+/g);
  return matches ? matches.map((m) => m.slice(1).toLowerCase()) : [];
}

function extractHashtags(post: EnsemblePost): string[] {
  const fromText = extractHashtagsFromText(post.desc || '');
  const fromMetadata = (post.text_extra ?? [])
    .map((entry) => entry.hashtag_name?.trim().toLowerCase())
    .filter((value): value is string => Boolean(value));

  return [...new Set([...fromMetadata, ...fromText])];
}
