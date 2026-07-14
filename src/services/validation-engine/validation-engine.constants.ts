/**
 * Tunable V1 thresholds for Validation Engine.
 *
 * Fields USED for scoring:
 * - salesTrend.windows, revenueTrend.windows (cumulative daily snapshots)
 * - soldCount, totalSales, totalGmv, price
 * - rating, reviewCount, aiIntelligence.buyingSentimentScore/Label, reviewSummary (caveats)
 * - creativeCounts, related creatives metrics.*, isAd===true, estimatedVideoGmv, ingestedAt
 * - lastIngestedAt, dataSourceUpdatedAt, updatedAt, publishedAt (freshness/recency only)
 *
 * Fields EXCLUDED from scoring:
 * - suppliers / COGS / margin / shipping / Teemdrop-Alibaba links
 * - creative metrics.fetchedAt
 * - isAd=false as organic proof
 * - changePercent as primary growth metric
 */

export const OPPORTUNITY_WEIGHTS = {
  demand: 0.3,
  momentum: 0.25,
  saturation: 0.2,
  trust: 0.15,
  confidence: 0.1,
} as const;

/** Below this confidence → opportunityScore is null. */
export const MIN_CONFIDENCE_TO_SCORE = 35;

export const BAND_THRESHOLDS = {
  excellent: 80,
  strong: 65,
  moderate: 45,
} as const;

export const VERDICT_SCORE_THRESHOLDS = {
  strong_test: 85,
  test_carefully: 70,
  needs_more_proof: 55,
} as const;

export const STALE_TREND_DAYS = 7;

/** Preferred available-window cascade (days). */
export const WINDOW_CANDIDATES = [30, 14, 7, 3, 1] as const;

export const DEMAND_THRESHOLDS = {
  lowTicketMax: 30,
  highTicketMin: 50,
  /** Lifetime units: weak / moderate / strong floors by ticket band. */
  lifetimeUnits: {
    low: { weak: 50, moderate: 200, strong: 1000 },
    mid: { weak: 30, moderate: 100, strong: 500 },
    high: { weak: 10, moderate: 40, strong: 150 },
  },
  /** Recent window units floors (applied to best available window). */
  recentUnits: {
    low: { weak: 20, moderate: 80, strong: 300 },
    mid: { weak: 10, moderate: 40, strong: 150 },
    high: { weak: 3, moderate: 15, strong: 50 },
  },
  recentGmv: {
    low: { weak: 200, moderate: 1000, strong: 5000 },
    mid: { weak: 300, moderate: 1500, strong: 8000 },
    high: { weak: 400, moderate: 2000, strong: 10000 },
  },
  reviewSupport: { weak: 5, moderate: 25, strong: 100 },
} as const;

export const SATURATION_THRESHOLDS = {
  lowProofMax: 1,
  earlyMax: 5,
  validatedMax: 15,
  competitiveMax: 40,
  heavyAdShare: 0.5,
  oneVideoShare: 0.7,
} as const;

export const TRUST_THRESHOLDS = {
  ratingStrong: 4.3,
  ratingModerate: 3.8,
  ratingWeak: 3.2,
  reviewStrong: 50,
  reviewModerate: 15,
  reviewWeak: 5,
  sentimentStrong: 65,
  sentimentWeak: 40,
} as const;

export const VERDICT_CAPS = {
  lowConfidenceMax: 'needs_more_proof' as const,
  lowConfidenceThreshold: 50,
  weakTrustMax: 'test_carefully' as const,
  weakTrustThreshold: 40,
  weakMomentumThreshold: 35,
  strongDemandForMomentumOverride: 65,
} as const;
