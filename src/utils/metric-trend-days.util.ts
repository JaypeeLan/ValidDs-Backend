/** Day-based sales/revenue trend windows — keep in sync with scraper/pipeline/metric_trend_util.py */
export const METRIC_TREND_DAY_OFFSETS = [0, 3, 7, 30, 60, 90] as const;
export const METRIC_TREND_MILESTONES = [3, 7, 30, 60, 90] as const;

const PREV_MILESTONE_SOURCE: Record<number, number> = {
  7: 3,
  30: 7,
  60: 30,
  90: 60,
};

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

export function metricTrendLastMilestone(doc: Record<string, unknown>): number {
  const raw = Number(doc.metricTrendLastMilestone ?? 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return (METRIC_TREND_MILESTONES as readonly number[]).includes(raw) ? raw : 0;
}

export function nextDueMilestone(
  productAgeDays: number | null | undefined,
  lastMilestone: number,
): number | null {
  if (productAgeDays == null || !Number.isFinite(productAgeDays)) return null;
  for (const milestone of METRIC_TREND_MILESTONES) {
    if (productAgeDays >= milestone && lastMilestone < milestone) return milestone;
  }
  return null;
}

export function rollSnapshotsAtMilestone(
  snaps: Map<number, number>,
  milestone: number,
): Map<number, number> {
  if (!(METRIC_TREND_MILESTONES as readonly number[]).includes(milestone)) {
    return new Map(snaps);
  }
  const out = new Map(snaps);
  const oldToday = out.get(0) ?? 0;
  if (milestone === 3) {
    if (oldToday > 0) out.set(3, oldToday);
    return out;
  }
  const prev = PREV_MILESTONE_SOURCE[milestone];
  let src = out.get(prev) ?? 0;
  if (src <= 0 && oldToday > 0) src = oldToday;
  if (src > 0) out.set(milestone, src);
  if (oldToday > 0) out.set(3, oldToday);
  return out;
}

export function snapshotsFromTrend(trend: unknown): Map<number, number> {
  const out = new Map<number, number>();
  if (!trend || typeof trend !== 'object') return out;
  const windows = (trend as { windows?: unknown }).windows;
  if (!Array.isArray(windows)) return out;
  for (const w of windows) {
    if (!w || typeof w !== 'object') continue;
    const offset = snapshotOffsetFromWindow(w as Record<string, unknown>);
    const value = Number((w as { value?: unknown }).value);
    if (offset == null || !Number.isFinite(value) || value < 0) continue;
    out.set(offset, value);
  }
  return out;
}

function parseRecordedAt(raw: unknown): Date | null {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    const dt = new Date(raw);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  return null;
}

export function productAgeDays(doc: Record<string, unknown>): number | null {
  for (const key of ['createdAt', 'ingestedAt', 'lastIngestedAt']) {
    const dt = parseRecordedAt(doc[key]);
    if (dt) {
      return Math.max(0, Math.floor((Date.now() - dt.getTime()) / 86_400_000));
    }
  }
  return null;
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
