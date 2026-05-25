/** Human-readable buying-sentiment bucket for UI chips (Demand, etc.). */
export type SentimentLabel = 'positive' | 'neutral' | 'negative';

export function resolveBuyingSentimentLabel(score: number | undefined | null): SentimentLabel {
  const n = Number(score);
  if (!Number.isFinite(n)) return 'neutral';
  if (n >= 70) return 'positive';
  if (n >= 40) return 'neutral';
  return 'negative';
}
