import type { ValidationScoreModule } from '../../types/validation-engine.types';
import { moduleFromScore } from './bands';
import { TRUST_THRESHOLDS } from './validation-engine.constants';

export interface TrustProductInput {
  rating?: number | null;
  reviewCount?: number | null;
  aiIntelligence?: {
    buyingSentimentScore?: number | null;
    buyingSentimentLabel?: string | null;
    reviewSummary?: { summary?: string | null } | null;
  } | null;
  /** When product detail already reshapes AI into aiInsight */
  aiInsight?: {
    buyingSentimentScore?: number | null;
    buyingSentimentLabel?: string | null;
    reviewSummary?: { summary?: string | null } | null;
  } | null;
}

export function scoreTrust(product: TrustProductInput): ValidationScoreModule & {
  weakTrust: boolean;
  insufficientReviews: boolean;
} {
  const inputsUsed: string[] = [];
  const missingInputs: string[] = [];
  const caveats: string[] = [];

  const rating = Number(product.rating);
  const reviewCount = Number(product.reviewCount) || 0;
  const ai = product.aiIntelligence ?? product.aiInsight;
  const sentiment =
    ai && typeof ai.buyingSentimentScore === 'number' ? ai.buyingSentimentScore : null;
  const sentimentLabel = ai?.buyingSentimentLabel ?? null;
  const hasReviewSummary = Boolean(ai?.reviewSummary?.summary);

  if (Number.isFinite(rating) && rating > 0) inputsUsed.push('rating');
  else missingInputs.push('rating');

  if (reviewCount > 0) inputsUsed.push('reviewCount');
  else missingInputs.push('reviewCount');

  if (sentiment != null) inputsUsed.push('buyingSentimentScore');
  else missingInputs.push('buyingSentimentScore');

  if (hasReviewSummary) inputsUsed.push('reviewSummary');
  // reviewSummary is caveat-only; missing is fine

  const hasAny = (Number.isFinite(rating) && rating > 0) || reviewCount > 0 || sentiment != null;

  if (!hasAny) {
    return {
      ...moduleFromScore(
        'trust',
        null,
        'No usable rating, review, or sentiment data to score trust.',
        inputsUsed,
        missingInputs,
        caveats,
      ),
      weakTrust: false,
      insufficientReviews: true,
    };
  }

  let ratingPart = 50;
  if (Number.isFinite(rating) && rating > 0) {
    if (rating >= TRUST_THRESHOLDS.ratingStrong) ratingPart = 90;
    else if (rating >= TRUST_THRESHOLDS.ratingModerate) ratingPart = 70;
    else if (rating >= TRUST_THRESHOLDS.ratingWeak) ratingPart = 45;
    else ratingPart = 20;
  } else {
    caveats.push('Rating missing; trust relies on reviews/sentiment where available.');
  }

  let volumePart = 35;
  const insufficientReviews = reviewCount < TRUST_THRESHOLDS.reviewWeak;
  if (reviewCount >= TRUST_THRESHOLDS.reviewStrong) volumePart = 90;
  else if (reviewCount >= TRUST_THRESHOLDS.reviewModerate) volumePart = 70;
  else if (reviewCount >= TRUST_THRESHOLDS.reviewWeak) volumePart = 50;
  else if (reviewCount > 0) volumePart = 35;
  else {
    volumePart = 30;
    caveats.push('Low or missing review volume reduces trust certainty.');
  }

  let sentimentPart = 55;
  if (sentiment != null) {
    if (sentiment >= TRUST_THRESHOLDS.sentimentStrong) sentimentPart = 88;
    else if (sentiment >= TRUST_THRESHOLDS.sentimentWeak) sentimentPart = 60;
    else sentimentPart = 25;
    if (sentimentLabel === 'negative') sentimentPart = Math.min(sentimentPart, 30);
  } else {
    caveats.push('Buying sentiment unavailable; trust uses rating and reviews only.');
  }

  // High rating with low reviews is weaker than high rating with volume.
  // Poor ratings dominate even when review volume is high.
  let score: number;
  if (Number.isFinite(rating) && rating > 0 && rating < TRUST_THRESHOLDS.ratingWeak) {
    score = Math.min(38, ratingPart * 0.7 + sentimentPart * 0.3);
  } else {
    const volumeWeight = reviewCount > 0 ? 0.35 : 0.2;
    const ratingWeight = 0.45;
    const sentimentWeight = sentiment != null ? 0.2 : 0.1;
    const totalW = ratingWeight + volumeWeight + sentimentWeight;
    score =
      (ratingPart * ratingWeight + volumePart * volumeWeight + sentimentPart * sentimentWeight) /
      totalW;
  }

  if (insufficientReviews && rating >= TRUST_THRESHOLDS.ratingStrong) {
    score = Math.min(score, 68);
    caveats.push('High rating with low review count is treated as moderate proof.');
  }

  const weakTrust =
    score < 40 || (Number.isFinite(rating) && rating > 0 && rating < TRUST_THRESHOLDS.ratingWeak);

  const reason =
    score >= 65
      ? 'Rating, reviews, and sentiment support testing this product.'
      : score >= 45
        ? 'Some buyer quality signals exist, but proof is incomplete or mixed.'
        : 'Buyer quality signals are weak or concerning.';

  return {
    ...moduleFromScore('trust', score, reason, inputsUsed, missingInputs, caveats),
    weakTrust,
    insufficientReviews,
  };
}
