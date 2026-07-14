import type { ValidationScoreModule } from '../../types/validation-engine.types';
import { moduleFromScore } from './bands';
import { DEMAND_THRESHOLDS } from './validation-engine.constants';
import type { TrendDeltas } from './trend-windows';

export interface DemandProductInput {
  soldCount?: number | null;
  totalSales?: number | null;
  totalGmv?: number | null;
  reviewCount?: number | null;
  price?: number | null;
}

function ticketBand(price: number): 'low' | 'mid' | 'high' {
  if (price > 0 && price < DEMAND_THRESHOLDS.lowTicketMax) return 'low';
  if (price >= DEMAND_THRESHOLDS.highTicketMin) return 'high';
  return 'mid';
}

function tierScore(
  value: number,
  floors: { weak: number; moderate: number; strong: number },
): number {
  if (value >= floors.strong) return 88;
  if (value >= floors.moderate) return 68;
  if (value >= floors.weak) return 48;
  if (value > 0) return 28;
  return 0;
}

export function scoreDemand(
  product: DemandProductInput,
  salesDeltas: TrendDeltas,
  gmvDeltas: TrendDeltas,
): ValidationScoreModule {
  const inputsUsed: string[] = [];
  const missingInputs: string[] = [];
  const caveats: string[] = [...salesDeltas.caveats, ...gmvDeltas.caveats];

  const price = Number(product.price) || 0;
  if (price > 0) inputsUsed.push('price');

  const soldCount = Number(product.soldCount) || 0;
  const totalSales = Number(product.totalSales) || 0;
  const lifetimeUnits = Math.max(soldCount, totalSales);
  const totalGmv = Number(product.totalGmv) || 0;
  const reviewCount = Number(product.reviewCount) || 0;

  if (soldCount > 0 || totalSales > 0) {
    if (soldCount > 0) inputsUsed.push('soldCount');
    if (totalSales > 0) inputsUsed.push('totalSales');
  } else {
    missingInputs.push('soldCount', 'totalSales');
  }
  if (totalGmv > 0) inputsUsed.push('totalGmv');
  else missingInputs.push('totalGmv');

  if (reviewCount > 0) inputsUsed.push('reviewCount');
  else missingInputs.push('reviewCount');

  const bestSales =
    salesDeltas.bestAvailableWindowDays != null
      ? salesDeltas.windowDeltas.find((d) => d.days === salesDeltas.bestAvailableWindowDays)
      : undefined;
  const bestGmv =
    gmvDeltas.bestAvailableWindowDays != null
      ? gmvDeltas.windowDeltas.find((d) => d.days === gmvDeltas.bestAvailableWindowDays)
      : undefined;

  if (bestSales) inputsUsed.push('salesTrend.windows');
  else missingInputs.push('salesTrend.windows');
  if (bestGmv) inputsUsed.push('revenueTrend.windows');
  else missingInputs.push('revenueTrend.windows');

  const hasAnyEvidence =
    lifetimeUnits > 0 || totalGmv > 0 || reviewCount > 0 || bestSales != null || bestGmv != null;

  if (!hasAnyEvidence) {
    return moduleFromScore(
      'demand',
      null,
      'No usable sales, GMV, or review evidence to score demand.',
      inputsUsed,
      missingInputs,
      caveats,
    );
  }

  const band = ticketBand(price);
  const lifetimeFloors = DEMAND_THRESHOLDS.lifetimeUnits[band];
  const recentUnitFloors = DEMAND_THRESHOLDS.recentUnits[band];
  const recentGmvFloors = DEMAND_THRESHOLDS.recentGmv[band];

  const lifetimeScore = tierScore(lifetimeUnits, lifetimeFloors);
  const gmvLifetimeScore = tierScore(totalGmv, {
    weak: recentGmvFloors.weak * 3,
    moderate: recentGmvFloors.moderate * 3,
    strong: recentGmvFloors.strong * 3,
  });
  const reviewScore = tierScore(reviewCount, DEMAND_THRESHOLDS.reviewSupport);

  let recentScore = 0;
  let hasRecent = false;
  if (bestSales) {
    recentScore = Math.max(recentScore, tierScore(bestSales.delta, recentUnitFloors));
    hasRecent = true;
  }
  if (bestGmv) {
    recentScore = Math.max(recentScore, tierScore(bestGmv.delta, recentGmvFloors));
    hasRecent = true;
  }

  // Recent evidence weighted higher than lifetime when present.
  let score: number;
  if (hasRecent) {
    score =
      recentScore * 0.55 + Math.max(lifetimeScore, gmvLifetimeScore) * 0.3 + reviewScore * 0.15;
  } else {
    score = Math.max(lifetimeScore, gmvLifetimeScore) * 0.7 + reviewScore * 0.3;
    caveats.push('Demand relies on lifetime/snapshot evidence; recent trend windows are missing.');
  }

  if (salesDeltas.shallowHistory || gmvDeltas.shallowHistory) {
    score = Math.min(score, 72);
    caveats.push('Recent demand window is shallow; score capped until more history exists.');
  }

  const reason = hasRecent
    ? 'Product has meaningful sales/GMV proof with recent movement in available trend windows.'
    : 'Product has lifetime sales or review proof, but limited recent trend evidence.';

  return moduleFromScore('demand', score, reason, inputsUsed, [...new Set(missingInputs)], caveats);
}
