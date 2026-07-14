import type { ValidationScoreModule } from '../../types/validation-engine.types';
import { moduleFromScore } from './bands';
import { STALE_TREND_DAYS } from './validation-engine.constants';
import type { TrendDeltas } from './trend-windows';

export interface ConfidenceContext {
  salesDeltas: TrendDeltas;
  gmvDeltas: TrendDeltas;
  hasSalesOrGmv: boolean;
  hasCreatives: boolean;
  hasReviews: boolean;
  isStale: boolean;
  now: Date;
  lastIngestedAt?: Date | string | null;
}

function ageDays(value: Date | string | null | undefined, now: Date): number | null {
  if (value == null) return null;
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!Number.isFinite(t)) return null;
  return (now.getTime() - t) / (1000 * 60 * 60 * 24);
}

export function scoreConfidence(ctx: ConfidenceContext): ValidationScoreModule {
  const inputsUsed: string[] = [];
  const missingInputs: string[] = [];
  const caveats: string[] = [];

  let points = 40; // baseline so missing-data products stay explainable

  const coverage = {
    hasToday: ctx.salesDeltas.coverage.hasToday || ctx.gmvDeltas.coverage.hasToday,
    has7d: ctx.salesDeltas.coverage.has7d || ctx.gmvDeltas.coverage.has7d,
    has14d: ctx.salesDeltas.coverage.has14d || ctx.gmvDeltas.coverage.has14d,
    has30d: ctx.salesDeltas.coverage.has30d || ctx.gmvDeltas.coverage.has30d,
  };

  if (coverage.hasToday || coverage.has7d || coverage.has14d || coverage.has30d) {
    inputsUsed.push('salesTrend.windows', 'revenueTrend.windows');
    points += 10;
    if (coverage.has7d) points += 8;
    if (coverage.has14d) points += 5;
    if (coverage.has30d) points += 7;
  } else {
    missingInputs.push('trend windows');
    points -= 12;
    caveats.push('Trend windows missing or too shallow for a high-confidence read.');
  }

  if (ctx.salesDeltas.shallowHistory && ctx.gmvDeltas.shallowHistory) {
    points -= 10;
    caveats.push('Available history is shorter than 7 days.');
  }

  if (ctx.hasSalesOrGmv) {
    inputsUsed.push('soldCount/totalSales/totalGmv');
    points += 10;
  } else {
    missingInputs.push('sales or GMV');
    points -= 8;
  }

  if (ctx.hasCreatives) {
    inputsUsed.push('creatives');
    points += 10;
  } else {
    missingInputs.push('creatives');
    points -= 8;
  }

  if (ctx.hasReviews) {
    inputsUsed.push('reviewCount/rating');
    points += 8;
  } else {
    missingInputs.push('review data');
    points -= 6;
  }

  const age = ageDays(ctx.lastIngestedAt, ctx.now);
  if (age != null) {
    inputsUsed.push('lastIngestedAt');
    if (age <= STALE_TREND_DAYS) points += 8;
    else {
      points -= 12;
      caveats.push('Product data freshness is weak.');
    }
  } else {
    missingInputs.push('lastIngestedAt');
  }

  if (ctx.isStale) points -= 8;

  if (ctx.salesDeltas.hasInconsistency || ctx.gmvDeltas.hasInconsistency) {
    points -= 15;
    caveats.push('Inconsistent trend deltas reduced confidence.');
  }

  const score = Math.max(0, Math.min(100, points));
  const reason =
    score >= 65
      ? 'Enough sales, trend, creative, and review evidence to support the validation judgment.'
      : score >= 45
        ? 'Partial evidence supports a cautious validation; key fields are still missing or shallow.'
        : 'Evidence coverage is too thin for a high-confidence opportunity call.';

  return moduleFromScore(
    'confidence',
    score,
    reason,
    [...new Set(inputsUsed)],
    [...new Set(missingInputs)],
    caveats,
  );
}
