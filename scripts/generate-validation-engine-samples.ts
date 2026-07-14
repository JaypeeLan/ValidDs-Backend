/**
 * One-shot generator: writes docs/validation-engine-v1-samples.json
 * Run: npx ts-node scripts/generate-validation-engine-samples.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { computeValidationEngineV1 } from '../src/services/validation-engine';
import type {
  ValidationCreativeInput,
  ValidationProductInput,
} from '../src/services/validation-engine';
import type { IMetricTrend } from '../src/types/product.types';

const NOW = new Date('2026-07-14T12:00:00.000Z');

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

function creative(overrides: Partial<ValidationCreativeInput> = {}): ValidationCreativeInput {
  return {
    isAd: false,
    estimatedVideoGmv: 1000,
    metrics: { viewCount: 50_000, likeCount: 2000, commentCount: 100, shareCount: 80 },
    ingestedAt: new Date('2026-07-12T00:00:00.000Z'),
    ...overrides,
  };
}

const fixtures: Array<{
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
  {
    name: 'bad_trust_product',
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
  },
];

const samples = {
  meta: {
    version: 'validds-validation-v1.0',
    trendWindowInterpretation: 'cumulative',
    apiPlacement: 'GET /api/v1/products/:id → data.validation (sibling of data.product)',
    notes: [
      'salesTrend.windows / revenueTrend.windows are daily-labeled cumulative snapshots (not daily increments).',
      'salesLast7d = value(daysAgo=0) - value(daysAgo=7); negative raw deltas clamp to 0 and emit trend_data_inconsistency.',
      'debug is included in V1 responses for product verification; frontend may ignore it.',
    ],
    fieldsUsed: [
      'salesTrend.windows',
      'revenueTrend.windows',
      'soldCount',
      'totalSales',
      'totalGmv',
      'price',
      'rating',
      'reviewCount',
      'aiIntelligence.buyingSentimentScore',
      'aiIntelligence.buyingSentimentLabel',
      'aiIntelligence.reviewSummary (caveats only)',
      'creativeCounts',
      'creatives.metrics.*',
      'creatives.isAd===true',
      'estimatedVideoGmv',
      'creatives.ingestedAt',
      'lastIngestedAt',
      'dataSourceUpdatedAt',
      'updatedAt',
    ],
    fieldsExcluded: [
      'suppliers / COGS / margin / shipping',
      'creative metrics.fetchedAt',
      'isAd=false as organic proof',
      'changePercent as primary growth metric',
      'supplier links',
    ],
  },
  samples: fixtures.map((f) => ({
    archetype: f.name,
    validation: computeValidationEngineV1({
      product: f.product,
      creatives: f.creatives,
      now: NOW,
    }),
  })),
};

const out = path.join(__dirname, '..', 'docs', 'validation-engine-v1-samples.json');
fs.writeFileSync(out, `${JSON.stringify(samples, null, 2)}\n`);
console.log(`Wrote ${out} with ${samples.samples.length} samples`);
