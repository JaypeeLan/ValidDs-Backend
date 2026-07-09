import 'dotenv/config';
import mongoose from 'mongoose';
import { env } from '../config/env.validation';
import { getMarketModels } from '../models/market-models.factory';
import { MARKET_CODES } from '../utils/markets';
import {
  expandExcludedProductCategoryL1FilterValues,
  isExcludedProductCategoryL1,
} from '../utils/excluded-product-categories.util';
import { matchedBlockedBrand } from '../utils/brand-blocklist.util';

/**
 * Archive electronics / tech gadget products (phones, earbuds, Samsung-class items).
 *
 * Usage:
 *   npx ts-node src/scripts/archive-gadget-products.ts            # dry run
 *   npx ts-node src/scripts/archive-gadget-products.ts --archive  # set status=archived
 *   npx ts-node src/scripts/archive-gadget-products.ts --delete   # hard delete + linked creatives
 */

type Mode = 'dry' | 'delete' | 'archive';
const BATCH_SIZE = 500;
const ACTIVE_FILTER = { status: { $nin: ['archived', 'invalid'] } };

function parseMode(): Mode {
  const args = process.argv.slice(2);
  if (args.includes('--delete')) return 'delete';
  if (args.includes('--archive')) return 'archive';
  return 'dry';
}

function isBrandedGadgetTitle(doc: { title?: string; listingTitleRaw?: string }): boolean {
  const title = String(doc.listingTitleRaw ?? doc.title ?? '');
  return Boolean(matchedBlockedBrand(title));
}

async function applyBatch(
  market: (typeof MARKET_CODES)[number],
  ids: mongoose.Types.ObjectId[],
  mode: Mode,
): Promise<number> {
  if (!ids.length) return 0;
  const { Product } = getMarketModels(market);

  if (mode === 'delete') {
    const { Creative } = getMarketModels(market);
    await Creative.deleteMany({ productId: { $in: ids } });
    const res = await Product.deleteMany({ _id: { $in: ids } });
    return res.deletedCount;
  }

  if (mode === 'archive') {
    const res = await Product.updateMany(
      { _id: { $in: ids } },
      { $set: { status: 'archived', updatedAt: new Date() } },
    );
    return res.modifiedCount;
  }

  return ids.length;
}

async function run() {
  const mode = parseMode();
  const excludedL1 = expandExcludedProductCategoryL1FilterValues();

  console.log(
    `Connecting to MongoDB (${env.MONGODB_DB_NAME}) at ${env.MONGODB_URI.replace(/:([^@]+)@/, ':****@')}...`,
  );
  await mongoose.connect(env.MONGODB_URI, { dbName: env.MONGODB_DB_NAME });
  console.log(`Mode: ${mode.toUpperCase()} | Excluded L1: ${excludedL1.join(', ')}\n`);

  let grandMatched = 0;
  let grandApplied = 0;

  try {
    for (const market of MARKET_CODES) {
      const { Product } = getMarketModels(market);
      let marketMatched = 0;
      let marketApplied = 0;
      const samples: string[] = [];

      const categoryCount = await Product.countDocuments({
        ...ACTIVE_FILTER,
        categoryL1: { $in: excludedL1 },
      });
      marketMatched += categoryCount;
      console.log(`[${market}] electronics category matches: ${categoryCount}`);

      if (categoryCount > 0) {
        if (mode === 'dry') {
          const preview = await Product.find(
            { ...ACTIVE_FILTER, categoryL1: { $in: excludedL1 } },
            { title: 1, categoryL1: 1 },
          )
            .limit(10)
            .lean();
          for (const row of preview) {
            samples.push(
              `  · [${String((row as { categoryL1?: string }).categoryL1 ?? '')}] ${String((row as { title?: string }).title ?? '').slice(0, 80)}`,
            );
          }
        } else if (mode === 'archive') {
          const res = await Product.updateMany(
            { ...ACTIVE_FILTER, categoryL1: { $in: excludedL1 } },
            { $set: { status: 'archived', updatedAt: new Date() } },
          );
          marketApplied += res.modifiedCount;
          console.log(`  → archived ${res.modifiedCount} by category`);
        } else {
          const ids = await Product.find(
            { ...ACTIVE_FILTER, categoryL1: { $in: excludedL1 } },
            { _id: 1 },
          ).lean();
          const objectIds = ids.map((row) => (row as { _id: mongoose.Types.ObjectId })._id);
          marketApplied += await applyBatch(market, objectIds, mode);
          console.log(`  → deleted ${marketApplied} by category`);
        }
      }

      const brandedCursor = Product.find(
        {
          ...ACTIVE_FILTER,
          categoryL1: { $nin: excludedL1 },
        },
        { title: 1, listingTitleRaw: 1, categoryL1: 1 },
      )
        .lean()
        .cursor();

      let brandedMatched = 0;
      let batch: mongoose.Types.ObjectId[] = [];

      for await (const doc of brandedCursor) {
        const row = doc as {
          _id: mongoose.Types.ObjectId;
          title?: string;
          listingTitleRaw?: string;
          categoryL1?: string;
        };
        if (isExcludedProductCategoryL1(row.categoryL1)) continue;
        if (!isBrandedGadgetTitle(row)) continue;

        brandedMatched += 1;
        if (samples.length < 10) {
          samples.push(
            `  · [${row.categoryL1 ?? 'brand/title'}] ${String(row.title ?? '').slice(0, 80)}`,
          );
        }

        if (mode === 'dry') continue;

        batch.push(row._id);
        if (batch.length >= BATCH_SIZE) {
          marketApplied += await applyBatch(market, batch, mode);
          batch = [];
        }
      }

      if (mode !== 'dry' && batch.length) {
        marketApplied += await applyBatch(market, batch, mode);
      }

      marketMatched += brandedMatched;
      console.log(
        `[${market}] branded title matches (non-electronics category): ${brandedMatched}`,
      );
      if (mode !== 'dry' && brandedMatched > 0) {
        console.log(
          `  → ${mode === 'archive' ? 'archived' : 'deleted'} ${marketApplied - (categoryCount > 0 && mode === 'archive' ? categoryCount : 0)} branded rows`,
        );
      }
      if (samples.length) console.log(samples.join('\n'));

      grandMatched += marketMatched;
      grandApplied += marketApplied;
    }

    console.log(
      `\n--- ${mode === 'dry' ? 'DRY RUN' : 'DONE'} --- matched ${grandMatched} gadget product(s).`,
    );
    if (mode !== 'dry') {
      console.log(`Applied to ${grandApplied} product(s).`);
    } else if (grandMatched > 0) {
      console.log('Re-run with --archive or --delete to apply.');
    }
  } catch (err) {
    console.error('Error archiving gadget products:', err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

run().catch(console.error);
