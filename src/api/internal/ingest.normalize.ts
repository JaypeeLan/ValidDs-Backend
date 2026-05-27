/** Normalize scraper payloads to satisfy strict Mongoose schemas on ingest. */

function numOrZero(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function scaleEngagementScore(score: unknown): number {
  const s = numOrZero(score);
  if (s <= 5) return Math.min(5, Math.max(0, s));
  if (s >= 80) return 5;
  if (s >= 60) return 4;
  if (s >= 40) return 3;
  if (s >= 20) return 2;
  if (s >= 5) return 1;
  return 0;
}

function normalizeSuppliers(suppliers: unknown): unknown[] {
  if (!Array.isArray(suppliers)) return [];
  const now = new Date();
  return suppliers.map((s) => {
    if (!s || typeof s !== 'object') return s;
    const row = { ...(s as Record<string, unknown>) };
    row.monthlyTraffic = numOrZero(row.monthlyTraffic);
    row.productUnitsSold = numOrZero(row.productUnitsSold);
    row.estimatedMonthlyRevenue = numOrZero(row.estimatedMonthlyRevenue);
    row.revenueSource = row.revenueSource ?? 'traffic-estimate';
    row.competitorScore = numOrZero(row.competitorScore);
    if (row.rating == null) row.rating = 0;
    if (!row.fetchedAt) row.fetchedAt = now;
    if (!row.checkedAt) row.checkedAt = now;
    return row;
  });
}

function normalizeAiIntelligence(ai: unknown): Record<string, unknown> {
  const base =
    ai && typeof ai === 'object' ? { ...(ai as Record<string, unknown>) } : {};
  if (!base.buyingSentimentReason) base.buyingSentimentReason = '';
  if (base.buyingSentimentScore == null) base.buyingSentimentScore = 0;
  if (!base.extractedAt) base.extractedAt = new Date();
  if (!base.confidenceReason) base.confidenceReason = 'Scraper ingest';
  if (base.confidence == null) base.confidence = 50;
  return base;
}

function normalizeTrends(trends: unknown): Record<string, unknown> {
  const t =
    trends && typeof trends === 'object' ? { ...(trends as Record<string, unknown>) } : {};
  const eng =
    t.engagement && typeof t.engagement === 'object'
      ? { ...(t.engagement as Record<string, unknown>) }
      : {};
  eng.score = scaleEngagementScore(eng.score);
  if (!eng.direction) eng.direction = 'unknown';
  if (eng.isTrending == null) eng.isTrending = false;
  if (!eng.calculatedAt) eng.calculatedAt = new Date();
  t.engagement = eng;
  return t;
}

function normalizeProductTrend(pt: unknown): Record<string, unknown> | null {
  if (!pt || typeof pt !== 'object') return null;
  const row = { ...(pt as Record<string, unknown>) };
  row.score = scaleEngagementScore(row.score);
  return row;
}

export function normalizeProductPayload(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    ...raw,
    suppliers: normalizeSuppliers(raw.suppliers),
    aiIntelligence: normalizeAiIntelligence(raw.aiIntelligence),
    trends: normalizeTrends(raw.trends),
  };
}

function normalizeRelatedVideos(related: unknown): unknown[] {
  if (!Array.isArray(related)) return [];
  return related.map((rv) => {
    if (!rv || typeof rv !== 'object') return rv;
    const row = { ...(rv as Record<string, unknown>) };
    const postUrl = String(row.tiktokPostUrl ?? '');
    const creator =
      row.creator && typeof row.creator === 'object'
        ? { ...(row.creator as Record<string, unknown>) }
        : {};
    if (postUrl && !creator.tiktokPostUrl) {
      creator.tiktokPostUrl = postUrl;
    }
    row.creator = creator;
    return row;
  });
}

export function normalizeCreativePayload(raw: Record<string, unknown>): Record<string, unknown> {
  const out = { ...raw };
  const pt = normalizeProductTrend(raw.productTrend);
  if (pt) out.productTrend = pt;
  const creator =
    out.creator && typeof out.creator === 'object'
      ? { ...(out.creator as Record<string, unknown>) }
      : {};
  const rootPostUrl = String(out.tiktokPostUrl ?? '');
  if (rootPostUrl && !creator.tiktokPostUrl) {
    creator.tiktokPostUrl = rootPostUrl;
  }
  out.creator = creator;
  out.relatedVideos = normalizeRelatedVideos(out.relatedVideos);
  return out;
}
