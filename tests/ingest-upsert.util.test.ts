import {
  creativeUpsertFilter,
  isCrossProductVideoReuse,
  isMongoDuplicateKeyError,
} from '../src/api/internal/ingest-upsert.util';

describe('ingest-upsert.util', () => {
  it('creativeUpsertFilter keys meta ads on externalVideoId', () => {
    expect(
      creativeUpsertFilter({
        externalVideoId: 'meta:123:abc',
        adDedupeKey: 'meta:text:page:copy',
      }),
    ).toEqual({ externalVideoId: 'meta:123:abc' });
  });

  it('creativeUpsertFilter keys organic rows on adDedupeKey when set', () => {
    expect(
      creativeUpsertFilter({
        externalVideoId: '7639035520198413598',
        adDedupeKey: 'tiktok:7639035520198413598',
      }),
    ).toEqual({ adDedupeKey: 'tiktok:7639035520198413598' });
  });

  it('isCrossProductVideoReuse blocks organic video hijacks only', () => {
    const payload = {
      externalVideoId: '7639035520198413598',
      productId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    };
    expect(isCrossProductVideoReuse(payload, 'bbbbbbbbbbbbbbbbbbbbbbbb')).toBe(true);
    expect(isCrossProductVideoReuse(payload, payload.productId)).toBe(false);
    expect(isCrossProductVideoReuse({ externalVideoId: 'meta:1:2', productId: 'a' }, 'b')).toBe(
      false,
    );
  });

  it('isMongoDuplicateKeyError detects code 11000', () => {
    expect(isMongoDuplicateKeyError({ code: 11000 })).toBe(true);
    expect(isMongoDuplicateKeyError({ code: 11001 })).toBe(false);
    expect(isMongoDuplicateKeyError(null)).toBe(false);
  });
});
