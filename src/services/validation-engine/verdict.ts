import type {
  ValidationRiskFlag,
  ValidationScoreModule,
  ValidationVerdict,
} from '../../types/validation-engine.types';
import {
  MIN_CONFIDENCE_TO_SCORE,
  OPPORTUNITY_WEIGHTS,
  VERDICT_CAPS,
  VERDICT_SCORE_THRESHOLDS,
} from './validation-engine.constants';

export const VERDICT_LABELS: Record<ValidationVerdict, string> = {
  strong_test: 'Strong test',
  test_carefully: 'Test carefully',
  needs_more_proof: 'Needs more proof',
  avoid_for_now: 'Avoid for now',
};

const VERDICT_RANK: Record<ValidationVerdict, number> = {
  strong_test: 4,
  test_carefully: 3,
  needs_more_proof: 2,
  avoid_for_now: 1,
};

function worse(a: ValidationVerdict, b: ValidationVerdict): ValidationVerdict {
  return VERDICT_RANK[a] <= VERDICT_RANK[b] ? a : b;
}

export function calculateOpportunityScore(modules: {
  demand: ValidationScoreModule;
  momentum: ValidationScoreModule;
  saturation: ValidationScoreModule;
  trust: ValidationScoreModule;
  confidence: ValidationScoreModule;
}): number | null {
  if (modules.confidence.score == null || modules.confidence.score < MIN_CONFIDENCE_TO_SCORE) {
    return null;
  }

  const parts: Array<{ weight: number; score: number }> = [];
  const entries: Array<[keyof typeof OPPORTUNITY_WEIGHTS, ValidationScoreModule]> = [
    ['demand', modules.demand],
    ['momentum', modules.momentum],
    ['saturation', modules.saturation],
    ['trust', modules.trust],
    ['confidence', modules.confidence],
  ];

  for (const [key, mod] of entries) {
    if (mod.score == null) continue;
    parts.push({ weight: OPPORTUNITY_WEIGHTS[key], score: mod.score });
  }

  if (parts.length === 0) return null;

  const weightSum = parts.reduce((s, p) => s + p.weight, 0);
  if (weightSum <= 0) return null;

  const raw = parts.reduce((s, p) => s + p.score * p.weight, 0) / weightSum;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

function baseVerdict(score: number | null): ValidationVerdict {
  if (score == null) return 'needs_more_proof';
  if (score >= VERDICT_SCORE_THRESHOLDS.strong_test) return 'strong_test';
  if (score >= VERDICT_SCORE_THRESHOLDS.test_carefully) return 'test_carefully';
  if (score >= VERDICT_SCORE_THRESHOLDS.needs_more_proof) return 'needs_more_proof';
  return 'avoid_for_now';
}

export function mapVerdict(
  opportunityScore: number | null,
  modules: {
    demand: ValidationScoreModule;
    momentum: ValidationScoreModule;
    saturation: ValidationScoreModule & { saturationLabel?: string };
    trust: ValidationScoreModule;
    confidence: ValidationScoreModule;
  },
  riskFlags: ValidationRiskFlag[],
): ValidationVerdict {
  let verdict = baseVerdict(opportunityScore);

  if (
    modules.confidence.score != null &&
    modules.confidence.score < VERDICT_CAPS.lowConfidenceThreshold
  ) {
    verdict = worse(verdict, VERDICT_CAPS.lowConfidenceMax);
  }

  if (modules.trust.score != null && modules.trust.score < VERDICT_CAPS.weakTrustThreshold) {
    verdict = worse(verdict, VERDICT_CAPS.weakTrustMax);
  }

  const demandStrong =
    modules.demand.score != null &&
    modules.demand.score >= VERDICT_CAPS.strongDemandForMomentumOverride;
  if (
    modules.momentum.score != null &&
    modules.momentum.score < VERDICT_CAPS.weakMomentumThreshold &&
    !demandStrong
  ) {
    verdict = worse(verdict, 'needs_more_proof');
  }

  if (riskFlags.some((f) => f.code === 'trend_data_inconsistency')) {
    verdict = worse(verdict, 'test_carefully');
  }

  const crowded =
    modules.saturation.saturationLabel === 'crowded_late' ||
    modules.saturation.saturationLabel === 'competitive';
  const momentumWeak =
    modules.momentum.score == null || modules.momentum.score < VERDICT_CAPS.weakMomentumThreshold;
  if (crowded && momentumWeak) {
    verdict = worse(verdict, 'needs_more_proof');
  }

  return verdict;
}
