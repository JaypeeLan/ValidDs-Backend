import type { ScoreBand, ValidationScoreModule } from '../../types/validation-engine.types';
import { BAND_THRESHOLDS } from './validation-engine.constants';

export function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function scoreBand(score: number | null): ScoreBand {
  if (score == null || !Number.isFinite(score)) return 'unknown';
  if (score >= BAND_THRESHOLDS.excellent) return 'excellent';
  if (score >= BAND_THRESHOLDS.strong) return 'strong';
  if (score >= BAND_THRESHOLDS.moderate) return 'moderate';
  return 'weak';
}

export function bandLabel(prefix: string, band: ScoreBand): string {
  switch (band) {
    case 'excellent':
      return `Excellent ${prefix}`;
    case 'strong':
      return `Strong ${prefix}`;
    case 'moderate':
      return `Moderate ${prefix}`;
    case 'weak':
      return `Weak ${prefix}`;
    default:
      return `Unknown ${prefix}`;
  }
}

export function emptyModule(
  prefix: string,
  reason: string,
  missingInputs: string[],
  caveats: string[] = [],
): ValidationScoreModule {
  return {
    score: null,
    band: 'unknown',
    label: bandLabel(prefix, 'unknown'),
    reason,
    inputsUsed: [],
    missingInputs,
    caveats,
  };
}

export function moduleFromScore(
  prefix: string,
  score: number | null,
  reason: string,
  inputsUsed: string[],
  missingInputs: string[],
  caveats: string[] = [],
): ValidationScoreModule {
  if (score == null) {
    return emptyModule(prefix, reason, missingInputs, caveats);
  }
  const clamped = clampScore(score);
  const band = scoreBand(clamped);
  return {
    score: clamped,
    band,
    label: bandLabel(prefix, band),
    reason,
    inputsUsed,
    missingInputs,
    caveats,
  };
}
