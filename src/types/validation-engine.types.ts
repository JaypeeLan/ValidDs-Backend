/** Validation Engine V1 — backend-owned product opportunity validation. */

export type ValidationVerdict =
  | 'strong_test'
  | 'test_carefully'
  | 'needs_more_proof'
  | 'avoid_for_now';

export type ScoreBand = 'excellent' | 'strong' | 'moderate' | 'weak' | 'unknown';

export type RiskSeverity = 'info' | 'caution' | 'serious';

export type SaturationLabel =
  | 'low_proof'
  | 'early_opportunity'
  | 'validated_opportunity'
  | 'competitive'
  | 'crowded_late'
  | 'unknown';

export interface ValidationRiskFlag {
  code: string;
  severity: RiskSeverity;
  label: string;
  reason: string;
}

export interface ValidationScoreModule {
  score: number | null;
  band: ScoreBand;
  label: string;
  reason: string;
  inputsUsed: string[];
  missingInputs: string[];
  caveats: string[];
}

export interface ValidationSaturationModule extends ValidationScoreModule {
  saturationLabel: SaturationLabel;
}

export interface ValidationTrendWindowCoverage {
  hasToday: boolean;
  has7d: boolean;
  has14d: boolean;
  has30d: boolean;
}

export interface ValidationEngineDebug {
  bestAvailableSalesWindowDays?: number | null;
  bestAvailableGmvWindowDays?: number | null;
  salesLast7d?: number | null;
  salesPrevious7d?: number | null;
  salesLast30d?: number | null;
  gmvLast7d?: number | null;
  gmvPrevious7d?: number | null;
  gmvLast30d?: number | null;
  creativeCount?: number | null;
  adCreativeCount?: number | null;
  topCreativeGmvShare?: number | null;
  trendWindowCoverage?: ValidationTrendWindowCoverage;
}

export interface ValidationEngineResult {
  version: 'validds-validation-v1.0';
  computedAt: string;
  sourceUpdatedAt: string | null;
  verdict: ValidationVerdict;
  verdictLabel: string;
  opportunityScore: number | null;
  demand: ValidationScoreModule;
  momentum: ValidationScoreModule;
  saturation: ValidationSaturationModule;
  trust: ValidationScoreModule;
  confidence: ValidationScoreModule;
  riskFlags: ValidationRiskFlag[];
  reasons: string[];
  nextStep: string;
  debug?: ValidationEngineDebug;
}

export const VALIDATION_ENGINE_VERSION = 'validds-validation-v1.0' as const;
