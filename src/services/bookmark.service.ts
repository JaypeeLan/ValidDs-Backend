import type { Model } from 'mongoose';
import type { IUserDocument } from '../models/user.model';
import type { ICreativeDocument } from '../models/creative.model';
import type { IProductModel } from '../models/product.model';
import type { BookmarkItem } from '../types/user.types';
import type { ISavedCreative, ISavedProduct } from '../types/user.types';
import { enrichCreativesWithResolvedVideoS3Keys } from '../services/meta-video-s3-resolve.service';
import { enrichProductsWithCreatorAvatars } from '../utils/product-response.util';
import { formatProductFeedItem } from '../utils/product-feed-format.util';
import { formatCreativeFeedItem } from '../utils/creative-response.util';

type BookmarkMeta = {
  savedAt: Date;
  notes?: string;
  tags?: string[];
};

function bookmarkMeta(entry: ISavedProduct | ISavedCreative): BookmarkMeta {
  return {
    savedAt: entry.savedAt,
    notes: entry.notes,
    tags: entry.tags,
  };
}

function attachMeta<T extends BookmarkMeta>(item: T, meta: BookmarkMeta): T {
  return {
    ...item,
    savedAt: meta.savedAt,
    ...(meta.notes ? { notes: meta.notes } : {}),
    ...(meta.tags?.length ? { tags: meta.tags } : {}),
  };
}

export function countUserBookmarks(user: IUserDocument): number {
  return (user.savedProducts?.length ?? 0) + (user.savedCreatives?.length ?? 0);
}

/**
 * Saved products and creatives with full feed-card fields at the top level plus bookmark metadata.
 */
export async function formatUserBookmarks(
  user: IUserDocument,
  creativeModel?: Model<ICreativeDocument>,
  productModel?: IProductModel,
): Promise<BookmarkItem[]> {
  const productEntries = user.savedProducts ?? [];
  const creativeEntries = user.savedCreatives ?? [];
  if (!productEntries.length && !creativeEntries.length) return [];

  const bookmarks: BookmarkItem[] = [];

  if (productEntries.length && productModel) {
    const metaList = productEntries.map((entry) => ({
      productId: String(entry.productId),
      ...bookmarkMeta(entry),
    }));
    const ids = metaList.map((m) => m.productId).filter(Boolean);
    const productRows = await productModel
      .find({ _id: { $in: ids } })
      .lean()
      .exec();
    const productById = new Map(
      productRows.map((row) => [
        String((row as { _id: unknown })._id),
        row as Record<string, unknown>,
      ]),
    );
    const productDocs = metaList
      .map((m) => productById.get(m.productId))
      .filter((p): p is Record<string, unknown> => Boolean(p));
    const enriched = await enrichProductsWithCreatorAvatars(productDocs, creativeModel);
    const enrichedById = new Map(enriched.map((p) => [String(p._id ?? p.id), p]));

    for (const meta of metaList) {
      const plain = enrichedById.get(meta.productId);
      if (!plain) continue;
      bookmarks.push(
        attachMeta(
          {
            kind: 'product',
            ...formatProductFeedItem(plain),
          },
          meta,
        ),
      );
    }
  }

  if (creativeEntries.length && creativeModel) {
    const metaList = creativeEntries.map((entry) => ({
      creativeId: String(entry.creativeId),
      ...bookmarkMeta(entry),
    }));
    const ids = metaList.map((m) => m.creativeId).filter(Boolean);
    const creativeRows = await creativeModel
      .find({ _id: { $in: ids } })
      .lean()
      .exec();
    const enrichedRows = await enrichCreativesWithResolvedVideoS3Keys(
      creativeRows as Record<string, unknown>[],
      creativeModel,
    );
    const creativeById = new Map(
      enrichedRows.map((row) => [
        String((row as { _id?: unknown; id?: unknown })._id ?? row.id),
        row,
      ]),
    );

    for (const meta of metaList) {
      const plain = creativeById.get(meta.creativeId);
      if (!plain) continue;
      bookmarks.push(
        attachMeta(
          {
            kind: 'creative',
            ...formatCreativeFeedItem(plain),
          },
          meta,
        ),
      );
    }
  }

  return bookmarks.sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
}
