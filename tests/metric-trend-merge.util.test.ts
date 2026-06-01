import { mergeMetricTrendSnapshots } from '../src/utils/metric-trend-merge.util';

describe('mergeMetricTrendSnapshots', () => {
  it('preserves prior month snapshots and updates current month', () => {
    const merged = mergeMetricTrendSnapshots(
      {
        direction: 'stable',
        changePercent: 0,
        windows: [
          { label: '2026-05', daysAgo: 1, monthsAgo: 1, value: 0 },
          { label: '2026-06', daysAgo: 0, monthsAgo: 0, value: 5000 },
        ],
      },
      {
        direction: 'stable',
        changePercent: 0,
        windows: [
          { label: '2026-05', daysAgo: 1, monthsAgo: 1, value: 4000 },
          { label: '2026-06', daysAgo: 0, monthsAgo: 0, value: 4500 },
        ],
      },
      8624,
    );

    const may = merged.windows.find((w) => w.label === '2026-05');
    const june = merged.windows.find((w) => w.label === '2026-06');
    expect(may?.value).toBe(4000);
    expect(june?.value).toBe(8624);
    expect(merged.direction).toBe('up');
    expect(merged.changePercent).toBeGreaterThan(0);
  });
});
