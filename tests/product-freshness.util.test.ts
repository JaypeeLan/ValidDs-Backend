import {
  applyUpdatedAtToUpdate,
  buildProductItemFreshness,
  shouldTouchProductUpdatedAt,
} from '../src/utils/product-freshness.util';

describe('product-freshness.util', () => {
  it('bumps only updatedAt on data updates', () => {
    const update = { $set: { rating: 4.5 } };
    applyUpdatedAtToUpdate(update);
    expect(update.$set).toMatchObject({ updatedAt: expect.any(Date) });
    expect(update.$set).not.toHaveProperty('lastIngestedAt');
    expect(update.$set).not.toHaveProperty('dataSourceUpdatedAt');
  });

  it('skips updatedAt when only marking stale', () => {
    const update = { $set: { status: 'stale' } };
    expect(shouldTouchProductUpdatedAt(update)).toBe(false);
    applyUpdatedAtToUpdate(update);
    expect(update.$set).toEqual({ status: 'stale' });
  });

  it('buildProductItemFreshness exposes lastIngestedAt and updatedAt', () => {
    const freshness = buildProductItemFreshness(
      {
        lastIngestedAt: '2026-05-01T12:00:00.000Z',
        updatedAt: '2026-05-01T13:00:00.000Z',
      },
      Date.parse('2026-05-01T14:00:00.000Z'),
    );
    expect(freshness.lastIngestedAt).toBe('2026-05-01T12:00:00.000Z');
    expect(freshness.updatedAt).toBe('2026-05-01T13:00:00.000Z');
    expect(freshness.lastUpdatedAt).toBe('2026-05-01T13:00:00.000Z');
    expect(freshness.freshnessLabel).toBe('2h ago');
  });

  it('falls back when freshness fields are missing on legacy docs', () => {
    const freshness = buildProductItemFreshness({
      updatedAt: '2026-04-01T00:00:00.000Z',
    });
    expect(freshness.lastUpdatedAt).toBe('2026-04-01T00:00:00.000Z');
    expect(freshness.lastIngestedAt).toBe('2026-04-01T00:00:00.000Z');
  });
});
