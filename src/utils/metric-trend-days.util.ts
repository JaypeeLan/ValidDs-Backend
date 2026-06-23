/** Daily sales/revenue trend windows — keep in sync with scraper/pipeline/metric_trend_util.py */
export const METRIC_TREND_DAY_COUNT = 90;
export const METRIC_TREND_DAY_OFFSETS = Array.from(
  { length: METRIC_TREND_DAY_COUNT },
  (_, i) => i,
) as number[];

const LEGACY_MILESTONE_OFFSETS = new Set([0, 3, 7, 30, 60, 90]);

const MONTHS_AGO_TO_DAYS: Record<number, number> = {
  0: 0,
  1: 30,
  2: 60,
  3: 90,
};

function utcTodayMs(now = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function dayWindowLabel(daysAgo: number, now = Date.now()): string {
  const dayMs = utcTodayMs(now) - daysAgo * 86_400_000;
  return new Date(dayMs).toISOString().slice(0, 10);
}

export function todayRollDate(now = Date.now()): string {
  return new Date(utcTodayMs(now)).toISOString().slice(0, 10);
}

export function defaultMetricTrendWindows(currentValue = 0, now = Date.now()) {
  return METRIC_TREND_DAY_OFFSETS.map((daysAgo) => ({
    label: dayWindowLabel(daysAgo, now),
    daysAgo,
    value: daysAgo === 0 ? Math.max(0, currentValue) : 0,
  }));
}

export function metricTrendLastRollDate(doc: Record<string, unknown>): string | null {
  const raw = doc.metricTrendLastRollDate;
  if (raw == null) return null;
  const s = String(raw).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

export function isDailyRollDue(doc: Record<string, unknown>, now = Date.now()): boolean {
  const last = metricTrendLastRollDate(doc);
  if (last == null) {
    const legacy = Number(doc.metricTrendLastMilestone ?? 0);
    return Number.isFinite(legacy) && legacy > 0;
  }
  return last < todayRollDate(now);
}

export function rollSnapshotsDaily(snaps: Map<number, number>): Map<number, number> {
  const out = new Map<number, number>();
  const maxIdx = METRIC_TREND_DAY_COUNT - 1;
  for (const [daysAgo, val] of snaps) {
    if (daysAgo < 0 || daysAgo > maxIdx || daysAgo >= maxIdx) continue;
    out.set(daysAgo + 1, val);
  }
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
  const monthsAgo = w.monthsAgo;
  if (typeof monthsAgo === 'number' && MONTHS_AGO_TO_DAYS[monthsAgo] != null) {
    const mapped = MONTHS_AGO_TO_DAYS[monthsAgo];
    return mapped < METRIC_TREND_DAY_COUNT ? mapped : null;
  }
  const daysAgo = w.daysAgo;
  if (typeof daysAgo === 'number') {
    if ((METRIC_TREND_DAY_OFFSETS as readonly number[]).includes(daysAgo)) return daysAgo;
    if (LEGACY_MILESTONE_OFFSETS.has(daysAgo)) return daysAgo;
  }
  const label = String(w.label ?? '').trim();
  const daily = /^(\d{4})-(\d{2})-(\d{2})$/.exec(label);
  if (daily) {
    const bucket = Date.UTC(Number(daily[1]), Number(daily[2]) - 1, Number(daily[3]));
    const ageDays = Math.max(0, Math.floor((utcTodayMs() - bucket) / 86_400_000));
    return ageDays < METRIC_TREND_DAY_COUNT ? ageDays : null;
  }
  const monthly = /^(\d{4})-(\d{2})/.exec(label);
  if (monthly) {
    const bucket = Date.UTC(Number(monthly[1]), Number(monthly[2]) - 1, 1);
    const ageDays = Math.max(0, Math.floor((utcTodayMs() - bucket) / 86_400_000));
    return ageDays < METRIC_TREND_DAY_COUNT ? ageDays : null;
  }
  return null;
}
