import type { ValidationScoreModule } from '../../types/validation-engine.types';
import { moduleFromScore } from './bands';
import { STALE_TREND_DAYS } from './validation-engine.constants';
import type { TrendDeltas } from './trend-windows';

export interface MomentumFreshnessInput {
  lastIngestedAt?: Date | string | null;
  dataSourceUpdatedAt?: Date | string | null;
  updatedAt?: Date | string | null;
}

function ageDays(value: Date | string | null | undefined, now: Date): number | null {
  if (value == null) return null;
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!Number.isFinite(t)) return null;
  return (now.getTime() - t) / (1000 * 60 * 60 * 24);
}

function growthRatio(last: number, prev: number): number {
  if (prev <= 0) return last > 0 ? 2 : 0;
  return last / prev;
}

export function scoreMomentum(
  salesDeltas: TrendDeltas,
  gmvDeltas: TrendDeltas,
  freshness: MomentumFreshnessInput,
  now: Date,
): ValidationScoreModule & { isStale: boolean } {
  const inputsUsed: string[] = [];
  const missingInputs: string[] = [];
  const caveats: string[] = [];

  if (salesDeltas.bestAvailableWindowDays != null) inputsUsed.push('salesTrend.windows');
  else missingInputs.push('salesTrend.windows');
  if (gmvDeltas.bestAvailableWindowDays != null) inputsUsed.push('revenueTrend.windows');
  else missingInputs.push('revenueTrend.windows');

  const ingestAge = ageDays(freshness.lastIngestedAt ?? freshness.dataSourceUpdatedAt, now);
  const updateAge = ageDays(freshness.updatedAt, now);
  if (freshness.lastIngestedAt) inputsUsed.push('lastIngestedAt');
  else if (freshness.dataSourceUpdatedAt) inputsUsed.push('dataSourceUpdatedAt');
  else missingInputs.push('lastIngestedAt');

  const isStale =
    (ingestAge != null && ingestAge > STALE_TREND_DAYS) ||
    (updateAge != null && updateAge > STALE_TREND_DAYS * 2);

  if (isStale) {
    caveats.push('Product trend data may be stale relative to the validation timestamp.');
  }

  const salesLast = salesDeltas.last7d;
  const salesPrev = salesDeltas.previous7d;
  const gmvLast = gmvDeltas.last7d;
  const gmvPrev = gmvDeltas.previous7d;

  const hasPair = (salesLast != null && salesPrev != null) || (gmvLast != null && gmvPrev != null);

  const bestDays = salesDeltas.bestAvailableWindowDays ?? gmvDeltas.bestAvailableWindowDays ?? null;
  const bestSalesDelta =
    bestDays != null ? salesDeltas.windowDeltas.find((d) => d.days === bestDays)?.delta : undefined;
  const bestGmvDelta =
    bestDays != null ? gmvDeltas.windowDeltas.find((d) => d.days === bestDays)?.delta : undefined;

  if (salesLast == null && gmvLast == null && bestSalesDelta == null && bestGmvDelta == null) {
    return {
      ...moduleFromScore(
        'momentum',
        null,
        'No usable trend windows to score momentum.',
        inputsUsed,
        missingInputs,
        caveats,
      ),
      isStale,
    };
  }

  let score: number;
  let reason: string;

  if (hasPair) {
    const salesRatio =
      salesLast != null && salesPrev != null ? growthRatio(salesLast, salesPrev) : null;
    const gmvRatio = gmvLast != null && gmvPrev != null ? growthRatio(gmvLast, gmvPrev) : null;
    const ratios = [salesRatio, gmvRatio].filter((r): r is number => r != null);
    const ratio = ratios.reduce((a, b) => a + b, 0) / ratios.length;

    if (ratio >= 1.5) score = 90;
    else if (ratio >= 1.15) score = 78;
    else if (ratio >= 1.0) score = 62;
    else if (ratio >= 0.75) score = 42;
    else score = 22;

    reason =
      ratio >= 1.15
        ? 'Recent 7-day movement is clearly rising versus the prior 7 days.'
        : ratio >= 1.0
          ? 'Recent 7-day movement is roughly stable to mildly positive.'
          : 'Recent 7-day movement is flat or declining versus the prior window.';

    if (salesDeltas.last30d != null || gmvDeltas.last30d != null) {
      inputsUsed.push('salesLast30d/gmvLast30d');
      const broad = (salesDeltas.last30d ?? 0) > 0 || (gmvDeltas.last30d ?? 0) > 0 ? 1 : 0;
      if (broad) score = Math.min(100, score + 4);
    }
  } else {
    // Shallow / unpaired window: directional but lower confidence.
    const delta = Math.max(bestSalesDelta ?? 0, bestGmvDelta ?? 0);
    if (delta > 0) {
      score = bestDays != null && bestDays >= 7 ? 58 : 48;
      reason = `Positive movement observed on the best available ${bestDays ?? 'short'}d window, without a full prior-period comparison.`;
      caveats.push('Momentum uses a shallow or unpaired window; confidence is reduced.');
    } else {
      score = 25;
      reason = 'Available recent windows show little or no positive movement.';
    }
  }

  if (isStale) score = Math.max(0, score - 18);
  if (salesDeltas.hasInconsistency || gmvDeltas.hasInconsistency) {
    score = Math.max(0, score - 12);
    caveats.push('Trend inconsistency reduced momentum confidence.');
  }

  return {
    ...moduleFromScore('momentum', score, reason, [...new Set(inputsUsed)], missingInputs, caveats),
    isStale,
  };
}
