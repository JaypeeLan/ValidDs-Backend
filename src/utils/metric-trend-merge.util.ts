import type { IMetricTrend, IMetricTrendWindow } from '../types/product.types';
import {
  METRIC_TREND_DAY_OFFSETS,
  dayWindowLabel,
  rollSnapshotsDaily,
  snapshotOffsetFromWindow,
  snapshotsFromTrend,
} from './metric-trend-days.util';

/** Merge cumulative metric snapshots (soldCount / GMV) across re-ingest on daily windows. */
export function mergeMetricTrendSnapshots(
  incoming: unknown,
  existing: unknown,
  currentValue: number,
  dailyRoll?: boolean | null,
  now = Date.now(),
): IMetricTrend {
  const snapshots = new Map<number, number>();

  const absorb = (trend: unknown, onlyFillGaps: boolean) => {
    if (!trend || typeof trend !== 'object') return;
    const windows = (trend as IMetricTrend).windows;
    if (!Array.isArray(windows)) return;
    for (const w of windows) {
      if (!w || typeof w !== 'object') continue;
      const row = w as IMetricTrendWindow & { monthsAgo?: number };
      const offset = snapshotOffsetFromWindow(row as Record<string, unknown>);
      const value = Number(row.value);
      if (offset == null || !Number.isFinite(value) || value < 0) continue;
      if (offset === 0) continue;
      if (onlyFillGaps && snapshots.has(offset)) continue;
      snapshots.set(offset, value);
    }
  };

  if (dailyRoll && existing) {
    const rolled = rollSnapshotsDaily(snapshotsFromTrend(existing));
    rolled.set(0, Math.max(0, currentValue));
    const windows: IMetricTrendWindow[] = METRIC_TREND_DAY_OFFSETS.map((daysAgo) => ({
      label: dayWindowLabel(daysAgo, now),
      daysAgo,
      value: round2(daysAgo === 0 ? Math.max(0, currentValue) : (rolled.get(daysAgo) ?? 0)),
    }));
    return computeTrendFromWindows(sanitizeCumulativeWindows(windows, currentValue));
  }

  absorb(existing, false);
  absorb(incoming, true);

  const windows: IMetricTrendWindow[] = METRIC_TREND_DAY_OFFSETS.map((daysAgo) => ({
    label: dayWindowLabel(daysAgo, now),
    daysAgo,
    value: round2(daysAgo === 0 ? Math.max(0, currentValue) : (snapshots.get(daysAgo) ?? 0)),
  }));

  return computeTrendFromWindows(sanitizeCumulativeWindows(windows, currentValue));
}

/** Cumulative sold/GMV: history cannot exceed today or more recent windows. */
export function sanitizeCumulativeWindows(
  windows: IMetricTrendWindow[],
  currentValue: number,
): IMetricTrendWindow[] {
  const current = Math.max(0, currentValue);
  let prev = current;
  return windows.map((w) => {
    if (w.daysAgo === 0) {
      return { ...w, value: round2(current) };
    }
    const raw = Number(w.value) || 0;
    if (current <= 0 || raw <= 0) {
      return { ...w, value: 0 };
    }
    const value = raw > prev ? round2(prev) : round2(raw);
    prev = value;
    return { ...w, value };
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function computeTrendFromWindows(windows: IMetricTrendWindow[]): IMetricTrend {
  const cur =
    windows.find((w) => w.daysAgo === 0)?.value ?? windows[windows.length - 1]?.value ?? 0;
  let baseline: number | undefined;
  for (const w of windows) {
    if (w.daysAgo > 0 && (w.value ?? 0) > 0) {
      baseline = w.value;
      break;
    }
  }
  const base = baseline && baseline > 0 ? baseline : cur;
  let changePercent = 0;
  if (base > 0 && cur > 0) {
    changePercent = Math.round(((cur - base) / base) * 1000) / 10;
  }
  let direction: IMetricTrend['direction'] = 'stable';
  if (changePercent > 1) direction = 'up';
  else if (changePercent < -1) direction = 'down';

  return { direction, changePercent, windows };
}
