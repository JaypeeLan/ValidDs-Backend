import { parseStartDateParam } from '../src/utils/content-feed-filters.util';

describe('content-feed-filters.util', () => {
  it('parseStartDateParam accepts YYYY-MM-DD', () => {
    const d = parseStartDateParam('2026-04-29');
    expect(d?.toISOString()).toBe('2026-04-29T00:00:00.000Z');
  });

  it('parseStartDateParam rejects invalid', () => {
    expect(parseStartDateParam('not-a-date')).toBeUndefined();
  });
});
