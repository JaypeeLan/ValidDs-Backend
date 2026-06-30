import mongoose from 'mongoose';
import {
  LISTABLE_PRODUCT_FILTER,
  PRODUCT_LISTING_DEDUPE_STAGES,
  PRODUCT_LISTING_FIELD_PROJECTION,
  ProductRepository,
} from '../db/repositories/product.repository';
import type { IProductModel } from '../models/product.model';
import type { IProductDocument } from '../models/product.model';
import type { IUserDocument } from '../models/user.model';
import {
  productPlayableCreativeLookupStages,
  creativeCollectionForProductCollection,
} from '../utils/creative-response.util';
import { mapFrontendCategories } from '../api/products/product-feed-filters.util';
import type { MarketCode } from '../utils/markets';

export const SIGNAL_WEIGHTS = {
  saved: 3,
  shopifyImport: 4,
  search: 2,
} as const;

export type PersonalizationProfile = {
  excludeIds: Set<string>;
  l1Weights: Map<string, number>;
  l2Weights: Map<string, number>;
  searchTexts: string[];
  priceSamples: number[];
};

type ProductSignal = {
  categoryL1?: string;
  categoryL2?: string;
  price?: number;
};

function addWeight(map: Map<string, number>, key: string | undefined, weight: number): void {
  const k = key?.trim();
  if (!k) return;
  map.set(k, (map.get(k) ?? 0) + weight);
}

function extractFilterCategories(filters?: Record<string, unknown>): {
  l1: string[];
  l2: string[];
} {
  const l1: string[] = [];
  const l2: string[] = [];
  if (!filters) return { l1, l2 };

  const rawCategory = filters.category ?? filters.categoryL1;
  if (Array.isArray(rawCategory)) {
    l1.push(...rawCategory.map(String));
  } else if (typeof rawCategory === 'string' && rawCategory.trim()) {
    l1.push(rawCategory);
  }

  const rawSub = filters.subcategory ?? filters.categoryL2;
  if (Array.isArray(rawSub)) {
    l2.push(...rawSub.map(String));
  } else if (typeof rawSub === 'string' && rawSub.trim()) {
    l2.push(rawSub);
  }

  return {
    l1: mapFrontendCategories(l1) ?? l1,
    l2: [...new Set(l2.map((v) => v.trim()).filter(Boolean))],
  };
}

export function buildPersonalizationProfile(
  user: Pick<IUserDocument, 'savedProducts' | 'searchHistory' | 'shopifyImportHistory'>,
  signalProducts: ProductSignal[],
  savedIdToProduct: Map<string, ProductSignal>,
  importIdToProduct: Map<string, ProductSignal>,
): PersonalizationProfile {
  const excludeIds = new Set<string>();
  const l1Weights = new Map<string, number>();
  const l2Weights = new Map<string, number>();
  const searchTexts: string[] = [];
  const priceSamples: number[] = [];

  for (const saved of user.savedProducts ?? []) {
    const id = String(saved.productId);
    excludeIds.add(id);
    const p = savedIdToProduct.get(id);
    if (p) {
      addWeight(l1Weights, p.categoryL1, SIGNAL_WEIGHTS.saved);
      addWeight(l2Weights, p.categoryL2, SIGNAL_WEIGHTS.saved);
      if (typeof p.price === 'number' && p.price > 0) priceSamples.push(p.price);
    }
  }

  for (const entry of user.shopifyImportHistory ?? []) {
    const id = String(entry.productId);
    excludeIds.add(id);
    const p = importIdToProduct.get(id);
    if (p) {
      addWeight(l1Weights, p.categoryL1, SIGNAL_WEIGHTS.shopifyImport);
      addWeight(l2Weights, p.categoryL2, SIGNAL_WEIGHTS.shopifyImport);
      if (typeof p.price === 'number' && p.price > 0) priceSamples.push(p.price);
    }
  }

  for (const entry of [...(user.searchHistory ?? [])].reverse().slice(0, 15)) {
    if (entry.query?.trim()) searchTexts.push(entry.query.trim());
    const { l1, l2 } = extractFilterCategories(entry.filters);
    for (const c of l1) addWeight(l1Weights, c, SIGNAL_WEIGHTS.search);
    for (const c of l2) addWeight(l2Weights, c, SIGNAL_WEIGHTS.search);
  }

  for (const p of signalProducts) {
    if (typeof p.price === 'number' && p.price > 0) priceSamples.push(p.price);
  }

  return { excludeIds, l1Weights, l2Weights, searchTexts, priceSamples };
}

function topWeightedKeys(weights: Map<string, number>, limit: number): string[] {
  return [...weights.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key]) => key);
}

function priceBand(samples: number[]): { min?: number; max?: number } {
  if (samples.length === 0) return {};
  const sorted = [...samples].sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.2)] ?? sorted[0]!;
  const hi = sorted[Math.ceil(sorted.length * 0.8) - 1] ?? sorted[sorted.length - 1]!;
  const pad = Math.max(5, (hi - lo) * 0.35);
  return { min: Math.max(0, lo - pad), max: hi + pad };
}

function dedupeProducts(rows: IProductDocument[]): IProductDocument[] {
  const seen = new Set<string>();
  const out: IProductDocument[] = [];
  for (const row of rows) {
    const id = String((row as { _id?: unknown })._id ?? '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(row);
  }
  return out;
}

async function queryPersonalizedProducts(
  profile: PersonalizationProfile,
  productModel: IProductModel,
  limit: number,
): Promise<IProductDocument[]> {
  const excludeObjectIds = [...profile.excludeIds]
    .filter((id) => mongoose.isValidObjectId(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  const topL2 = topWeightedKeys(profile.l2Weights, 5);
  const topL1 = topWeightedKeys(profile.l1Weights, 3);
  const band = priceBand(profile.priceSamples);

  const match: Record<string, unknown> = {
    ...LISTABLE_PRODUCT_FILTER,
    ...(excludeObjectIds.length ? { _id: { $nin: excludeObjectIds } } : {}),
  };

  if (topL2.length) {
    match.categoryL2 = topL2.length === 1 ? topL2[0] : { $in: topL2 };
  } else if (topL1.length) {
    match.categoryL1 = topL1.length === 1 ? topL1[0] : { $in: topL1 };
  }

  if (band.min != null || band.max != null) {
    match.price = {
      ...(band.min != null ? { $gte: band.min } : {}),
      ...(band.max != null ? { $lte: band.max } : {}),
    };
  }

  const sort = {
    totalGmv: -1 as const,
    'trends.engagement.score': -1 as const,
    'trend.score': -1 as const,
    lastIngestedAt: -1 as const,
  };

  let rows = (await productModel
    .aggregate([
      { $match: match },
      ...productPlayableCreativeLookupStages(
        creativeCollectionForProductCollection(productModel.collection.name),
      ),
      { $sort: sort },
      ...PRODUCT_LISTING_DEDUPE_STAGES,
      { $sort: sort },
      { $limit: limit },
      { $project: PRODUCT_LISTING_FIELD_PROJECTION },
    ])
    .option({ maxTimeMS: 15_000 })
    .exec()) as unknown as IProductDocument[];

  if (rows.length >= limit || profile.searchTexts.length === 0) {
    return rows;
  }

  const latestQuery = profile.searchTexts[0]!;
  const textRows = await ProductRepository.search(latestQuery, { page: 1, limit }, productModel);
  const merged = dedupeProducts([...rows, ...textRows.data]);
  return merged.slice(0, limit);
}

async function loadSignalProductMaps(
  user: Pick<IUserDocument, 'savedProducts' | 'shopifyImportHistory'>,
  productModel: IProductModel,
): Promise<{
  savedIdToProduct: Map<string, ProductSignal>;
  importIdToProduct: Map<string, ProductSignal>;
}> {
  const ids = new Set<string>();
  for (const s of user.savedProducts ?? []) ids.add(String(s.productId));
  for (const i of user.shopifyImportHistory ?? []) ids.add(String(i.productId));

  const objectIds = [...ids]
    .filter((id) => mongoose.isValidObjectId(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  const docs =
    objectIds.length === 0
      ? []
      : await productModel
          .find({ _id: { $in: objectIds } })
          .select({ categoryL1: 1, categoryL2: 1, price: 1 })
          .lean();

  const byId = new Map<string, ProductSignal>();
  for (const doc of docs) {
    byId.set(String(doc._id), {
      categoryL1: typeof doc.categoryL1 === 'string' ? doc.categoryL1 : undefined,
      categoryL2: typeof doc.categoryL2 === 'string' ? doc.categoryL2 : undefined,
      price: typeof doc.price === 'number' ? doc.price : undefined,
    });
  }

  const savedIdToProduct = new Map<string, ProductSignal>();
  for (const s of user.savedProducts ?? []) {
    const id = String(s.productId);
    const p = byId.get(id);
    if (p) savedIdToProduct.set(id, p);
  }

  const importIdToProduct = new Map<string, ProductSignal>();
  for (const i of user.shopifyImportHistory ?? []) {
    const id = String(i.productId);
    const p = byId.get(id);
    if (p) importIdToProduct.set(id, p);
  }

  return { savedIdToProduct, importIdToProduct };
}

function hasPersonalizationSignals(
  user: Pick<IUserDocument, 'savedProducts' | 'searchHistory' | 'shopifyImportHistory'>,
): boolean {
  return (
    (user.savedProducts?.length ?? 0) > 0 ||
    (user.shopifyImportHistory?.length ?? 0) > 0 ||
    (user.searchHistory?.length ?? 0) > 0
  );
}

export async function getPersonalizedProducts(
  user: IUserDocument,
  productModel: IProductModel,
  limit = 12,
): Promise<{ products: IProductDocument[]; personalized: boolean }> {
  if (!hasPersonalizationSignals(user)) {
    const fallback = await ProductRepository.findFeed(
      { page: 1, limit, sortBy: 'gmv-desc' },
      productModel,
    );
    return { products: fallback.data, personalized: false };
  }

  const { savedIdToProduct, importIdToProduct } = await loadSignalProductMaps(user, productModel);
  const profile = buildPersonalizationProfile(user, [], savedIdToProduct, importIdToProduct);
  const products = await queryPersonalizedProducts(profile, productModel, limit);
  return { products, personalized: true };
}

export async function getYouMayLikeProducts(
  productId: string,
  user: IUserDocument | undefined,
  productModel: IProductModel,
  _market: MarketCode,
  limit = 8,
): Promise<{ products: IProductDocument[]; personalized: boolean }> {
  if (!user || !hasPersonalizationSignals(user)) {
    return { products: [], personalized: false };
  }

  const { savedIdToProduct, importIdToProduct } = await loadSignalProductMaps(user, productModel);
  const profile = buildPersonalizationProfile(user, [], savedIdToProduct, importIdToProduct);
  profile.excludeIds.add(productId);

  const products = await queryPersonalizedProducts(profile, productModel, limit);
  return { products, personalized: true };
}
