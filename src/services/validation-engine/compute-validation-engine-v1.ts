import type { IMetricTrend } from '../../types/product.types';
import {
  VALIDATION_ENGINE_VERSION,
  type ValidationEngineResult,
} from '../../types/validation-engine.types';
import { buildNextStep, buildReasons } from './next-step';
import { buildRiskFlags } from './risk-flags';
import { scoreConfidence } from './score-confidence';
import { scoreDemand } from './score-demand';
import { scoreMomentum } from './score-momentum';
import { scoreSaturation } from './score-saturation';
import { scoreTrust } from './score-trust';
import { calculateSalesAndGmvDeltas } from './trend-windows';
import { calculateOpportunityScore, mapVerdict, VERDICT_LABELS } from './verdict';

export interface ValidationProductInput {
  soldCount?: number | null;
  totalSales?: number | null;
  totalGmv?: number | null;
  reviewCount?: number | null;
  rating?: number | null;
  price?: number | null;
  salesTrend?: IMetricTrend | null;
  revenueTrend?: IMetricTrend | null;
  creativeCounts?: {
    ads?: number | null;
    organic?: number | null;
    reviews?: number | null;
    total?: number | null;
  } | null;
  relatedVideosCount?: number | null;
  lastIngestedAt?: Date | string | null;
  dataSourceUpdatedAt?: Date | string | null;
  updatedAt?: Date | string | null;
  publishedAt?: Date | string | null;
  aiIntelligence?: {
    buyingSentimentScore?: number | null;
    buyingSentimentLabel?: string | null;
    reviewSummary?: { summary?: string | null } | null;
  } | null;
  aiInsight?: {
    buyingSentimentScore?: number | null;
    buyingSentimentLabel?: string | null;
    reviewSummary?: { summary?: string | null } | null;
  } | null;
}

export interface ValidationCreativeInput {
  isAd?: boolean | null;
  estimatedVideoGmv?: number | null;
  metrics?: {
    viewCount?: number | null;
    likeCount?: number | null;
    commentCount?: number | null;
    shareCount?: number | null;
  } | null;
  ingestedAt?: Date | string | null;
}

export interface ComputeValidationEngineV1Input {
  product: ValidationProductInput;
  creatives?: ValidationCreativeInput[];
  now?: Date;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  }
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/**
 * Deterministic Validation Engine V1.
 * Trend windows are interpreted as cumulative daily snapshots.
 */
export function computeValidationEngineV1(
  input: ComputeValidationEngineV1Input,
): ValidationEngineResult {
  const now = input.now ?? new Date();
  const product = input.product;
  const creatives = input.creatives ?? [];

  const { sales, gmv, mergedCoverage } = calculateSalesAndGmvDeltas(
    product.salesTrend,
    product.revenueTrend,
  );

  const demand = scoreDemand(product, sales, gmv);
  const momentum = scoreMomentum(
    sales,
    gmv,
    {
      lastIngestedAt: product.lastIngestedAt,
      dataSourceUpdatedAt: product.dataSourceUpdatedAt,
      updatedAt: product.updatedAt,
    },
    now,
  );
  const saturation = scoreSaturation(product, creatives);
  const trust = scoreTrust(product);

  const hasSalesOrGmv =
    (Number(product.soldCount) || 0) > 0 ||
    (Number(product.totalSales) || 0) > 0 ||
    (Number(product.totalGmv) || 0) > 0 ||
    sales.bestAvailableWindowDays != null ||
    gmv.bestAvailableWindowDays != null;

  const confidence = scoreConfidence({
    salesDeltas: sales,
    gmvDeltas: gmv,
    hasSalesOrGmv,
    hasCreatives: saturation.creativeCount > 0,
    hasReviews: (Number(product.reviewCount) || 0) > 0 || (Number(product.rating) || 0) > 0,
    isStale: momentum.isStale,
    now,
    lastIngestedAt: product.lastIngestedAt ?? product.dataSourceUpdatedAt,
  });

  const riskFlags = buildRiskFlags({
    salesDeltas: sales,
    gmvDeltas: gmv,
    demand,
    momentum,
    saturation,
    trust,
    confidence,
  });

  const opportunityScore = calculateOpportunityScore({
    demand,
    momentum,
    saturation,
    trust,
    confidence,
  });

  const verdict = mapVerdict(
    opportunityScore,
    { demand, momentum, saturation, trust, confidence },
    riskFlags,
  );

  const nextStep = buildNextStep(
    verdict,
    { demand, momentum, saturation, trust, confidence },
    riskFlags,
  );
  const reasons = buildReasons(
    verdict,
    { demand, momentum, saturation, trust, confidence },
    riskFlags,
  );

  const sourceUpdatedAt =
    toIso(product.dataSourceUpdatedAt) ?? toIso(product.lastIngestedAt) ?? toIso(product.updatedAt);

  return {
    version: VALIDATION_ENGINE_VERSION,
    computedAt: now.toISOString(),
    sourceUpdatedAt,
    verdict,
    verdictLabel: VERDICT_LABELS[verdict],
    opportunityScore,
    demand,
    momentum: {
      score: momentum.score,
      band: momentum.band,
      label: momentum.label,
      reason: momentum.reason,
      inputsUsed: momentum.inputsUsed,
      missingInputs: momentum.missingInputs,
      caveats: momentum.caveats,
    },
    saturation: {
      score: saturation.score,
      band: saturation.band,
      label: saturation.label,
      reason: saturation.reason,
      inputsUsed: saturation.inputsUsed,
      missingInputs: saturation.missingInputs,
      caveats: saturation.caveats,
      saturationLabel: saturation.saturationLabel,
    },
    trust: {
      score: trust.score,
      band: trust.band,
      label: trust.label,
      reason: trust.reason,
      inputsUsed: trust.inputsUsed,
      missingInputs: trust.missingInputs,
      caveats: trust.caveats,
    },
    confidence,
    riskFlags,
    reasons,
    nextStep,
    debug: {
      bestAvailableSalesWindowDays: sales.bestAvailableWindowDays,
      bestAvailableGmvWindowDays: gmv.bestAvailableWindowDays,
      salesLast7d: sales.last7d,
      salesPrevious7d: sales.previous7d,
      salesLast30d: sales.last30d,
      gmvLast7d: gmv.last7d,
      gmvPrevious7d: gmv.previous7d,
      gmvLast30d: gmv.last30d,
      creativeCount: saturation.creativeCount,
      adCreativeCount: saturation.adCreativeCount,
      topCreativeGmvShare: saturation.topCreativeGmvShare,
      trendWindowCoverage: mergedCoverage,
    },
  };
}
