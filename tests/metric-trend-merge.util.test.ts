import { mergeMetricTrendSnapshots } from '../src/utils/metric-trend-merge.util';
import { METRIC_TREND_DAY_OFFSETS } from '../src/utils/metric-trend-days.util';

describe('mergeMetricTrendSnapshots', () => {
  it('uses day windows and preserves prior snapshots on re-ingest', () => {
    const merged = mergeMetricTrendSnapshots(
      {
        direction: 'stable',
        changePercent: 0,
        windows: [
          { label: '30d ago', daysAgo: 30, value: 4000 },
          { label: 'Today', daysAgo: 0, value: 5000 },
        ],
      },
      {
        direction: 'stable',
        changePercent: 0,
        windows: [
          { label: '30d ago', daysAgo: 30, value: 3500 },
          { label: 'Today', daysAgo: 0, value: 4500 },
        ],
      },
      8624,
    );

    expect(merged.windows.map((w) => w.daysAgo)).toEqual([...METRIC_TREND_DAY_OFFSETS]);
    const today = merged.windows.find((w) => w.daysAgo === 0);
    const d30 = merged.windows.find((w) => w.daysAgo === 30);
    expect(today?.value).toBe(8624);
    expect(d30?.value).toBe(3500);
    expect(merged.direction).toBe('up');
    expect(merged.changePercent).toBeGreaterThan(0);
  });

  it('maps legacy monthly windows to day offsets', () => {
    const merged = mergeMetricTrendSnapshots(
      {
        direction: 'stable',
        changePercent: 0,
        windows: [
          { label: '2026-05', daysAgo: 1, monthsAgo: 1, value: 2000 },
          { label: 'Today', daysAgo: 0, monthsAgo: 0, value: 3000 },
        ],
      },
      null,
      5000,
    );
    const d30 = merged.windows.find((w) => w.daysAgo === 30);
    expect(d30?.value).toBe(2000);
    expect(merged.windows.find((w) => w.daysAgo === 0)?.value).toBe(5000);
  });

  it('clamps impossible history when today is zero', () => {
    const merged = mergeMetricTrendSnapshots(
      {
        direction: 'down',
        changePercent: -100,
        windows: [
          { label: '30d ago', daysAgo: 30, value: 1200 },
          { label: 'Today', daysAgo: 0, value: 0 },
        ],
      },
      null,
      0,
    );
    expect(merged.windows.find((w) => w.daysAgo === 0)?.value).toBe(0);
    expect(merged.windows.find((w) => w.daysAgo === 30)?.value).toBe(0);
  });
});
