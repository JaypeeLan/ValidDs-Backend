import { NormalizedPost, NormalizedComment } from '../ingestion.types';
import { EnsemblePost, EnsembleComment } from './ensemble.client';

export function transformEnsemblePosts(posts: EnsemblePost[]): NormalizedPost[] {
  return posts.map((post) => {
    const desc = post.desc || '';
    const hashtags = extractHashtagsFromText(desc);

    return {
      videoId: post.aweme_id,
      videoUrl: `https://www.tiktok.com/@${post.author?.unique_id || 'unknown'}/video/${post.aweme_id}`,
      videoPlayUrl: post.video?.play_addr?.url_list?.[0],
      thumbnailUrl: post.video?.cover?.url_list?.[0],

      title: desc.split('\n')[0] || 'Unknown Title',
      description: desc,
      hashtags,
      rawText: desc,

      creatorHandle: post.author?.unique_id || 'unknown',
      creatorDisplayName: post.author?.nickname,
      creatorFollowers: post.author?.follower_count || 0,
      creatorRegion: post.author?.region,

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
