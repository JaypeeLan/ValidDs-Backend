import { mergeMetricTrendSnapshots } from '../src/utils/metric-trend-merge.util';
import {
  METRIC_TREND_DAY_COUNT,
  METRIC_TREND_DAY_OFFSETS,
} from '../src/utils/metric-trend-days.util';

const FIXED_NOW = Date.UTC(2026, 5, 22, 12, 0, 0);

describe('mergeMetricTrendSnapshots', () => {
  it('builds ninety daily windows with date labels', () => {
    const merged = mergeMetricTrendSnapshots(null, null, 5000, false, FIXED_NOW);
    expect(merged.windows).toHaveLength(METRIC_TREND_DAY_COUNT);
    expect(merged.windows.map((w) => w.daysAgo)).toEqual([...METRIC_TREND_DAY_OFFSETS]);
    expect(merged.windows[0]?.label).toBe('2026-06-22');
    expect(merged.windows[1]?.label).toBe('2026-06-21');
    expect(merged.windows.find((w) => w.daysAgo === 0)?.value).toBe(5000);
  });

  it('merges existing snapshots into daily windows', () => {
    const merged = mergeMetricTrendSnapshots(
      {
        direction: 'up',
        changePercent: 25,
        windows: [
          { label: '2026-05-23', daysAgo: 30, value: 4000 },
          { label: '2026-06-22', daysAgo: 0, value: 5000 },
        ],
      },
      {
        direction: 'up',
        changePercent: 28,
        windows: [
          { label: '2026-05-23', daysAgo: 30, value: 3500 },
          { label: '2026-06-22', daysAgo: 0, value: 4500 },
        ],
      },
      5000,
      false,
      FIXED_NOW,
    );
    const d30 = merged.windows.find((w) => w.daysAgo === 30);
    expect(d30?.value).toBe(3500);
    expect(merged.windows.find((w) => w.daysAgo === 0)?.value).toBe(5000);
  });

  it('maps legacy monthly windows to nearest day offset', () => {
    const merged = mergeMetricTrendSnapshots(
      {
        direction: 'stable',
        changePercent: 0,
        windows: [
          { label: '2026-05', daysAgo: 1, monthsAgo: 1, value: 2000 },
          { label: '2026-06-22', daysAgo: 0, monthsAgo: 0, value: 3000 },
        ],
      },
      null,
      5000,
      false,
      FIXED_NOW,
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
          { label: '2026-05-23', daysAgo: 30, value: 1200 },
          { label: '2026-06-22', daysAgo: 0, value: 0 },
        ],
      },
      null,
      0,
      false,
      FIXED_NOW,
    );
    expect(merged.windows.find((w) => w.daysAgo === 0)?.value).toBe(0);
    expect(merged.windows.find((w) => w.daysAgo === 30)?.value).toBe(0);
  });

  it('rolls windows daily before setting fresh today', () => {
    const existing = {
      direction: 'stable',
      changePercent: 0,
      windows: [
        { label: '2026-06-22', daysAgo: 0, value: 100 },
        { label: '2026-06-21', daysAgo: 1, value: 80 },
      ],
    };
    const merged = mergeMetricTrendSnapshots(null, existing, 150, true, FIXED_NOW);
    expect(merged.windows.find((w) => w.daysAgo === 0)?.value).toBe(150);
    expect(merged.windows.find((w) => w.daysAgo === 1)?.value).toBe(100);
    expect(merged.windows.find((w) => w.daysAgo === 2)?.value).toBe(80);
  });
});
