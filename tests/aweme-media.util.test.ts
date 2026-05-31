import {
  extractAwemeAvatar,
  extractAwemeMedia,
  extractAwemeThumbnail,
  extractAwemeVideoPlayUrl,
  resolveAwemeId,
} from '../src/utils/aweme-media.util';

describe('aweme-media.util', () => {
  it('extracts thumbnail, video, and avatar from snake_case aweme JSON', () => {
    const aweme = {
      aweme_id: '123',
      video: {
        play_addr: { url_list: ['https://cdn.example/video.mp4'] },
        cover: { url_list: ['https://cdn.example/cover.jpg'] },
      },
      author: {
        avatar_larger: { url_list: ['https://cdn.example/avatar.jpg'] },
        follower_count: 1200,
      },
    };

    expect(resolveAwemeId(aweme)).toBe('123');
    expect(extractAwemeVideoPlayUrl(aweme)).toBe('https://cdn.example/video.mp4');
    expect(extractAwemeThumbnail(aweme)).toBe('https://cdn.example/cover.jpg');
    expect(extractAwemeAvatar(aweme.author as Record<string, unknown>)).toBe(
      'https://cdn.example/avatar.jpg',
    );

    const media = extractAwemeMedia(aweme);
    expect(media?.videoPlayUrl).toBe('https://cdn.example/video.mp4');
    expect(media?.thumbnailUrl).toBe('https://cdn.example/cover.jpg');
    expect(media?.creator?.avatarUrl).toBe('https://cdn.example/avatar.jpg');
    expect(media?.creator?.followers).toBe(1200);
  });
});
