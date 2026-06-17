import mongoose from 'mongoose';
import { ProductRepository } from '../db/repositories/product.repository';
import { IProductDocument, IProductModel } from '../models/product.model';
import { AIOrchestrator } from './ai.orchestrator';
import { CacheService } from '../cache/cache.service';
import { CacheKeys, CACHE_TTL } from '../cache/cache.keys';
import type { MarketCode } from '../utils/markets';
import { DEFAULT_MARKET } from '../utils/markets';
import { resolveEngagementTrend } from '../utils/product-trend.util';
import type {
  IAIIntelligence,
  ProductCompareAnalysis,
  ProductCompareItem,
  ProductCompareResponse,
} from '../types/product.types';
import { logger } from '../logger';

const log = logger.child({ module: 'product-compare' });

const COMPARE_SYSTEM_PROMPT = `You are a TikTok Shop product research analyst for ValidDs.
Compare the provided products for a seller deciding which opportunity to pursue or benchmark against.

Return JSON only with this shape:
{
  "summary": "2-4 sentences comparing the products overall",
  "recommendation": "1-2 sentences on which is the stronger opportunity and when to pick each",
  "products": [
    {
      "productId": "<mongo id>",
      "pros": ["2-4 specific strengths"],
      "cons": ["2-4 specific weaknesses"],
      "bestFor": "one line on the ideal seller or use case"
    }
  ],
  "dimensions": [
    {
      "label": "Price & value | Demand & sales | Competition | Trend momentum | Overall opportunity",
      "leaderId": "<mongo id or null if tie>",
      "note": "one sentence explaining the leader or tie"
    }
  ]
}

Rules:
- Use the numeric metrics provided; do not invent sales or ratings.
- Be direct and specific; no emojis.
- Include one entry in products for every input product id.`;

function maxCompetitorScore(suppliers: unknown): number | null {
  if (!Array.isArray(suppliers)) return null;
  let max: number | null = null;
  for (const row of suppliers) {
    const score = Number((row as { competitorScore?: number })?.competitorScore);
    if (Number.isFinite(score) && (max === null || score > max)) max = score;
  }
  return max;
}

function toPlain(product: IProductDocument): Record<string, unknown> {
  return { ...product } as Record<string, unknown>;
}

export function formatProductCompareItem(product: IProductDocument): ProductCompareItem {
  const plain = toPlain(product);
  const engagement = resolveEngagementTrend(plain);
  const rating = typeof plain.rating === 'number' && plain.rating > 0 ? plain.rating : undefined;

  return {
    id: String(product._id),
    title: String(plain.title ?? ''),
    primaryImageUrl: typeof plain.primaryImageUrl === 'string' ? plain.primaryImageUrl : undefined,
    price: typeof plain.price === 'number' ? plain.price : undefined,
    currency: typeof plain.currency === 'string' ? plain.currency : undefined,
    categoryL1: String(plain.categoryL1 ?? ''),
    categoryL2: typeof plain.categoryL2 === 'string' ? plain.categoryL2 : undefined,
    rating,
    totalSales: typeof plain.totalSales === 'number' ? plain.totalSales : undefined,
    totalGmv: typeof plain.totalGmv === 'number' ? plain.totalGmv : undefined,
    shopName: typeof plain.shopName === 'string' ? plain.shopName : undefined,
    competitionScore: maxCompetitorScore(plain.suppliers),
    trend: {
      score: engagement.score,
      direction: engagement.direction,
      isTrending: engagement.isTrending,
    },
  };
}

function buildAiPayload(products: IProductDocument[]): string {
  const payload = products.map((product) => {
    const plain = toPlain(product);
    const ai = (plain.aiIntelligence ?? {}) as IAIIntelligence;
    const pageSummary =
      typeof ai.pageSummary?.text === 'string' ? ai.pageSummary.text.slice(0, 600) : undefined;
    const reviewSummary =
      typeof ai.reviewSummary?.summary === 'string'
        ? ai.reviewSummary.summary.slice(0, 300)
        : undefined;

    return {
      id: String(product._id),
      title: plain.title,
      price: plain.price,
      currency: plain.currency,
      categoryL1: plain.categoryL1,
      categoryL2: plain.categoryL2,
      rating: plain.rating,
      reviewCount: plain.reviewCount,
      totalSales: plain.totalSales,
      totalGmv: plain.totalGmv,
      shopName: plain.shopName,
      competitionScore: maxCompetitorScore(plain.suppliers),
      trend: resolveEngagementTrend(plain),
      ai: {
        confidence: ai.confidence,
        productType: ai.productType,
        priceBand: ai.priceBand,
        problemStatement: ai.problemStatement,
        valueStatement: ai.valueStatement,
        pageSummary,
        reviewSummary,
        sentimentLabel:
          ai.buyingSentimentLabel ?? ai.marketingAnalysis?.sentimentLabel ?? undefined,
        marketingInsight: ai.marketingAnalysis?.marketingInsight,
      },
    };
  });

  return JSON.stringify({ products: payload }, null, 2);
}

function normalizeAnalysis(
  raw: ProductCompareAnalysis | null,
  products: IProductDocument[],
): ProductCompareAnalysis | null {
  if (!raw) return null;

  const validIds = new Set(products.map((p) => String(p._id)));
  const summary = String(raw.summary ?? '').trim();
  const recommendation = String(raw.recommendation ?? '').trim();
  if (!summary) return null;

  const productRows = Array.isArray(raw.products)
    ? raw.products
        .filter((row) => validIds.has(String(row.productId)))
        .map((row) => ({
          productId: String(row.productId),
          pros: Array.isArray(row.pros)
            ? row.pros
                .map((v) => String(v).trim())
                .filter(Boolean)
                .slice(0, 4)
            : [],
          cons: Array.isArray(row.cons)
            ? row.cons
                .map((v) => String(v).trim())
                .filter(Boolean)
                .slice(0, 4)
            : [],
          bestFor: String(row.bestFor ?? '').trim(),
        }))
    : [];

  const dimensions = Array.isArray(raw.dimensions)
    ? raw.dimensions
        .map((row) => ({
          label: String(row.label ?? '').trim(),
          leaderId:
            row.leaderId != null && validIds.has(String(row.leaderId))
              ? String(row.leaderId)
              : null,
          note: String(row.note ?? '').trim(),
        }))
        .filter((row) => row.label && row.note)
    : [];

  return {
    summary,
    recommendation,
    products: productRows,
    dimensions,
  };
}

function leaderByNumeric(
  products: IProductDocument[],
  pick: (plain: Record<string, unknown>) => number,
  higherIsBetter = true,
): string | null {
  let leaderId: string | null = null;
  let leaderValue: number | null = null;

  for (const product of products) {
    const value = pick(toPlain(product));
    if (!Number.isFinite(value)) continue;
    if (leaderValue == null || (higherIsBetter ? value > leaderValue : value < leaderValue)) {
      leaderValue = value;
      leaderId = String(product._id);
    }
  }

  return leaderId;
}

function buildFallbackAnalysis(products: IProductDocument[]): ProductCompareAnalysis {
  const items = products.map(formatProductCompareItem);
  const sortedByGmv = [...items].sort((a, b) => (b.totalGmv ?? 0) - (a.totalGmv ?? 0));
  const sortedByPrice = [...items].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
  const leaderGmv = sortedByGmv[0];
  const cheapest = sortedByPrice[0];

  const summary = items
    .map(
      (item) =>
        `${item.title}: $${item.price ?? '—'}, ${item.totalSales ?? 0} units sold, $${item.totalGmv ?? 0} GMV.`,
    )
    .join(' ');

  const recommendation =
    leaderGmv && cheapest
      ? `${leaderGmv.title} leads on GMV; ${cheapest.title} is the lower price point. Pick based on whether you want proven demand or a cheaper entry offer.`
      : 'Compare price, sales, and trend signals before choosing which product to pursue.';

  return {
    summary,
    recommendation,
    products: items.map((item) => ({
      productId: item.id,
      pros: [
        item.totalGmv ? `$${item.totalGmv.toLocaleString()} total GMV` : 'GMV data unavailable',
        item.rating ? `${item.rating}★ rating` : 'Rating unavailable',
      ],
      cons: [
        item.competitionScore != null && item.competitionScore >= 70
          ? 'Higher competition score'
          : 'Limited competitive context',
      ],
      bestFor:
        item.id === leaderGmv?.id
          ? 'Sellers prioritizing proven TikTok Shop demand'
          : 'Sellers testing a lower-priced offer',
    })),
    dimensions: [
      {
        label: 'Demand & sales',
        leaderId: leaderByNumeric(products, (p) => Number(p.totalGmv) || 0),
        note: 'Based on stored total GMV.',
      },
      {
        label: 'Price & value',
        leaderId: leaderByNumeric(products, (p) => Number(p.price) || Infinity, false),
        note: 'Lower price may be easier to convert; higher price can mean better margins.',
      },
      {
        label: 'Trend momentum',
        leaderId: leaderByNumeric(products, (p) => Number(resolveEngagementTrend(p).score) || 0),
        note: 'Based on engagement trend score.',
      },
    ],
  };
}

async function generateAnalysis(products: IProductDocument[]): Promise<ProductCompareAnalysis> {
  if (products.length < 2) {
    return {
      summary: 'At least two valid products are required for comparison.',
      recommendation: '',
      products: [],
      dimensions: [],
    };
  }

  try {
    const aiResult = await AIOrchestrator.extractJson<ProductCompareAnalysis>(
      COMPARE_SYSTEM_PROMPT,
      buildAiPayload(products),
      process.env.AI_PRIORITY === 'deepseek' ? 'deepseek' : 'gemini',
    );
    const normalized = normalizeAnalysis(aiResult, products);
    if (normalized) return normalized;
  } catch (err) {
    log.warn('AI product comparison failed, using fallback', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return buildFallbackAnalysis(products);
}

export async function compareProducts(
  ids: string[],
  productModel?: IProductModel,
  market: MarketCode = DEFAULT_MARKET,
): Promise<ProductCompareResponse> {
  const uniqueIds = [...new Set(ids.filter((id) => mongoose.isValidObjectId(id)))];
  const products = await ProductRepository.findByIdsForCompare(uniqueIds, productModel);
  const foundIds = new Set(products.map((product) => String(product._id)));
  const notFound = uniqueIds.filter((id) => !foundIds.has(id));

  const cacheKey = CacheKeys.productCompare(
    market,
    uniqueIds.filter((id) => foundIds.has(id)).join(','),
  );
  const analysis =
    products.length >= 2
      ? await CacheService.getOrSet(cacheKey, CACHE_TTL.PRODUCT_COMPARE, () =>
          generateAnalysis(products),
        )
      : null;

  return {
    products: products.map(formatProductCompareItem),
    analysis,
    notFound,
  };
}
