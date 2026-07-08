/**
 * Allocate parent product GMV across creatives on the same SKU by view share.
 *
 * This is an estimate — not TikTok-attributed revenue. See estimatedVideoGmvMethod
 * on each creative for how the share was derived.
 */

export type EstimatedVideoGmvMethod = 'view_share' | 'sole_video' | 'equal_split' | 'none';

export interface EstimatedVideoGmvAllocation {
  estimatedVideoGmv: number | null;
  estimatedVideoSales: number | null;
  /** Fraction of parent product GMV attributed to this video (0–1). */
  estimatedVideoGmvShare: number | null;
  estimatedVideoGmvMethod: EstimatedVideoGmvMethod;
}

export interface CreativeGmvInput {
  id: string;
  viewCount: number;
  productTotalGmv?: number | null;
  productTotalSales?: number | null;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function nonNegativeInt(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function nonNegativeMoney(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function allocateMoneyByShares(total: number, shares: number[]): number[] {
  if (shares.length === 0) return [];
  if (total <= 0) return shares.map(() => 0);

  const parts = shares.map((share) => roundMoney(total * share));
  const drift = roundMoney(total) - parts.reduce((sum, part) => sum + part, 0);
  if (drift !== 0) {
    const maxIdx = shares.reduce((best, share, idx) => (share > shares[best] ? idx : best), 0);
    parts[maxIdx] = roundMoney(parts[maxIdx] + drift);
  }
  return parts;
}

/** Largest-remainder method so unit counts sum exactly to the product total. */
function allocateUnitsByShares(total: number, shares: number[]): number[] {
  if (shares.length === 0) return [];
  if (total <= 0) return shares.map(() => 0);

  const exact = shares.map((share) => total * share);
  const floors = exact.map((value) => Math.floor(value));
  let remainder = total - floors.reduce((sum, value) => sum + value, 0);
  const ranked = exact
    .map((value, index) => ({ index, remainder: value - floors[index] }))
    .sort((a, b) => b.remainder - a.remainder);

  const out = [...floors];
  for (let i = 0; i < remainder; i += 1) {
    out[ranked[i % ranked.length].index] += 1;
  }
  return out;
}

function buildAllocation(
  productGmv: number,
  productSales: number,
  share: number,
  method: EstimatedVideoGmvMethod,
): EstimatedVideoGmvAllocation {
  const gmvParts = allocateMoneyByShares(productGmv, [share]);
  const salesParts = allocateUnitsByShares(productSales, [share]);
  return {
    estimatedVideoGmv: productGmv > 0 ? gmvParts[0] : null,
    estimatedVideoSales: productSales > 0 ? salesParts[0] : null,
    estimatedVideoGmvShare: share,
    estimatedVideoGmvMethod: method,
  };
}

/**
 * Given all creatives for one product, return per-creative estimated GMV allocations.
 */
export function computeEstimatedVideoGmvAllocations(
  creatives: CreativeGmvInput[],
): Map<string, EstimatedVideoGmvAllocation> {
  const result = new Map<string, EstimatedVideoGmvAllocation>();
  if (creatives.length === 0) return result;

  const productGmv = nonNegativeMoney(creatives[0].productTotalGmv);
  const productSales = nonNegativeInt(creatives[0].productTotalSales);

  if (productGmv <= 0 && productSales <= 0) {
    for (const creative of creatives) {
      result.set(creative.id, {
        estimatedVideoGmv: null,
        estimatedVideoSales: null,
        estimatedVideoGmvShare: null,
        estimatedVideoGmvMethod: 'none',
      });
    }
    return result;
  }

  if (creatives.length === 1) {
    result.set(creatives[0].id, buildAllocation(productGmv, productSales, 1, 'sole_video'));
    return result;
  }

  const views = creatives.map((creative) => nonNegativeInt(creative.viewCount));
  const totalViews = views.reduce((sum, count) => sum + count, 0);

  let shares: number[];
  let method: EstimatedVideoGmvMethod;
  if (totalViews > 0) {
    shares = views.map((count) => count / totalViews);
    method = 'view_share';
  } else {
    shares = creatives.map(() => 1 / creatives.length);
    method = 'equal_split';
  }

  const gmvParts = allocateMoneyByShares(productGmv, shares);
  const salesParts = allocateUnitsByShares(productSales, shares);

  creatives.forEach((creative, index) => {
    result.set(creative.id, {
      estimatedVideoGmv: productGmv > 0 ? gmvParts[index] : null,
      estimatedVideoSales: productSales > 0 ? salesParts[index] : null,
      estimatedVideoGmvShare: shares[index],
      estimatedVideoGmvMethod: method,
    });
  });

  return result;
}
