import mongoose from 'mongoose';
import { Creative } from '../models/creative.model';
import type { IPrimaryCreator, IPrimaryCreatorApi } from '../types/product.types';

export type CreatorAvatarEnrichment = {
  creativeId: string;
  /** Creator profile image — stored on product as `primaryCreator.primaryImageUrl`. */
  primaryImageUrl?: string;
};

function pickUrl(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

/** Normalize creator avatar fields before persisting to MongoDB. */
export function normalizePrimaryCreatorForStorage(
  creator: IPrimaryCreator,
): IPrimaryCreator {
  const primaryImageUrl =
    pickUrl(creator.primaryImageUrl, creator.avatarUrl) ?? null;
  return {
    ...creator,
    primaryImageUrl,
    avatarUrl: primaryImageUrl,
  };
}

function creatorAvatarProxyPath(creativeId: string): string {
  const apiVersion = process.env.API_VERSION || 'v1';
  return `/api/${apiVersion}/creatives/${creativeId}/thumbnail?index=0&kind=avatar`;
}

/** Merge stored creator fields with optional creative fallback; attach proxy URL when a creative exists. */
export function normalizePrimaryCreatorOnProduct(
  product: Record<string, unknown>,
  enrichment?: CreatorAvatarEnrichment | null,
): void {
  const raw = product.primaryCreator as Record<string, unknown> | undefined | null;
  const hasEnrichment = Boolean(enrichment?.creativeId || enrichment?.primaryImageUrl);
  if ((!raw || typeof raw !== 'object') && !hasEnrichment) return;

  const pc = raw && typeof raw === 'object' ? { ...raw } : {};
  // Canonical creator avatar is primaryImageUrl; avatarUrl is kept in sync for legacy clients.
  const primaryImageUrl =
    pickUrl(pc.primaryImageUrl, pc.avatarUrl, enrichment?.primaryImageUrl) ?? null;

  const avatarProxyUrl =
    enrichment?.creativeId && primaryImageUrl
      ? creatorAvatarProxyPath(enrichment.creativeId)
      : pickUrl(pc.avatarProxyUrl);

  const apiCreator: IPrimaryCreatorApi = {
    handle: typeof pc.handle === 'string' ? pc.handle : '',
    displayName: typeof pc.displayName === 'string' ? pc.displayName : undefined,
    bio: typeof pc.bio === 'string' ? pc.bio : undefined,
    tiktokUserId: typeof pc.tiktokUserId === 'string' ? pc.tiktokUserId : undefined,
    followers: typeof pc.followers === 'number' ? pc.followers : undefined,
    following: typeof pc.following === 'number' ? pc.following : undefined,
    totalLikes: typeof pc.totalLikes === 'number' ? pc.totalLikes : undefined,
    region: typeof pc.region === 'string' ? pc.region : undefined,
    verified: typeof pc.verified === 'boolean' ? pc.verified : undefined,
    tiktokPostUrl: typeof pc.tiktokPostUrl === 'string' ? pc.tiktokPostUrl : undefined,
    primaryImageUrl,
    avatarUrl: primaryImageUrl,
    ...(avatarProxyUrl ? { avatarProxyUrl } : {}),
  };
  product.primaryCreator = apiCreator;
}

/** Top creative per product (by views) that has a creator avatar URL. */
export async function loadCreatorAvatarEnrichmentByProductId(
  productIds: string[],
): Promise<Map<string, CreatorAvatarEnrichment>> {
  const validIds = [
    ...new Set(
      productIds.filter((id) => mongoose.isValidObjectId(id)).map((id) => String(id)),
    ),
  ];
  if (!validIds.length) return new Map();

  const objectIds = validIds.map((id) => new mongoose.Types.ObjectId(id));

  const rows = await Creative.aggregate<{
    _id: mongoose.Types.ObjectId;
    creativeId: mongoose.Types.ObjectId;
    avatarUrl?: string;
  }>([
    {
      $match: {
        productId: { $in: objectIds },
        'creator.avatarUrl': { $type: 'string', $nin: [null, ''] },
      },
    },
    { $sort: { 'metrics.viewCount': -1 } },
    {
      $group: {
        _id: '$productId',
        creativeId: { $first: '$_id' },
        avatarUrl: { $first: '$creator.avatarUrl' },
      },
    },
  ]);

  const map = new Map<string, CreatorAvatarEnrichment>();
  for (const row of rows) {
    map.set(String(row._id), {
      creativeId: String(row.creativeId),
      primaryImageUrl: typeof row.avatarUrl === 'string' ? row.avatarUrl : undefined,
    });
  }
  return map;
}

export async function enrichProductsWithCreatorAvatars(
  products: Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
  if (!products.length) return products;

  const enrichments = await loadCreatorAvatarEnrichmentByProductId(
    products.map((p) => String(p._id ?? '')),
  );

  for (const product of products) {
    const id = String(product._id ?? '');
    normalizePrimaryCreatorOnProduct(product, enrichments.get(id) ?? null);
  }

  return products;
}
