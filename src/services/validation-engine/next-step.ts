import type {
  ValidationRiskFlag,
  ValidationScoreModule,
  ValidationVerdict,
} from '../../types/validation-engine.types';

export function buildNextStep(
  verdict: ValidationVerdict,
  modules: {
    demand: ValidationScoreModule;
    momentum: ValidationScoreModule;
    saturation: ValidationScoreModule & { saturationLabel?: string };
    trust: ValidationScoreModule;
    confidence: ValidationScoreModule;
  },
  riskFlags: ValidationRiskFlag[],
): string {
  const codes = new Set(riskFlags.map((f) => f.code));

  if (codes.has('weak_trust_signals')) {
    return 'Review customer complaints before testing this product.';
  }
  if (verdict === 'avoid_for_now') {
    return 'Avoid this product for now because demand proof is weak and competition appears high.';
  }
  if (codes.has('stale_trend_data') || codes.has('missing_recent_momentum')) {
    return 'Watch this product until more recent demand data is available.';
  }
  if (verdict === 'strong_test') {
    return 'Test with a small ad budget and monitor sales movement over the next 7 days.';
  }
  if (verdict === 'test_carefully') {
    return 'Test carefully with a limited budget and validate sourcing manually using the supplier search links before committing more spend.';
  }
  if (modules.saturation.saturationLabel === 'low_proof') {
    return 'Watch this product until more creative proof and recent demand data are available.';
  }
  return 'Needs more proof — re-check after fresher sales and creative data land, and validate sourcing before committing budget.';
}

export function buildReasons(
  verdict: ValidationVerdict,
  modules: {
    demand: ValidationScoreModule;
    momentum: ValidationScoreModule;
    saturation: ValidationScoreModule;
    trust: ValidationScoreModule;
    confidence: ValidationScoreModule;
  },
  riskFlags: ValidationRiskFlag[],
): string[] {
  const reasons: string[] = [];
  if (modules.demand.reason) reasons.push(modules.demand.reason);
  if (modules.momentum.reason) reasons.push(modules.momentum.reason);
  if (modules.saturation.reason) reasons.push(modules.saturation.reason);
  if (modules.trust.score != null && modules.trust.score < 50) {
    reasons.push(modules.trust.reason);
  }
  if (modules.confidence.score != null && modules.confidence.score < 50) {
    reasons.push(modules.confidence.reason);
  }
  for (const flag of riskFlags.slice(0, 3)) {
    reasons.push(flag.reason);
  }
  if (reasons.length === 0) {
    reasons.push(`Validation verdict: ${verdict}.`);
  }
  // De-dupe while preserving order
  return [...new Set(reasons)].slice(0, 6);
}
