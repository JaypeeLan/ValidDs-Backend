/** Day-based sales/revenue trend windows — keep in sync with scraper/pipeline/metric_trend_util.py */
export const METRIC_TREND_DAY_OFFSETS = [0, 3, 7, 30, 60, 90] as const;

const MONTHS_AGO_TO_DAYS: Record<number, number> = {
  0: 0,
  1: 30,
  2: 60,
  3: 90,
};

export function dayWindowLabel(daysAgo: number): string {
  return daysAgo === 0 ? 'Today' : `${daysAgo}d ago`;
}

export function defaultMetricTrendWindows(currentValue = 0) {
  return METRIC_TREND_DAY_OFFSETS.map((daysAgo) => ({
    label: dayWindowLabel(daysAgo),
    daysAgo,
    value: daysAgo === 0 ? Math.max(0, currentValue) : 0,
  }));
}

export function snapshotOffsetFromWindow(w: Record<string, unknown>): number | null {
  const daysAgo = w.daysAgo;
  if (
    typeof daysAgo === 'number' &&
    (METRIC_TREND_DAY_OFFSETS as readonly number[]).includes(daysAgo)
  ) {
    return daysAgo;
  }
  const monthsAgo = w.monthsAgo;
  if (typeof monthsAgo === 'number' && MONTHS_AGO_TO_DAYS[monthsAgo] != null) {
    return MONTHS_AGO_TO_DAYS[monthsAgo];
  }
  const label = String(w.label ?? '').trim();
  const m = /^(\d{4})-(\d{2})/.exec(label);
  if (m) {
    const bucket = Date.UTC(Number(m[1]), Number(m[2]) - 1, 1);
    const ageDays = Math.max(0, Math.floor((Date.now() - bucket) / 86_400_000));
    let best: number | null = null;
    let bestDist = 3;
    for (const target of METRIC_TREND_DAY_OFFSETS) {
      if (target === 0) continue;
      const dist = Math.abs(ageDays - target);
      if (dist <= bestDist) {
        best = target;
        bestDist = dist;
      }
    }
    return best;
  }
  return null;
}
