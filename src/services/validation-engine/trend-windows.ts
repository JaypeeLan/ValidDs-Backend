import type { IMetricTrend, IMetricTrendWindow } from '../../types/product.types';
import type { ValidationTrendWindowCoverage } from '../../types/validation-engine.types';
import { WINDOW_CANDIDATES } from './validation-engine.constants';

export interface TrendValueLookup {
  value: number;
  daysAgo: number;
  exact: boolean;
}

export interface WindowDelta {
  days: number;
  delta: number;
  rawDelta: number;
  negativeClamped: boolean;
  usedNearestOlder: boolean;
  caveats: string[];
}

export interface TrendDeltas {
  coverage: ValidationTrendWindowCoverage;
  availableWindowDays: number[];
  bestAvailableWindowDays: number | null;
  last7d: number | null;
  previous7d: number | null;
  last30d: number | null;
  windowDeltas: WindowDelta[];
  hasInconsistency: boolean;
  caveats: string[];
  shallowHistory: boolean;
}

function asWindows(trend: IMetricTrend | null | undefined): IMetricTrendWindow[] {
  if (!trend || !Array.isArray(trend.windows)) return [];
  return trend.windows.filter(
    (w) => w && typeof w === 'object' && Number.isFinite(Number(w.daysAgo)),
  );
}

/** Exact daysAgo match only (preferred). Today allows 0; older requires value present. */
export function getTrendValueAt(
  windows: IMetricTrendWindow[],
  daysAgo: number,
): TrendValueLookup | null {
  const hit = windows.find((w) => Number(w.daysAgo) === daysAgo);
  if (!hit) return null;
  const value = Number(hit.value);
  if (!Number.isFinite(value) || value < 0) return null;
  // Older cumulative snapshots of 0 usually mean "no history yet", not a usable baseline.
  if (daysAgo > 0 && value <= 0) return null;
  return { value, daysAgo, exact: true };
}

/**
 * Prefer exact offset. Optionally fall back to nearest older (larger daysAgo) with value > 0.
 * Today (0) never uses fallback.
 */
export function getTrendValueAtOrBefore(
  windows: IMetricTrendWindow[],
  daysAgo: number,
  allowNearestOlder = false,
): TrendValueLookup | null {
  const exact = getTrendValueAt(windows, daysAgo);
  if (exact) return exact;
  if (!allowNearestOlder || daysAgo <= 0) return null;

  let best: TrendValueLookup | null = null;
  for (const w of windows) {
    const offset = Number(w.daysAgo);
    const value = Number(w.value);
    if (!Number.isFinite(offset) || offset < daysAgo) continue;
    if (!Number.isFinite(value) || value <= 0) continue;
    if (!best || offset < best.daysAgo) {
      best = { value, daysAgo: offset, exact: false };
    }
  }
  return best;
}

export function getTrendCoverage(windows: IMetricTrendWindow[]): ValidationTrendWindowCoverage {
  return {
    hasToday: getTrendValueAt(windows, 0) != null,
    has7d: getTrendValueAt(windows, 7) != null,
    has14d: getTrendValueAt(windows, 14) != null,
    has30d: getTrendValueAt(windows, 30) != null,
  };
}

function computeWindowDelta(
  windows: IMetricTrendWindow[],
  days: number,
  metricLabel: string,
): WindowDelta | null {
  const today = getTrendValueAt(windows, 0);
  if (!today) return null;

  const past = getTrendValueAtOrBefore(windows, days, false);
  if (!past) return null;

  const rawDelta = today.value - past.value;
  const negativeClamped = rawDelta < 0;
  const delta = Math.max(0, rawDelta);
  const caveats: string[] = [];
  if (!past.exact) {
    caveats.push(
      `${metricLabel} ${days}d window used nearest older snapshot at daysAgo=${past.daysAgo}.`,
    );
  }
  if (negativeClamped) {
    caveats.push(`${metricLabel} ${days}d raw delta was negative (${rawDelta}); clamped to 0.`);
  }
  return {
    days,
    delta,
    rawDelta,
    negativeClamped,
    usedNearestOlder: !past.exact,
    caveats,
  };
}

export function calculateAvailableWindows(
  windows: IMetricTrendWindow[],
  candidates: readonly number[] = WINDOW_CANDIDATES,
): number[] {
  const available: number[] = [];
  for (const days of candidates) {
    if (computeWindowDelta(windows, days, 'metric')) {
      available.push(days);
    }
  }
  return available;
}

export function calculateTrendDeltas(
  trend: IMetricTrend | null | undefined,
  metricLabel: string,
): TrendDeltas {
  const windows = asWindows(trend);
  const coverage = getTrendCoverage(windows);
  const caveats: string[] = [];
  const windowDeltas: WindowDelta[] = [];
  let hasInconsistency = false;

  for (const days of WINDOW_CANDIDATES) {
    const d = computeWindowDelta(windows, days, metricLabel);
    if (!d) continue;
    windowDeltas.push(d);
    caveats.push(...d.caveats);
    if (d.negativeClamped) hasInconsistency = true;
  }

  const availableWindowDays = windowDeltas.map((d) => d.days);
  const bestAvailableWindowDays = availableWindowDays[0] ?? null;

  const byDays = (n: number) => windowDeltas.find((d) => d.days === n)?.delta ?? null;

  const last7d = byDays(7);
  // Previous 7d = value at 7 minus value at 14 (cumulative)
  let previous7d: number | null = null;
  const at7 = getTrendValueAt(windows, 7);
  const at14 = getTrendValueAt(windows, 14);
  if (at7 && at14) {
    const raw = at7.value - at14.value;
    if (raw < 0) {
      hasInconsistency = true;
      caveats.push(`${metricLabel} previous-7d raw delta was negative (${raw}); clamped to 0.`);
      previous7d = 0;
    } else {
      previous7d = raw;
    }
  }

  const last30d = byDays(30);
  const shallowHistory =
    bestAvailableWindowDays != null && bestAvailableWindowDays < 7
      ? true
      : bestAvailableWindowDays == null && windows.length > 0;

  if (shallowHistory && bestAvailableWindowDays != null) {
    caveats.push(
      `${metricLabel} history is shallow; best available window is ${bestAvailableWindowDays}d.`,
    );
  }

  return {
    coverage,
    availableWindowDays,
    bestAvailableWindowDays,
    last7d,
    previous7d,
    last30d,
    windowDeltas,
    hasInconsistency,
    caveats,
    shallowHistory,
  };
}

export function calculateSalesAndGmvDeltas(
  salesTrend: IMetricTrend | null | undefined,
  revenueTrend: IMetricTrend | null | undefined,
): {
  sales: TrendDeltas;
  gmv: TrendDeltas;
  mergedCoverage: ValidationTrendWindowCoverage;
} {
  const sales = calculateTrendDeltas(salesTrend, 'Sales');
  const gmv = calculateTrendDeltas(revenueTrend, 'GMV');
  return {
    sales,
    gmv,
    mergedCoverage: {
      hasToday: sales.coverage.hasToday || gmv.coverage.hasToday,
      has7d: sales.coverage.has7d || gmv.coverage.has7d,
      has14d: sales.coverage.has14d || gmv.coverage.has14d,
      has30d: sales.coverage.has30d || gmv.coverage.has30d,
    },
  };
}
