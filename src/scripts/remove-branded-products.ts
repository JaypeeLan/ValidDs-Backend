import 'dotenv/config';
import mongoose from 'mongoose';
import { env } from '../config/env.validation';
import { getMarketModels } from '../models/market-models.factory';
import { MARKET_CODES } from '../utils/markets';
import { matchedBlockedBrand, blockedBrandTerms } from '../utils/brand-blocklist.util';

/**
 * Remove (or archive) branded / big-name products that are not viable for
 * dropshipping (e.g. "Samsung Galaxy Buds 5 Pro", iPhone, PlayStation).
 *
 * Scans every market product collection, matching titles against the shared
 * brand blocklist (src/utils/brand-blocklist.util.ts).
 *
 * Usage:
 *   npx ts-node src/scripts/remove-branded-products.ts            # dry run (report only)
 *   npx ts-node src/scripts/remove-branded-products.ts --delete   # hard delete matches
 *   npx ts-node src/scripts/remove-branded-products.ts --archive  # set status=archived
 */

type Mode = 'dry' | 'delete' | 'archive';

function parseMode(): Mode {
  const args = process.argv.slice(2);
  if (args.includes('--delete')) return 'delete';
  if (args.includes('--archive')) return 'archive';
  return 'dry';
}

async function run() {
  const mode = parseMode();

  console.log(
    `Connecting to MongoDB (${env.MONGODB_DB_NAME}) at ${env.MONGODB_URI.replace(/:([^@]+)@/, ':****@')}...`,
  );
  await mongoose.connect(env.MONGODB_URI, { dbName: env.MONGODB_DB_NAME });
  console.log(`Mode: ${mode.toUpperCase()} | Blocked terms: ${blockedBrandTerms().length}\n`);

  let grandTotal = 0;
  let grandAffected = 0;

  try {
    for (const market of MARKET_CODES) {
      const { Product } = getMarketModels(market);
      const cursor = Product.find({}, { title: 1, listingTitleRaw: 1, status: 1 }).lean().cursor();

      const matchedIds: mongoose.Types.ObjectId[] = [];
      const samples: string[] = [];
      let scanned = 0;

      for await (const doc of cursor) {
        scanned += 1;
        const title = String((doc as { title?: string }).title ?? '');
        const rawTitle = String((doc as { listingTitleRaw?: string }).listingTitleRaw ?? '');
        const match = matchedBlockedBrand(rawTitle) ?? matchedBlockedBrand(title);
        if (match) {
          matchedIds.push((doc as { _id: mongoose.Types.ObjectId })._id);
          if (samples.length < 10) samples.push(`  · [${match}] ${title.slice(0, 80)}`);
        }
      }

      grandTotal += scanned;
      grandAffected += matchedIds.length;

      console.log(`[${market}] scanned ${scanned} · matched ${matchedIds.length}`);
      if (samples.length) console.log(samples.join('\n'));

      if (matchedIds.length === 0) continue;

      if (mode === 'delete') {
        const { Creative } = getMarketModels(market);
        const creativesRemoved = await Creative.deleteMany({ productId: { $in: matchedIds } });
        const res = await Product.deleteMany({ _id: { $in: matchedIds } });
        console.log(
          `  → deleted ${res.deletedCount} products, ${creativesRemoved.deletedCount} linked creatives`,
        );
      } else if (mode === 'archive') {
        const res = await Product.updateMany(
          { _id: { $in: matchedIds } },
          { $set: { status: 'archived', updatedAt: new Date() } },
        );
        console.log(`  → archived ${res.modifiedCount} products`);
      }
    }

    console.log(
      `\n--- ${mode === 'dry' ? 'DRY RUN' : 'DONE'} --- scanned ${grandTotal} products, ${grandAffected} branded match(es).`,
    );
    if (mode === 'dry' && grandAffected > 0) {
      console.log('Re-run with --delete (hard remove) or --archive to apply.');
    }
  } catch (err) {
    console.error('Error removing branded products:', err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

run().catch(console.error);
