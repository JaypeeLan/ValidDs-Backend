import { NormalizedPost, NormalizedComment } from '../ingestion.types';
import { EnsemblePost, EnsembleComment } from './ensemble.client';

export function transformEnsemblePosts(posts: EnsemblePost[]): NormalizedPost[] {
  return posts.map((post) => {
    const desc = post.desc || '';
    const hashtags = extractHashtags(post);
    const creatorHandle = post.author?.unique_id || 'unknown';

    return {
      videoId: post.aweme_id,
      videoUrl: `https://www.tiktok.com/@${creatorHandle}/video/${post.aweme_id}`,
      videoPlayUrl: post.video?.play_addr?.url_list?.[0],
      thumbnailUrl: post.video?.cover?.url_list?.[0],

      title: desc.split('\n')[0] || 'Unknown Title',
      description: desc,
      hashtags,
      rawText: desc,

      creatorHandle,
      creatorDisplayName: post.author?.nickname,
      creatorFollowers: post.author?.follower_count || 0,
      creatorRegion: post.author?.region,
      creatorVerified: typeof post.author?.verification_type === 'number' ? post.author.verification_type > 0 : undefined,
      creatorAvatarUrl: post.author?.avatar_thumb?.url_list?.[0],
      creatorBio: post.author?.signature,

      viewCount: post.statistics?.play_count || 0,
      likeCount: post.statistics?.digg_count || 0,
      commentCount: post.statistics?.comment_count || 0,
      shareCount: post.statistics?.share_count || 0,

      isAd: false, // Ensemble organic search
      adStatus: 'unknown',

      publishedAt: post.create_time ? new Date(post.create_time * 1000) : undefined,
      collectedAt: new Date(),

      source: 'ensemble',
      sourceRaw: post,
    };
  });
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
