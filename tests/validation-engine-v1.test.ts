import {
  computeValidationEngineV1,
  type ValidationCreativeInput,
  type ValidationProductInput,
} from '../src/services/validation-engine';
import { calculateTrendDeltas } from '../src/services/validation-engine/trend-windows';
import type { IMetricTrend } from '../src/types/product.types';

const NOW = new Date('2026-07-14T12:00:00.000Z');

/** Build cumulative daily windows: daysAgo → cumulative value. Missing offsets omitted. */
function cumulativeTrend(points: Record<number, number>): IMetricTrend {
  const windows = Object.entries(points)
    .map(([daysAgo, value]) => ({
      label: `2026-07-${String(14 - Number(daysAgo)).padStart(2, '0')}`,
      daysAgo: Number(daysAgo),
      value,
    }))
    .sort((a, b) => a.daysAgo - b.daysAgo);
  return { direction: 'up', changePercent: 10, windows };
}

function baseProduct(overrides: Partial<ValidationProductInput> = {}): ValidationProductInput {
  return {
    price: 24.99,
    soldCount: 800,
    totalSales: 800,
    totalGmv: 16000,
    rating: 4.6,
    reviewCount: 120,
    lastIngestedAt: new Date('2026-07-13T10:00:00.000Z'),
    dataSourceUpdatedAt: new Date('2026-07-13T10:00:00.000Z'),
    updatedAt: new Date('2026-07-13T10:00:00.000Z'),
    creativeCounts: { ads: 2, organic: 6, reviews: 0, total: 8 },
    relatedVideosCount: 8,
    aiIntelligence: {
      buyingSentimentScore: 72,
      buyingSentimentLabel: 'positive',
      reviewSummary: { summary: 'Customers like the product overall.' },
    },
    salesTrend: cumulativeTrend({
      0: 800,
      1: 790,
      3: 760,
      7: 700,
      14: 620,
      30: 400,
    }),
    revenueTrend: cumulativeTrend({
      0: 16000,
      1: 15800,
      3: 15200,
      7: 14000,
      14: 12400,
      30: 8000,
    }),
    ...overrides,
  };
}

function creative(
  overrides: Partial<ValidationCreativeInput> & { estimatedVideoGmv?: number } = {},
): ValidationCreativeInput {
  return {
    isAd: false,
    estimatedVideoGmv: 1000,
    metrics: { viewCount: 50_000, likeCount: 2000, commentCount: 100, shareCount: 80 },
    ingestedAt: new Date('2026-07-12T00:00:00.000Z'),
    ...overrides,
  };
}

describe('Validation Engine V1 — cumulative trend math', () => {
  it('treats windows as cumulative (last7 = today - day7)', () => {
    const deltas = calculateTrendDeltas(
      cumulativeTrend({ 0: 800, 7: 700, 14: 620, 30: 400 }),
      'Sales',
    );
    expect(deltas.last7d).toBe(100);
    expect(deltas.previous7d).toBe(80);
    expect(deltas.last30d).toBe(400);
    expect(deltas.bestAvailableWindowDays).toBe(30);
  });

  it('clamps negative deltas and flags inconsistency', () => {
    const deltas = calculateTrendDeltas(cumulativeTrend({ 0: 100, 7: 200, 14: 150 }), 'Sales');
    expect(deltas.last7d).toBe(0);
    expect(deltas.hasInconsistency).toBe(true);
  });
});

describe('Validation Engine V1 — archetypes', () => {
  it('strong winner: high demand, rising momentum, healthy saturation, strong trust', () => {
    const result = computeValidationEngineV1({
      product: baseProduct(),
      creatives: Array.from({ length: 8 }, (_, i) =>
        creative({ estimatedVideoGmv: 1500 + i * 50, isAd: i < 2 }),
      ),
      now: NOW,
    });

    expect(result.version).toBe('validds-validation-v1.0');
    expect(result.demand.score).toBeGreaterThanOrEqual(65);
    expect(result.momentum.score).toBeGreaterThanOrEqual(60);
    expect(result.saturation.saturationLabel).toMatch(/early_opportunity|validated_opportunity/);
    expect(result.trust.score).toBeGreaterThanOrEqual(60);
    expect(result.opportunityScore).not.toBeNull();
    expect(result.opportunityScore!).toBeGreaterThanOrEqual(65);
    expect(['strong_test', 'test_carefully']).toContain(result.verdict);
    expect(result.debug?.salesLast7d).toBe(100);
  });

  it('early opportunity: moderate demand, rising momentum, not crowded', () => {
    const result = computeValidationEngineV1({
      product: baseProduct({
        soldCount: 90,
        totalSales: 90,
        totalGmv: 2200,
        reviewCount: 18,
        creativeCounts: { ads: 0, organic: 3, reviews: 0, total: 3 },
        relatedVideosCount: 3,
        salesTrend: cumulativeTrend({ 0: 90, 7: 60, 14: 45 }),
        revenueTrend: cumulativeTrend({ 0: 2200, 7: 1400, 14: 1000 }),
      }),
      creatives: [
        creative({ estimatedVideoGmv: 800 }),
        creative({ estimatedVideoGmv: 600 }),
        creative({ estimatedVideoGmv: 400 }),
      ],
      now: NOW,
    });

    expect(result.saturation.saturationLabel).toBe('early_opportunity');
    expect(result.momentum.score).toBeGreaterThanOrEqual(55);
    expect(result.opportunityScore).not.toBeNull();
    expect(['strong_test', 'test_carefully', 'needs_more_proof']).toContain(result.verdict);
  });

  it('crowded product: strong demand but crowded + ad pressure', () => {
    const creatives = Array.from({ length: 45 }, (_, i) =>
      creative({
        isAd: i % 2 === 0,
        estimatedVideoGmv: i === 0 ? 50_000 : 200,
      }),
    );
    const result = computeValidationEngineV1({
      product: baseProduct({
        creativeCounts: { ads: 25, organic: 20, reviews: 0, total: 45 },
        relatedVideosCount: 45,
      }),
      creatives,
      now: NOW,
    });

    expect(['competitive', 'crowded_late']).toContain(result.saturation.saturationLabel);
    expect(result.riskFlags.some((f) => f.code === 'crowded_market')).toBe(true);
    expect(
      result.riskFlags.some(
        (f) => f.code === 'one_video_dependency' || f.code === 'heavy_ad_pressure',
      ),
    ).toBe(true);
  });

  it('stale product: lifetime demand exists but data is stale', () => {
    const result = computeValidationEngineV1({
      product: baseProduct({
        lastIngestedAt: new Date('2026-06-20T10:00:00.000Z'),
        dataSourceUpdatedAt: new Date('2026-06-20T10:00:00.000Z'),
        updatedAt: new Date('2026-06-20T10:00:00.000Z'),
        salesTrend: cumulativeTrend({ 0: 800, 7: 795, 14: 790, 30: 750 }),
        revenueTrend: cumulativeTrend({ 0: 16000, 7: 15900, 14: 15800, 30: 15000 }),
      }),
      creatives: [creative(), creative()],
      now: NOW,
    });

    expect(result.riskFlags.some((f) => f.code === 'stale_trend_data')).toBe(true);
    expect(result.momentum.score).toBeLessThan(70);
    expect(result.nextStep.toLowerCase()).toMatch(/watch|recent/);
  });

  it('low-confidence product: missing trends and weak review/creative evidence', () => {
    const result = computeValidationEngineV1({
      product: baseProduct({
        soldCount: 0,
        totalSales: 0,
        totalGmv: 0,
        rating: 0,
        reviewCount: 0,
        creativeCounts: { ads: 0, organic: 0, reviews: 0, total: 0 },
        relatedVideosCount: 0,
        aiIntelligence: { buyingSentimentScore: null },
        salesTrend: { direction: 'stable', changePercent: 0, windows: [] },
        revenueTrend: { direction: 'stable', changePercent: 0, windows: [] },
      }),
      creatives: [],
      now: NOW,
    });

    expect(result.demand.score).toBeNull();
    expect(result.momentum.score).toBeNull();
    expect(result.confidence.score).toBeLessThan(50);
    expect(result.opportunityScore).toBeNull();
    expect(result.verdict).toBe('needs_more_proof');
    expect(result.riskFlags.some((f) => f.code === 'low_confidence')).toBe(true);
  });

  it('bad trust product: demand exists but rating/sentiment weak', () => {
    const result = computeValidationEngineV1({
      product: baseProduct({
        rating: 2.8,
        reviewCount: 80,
        aiIntelligence: {
          buyingSentimentScore: 28,
          buyingSentimentLabel: 'negative',
          reviewSummary: { summary: 'Many complaints about quality.' },
        },
      }),
      creatives: Array.from({ length: 6 }, () => creative()),
      now: NOW,
    });

    expect(result.trust.score).toBeLessThan(40);
    expect(result.riskFlags.some((f) => f.code === 'weak_trust_signals')).toBe(true);
    expect(['test_carefully', 'needs_more_proof', 'avoid_for_now']).toContain(result.verdict);
    expect(result.nextStep.toLowerCase()).toMatch(/complaint|review/);
  });

  it('inconsistent trend product: negative deltas reduce confidence and cap verdict', () => {
    const result = computeValidationEngineV1({
      product: baseProduct({
        salesTrend: cumulativeTrend({ 0: 500, 7: 700, 14: 600, 30: 400 }),
        revenueTrend: cumulativeTrend({ 0: 10000, 7: 14000, 14: 12000, 30: 8000 }),
      }),
      creatives: Array.from({ length: 6 }, () => creative()),
      now: NOW,
    });

    expect(result.riskFlags.some((f) => f.code === 'trend_data_inconsistency')).toBe(true);
    expect(result.debug?.salesLast7d).toBe(0);
    // Cap: maximum test_carefully when inconsistency present
    expect(['test_carefully', 'needs_more_proof', 'avoid_for_now']).toContain(result.verdict);
    expect(result.verdict).not.toBe('strong_test');
  });

  it('exposes module shape fields on every module', () => {
    const result = computeValidationEngineV1({
      product: baseProduct(),
      creatives: [creative()],
      now: NOW,
    });
    for (const key of ['demand', 'momentum', 'saturation', 'trust', 'confidence'] as const) {
      const mod = result[key];
      expect(mod).toEqual(
        expect.objectContaining({
          score: expect.anything(),
          band: expect.any(String),
          label: expect.any(String),
          reason: expect.any(String),
          inputsUsed: expect.any(Array),
          missingInputs: expect.any(Array),
          caveats: expect.any(Array),
        }),
      );
    }
    expect(result.saturation.saturationLabel).toBeDefined();
    expect(result.nextStep.length).toBeGreaterThan(10);
    expect(result.reasons.length).toBeGreaterThan(0);
  });
});

/** Fixture products used to generate docs/validation-engine-v1-samples.json */
export const VALIDATION_SAMPLE_FIXTURES: Array<{
  name: string;
  product: ValidationProductInput;
  creatives: ValidationCreativeInput[];
}> = [
  {
    name: 'strong_winner',
    product: baseProduct(),
    creatives: Array.from({ length: 8 }, (_, i) =>
      creative({ estimatedVideoGmv: 1500 + i * 50, isAd: i < 2 }),
    ),
  },
  {
    name: 'early_opportunity',
    product: baseProduct({
      soldCount: 90,
      totalSales: 90,
      totalGmv: 2200,
      reviewCount: 18,
      creativeCounts: { ads: 0, organic: 3, reviews: 0, total: 3 },
      relatedVideosCount: 3,
      salesTrend: cumulativeTrend({ 0: 90, 7: 60, 14: 45 }),
      revenueTrend: cumulativeTrend({ 0: 2200, 7: 1400, 14: 1000 }),
    }),
    creatives: [
      creative({ estimatedVideoGmv: 800 }),
      creative({ estimatedVideoGmv: 600 }),
      creative({ estimatedVideoGmv: 400 }),
    ],
  },
  {
    name: 'crowded_product',
    product: baseProduct({
      creativeCounts: { ads: 25, organic: 20, reviews: 0, total: 45 },
      relatedVideosCount: 45,
    }),
    creatives: Array.from({ length: 45 }, (_, i) =>
      creative({
        isAd: i % 2 === 0,
        estimatedVideoGmv: i === 0 ? 50_000 : 200,
      }),
    ),
  },
  {
    name: 'stale_product',
    product: baseProduct({
      lastIngestedAt: new Date('2026-06-20T10:00:00.000Z'),
      dataSourceUpdatedAt: new Date('2026-06-20T10:00:00.000Z'),
      updatedAt: new Date('2026-06-20T10:00:00.000Z'),
      salesTrend: cumulativeTrend({ 0: 800, 7: 795, 14: 790, 30: 750 }),
      revenueTrend: cumulativeTrend({ 0: 16000, 7: 15900, 14: 15800, 30: 15000 }),
    }),
    creatives: [creative(), creative()],
  },
  {
    name: 'low_confidence_product',
    product: baseProduct({
      soldCount: 0,
      totalSales: 0,
      totalGmv: 0,
      rating: 0,
      reviewCount: 0,
      creativeCounts: { ads: 0, organic: 0, reviews: 0, total: 0 },
      relatedVideosCount: 0,
      aiIntelligence: { buyingSentimentScore: null },
      salesTrend: { direction: 'stable', changePercent: 0, windows: [] },
      revenueTrend: { direction: 'stable', changePercent: 0, windows: [] },
    }),
    creatives: [],
  },
];
