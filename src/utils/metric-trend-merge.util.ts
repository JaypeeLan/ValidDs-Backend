import type { IMetricTrend, IMetricTrendWindow } from '../types/product.types';

/** Merge cumulative metric snapshots (e.g. soldCount) month-by-month on re-ingest. */
export function mergeMetricTrendSnapshots(
  incoming: unknown,
  existing: unknown,
  currentValue: number,
): IMetricTrend {
  const snapshots = new Map<string, number>();

  const absorb = (trend: unknown) => {
    if (!trend || typeof trend !== 'object') return;
    const windows = (trend as IMetricTrend).windows;
    if (!Array.isArray(windows)) return;
    for (const w of windows) {
      if (!w || typeof w !== 'object') continue;
      const label = String((w as IMetricTrendWindow).label ?? '').trim();
      const value = Number((w as IMetricTrendWindow).value);
      if (label && Number.isFinite(value) && value > 0) {
        snapshots.set(label, value);
      }
    }
  };

  absorb(existing);
  absorb(incoming);

  const template = pickWindowTemplate(incoming, existing);
  const curLabel = template.find((w) => (w.monthsAgo ?? w.daysAgo) === 0)?.label;
  if (curLabel) snapshots.set(curLabel, Math.max(0, currentValue));

  const windows: IMetricTrendWindow[] = template.map((w) => {
    const row = w as IMetricTrendWindow & { monthsAgo?: number; recordedAt?: string };
    const monthsAgo = row.monthsAgo ?? row.daysAgo ?? 0;
    const label = String(row.label ?? '').trim();
    const value =
      monthsAgo === 0 ? Math.max(0, currentValue) : label ? (snapshots.get(label) ?? 0) : 0;
    return {
      label: label || row.label,
      daysAgo: row.daysAgo ?? monthsAgo,
      value: round2(value),
    };
  });

  return computeTrendFromWindows(windows);
}

type TrendWindowRow = IMetricTrendWindow & { monthsAgo?: number; recordedAt?: string };

function pickWindowTemplate(incoming: unknown, existing: unknown): TrendWindowRow[] {
  for (const trend of [incoming, existing]) {
    if (!trend || typeof trend !== 'object') continue;
    const windows = (trend as IMetricTrend).windows;
    if (Array.isArray(windows) && windows.length > 0) {
      return windows.map((w) => ({ ...(w as TrendWindowRow) }));
    }
  }
  const label = currentMonthLabel();
  return [
    {
      label,
      daysAgo: 0,
      monthsAgo: 0,
      value: 0,
      recordedAt: `${label}-01T12:00:00.000Z`,
    },
  ];
}

function currentMonthLabel(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function windowOffset(w: IMetricTrendWindow & { monthsAgo?: number }): number {
  return w.monthsAgo ?? w.daysAgo ?? 0;
}

function computeTrendFromWindows(windows: IMetricTrendWindow[]): IMetricTrend {
  const cur =
    windows.find((w) => windowOffset(w) === 0)?.value ?? windows[windows.length - 1]?.value ?? 0;
  let baseline =
    windows.find((w) => windowOffset(w) === 1 && (w.value ?? 0) > 0)?.value ?? undefined;
  if (baseline == null) {
    for (const w of windows) {
      const mo = windowOffset(w);
      if (mo > 1 && (w.value ?? 0) > 0) {
        baseline = w.value;
        break;
      }
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
