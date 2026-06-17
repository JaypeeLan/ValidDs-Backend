import mongoose from 'mongoose';
import { User } from '../models/user.model';
import type { ProductFeedFilters } from '../db/repositories/product.repository';
import { logger } from '../logger';

const log = logger.child({ module: 'user-activity' });

function summarizeFeedFilters(filters?: ProductFeedFilters): string | undefined {
  if (!filters) return undefined;
  const parts: string[] = [];
  if (filters.category?.length) parts.push(`category:${filters.category.join(',')}`);
  if (filters.subcategory?.length) parts.push(`subcategory:${filters.subcategory.join(',')}`);
  if (filters.productKind) parts.push(`kind:${filters.productKind}`);
  if (filters.section) parts.push(`section:${filters.section}`);
  return parts.length ? parts.join(' ') : undefined;
}

function buildSearchHistoryLabel(query?: string, filters?: ProductFeedFilters): string | undefined {
  const q = query?.trim();
  if (q) return q.slice(0, 200);
  return summarizeFeedFilters(filters);
}

/** Fire-and-forget product discovery activity for personalization. */
export function recordProductDiscovery(
  userId: string,
  opts: {
    query?: string;
    filters?: ProductFeedFilters;
    resultCount?: number;
  },
): void {
  const label = buildSearchHistoryLabel(opts.query, opts.filters);
  if (!label) return;

  void User.updateOne(
    { _id: userId, status: 'active' },
    {
      $push: {
        searchHistory: {
          $each: [
            {
              query: label,
              filters: opts.filters as Record<string, unknown> | undefined,
              searchedAt: new Date(),
              resultCount: opts.resultCount,
            },
          ],
          $slice: -50,
        },
      },
      $inc: { 'usage.searchesTotal': 1, 'usage.searchesToday': 1 },
      $set: { 'usage.lastActivityAt': new Date() },
    },
  ).catch((err) => {
    log.debug('Failed to record product discovery', { userId, err: String(err) });
  });
}

export function recordShopifyImport(
  userId: string,
  productId: string,
  opts?: { shopifyProductId?: number; shop?: string },
): void {
  if (!mongoose.isValidObjectId(productId)) return;

  void User.updateOne(
    { _id: userId, status: 'active' },
    {
      $push: {
        shopifyImportHistory: {
          $each: [
            {
              productId: new mongoose.Types.ObjectId(productId),
              importedAt: new Date(),
              shopifyProductId: opts?.shopifyProductId,
              shop: opts?.shop,
            },
          ],
          $slice: -100,
        },
      },
      $set: { 'usage.lastActivityAt': new Date() },
    },
  ).catch((err) => {
    log.debug('Failed to record Shopify import', { userId, productId, err: String(err) });
  });
}
