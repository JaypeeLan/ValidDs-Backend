import {
  metaAdIdFromCreative,
  metaAdMp4S3Key,
  metaVideoS3Prefix,
} from '../src/utils/meta-video-s3.util';

describe('meta-video-s3.util', () => {
  it('builds predictable S3 key for numeric ad id', () => {
    expect(metaAdMp4S3Key('1290159126432600')).toBe(`${metaVideoS3Prefix()}/1290159126432600.mp4`);
  });

  it('extracts ad id from meta externalVideoId', () => {
    expect(
      metaAdIdFromCreative({
        externalVideoId: 'meta:1290159126432600',
        metaAdLibraryUrl: 'https://www.facebook.com/ads/library/?id=1290159126432600',
      }),
    ).toBe('1290159126432600');
  });

  it('returns undefined key for non-numeric meta dedupe ids', () => {
    expect(metaAdMp4S3Key('visual')).toBeUndefined();
  });
});
