import type {
  SaturationLabel,
  ValidationRiskFlag,
  ValidationScoreModule,
} from '../../types/validation-engine.types';
import type { TrendDeltas } from './trend-windows';

export interface RiskFlagContext {
  salesDeltas: TrendDeltas;
  gmvDeltas: TrendDeltas;
  demand: ValidationScoreModule;
  momentum: ValidationScoreModule & { isStale: boolean };
  saturation: {
    saturationLabel: SaturationLabel;
    heavyAdPressure: boolean;
    oneVideoDependency: boolean;
    crowded: boolean;
    creativeCount: number;
  };
  trust: ValidationScoreModule & { weakTrust: boolean; insufficientReviews: boolean };
  confidence: ValidationScoreModule;
}

export function buildRiskFlags(ctx: RiskFlagContext): ValidationRiskFlag[] {
  const flags: ValidationRiskFlag[] = [];

  if (ctx.salesDeltas.hasInconsistency || ctx.gmvDeltas.hasInconsistency) {
    flags.push({
      code: 'trend_data_inconsistency',
      severity: 'caution',
      label: 'Trend data inconsistency',
      reason:
        'Cumulative trend windows produced a negative delta that was clamped to zero. Treat recent movement with caution.',
    });
  }

  if (ctx.momentum.isStale) {
    flags.push({
      code: 'stale_trend_data',
      severity: 'caution',
      label: 'Trend data may be stale',
      reason:
        'Product trend data has not been refreshed recently enough for a high-confidence momentum read.',
    });
  }

  if (ctx.confidence.score != null && ctx.confidence.score < 50) {
    flags.push({
      code: 'low_confidence',
      severity: 'caution',
      label: 'Low validation confidence',
      reason: 'Evidence coverage is too thin to treat this opportunity score as definitive.',
    });
  }

  if (ctx.saturation.saturationLabel === 'low_proof' || ctx.saturation.creativeCount < 2) {
    flags.push({
      code: 'low_creative_proof',
      severity: 'info',
      label: 'Low creative proof',
      reason: 'There is limited creative evidence validating market interest.',
    });
  }

  if (ctx.saturation.heavyAdPressure) {
    flags.push({
      code: 'heavy_ad_pressure',
      severity: 'caution',
      label: 'Heavy ad pressure',
      reason: 'A large share of creatives are paid ads, which raises competition risk.',
    });
  }

  if (ctx.saturation.oneVideoDependency) {
    flags.push({
      code: 'one_video_dependency',
      severity: 'serious',
      label: 'One-video dependency',
      reason:
        'Estimated video GMV is concentrated in a single creative, making the opportunity fragile.',
    });
  }

  if (ctx.saturation.crowded || ctx.saturation.saturationLabel === 'crowded_late') {
    flags.push({
      code: 'crowded_market',
      severity: 'caution',
      label: 'Crowded market',
      reason: 'Creative volume or ad pressure suggests the niche may already be crowded.',
    });
  }

  if (ctx.trust.weakTrust || (ctx.trust.score != null && ctx.trust.score < 40)) {
    flags.push({
      code: 'weak_trust_signals',
      severity: 'serious',
      label: 'Weak trust signals',
      reason: 'Rating or buying sentiment signals do not strongly support testing.',
    });
  }

  if (ctx.trust.insufficientReviews) {
    flags.push({
      code: 'insufficient_review_volume',
      severity: 'info',
      label: 'Insufficient review volume',
      reason: 'Review count is too low to strongly validate customer quality.',
    });
  }

  if (
    ctx.momentum.score == null ||
    ctx.momentum.score < 40 ||
    (ctx.salesDeltas.last7d == null &&
      ctx.gmvDeltas.last7d == null &&
      ctx.salesDeltas.bestAvailableWindowDays == null &&
      ctx.gmvDeltas.bestAvailableWindowDays == null)
  ) {
    flags.push({
      code: 'missing_recent_momentum',
      severity: 'caution',
      label: 'Missing recent momentum',
      reason:
        'Recent sales/GMV movement is weak, missing, or too shallow to confirm demand is alive.',
    });
  }

  return flags;
}
